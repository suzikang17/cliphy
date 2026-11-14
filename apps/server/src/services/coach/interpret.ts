import Anthropic from "@anthropic-ai/sdk";
import {
  BUNDLE_KINDS,
  MAX_QUESTION_OPTIONS,
  TASK_KINDS,
  type BundleKind,
  type InboundMessage,
  type OpenQuestion,
  type ProposedTask,
  type TaskKind,
  type TaskKit,
} from "@cliphy/shared";

const anthropic = new Anthropic({ timeout: 120_000 });

export const INTERPRET_MODEL = "claude-opus-5-5";
/**
 * For bundles read from a thread's past. They only become a line of history
 * (no question, no tasks), and a whole-thread import can be thousands of them.
 */
export const HISTORY_MODEL = "claude-haiku-5-5";
const TOOL_NAME = "record_interpretation";
/** How many images one reading may carry, and how large each may be (raw bytes). */
const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 3_500_000;
/** Image formats the model can read. Anything else is described, not sent. */
const READABLE_IMAGES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type ReadableImage = (typeof READABLE_IMAGES)[number];

export interface InterpretContext {
  person: { id: string; name: string };
  /** YYYY-MM-DD, the user's date. */
  today: string;
  projects: { id: string; name: string; hints: string }[];
  recentRequests: { id: string; projectId: string | null; understood: string }[];
  /** `ask` tasks waiting on this person. */
  waitingAsks: { id: string; title: string }[];
  /** What the user said was wrong with an earlier reading of this bundle. */
  fixNote: string | null;
  /** Plain sentences learned from the user's earlier answers. Applied before asking again. */
  rules?: string[];
}

export interface Interpretation {
  kind: BundleKind;
  understood: string;
  projectId: string | null;
  newProjectName: string | null;
  question: OpenQuestion | null;
  replacesRequestId: string | null;
  repliesToTaskId: string | null;
  dueDate: string | null;
  tasks: ProposedTask[];
}

const SYSTEM_PROMPT = `You read messages a creative professional received from someone they work with, and record what, if anything, is being asked of them.

Always answer by calling the ${TOOL_NAME} tool exactly once. Never answer in prose.

Decide the kind:
- "request": the person wants something done, changed, sent or decided.
- "reply": the messages answer one of the listed questions the professional is waiting on. Set repliesToTaskId to that question's id.
- "chat": anything else (thanks, small talk, scheduling chatter that asks for nothing). Leave every other field empty.

For a request:
- understood: at most two plain sentences. Always keep who asked, what for, and by when if they said. Example: "Maren asked to replace the page 2 text with new copy by Wednesday." No filler.
- projectId: the id of the listed project this belongs to. If it clearly belongs to a project that is not listed, leave projectId null and give newProjectName. If you cannot tell, leave both null.
- question: ask ONE question only when the request is truly ambiguous in a way that changes the work. Give up to 3 answer options of at most 2 words each. Otherwise null.
- replacesRequestId: the id of a listed earlier request ONLY when this request targets the same thing on the same project and supersedes it. Otherwise null.
- dueDate: YYYY-MM-DD only if the person gave a deadline. Resolve words like "Wednesday" against today's date.
- tasks: a short chain, in order. Each task has exactly one kind:
  - "do": work the professional does. Put what done means in kit.doneWhen, where it goes in kit.target, and the materials needed in kit.materials.
  - "tell": tell the person something. Put a short draft message in kit.draft.
  - "ask": ask the person for something. Put a short draft message in kit.draft.
  - "get": a real-world errand, such as buying supplies.
  Use after (the index of an earlier task in this list) when a task must wait for another. If you asked a question, include one "ask" task for it with answersQuestion true, and make the work wait on it. A typical small change is: ask (if ambiguous), do, then tell the person it is done.
  Titles are short: a few words, no trailing period.

Only use ids that appear in the context you are given.`;

const TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description: "Record how the messages were understood. Call exactly once.",
  input_schema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: [...BUNDLE_KINDS] },
      understood: { type: "string" },
      projectId: { type: ["string", "null"] },
      newProjectName: { type: ["string", "null"] },
      question: {
        type: ["object", "null"],
        properties: {
          text: { type: "string" },
          options: { type: "array", items: { type: "string" } },
        },
      },
      replacesRequestId: { type: ["string", "null"] },
      repliesToTaskId: { type: ["string", "null"] },
      dueDate: { type: ["string", "null"], description: "YYYY-MM-DD" },
      tasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: [...TASK_KINDS] },
            title: { type: "string" },
            withPerson: { type: "boolean" },
            after: { type: ["integer", "null"] },
            answersQuestion: { type: "boolean" },
            kit: {
              type: "object",
              properties: {
                materials: { type: "array", items: { type: "string" } },
                target: { type: "string" },
                doneWhen: { type: "string" },
                draft: { type: "string" },
              },
            },
          },
          required: ["kind", "title"],
        },
      },
    },
    required: ["kind", "understood"],
  },
};

// ── Parsing ──────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

const EMPTY: Interpretation = {
  kind: "chat",
  understood: "",
  projectId: null,
  newProjectName: null,
  question: null,
  replacesRequestId: null,
  repliesToTaskId: null,
  dueDate: null,
  tasks: [],
};

function parseKit(raw: unknown): TaskKit {
  if (!isObj(raw)) return {};
  const kit: TaskKit = {};
  if (Array.isArray(raw.materials)) {
    const materials = raw.materials.map(text).filter(Boolean);
    if (materials.length) kit.materials = materials;
  }
  for (const key of ["target", "doneWhen", "draft"] as const) {
    const value = text(raw[key]);
    if (value) kit[key] = value;
  }
  return kit;
}

function parseQuestion(raw: unknown): OpenQuestion | null {
  if (!isObj(raw)) return null;
  const question = text(raw.text);
  if (!question) return null;
  const options = (Array.isArray(raw.options) ? raw.options : [])
    .map(text)
    .filter(Boolean)
    .slice(0, MAX_QUESTION_OPTIONS);
  return { text: question, options };
}

function parseTasks(raw: unknown, hasQuestion: boolean): ProposedTask[] {
  if (!Array.isArray(raw)) return [];
  // Model index → index among the tasks we keep, so `after` survives dropped tasks.
  const keptIndex = new Map<number, number>();
  const tasks: ProposedTask[] = [];
  let answerTaken = false;

  raw.forEach((item, modelIndex) => {
    if (!isObj(item)) return;
    const kind = item.kind as TaskKind;
    const title = text(item.title);
    if (!TASK_KINDS.includes(kind) || !title) return;

    const afterModel = Number.isInteger(item.after) ? (item.after as number) : null;
    const after = afterModel !== null ? (keptIndex.get(afterModel) ?? null) : null;

    const answersQuestion = hasQuestion && !answerTaken && item.answersQuestion === true;
    if (answersQuestion) answerTaken = true;

    keptIndex.set(modelIndex, tasks.length);
    tasks.push({
      kind,
      title,
      withPerson:
        typeof item.withPerson === "boolean" ? item.withPerson : kind === "tell" || kind === "ask",
      after,
      answersQuestion,
      kit: parseKit(item.kit),
    });
  });
  return tasks;
}

/**
 * Turn whatever the model returned into a safe Interpretation.
 * Pure, and never throws: unusable input becomes ordinary chat. Ids are kept
 * only when they appear in the context, so a made-up or foreign id is never written.
 */
export function parseInterpretation(raw: unknown, ctx: InterpretContext): Interpretation {
  if (!isObj(raw) || !BUNDLE_KINDS.includes(raw.kind as BundleKind)) return { ...EMPTY };
  const kind = raw.kind as BundleKind;
  const understood = text(raw.understood);

  if (kind === "chat") return { ...EMPTY };

  if (kind === "reply") {
    const id = text(raw.repliesToTaskId);
    return {
      ...EMPTY,
      kind,
      understood,
      repliesToTaskId: ctx.waitingAsks.some((t) => t.id === id) ? id : null,
    };
  }

  if (!understood) return { ...EMPTY };

  const projectId = ctx.projects.some((p) => p.id === raw.projectId)
    ? (raw.projectId as string)
    : null;
  const replacesRequestId = ctx.recentRequests.some((r) => r.id === raw.replacesRequestId)
    ? (raw.replacesRequestId as string)
    : null;
  const question = parseQuestion(raw.question);
  const due = text(raw.dueDate);

  return {
    kind,
    understood,
    projectId,
    newProjectName: projectId ? null : text(raw.newProjectName) || null,
    question,
    replacesRequestId,
    repliesToTaskId: null,
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(due) && due >= ctx.today ? due : null,
    tasks: parseTasks(raw.tasks, question !== null),
  };
}

