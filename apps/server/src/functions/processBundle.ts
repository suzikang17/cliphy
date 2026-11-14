import type { InboundMessage } from "@cliphy/shared";
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
import { projectTag } from "../services/coach/projects.js";
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

/** Called when retries are exhausted. Messages stay stored; the bundle can be reprocessed. */
export async function markBundleFailed(bundleId: string, userId: string): Promise<void> {
  await supabase
    .from("coach_bundles")
    .update({ status: "failed" })
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
      .in("status", ["new", "confirmed"])
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
  return {
    messages: (messagesRes.data as Row[]) ?? [],
    ctx: {
      person: { id: personId, name: person?.name ?? "Someone" },
      today: new Date().toISOString().slice(0, 10),
      projects: projects.map((p) => ({ id: p.id, name: p.name, hints: hints.get(p.tag) ?? "" })),
      recentRequests: (
        (requestsRes.data as { id: string; project_id: string | null; understood: string }[]) ?? []
      ).map((r) => ({ id: r.id, projectId: r.project_id, understood: r.understood })),
      waitingAsks: (asksRes.data as { id: string; title: string }[]) ?? [],
      fixNote: (bundle.fix_note as string) ?? null,
    },
  };
}

/** Turn a bundle of captured messages into a request, a linked reply, or nothing. */
type BundleEvent = { data: unknown };
type BundleStep = { run: <T>(name: string, fn: () => Promise<T>) => Promise<T> };

async function runBundle({ event, step }: { event: BundleEvent; step: BundleStep }) {
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
  const { interp, messages } = await step.run("interpret", async () => {
    const { ctx, messages } = await loadContext(bundle, userId);
    const parsed: InboundMessage[] = messages.map(toMessage);

    const images: { bytes: Buffer; mediaType: string }[] = [];
    for (const m of parsed) {
      for (const a of m.attachments) {
        try {
          images.push(await downloadImage(a.storagePath));
        } catch (err) {
          log.warn("Could not download attachment", { path: a.storagePath, err: String(err) });
        }
      }
    }
    return { interp: await interpretBundle(parsed, images, ctx), messages };
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

/** New messages: wait until the sender has been quiet, then read the bundle once. */
export const processBundle = inngest.createFunction(
  {
    id: "coach-process-bundle",
    retries: 2,
    debounce: { key: "event.data.bundleId", period: "3m" },
    triggers: [{ event: "coach/bundle.touched" }],
    onFailure,
  },
  runBundle as never,
);

/** "Fix it": read the same bundle again straight away, with the user's correction. */
export const reprocessBundle = inngest.createFunction(
  {
    id: "coach-reprocess-bundle",
    retries: 2,
    triggers: [{ event: "coach/bundle.fix" }],
    onFailure,
  },
  runBundle as never,
);
