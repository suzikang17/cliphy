import Anthropic from "@anthropic-ai/sdk";
import { TASK_KINDS, type CoachTask } from "@cliphy/shared";
import { supabase } from "../../lib/supabase.js";
import { logger } from "../../lib/logger.js";
import { semanticSearch } from "../search.js";
import { executeAction, markTaskSent, setTaskState } from "./actions.js";
import { ruleLearned } from "./botMessages.js";
import { listMessages, postBotMessage } from "./chat.js";
import { loadSettings, syncTaskReminders } from "./reminders.js";
import { fixRequest } from "./requestActions.js";
import { createTask, taskColumns } from "./taskInput.js";
import { loadTasks } from "./taskStore.js";
import { localParts } from "./time.js";
import { buildUpNext } from "./upNext.js";
import { toPerson, toProject } from "../../lib/coachMappers.js";

const anthropic = new Anthropic({ timeout: 120_000 });
const log = logger.child({ service: "coach-agent" });

export const AGENT_MODEL = "claude-opus-5-5";
export const LEARN_MODEL = "claude-haiku-5-5";
/** The most model turns one user message may take. Ends a model that keeps calling tools. */
export const MAX_AGENT_TURNS = 6;

type Row = Record<string, unknown>;

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const SYSTEM = `You are the assistant inside an app for a creative professional. You keep track of requests from the people they work with, the tasks those become, and reminders.

How to answer:
- State the fact and stop. One or two short sentences. No greetings, no filler, no exclamation marks, no offers of further help.
- When the user asks you to do something, do it with a tool, then say what you did in a few words.
- When the user tells you something that needs no action, reply in a few words and call no tools.
- Never invent ids. Use only ids from the context below. If you cannot tell which task or request they mean, ask one short question.
- A task has exactly one kind: "do" (work they do), "tell" (tell someone something), "ask" (ask someone for something), "get" (a real-world errand).
- Dates are YYYY-MM-DD and times HH:MM (24-hour), in the user's own timezone. Resolve "tomorrow" or "Friday" against today's date in the context.
- Use "remember" only for a lasting preference or meaning the user states, never for a one-off instruction.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "answer_request",
    description: "Answer the open question on a new request and turn the request into its tasks.",
    input_schema: {
      type: "object",
      properties: { requestId: { type: "string" }, answer: { type: "string" } },
      required: ["requestId", "answer"],
    },
  },
  {
    name: "confirm_request",
    description: "Confirm a new request as understood, creating its tasks.",
    input_schema: {
      type: "object",
      properties: { requestId: { type: "string" } },
      required: ["requestId"],
    },
  },
  {
    name: "fix_request",
    description: "A new request was misunderstood. Re-read it with the user's correction.",
    input_schema: {
      type: "object",
      properties: { requestId: { type: "string" }, note: { type: "string" } },
      required: ["requestId", "note"],
    },
  },
  {
    name: "create_task",
    description: "Create a task of the user's own, optionally dated.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: [...TASK_KINDS] },
        title: { type: "string", description: "A few words, no trailing period." },
        dueDate: { type: "string", description: "YYYY-MM-DD" },
        dueTime: { type: "string", description: "HH:MM; needs dueDate" },
        projectId: { type: "string" },
        personId: { type: "string", description: "Who a tell or ask is with." },
        place: { type: "string", description: "For get tasks: where." },
        checklist: {
          type: "array",
          items: { type: "string" },
          description: "For get tasks: items.",
        },
      },
      required: ["kind", "title"],
    },
  },
  {
    name: "update_task",
    description: "Change a task's title, date or time, or mark it done, dropped or open again.",
    input_schema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        title: { type: "string" },
        dueDate: { type: ["string", "null"] },
        dueTime: { type: ["string", "null"] },
        state: { type: "string", enum: ["done", "dropped", "open"] },
      },
      required: ["taskId"],
    },
  },
  {
    name: "mark_sent",
    description: "The user sent the message for a tell or ask task.",
    input_schema: {
      type: "object",
      properties: { taskId: { type: "string" } },
      required: ["taskId"],
    },
  },
  {
    name: "list_up_next",
    description: "What is overdue, due this week, waiting on others and on the back burner.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "search_library",
    description: "Search the user's saved clips (videos, articles, images, notes) by meaning.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "remember",
    description:
      "Keep a lasting rule the user stated, as one plain sentence. The user is shown it and can undo it.",
    input_schema: {
      type: "object",
      properties: { sentence: { type: "string" } },
      required: ["sentence"],
    },
  },
];

interface AgentContext {
  userId: string;
  timezone: string;
  today: string;
  tasks: CoachTask[];
  taskIds: Set<string>;
  newRequestIds: Set<string>;
  text: string;
}

async function loadContext(userId: string): Promise<AgentContext> {
  const [{ tasks }, requestsRes, peopleRes, projectsRes, rulesRes, settings, recent] =
    await Promise.all([
      loadTasks(userId),
      supabase
        .from("coach_requests")
        .select("*")
        .eq("user_id", userId)
        .eq("status", "new")
        .order("created_at", { ascending: false })
        .limit(10),
      supabase.from("coach_people").select("*").eq("user_id", userId),
      supabase.from("coach_projects").select("*").eq("user_id", userId).eq("active", true),
      supabase
        .from("coach_rules")
        .select("sentence")
        .eq("user_id", userId)
        .eq("active", true)
        .limit(50),
      loadSettings(userId),
      listMessages(userId, { limit: 12 }),
    ]);

  const now = new Date();
  const local = localParts(now, settings.timezone);
  const requests = (requestsRes.data as Row[]) ?? [];
  const live = tasks.filter((t) => t.state === "open" || t.state === "waiting").slice(0, 40);
  const list = (rows: string[]) => (rows.length ? rows.join("\n") : "(none)");

  const text = [
    `Today is ${DAYS[local.dow]} ${local.date}, ${local.time} in ${settings.timezone}.`,
    `New requests awaiting the user:\n${list(
      requests.map((r) => {
        const q = r.open_question as { text?: string } | null;
        return `- ${r.id}: ${r.understood}${q?.text ? ` Open question: ${q.text}` : ""}`;
      }),
    )}`,
    `Open tasks:\n${list(
      live.map(
        (t) =>
          `- ${t.id}: [${t.kind}] ${t.title}` +
          `${t.dueDate ? ` due ${t.dueDate}${t.dueTime ? ` ${t.dueTime.slice(0, 5)}` : ""}` : ""}` +
          `${t.state === "waiting" ? " (waiting on someone)" : ""}${t.blocked ? " (blocked)" : ""}`,
      ),
    )}`,
    `People:\n${list(((peopleRes.data as Row[]) ?? []).map((p) => `- ${p.id}: ${p.name} (${p.role})`))}`,
    `Projects:\n${list(((projectsRes.data as Row[]) ?? []).map((p) => `- ${p.id}: ${p.name}`))}`,
    `What you have learned:\n${list(
      ((rulesRes.data as { sentence: string }[]) ?? []).map((r) => `- ${r.sentence}`),
    )}`,
    `Recent conversation:\n${list(
      recent.map((m) => `${m.role === "user" ? "User" : "You"}: ${m.text.replace(/\s+/g, " ")}`),
    )}`,
  ].join("\n\n");

  return {
    userId,
    timezone: settings.timezone,
    today: local.date,
    tasks,
    taskIds: new Set(tasks.map((t) => t.id)),
    newRequestIds: new Set(requests.map((r) => r.id as string)),
    text,
  };
}

class ToolError extends Error {}
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Run one tool call. Throws ToolError for anything the model got wrong; nothing is written then. */
async function runTool(ctx: AgentContext, name: string, raw: unknown): Promise<string> {
  const input = (typeof raw === "object" && raw !== null ? raw : {}) as Row;
  const { userId } = ctx;

  const needRequest = (): string => {
    const id = str(input.requestId);
    if (!ctx.newRequestIds.has(id)) throw new ToolError("No new request with that id.");
    return id;
  };
  const needTask = (): string => {
    const id = str(input.taskId);
    if (!ctx.taskIds.has(id)) throw new ToolError("No task with that id.");
    return id;
  };

  switch (name) {
    case "answer_request": {
      const requestId = needRequest();
      const answer = str(input.answer);
      if (!answer) throw new ToolError("answer is required.");
      const r = await executeAction(userId, { type: "answer_request", requestId, answer });
      return r.say ?? "Nothing changed.";
    }
    case "confirm_request": {
      const r = await executeAction(userId, { type: "confirm_request", requestId: needRequest() });
      return r.say ?? "Nothing changed.";
    }
    case "fix_request": {
      const r = await fixRequest(userId, needRequest(), input.note);
      if (r.status !== 202) throw new ToolError(r.body.error);
      return "Reading it again with that correction.";
    }
    case "create_task": {
      const checklist = Array.isArray(input.checklist)
        ? input.checklist
            .map(str)
            .filter(Boolean)
            .map((text) => ({ text, done: false }))
        : undefined;
      const r = await createTask(userId, {
        kind: input.kind,
        title: input.title,
        dueDate: input.dueDate ?? undefined,
        dueTime: input.dueTime ?? undefined,
        projectId: input.projectId ?? undefined,
        withPersonId: input.personId ?? undefined,
        place: input.place ?? undefined,
        checklist,
      });
      if (r.status !== 201) throw new ToolError(r.body.error);
      return `Created task ${r.body.task.id}.`;
    }
    case "update_task": {
      const taskId = needTask();
      const task = ctx.tasks.find((t) => t.id === taskId)!;
      const said: string[] = [];

      if (input.title !== undefined || input.dueDate !== undefined || input.dueTime !== undefined) {
        const parsed = taskColumns(
          { title: input.title, dueDate: input.dueDate, dueTime: input.dueTime },
          task.kind,
          task.dueDate,
        );
        if ("error" in parsed) throw new ToolError(parsed.error);
        if (Object.keys(parsed.values).length > 0) {
          const { data } = await supabase
            .from("coach_tasks")
            .update(parsed.values)
            .eq("id", taskId)
            .eq("user_id", userId)
            .select("id")
            .maybeSingle();
          if (!data) throw new ToolError("Could not update the task.");
          if ("due_date" in parsed.values || "due_time" in parsed.values) {
            await syncTaskReminders(userId, [taskId]);
          }
          said.push("Updated.");
        }
      }
      if (input.state !== undefined) {
        if (input.state !== "done" && input.state !== "dropped" && input.state !== "open") {
          throw new ToolError("state must be done, dropped or open.");
        }
        const r = await setTaskState(userId, taskId, input.state);
        said.push(r.say ?? "Nothing changed.");
      }
      return said.join(" ") || "Nothing changed.";
    }
    case "mark_sent": {
      const r = await markTaskSent(userId, needTask());
      return r.say ?? "Nothing changed.";
    }
    case "list_up_next": {
      const [peopleRes, projectsRes] = await Promise.all([
        supabase.from("coach_people").select("*").eq("user_id", userId),
        supabase.from("coach_projects").select("*").eq("user_id", userId),
      ]);
      const up = buildUpNext(
        ctx.tasks,
        ((peopleRes.data as Row[]) ?? []).map(toPerson),
        ((projectsRes.data as Row[]) ?? []).map((p) => toProject(p, [])),
        ctx.today,
      );
      return JSON.stringify(up);
    }
    case "search_library": {
      const query = str(input.query);
      if (!query) throw new ToolError("query is required.");
      const clips = await semanticSearch(userId, query, 5);
      if (clips.length === 0) return "No clips found.";
      return clips
        .map(
          (c) =>
            `- ${c.videoTitle ?? c.excerpt ?? "Untitled"} (${c.sourceType})${c.sourceUrl ? ` ${c.sourceUrl}` : ""}`,
        )
        .join("\n");
    }
    case "remember": {
      const sentence = str(input.sentence).slice(0, 200);
      if (!sentence) throw new ToolError("sentence is required.");
      const { data } = await supabase
        .from("coach_rules")
        .insert({ user_id: userId, sentence })
        .select("id")
        .single();
      if (!data) throw new ToolError("Could not save the rule.");
      // Nothing is learned out of sight: the rule appears in the thread with an Undo.
      await postBotMessage(userId, ruleLearned({ id: (data as { id: string }).id, sentence }));
      return "Remembered.";
    }
    default:
      throw new ToolError(`Unknown tool ${name}.`);
  }
}

/**
 * Answer one thing the user typed. The model may call tools (which act through
 * the same functions the buttons use) for at most MAX_AGENT_TURNS turns.
 */
export async function runAgent(userId: string, userText: string): Promise<{ text: string }> {
  const ctx = await loadContext(userId);
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: `${ctx.text}\n\nThe user now says: ${userText}` },
  ];

  for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
    const response = await anthropic.messages.create({
      model: AGENT_MODEL,
      max_tokens: 4000,
      system: SYSTEM,
      tools: TOOLS,
      tool_choice: { type: "auto" },
      messages,
    });
    if ((response.stop_reason as string) === "refusal") return { text: "I can't help with that." };

    const calls = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (response.stop_reason !== "tool_use" || calls.length === 0) {
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join(" ")
        .trim();
      return { text: text || "Done." };
    }

    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const call of calls) {
      try {
        const content = await runTool(ctx, call.name, call.input);
        results.push({ type: "tool_result", tool_use_id: call.id, content });
      } catch (err) {
        if (!(err instanceof ToolError))
          log.warn("Tool failed", { tool: call.name, err: String(err) });
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: err instanceof ToolError ? err.message : "That did not work.",
          is_error: true,
        });
      }
    }
    messages.push({ role: "user", content: results });
  }
  return { text: "I couldn't finish that. Try saying it another way." };
}

// ── Learning from an answer ──────────────────────────────────────────────

const LEARN_SYSTEM = `A creative professional was asked a clarifying question about a request from someone they work with, and answered it. Decide whether the answer reveals something lasting that should be applied next time without asking: what a word means for this person, a standing preference, where a kind of thing belongs.

