import Anthropic from "@anthropic-ai/sdk";
import type { BatchItemState } from "@cliphy/shared";

const anthropic = new Anthropic({ timeout: 60_000 });

/** The summary goes to a client under the owner's name, so the better model writes it. */
export const SUMMARY_MODEL = "claude-sonnet-5-5";

/** A sent message this short is never taken for the summary. */
const MIN_MATCH_LENGTH = 40;

export interface SummaryItem {
  /** What was asked, in one sentence. */
  label: string;
  /** The client's own words. */
  asked: string[];
  /** The tasks done for it. */
  work: string[];
  state: BatchItemState;
  note: string | null;
}

export interface SummaryInput {
  clientName: string;
  projectName: string | null;
  items: SummaryItem[];
  /** Recent messages the owner sent this client, to copy how she writes. */
  voice: string[];
}

/** A summary is written once every item is ticked or carried over. */
export function canSummarize(items: { state: BatchItemState }[]): boolean {
  return items.length > 0 && items.every((i) => i.state !== "unchecked");
}

const SYSTEM_PROMPT = `You write the text message a freelance web designer sends a client to report finished work.

Rules:
- Plain text only. No markdown, no bold, no headings, no emoji.
- No greeting, no sign-off, no thanks, no offer of further help.
- Open with one short line saying the changes are live, naming the project if there is one.
- Then one line per item, each starting with "- ". Say what changed on the site, in the client's own terms. Not how it was done.
- If an item is NOT DONE, put it last under a line "Still open:" and give the reason in a few words.
- Write as "I". Match the tone and length of the designer's own messages when samples are given.
- Keep every item. Add nothing that is not in the list.
- Reply with the message only.`;

export function buildSummaryPrompt(input: SummaryInput): { system: string; user: string } {
  const lines: string[] = [`Client: ${input.clientName}`];
  if (input.projectName) lines.push(`Project: ${input.projectName}`);
  lines.push("", "Items:");

  input.items.forEach((item, i) => {
    lines.push(`${i + 1}. ${item.label} — ${item.state === "not_done" ? "NOT DONE" : "DONE"}`);
    for (const text of item.asked) lines.push(`   Client wrote: ${text}`);
    for (const title of item.work) lines.push(`   Work done: ${title}`);
    if (item.note) lines.push(`   My note: ${item.note}`);
  });

  if (input.voice.length > 0) {
    lines.push("", "How I write to this client:");
    for (const text of input.voice) lines.push(`- ${text}`);
  }

  return { system: SYSTEM_PROMPT, user: lines.join("\n") };
}

const squash = (text: string) =>
  text
    .replace(/[-•*]\s+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** True when a message the owner sent is the batch's summary, give or take a line. */
export function summaryMatches(sentText: string, summary: string): boolean {
  const sent = squash(sentText);
  const want = squash(summary);
  if (want.length < MIN_MATCH_LENGTH) return false;
  return sent.includes(want);
}

export async function writeSummary(input: SummaryInput): Promise<string> {
  const prompt = buildSummaryPrompt(input);
  const response = await anthropic.messages.create({
    model: SUMMARY_MODEL,
    max_tokens: 2000,
    system: prompt.system,
    messages: [{ role: "user", content: prompt.user }],
  });
  if ((response.stop_reason as string) === "refusal") {
    throw new Error("Summary refused by the model");
  }
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!text) throw new Error("Model returned no summary");
  return text;
}
