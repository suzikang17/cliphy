import Anthropic from "@anthropic-ai/sdk";

// A stretch of one person's texts, read once, into the distinct things they
// asked for. The per-message reading (interpret.ts) answers "what is this
// message?"; this answers "over the last week, what does she want done?".
//
// The model proposes. Everything it returns is checked here: ids must be ones
// it was given, and a quote must be in the message word for word, or the
// whole message is shown instead. A quote the owner reads is always text the
// person actually sent.

// Under the server's own 60 second limit, so a slow read fails with words, not a blank page.
const anthropic = new Anthropic({ timeout: 55_000, maxRetries: 0 });

/** Many messages, careful grouping, and the owner acts on the result: the better model. */
export const DIGEST_MODEL = "claude-sonnet-5-5";
const TOOL_NAME = "record_requests";

export interface DigestContext {
  personName: string;
  /** YYYY-MM-DD, the owner's date. */
  today: string;
  messages: {
    id: string;
    sentAt: string;
    direction: "in" | "out";
    text: string;
    /** How many pictures came with it. They are not shown to the model. */
    pictures: number;
  }[];
  openTasks: { id: string; title: string }[];
  projects: { id: string; name: string }[];
}

export interface DigestQuoteRef {
  messageId: string;
  /** Their words, exactly as stored. Empty for a message that was only pictures. */
  text: string;
}

export interface DigestItemRef {
  title: string;
  detail: string;
  quotes: DigestQuoteRef[];
  /** An open task that already covers it. */
  taskId: string | null;
  projectId: string | null;
  dueDate: string | null;
  /** The owner already said, in the thread, that it was done. */
  answered: boolean;
}

export interface DigestGroupRef {
  name: string;
  items: DigestItemRef[];
}

const SYSTEM_PROMPT = `You read a stretch of text messages between a freelance designer ("Me") and one client, and list every distinct thing the client asked for.

Always answer by calling the ${TOOL_NAME} tool exactly once. Never answer in prose.

How to list:
- One item per distinct thing to do. A single message often holds several: split them.
- When the client repeats, clarifies or changes an earlier ask, keep ONE item that says what they want now, and quote each message that bears on it.
- Leave out greetings, thanks and chatter that asks for nothing.
- title: a few words, starting with a verb, no trailing period. Example: "Move the front photo down".
- detail: one or two plain sentences with every specific needed to do the work: which page, which picture, what wording, by when. Say only what the messages say. If something needed is not said, say what is missing.
- quotes: for each item, the client's own words that ask for it. Copy the text character for character from the message, and give that message's id. Quote the sentence or sentences that matter, not the whole message, unless the whole message is the ask. For a message that is only pictures, give its id with empty text. Never quote Me.
- taskId: the id of a listed open task that already covers the item, else null.
- projectId: the id of the listed project it belongs to, else null.
- dueDate: YYYY-MM-DD only if the client gave a deadline, resolved against today's date. Else null.
- answered: true only when a later message from Me says this was done.

Group the items by what they concern (for example a page or section of the site, or a separate deliverable). Group names are two or three words. Order groups and items by when they were first asked.

Only use ids that appear in what you are given.`;

const TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description: "Record every distinct request found in the messages. Call exactly once.",
  input_schema: {
    type: "object",
    properties: {
      groups: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  detail: { type: "string" },
                  quotes: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        messageId: { type: "string" },
                        text: { type: "string" },
                      },
                      required: ["messageId", "text"],
                    },
                  },
                  taskId: { type: ["string", "null"] },
                  projectId: { type: ["string", "null"] },
                  dueDate: { type: ["string", "null"], description: "YYYY-MM-DD" },
                  answered: { type: "boolean" },
                },
                required: ["title", "detail", "quotes"],
              },
            },
          },
          required: ["name", "items"],
        },
      },
    },
    required: ["groups"],
  },
};