Call propose_rule exactly once. Give one plain sentence, naming the person when the rule is about them, or null when the answer only settles this one request. Most answers settle only this one request.`;

const LEARN_TOOL: Anthropic.Tool = {
  name: "propose_rule",
  description: "Propose one lasting rule, or null.",
  input_schema: {
    type: "object",
    properties: { sentence: { type: ["string", "null"] } },
    required: ["sentence"],
  },
};

/**
 * After the user answers a request's open question, see whether a lasting
 * rule follows. If so, keep it and show it in the thread with an Undo.
 * Returns the new rule's id, or null when nothing was learned.
 */
export async function learnFromAnswer(userId: string, requestId: string): Promise<string | null> {
  const { data: found } = await supabase
    .from("coach_requests")
    .select("*")
    .eq("id", requestId)
    .eq("user_id", userId)
    .maybeSingle();
  const request = found as Row | null;
  const question = (request?.open_question as { text?: string } | null)?.text;
  const answer = str(request?.answer);
  if (!request || !question || !answer) return null;

  const [{ data: person }, { data: rules }] = await Promise.all([
    supabase
      .from("coach_people")
      .select("id, name")
      .eq("id", request.person_id as string)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("coach_rules")
      .select("sentence")
      .eq("user_id", userId)
      .eq("active", true)
      .limit(50),
  ]);
  const known = ((rules as { sentence: string }[]) ?? []).map((r) => `- ${r.sentence}`).join("\n");

  const response = await anthropic.messages.create({
    model: LEARN_MODEL,
    max_tokens: 500,
    system: LEARN_SYSTEM,
    tools: [LEARN_TOOL],
    tool_choice: { type: "auto" },
    messages: [
      {
        role: "user",
        content: [
          `Person: ${(person as { name?: string } | null)?.name ?? "Someone"}`,
          `Request: ${request.understood}`,
          `Question: ${question}`,
          `Answer: ${answer}`,
          `Rules already known:\n${known || "(none)"}`,
        ].join("\n"),
      },
    ],
  });
  const call = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === LEARN_TOOL.name,
  );
  const sentence = str((call?.input as Row | undefined)?.sentence).slice(0, 200);
  if (!sentence) return null;

  const { data: saved } = await supabase
    .from("coach_rules")
    .insert({ user_id: userId, sentence, person_id: request.person_id })
    .select("id")
    .single();
  if (!saved) return null;
  const id = (saved as { id: string }).id;
  await postBotMessage(userId, ruleLearned({ id, sentence }));
  return id;
}
