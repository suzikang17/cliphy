import type { Attachment, InboundMessage } from "@cliphy/shared";
import { inngest } from "../lib/inngest.js";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { downloadImage } from "../lib/storage.js";
import { toMessage } from "../lib/coachMappers.js";
import {
  interpretBundle,
  type InterpretContext,
  type Interpretation,
} from "../services/coach/interpret.js";
import { replyArrived, requestArrived } from "../services/coach/botMessages.js";
import { postBotMessage } from "../services/coach/chat.js";
import { projectTag } from "../services/coach/projects.js";
import { loadSettings } from "../services/coach/reminders.js";
import { localParts } from "../services/coach/time.js";
import { createImageClip } from "../services/imageClip.js";

const log = logger.child({ fn: "coach-process-bundle" });

type Row = Record<string, unknown>;

interface BundleRow {
  id: string;
  person_id: string;
  historical: boolean;
}

/** Save each attachment as a Library clip and note the clip on its message. */
async function clipAttachments(messages: Row[], userId: string, tags: string[]): Promise<void> {
  for (const m of messages) {
    const attachments = ((m.attachments as Row[]) ?? []).map((a) => ({ ...a }));
    let changed = false;
    for (const a of attachments) {
      if (a.clipId || typeof a.storagePath !== "string") continue;
      try {
        const clip = await createImageClip(userId, a.storagePath, tags);
        a.clipId = clip.id;
        changed = true;
      } catch (err) {
        // The request matters more than its Library copy; carry on without the clip.
        log.warn("Could not create clip for attachment", { messageId: m.id, err: String(err) });
      }
    }
    if (changed) {
      await supabase
        .from("coach_messages")
        .update({ attachments })
        .eq("id", m.id as string)
        .eq("user_id", userId);
    }
  }
}

/** The project to file under: the chosen one, or a new one the model named. */
async function resolveProject(
  interp: Interpretation,
  personId: string,
  userId: string,
): Promise<{ id: string; tag: string } | null> {
  if (interp.projectId) {
    const { data } = await supabase
      .from("coach_projects")
      .select("id, tag")
      .eq("id", interp.projectId)
      .eq("user_id", userId)
      .maybeSingle();
    return (data as { id: string; tag: string } | null) ?? null;
  }
  if (!interp.newProjectName) return null;

  const tag = projectTag(interp.newProjectName);
  if (tag === "project:") return null;

  const { data: created } = await supabase
    .from("coach_projects")
    .insert({ user_id: userId, name: interp.newProjectName, tag })
    .select("id, tag")
    .single();
  let project = created as { id: string; tag: string } | null;
  if (!project) {
    // Most likely the tag already exists (unique per user): use that project.
    const { data: existing } = await supabase
      .from("coach_projects")
      .select("id, tag")
      .eq("user_id", userId)
      .eq("tag", tag)
      .maybeSingle();
    project = (existing as { id: string; tag: string } | null) ?? null;
  }
  if (project) {
    await supabase
      .from("coach_project_people")
      .upsert(
        { project_id: project.id, person_id: personId },
        { onConflict: "project_id,person_id", ignoreDuplicates: true },
      );
  }
  return project;
}

/**
 * Write what a bundle was understood to be.
 * - chat: nothing.
 * - reply: linked to the waiting ask it answers.
 * - request: one request row (idempotent per bundle) holding the proposed
 *   chain; tasks are only created when the user confirms it.
 */
export async function storeInterpretation(
  bundle: BundleRow,
  messages: Row[],
  interp: Interpretation,
  userId: string,
): Promise<{ requestId: string | null }> {
  if (interp.kind === "chat") return { requestId: null };

  if (interp.kind === "reply") {
    if (interp.repliesToTaskId) {
      await supabase
        .from("coach_tasks")
        .update({ reply_bundle_id: bundle.id })
        .eq("id", interp.repliesToTaskId)
        .eq("user_id", userId);
    }
    await clipAttachments(messages, userId, []);
    return { requestId: null };
  }

  const project = await resolveProject(interp, bundle.person_id, userId);
  const historical = bundle.historical === true;

  const { data, error } = await supabase
    .from("coach_requests")
    .upsert(
      {
        user_id: userId,
        bundle_id: bundle.id,
        person_id: bundle.person_id,
        project_id: project?.id ?? null,
        understood: interp.understood,
        open_question: historical ? null : interp.question,
        // Read from a thread's past: history only, nothing to confirm or do.
        status: historical ? "closed" : "new",
        historical,
        proposed_replaces_id: historical ? null : interp.replacesRequestId,
        proposed_tasks: historical ? [] : interp.tasks,
        due_date: historical ? null : interp.dueDate,
      },
      { onConflict: "bundle_id" },
    )
    .select("id")
    .single();
  if (error || !data) throw new Error(`Failed to store request for bundle ${bundle.id}`);

  await clipAttachments(messages, userId, project ? [project.tag] : []);
  return { requestId: (data as { id: string }).id };
}