export function buildDigestPrompt(ctx: DigestContext): { system: string; user: string } {
  const lines: string[] = [`Today: ${ctx.today}`, `Client: ${ctx.personName}`, ""];

  lines.push("Projects:");
  for (const p of ctx.projects) lines.push(`- ${p.id}: ${p.name}`);
  if (ctx.projects.length === 0) lines.push("(none)");

  lines.push("", "Open tasks already on the list:");
  for (const t of ctx.openTasks) lines.push(`- ${t.id}: ${t.title}`);
  if (ctx.openTasks.length === 0) lines.push("(none)");

  lines.push("", "Messages, oldest first:");
  for (const m of ctx.messages) {
    const who = m.direction === "out" ? "Me" : ctx.personName;
    const pictures =
      m.pictures > 0 ? ` (${m.pictures} ${m.pictures === 1 ? "picture" : "pictures"})` : "";
    lines.push(`[${m.id}] ${m.sentAt.slice(0, 10)} ${who}${pictures}:`, m.text, "");
  }
  return { system: SYSTEM_PROMPT, user: lines.join("\n") };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Find `quote` in `source` ignoring differences in spacing and line breaks,
 * and return the matching stretch of `source` itself. Null when it is not there.
 */
function exactStretch(source: string, quote: string): string | null {
  const words = quote.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const pattern = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  const found = new RegExp(pattern).exec(source);
  return found ? found[0] : null;
}

/** Keep only what checks out against the messages, tasks and projects that were given. */
export function parseDigest(raw: unknown, ctx: DigestContext): DigestGroupRef[] {
  if (!isObj(raw) || !Array.isArray(raw.groups)) return [];
  const theirs = new Map(
    ctx.messages.filter((m) => m.direction === "in").map((m) => [m.id, m.text.trim()]),
  );
  const taskIds = new Set(ctx.openTasks.map((t) => t.id));
  const projectIds = new Set(ctx.projects.map((p) => p.id));

  const groups: DigestGroupRef[] = [];
  for (const group of raw.groups) {
    if (!isObj(group) || !Array.isArray(group.items)) continue;
    const items: DigestItemRef[] = [];
    for (const item of group.items) {
      if (!isObj(item) || !text(item.title)) continue;
      const quotes: DigestQuoteRef[] = [];
      for (const quote of Array.isArray(item.quotes) ? item.quotes : []) {
        if (!isObj(quote) || typeof quote.messageId !== "string") continue;
        const source = theirs.get(quote.messageId);
        if (source === undefined) continue;
        // Their words as stored: the stretch that was quoted, or all of it.
        quotes.push({
          messageId: quote.messageId,
          text: source ? (exactStretch(source, text(quote.text)) ?? source) : "",
        });
      }
      if (quotes.length === 0) continue;
      const due = text(item.dueDate);
      items.push({
        title: text(item.title),
        detail: text(item.detail),
        quotes,
        taskId: typeof item.taskId === "string" && taskIds.has(item.taskId) ? item.taskId : null,
        projectId:
          typeof item.projectId === "string" && projectIds.has(item.projectId)
            ? item.projectId
            : null,
        dueDate: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
        answered: item.answered === true,
      });
    }
    if (items.length > 0) groups.push({ name: text(group.name) || "Other", items });
  }
  return groups;
}

/** Read the messages and return the requests found in them, checked. */
export async function findRequests(ctx: DigestContext): Promise<DigestGroupRef[]> {
  const prompt = buildDigestPrompt(ctx);
  // Current models reject a forced tool call, so the tool is offered with
  // `auto` and the system prompt requires it (as interpret.ts does).
  const response = await anthropic.messages.create({
    model: DIGEST_MODEL,
    max_tokens: 16000,
    system: prompt.system,
    tools: [TOOL],
    tool_choice: { type: "auto" },
    messages: [{ role: "user", content: prompt.user }],
  });
  if ((response.stop_reason as string) === "refusal") {
    throw new Error("The model refused to read these messages");
  }
  const call = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === TOOL_NAME,
  );
  if (!call) throw new Error("The model returned no requests");
  return parseDigest(call.input, ctx);
}