// ── Prompt ───────────────────────────────────────────────────────────────

function contextText(ctx: InterpretContext): string {
  const list = (rows: string[]) => (rows.length ? rows.join("\n") : "(none)");
  const parts = [
    `Today is ${ctx.today}.`,
    `The messages are from ${ctx.person.name}.`,
    `Projects:\n${list(
      ctx.projects.map((p) => `- ${p.id}: ${p.name}${p.hints ? ` (${p.hints})` : ""}`),
    )}`,
    `Earlier requests from ${ctx.person.name}:\n${list(
      ctx.recentRequests.map((r) => `- ${r.id}: ${r.understood}`),
    )}`,
    `Questions waiting on ${ctx.person.name}:\n${list(
      ctx.waitingAsks.map((t) => `- ${t.id}: ${t.title}`),
    )}`,
  ];
  if (ctx.rules?.length) {
    parts.push(
      `What you have learned from this user's earlier answers. Apply these; do not ask about them again:\n${ctx.rules
        .map((r) => `- ${r}`)
        .join("\n")}`,
    );
  }
  if (ctx.fixNote) {
    parts.push(`An earlier reading of these messages was wrong. The correction: ${ctx.fixNote}`);
  }
  return parts.join("\n\n");
}

export function buildInterpretMessages(
  messages: InboundMessage[],
  images: { bytes: Buffer; mediaType: string }[],
  ctx: InterpretContext,
): Anthropic.MessageParam[] {
  const content: Anthropic.ContentBlockParam[] = [{ type: "text", text: contextText(ctx) }];

  // Captures are kept at full quality, but a reading has a size budget: images
  // in a format the model cannot read, too large, or past the count limit are
  // left out and counted so the model knows something is missing.
  let unreadable = 0;
  let sent = 0;
  for (const image of images) {
    if (
      !READABLE_IMAGES.includes(image.mediaType as ReadableImage) ||
      image.bytes.length > MAX_IMAGE_BYTES ||
      sent >= MAX_IMAGES
    ) {
      unreadable++;
      continue;
    }
    sent++;
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: image.mediaType as ReadableImage,
        data: image.bytes.toString("base64"),
      },
    });
  }

  const lines = [...messages]
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt))
    .filter((m) => m.text.trim())
    .map((m) => {
      const who = m.direction === "out" ? "Me" : ctx.person.name;
      return `[${m.sentAt}] ${who}: ${m.text.trim()}`;
    });

  const notes: string[] = [];
  if (unreadable > 0) {
    notes.push(`(${unreadable} image${unreadable === 1 ? "" : "s"} could not be read)`);
  }
  content.push({
    type: "text",
    text: [
      "Messages:",
      lines.length ? lines.join("\n") : "(no text was sent with these)",
      ...notes,
    ].join("\n"),
  });

  return [{ role: "user", content }];
}

// ── Call ─────────────────────────────────────────────────────────────────

export async function interpretBundle(
  messages: InboundMessage[],
  images: { bytes: Buffer; mediaType: string }[],
  ctx: InterpretContext,
  /** `model` overrides the default, e.g. the small model for reading old history. */
  opts: { model?: string } = {},
): Promise<Interpretation> {
  // Current models reject a forced tool call, so the tool is offered with
  // `auto` and the system prompt requires it. A reply without it is an error
  // the caller retries, never a silent "chat".
  const response = await anthropic.messages.create({
    model: opts.model ?? INTERPRET_MODEL,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    tools: [TOOL],
    tool_choice: { type: "auto" },
    messages: buildInterpretMessages(messages, images, ctx),
  });

  if ((response.stop_reason as string) === "refusal") {
    throw new Error("Interpretation refused by the model");
  }
  const call = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === TOOL_NAME,
  );
  if (!call) throw new Error("Model returned no interpretation");
  return parseInterpretation(call.input, ctx);
}