/** The sweep stops re-reading a bundle once the job has given up on it this many times. */
export const MAX_BUNDLE_ATTEMPTS = 3;
/** A bundle still unread this long after its last message was never announced, or its job died. */
const STUCK_AFTER_MS = 10 * 60_000;

/**
 * Called when the job's retries are exhausted. Messages stay stored; the sweep
 * re-reads the bundle until it has failed MAX_BUNDLE_ATTEMPTS times.
 */
export async function markBundleFailed(bundleId: string, userId: string): Promise<void> {
  const { data } = await supabase
    .from("coach_bundles")
    .select("attempts")
    .eq("id", bundleId)
    .eq("user_id", userId)
    .maybeSingle();
  const attempts = ((data as { attempts?: number } | null)?.attempts ?? 0) + 1;
  await supabase
    .from("coach_bundles")
    .update({ status: "failed", attempts })
    .eq("id", bundleId)
    .eq("user_id", userId);
}

async function loadContext(
  bundle: Row,
  userId: string,
): Promise<{ ctx: InterpretContext; messages: Row[] }> {
  const personId = bundle.person_id as string;
  const [messagesRes, personRes, projectsRes, requestsRes, asksRes] = await Promise.all([
    supabase
      .from("coach_messages")
      .select("*")
      .eq("bundle_id", bundle.id as string)
      .eq("user_id", userId)
      .order("sent_at", { ascending: true }),
    supabase.from("coach_people").select("id, name").eq("id", personId).maybeSingle(),
    supabase
      .from("coach_projects")
      .select("id, name, tag")
      .eq("user_id", userId)
      .eq("active", true),
    supabase
      .from("coach_requests")
      .select("id, project_id, understood")
      .eq("user_id", userId)
      .eq("person_id", personId)
      .in("status", ["new", "confirmed", "closed"])
      .neq("bundle_id", bundle.id as string)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("coach_tasks")
      .select("id, title")
      .eq("user_id", userId)
      .eq("with_person_id", personId)
      .eq("kind", "ask")
      .eq("state", "waiting"),
  ]);

  const projects = (projectsRes.data as { id: string; name: string; tag: string }[]) ?? [];
  const hints = new Map<string, string>();
  if (projects.length > 0) {
    const { data: hintRows } = await supabase
      .from("tag_hints")
      .select("tag, hints")
      .eq("user_id", userId)
      .in(
        "tag",
        projects.map((p) => p.tag),
      );
    for (const h of (hintRows as { tag: string; hints: string }[]) ?? []) hints.set(h.tag, h.hints);
  }

  const person = personRes.data as { id: string; name: string } | null;
  const { timezone } = await loadSettings(userId);
  const { data: ruleRows } = await supabase
    .from("coach_rules")
    .select("sentence")
    .eq("user_id", userId)
    .eq("active", true)
    .limit(50);
  return {
    messages: (messagesRes.data as Row[]) ?? [],
    ctx: {
      person: { id: personId, name: person?.name ?? "Someone" },
      // "By Wednesday" means the user's Wednesday, so today is their date, not the server's.
      today: localParts(new Date(), timezone).date,
      projects: projects.map((p) => ({ id: p.id, name: p.name, hints: hints.get(p.tag) ?? "" })),
      recentRequests: (
        (requestsRes.data as { id: string; project_id: string | null; understood: string }[]) ?? []
      ).map((r) => ({ id: r.id, projectId: r.project_id, understood: r.understood })),
      waitingAsks: (asksRes.data as { id: string; title: string }[]) ?? [],
      fixNote: (bundle.fix_note as string) ?? null,
      rules: ((ruleRows as { sentence: string }[]) ?? []).map((r) => r.sentence),
    },
  };
}

/** Turn a bundle of captured messages into a request, a linked reply, or nothing. */
type BundleEvent = { data: unknown };
type BundleStep = { run: <T>(name: string, fn: () => Promise<T>) => Promise<T> };

const RETRIES = 2;

async function runBundle({
  event,
  step,
  attempt = 0,
}: {
  event: BundleEvent;
  step: BundleStep;
  attempt?: number;
}) {
  const { bundleId, userId } = event.data as { bundleId: string; userId: string };

  const bundle = await step.run("claim-bundle", async () => {
    const { data } = await supabase
      .from("coach_bundles")
      .select("*")
      .eq("id", bundleId)
      .eq("user_id", userId)
      .maybeSingle();
    const row = data as Row | null;
    if (!row || row.status === "done") return null;
    await supabase
      .from("coach_bundles")
      .update({ status: "processing" })
      .eq("id", bundleId)
      .eq("user_id", userId);
    return row;
  });
  if (!bundle) return { skipped: true };

  // Load, download and interpret in one step: image bytes do not survive
  // being passed between steps.
  const { interp, messages, waitingAsks } = await step.run("interpret", async () => {
    const { ctx, messages } = await loadContext(bundle, userId);
    const parsed: InboundMessage[] = messages.map(toMessage);

    const images: { bytes: Buffer; mediaType: string }[] = [];
    for (const m of parsed) {
      for (const a of m.attachments) {
        try {
          const { bytes } = await downloadImage(a.storagePath);
          // The type recorded at capture, not one guessed from the file name:
          // a HEIC photo must not reach the model labelled as a JPEG.
          images.push({ bytes, mediaType: a.mediaType });
        } catch (err) {
          // A screenshot may be the whole request, so a storage hiccup is
          // retried. Only the last attempt reads the bundle without it.
          if (attempt < RETRIES) throw err;
          log.warn("Could not download attachment", { path: a.storagePath, err: String(err) });
        }
      }
    }
    return {
      interp: await interpretBundle(parsed, images, ctx),
      messages,
      waitingAsks: ctx.waitingAsks,
    };
  });

  const { requestId } = await step.run("store", () =>
    storeInterpretation(
      {
        id: bundleId,
        person_id: bundle.person_id as string,
        historical: bundle.historical === true,
      },
      messages,
      interp,
      userId,
    ),
  );

  // Say it in the chat thread. Posting is keyed on the request or bundle, so
  // a retry of this run cannot say it twice. History read from the past is silent.
  await step.run("announce", async () => {
    if (bundle.historical === true) return;
    if (interp.kind === "request" && requestId) {
      const attachments = messages.flatMap((m) => (m.attachments as Attachment[]) ?? []);
      await postBotMessage(
        userId,
        requestArrived(
          { id: requestId, understood: interp.understood, openQuestion: interp.question },
          attachments,
        ),
      );
    } else if (interp.kind === "reply") {
      const ask = waitingAsks.find((t) => t.id === interp.repliesToTaskId) ?? null;
      await postBotMessage(userId, replyArrived(ask, interp.understood, bundleId));
    }
  });

  await step.run("finish", async () => {
    await supabase
      .from("coach_bundles")
      .update({ status: "done", kind: interp.kind, fix_note: null })
      .eq("id", bundleId)
      .eq("user_id", userId);
  });

  return { kind: interp.kind, requestId };
}

const onFailure = async ({ event }: { event: { data: { event: { data: unknown } } } }) => {
  const { bundleId, userId } = event.data.event.data as { bundleId: string; userId: string };
  await markBundleFailed(bundleId, userId);
};

// One bundle at a time per user: a later bundle must see the request an
// earlier one produced (to propose replacing it), and a backfill of many
// bundles must not burst into rate limits.
const PER_USER = [{ key: "event.data.userId", limit: 1 }];

/** New messages: wait until the sender has been quiet, then read the bundle once. */
export const BUNDLE_JOB = {
  id: "coach-process-bundle",
  retries: RETRIES,
  // `timeout` bounds the wait, so a thread that never pauses is still read.
  debounce: { key: "event.data.bundleId", period: "3m", timeout: "15m" },
  concurrency: PER_USER,
  triggers: [{ event: "coach/bundle.touched" }],
  onFailure,
} as const;

/** "Fix it" and the sweep: read a bundle straight away. */
export const RETRY_JOB = {
  id: "coach-reprocess-bundle",
  retries: RETRIES,
  concurrency: PER_USER,
  triggers: [{ event: "coach/bundle.fix" }, { event: "coach/bundle.retry" }],
  onFailure,
} as const;

export const processBundle = inngest.createFunction(BUNDLE_JOB as never, runBundle as never);
export const reprocessBundle = inngest.createFunction(RETRY_JOB as never, runBundle as never);

/**
 * Safety net: nothing captured may sit unread. Re-announces bundles that were
 * stored but never read (the upload died before announcing them, or the job
 * died mid-run) and failed bundles that still have attempts left.
 */
export const sweepBundles = inngest.createFunction(
  { id: "coach-sweep-bundles", triggers: [{ cron: "*/10 * * * *" }] },
  async ({ step }) => {
    const stale = await step.run("find-stale", async () => {
      const cutoff = new Date(Date.now() - STUCK_AFTER_MS).toISOString();
      const [stuck, failed] = await Promise.all([
        supabase
          .from("coach_bundles")
          .select("id, user_id")
          .eq("status", "collecting")
          .lt("last_message_at", cutoff)
          .limit(100),
        supabase
          .from("coach_bundles")
          .select("id, user_id")
          .eq("status", "failed")
          .lt("attempts", MAX_BUNDLE_ATTEMPTS)
          .limit(100),
      ]);
      type Stale = { id: string; user_id: string };
      return [...((stuck.data as Stale[]) ?? []), ...((failed.data as Stale[]) ?? [])];
    });

    for (const b of stale) {
      await inngest.send({
        name: "coach/bundle.retry",
        data: { bundleId: b.id, userId: b.user_id },
      });
    }
    return { resent: stale.length };
  },
);
