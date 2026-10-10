import { TypeSafeClient, choice, noul, type Questions } from "@typesafe-ai/sdk";
import { tagPath, type SummaryJson } from "@cliphy/shared";

// Jev (TypeSafe AI) classifies; Claude generates. Jev decides which of the user's
// existing tags apply and whether a Claude-proposed topic duplicates one of them.
// It can't invent tag names — new tags come from summaryJson.topics.
const MODEL = "jev-1.13.0";

/** Minimum P(yes) for an existing tag to be auto-applied. */
export const APPLY_THRESHOLD = 0.7;
/** Minimum confidence for a candidate to count as a duplicate of an existing tag. */
export const DUPLICATE_THRESHOLD = 0.5;
/** Jev choice questions allow 255 options; leave headroom for "none". */
export const MAX_EXISTING_TAGS = 200;

const NONE = "none";

let client: TypeSafeClient | null = null;

export function isTaggerConfigured(): boolean {
  return Boolean(process.env.TYPESAFE_API_KEY);
}

function getClient(): TypeSafeClient {
  client ??= new TypeSafeClient({ timeout: 10_000 });
  return client;
}

export interface TagClipInput {
  summaryJson: SummaryJson;
  title?: string;
  /** User's existing tags, most-used first (truncated to MAX_EXISTING_TAGS). */
  existingTags: string[];
  /** Candidate new tags (Claude topics), already lowercased. */
  candidates: string[];
}

export interface TagClipResult {
  /** Existing tags that fit, highest confidence first. */
  apply: string[];
  /** Candidates that match no existing tag. */
  suggest: string[];
}

const label = (tag: string) => tagPath(tag).join(" › ");

export async function tagClip({
  summaryJson,
  title,
  existingTags,
  candidates,
}: TagClipInput): Promise<TagClipResult> {
  const tags = existingTags.slice(0, MAX_EXISTING_TAGS);
  const existing = new Set(tags);
  // Exact matches are duplicates without asking
  const fresh = [...new Set(candidates)].filter((c) => !existing.has(c));

  if (tags.length === 0) {
    return { apply: [], suggest: fresh };
  }

  // Jev answers are keyed by question name; tag strings aren't safe keys, so index them.
  const questions: Questions = {};
  tags.forEach((tag, i) => {
    questions[`t${i}`] = noul(`Does the tag "${label(tag)}" describe this video?`);
  });

  const options: Record<string, string> = { [NONE]: "None of these mean the same thing" };
  tags.forEach((tag, i) => {
    options[`e${i}`] = label(tag);
  });
  fresh.forEach((cand, j) => {
    questions[`c${j}`] = choice(
      `Which existing tag means the same thing as the proposed tag "${cand}"?`,
      options,
    );
  });

  const { answers } = await getClient().systemOne({
    model: MODEL,
    state: {
      title: title ?? null,
      summary: summaryJson.summary,
      keyPoints: summaryJson.keyPoints,
      section: summaryJson.contextSection?.title ?? null,
    },
    questions,
  });

  const apply = tags
    .map((tag, i) => {
      const a = answers[`t${i}`];
      return { tag, p: a?.type === "noul" ? a.noul : 0 };
    })
    .filter(({ p }) => p >= APPLY_THRESHOLD)
    .sort((a, b) => b.p - a.p)
    .map(({ tag }) => tag);

  const suggest = fresh.filter((_, j) => {
    const a = answers[`c${j}`];
    if (a?.type !== "choice") return true;
    const isDuplicate = a.choice !== NONE && a.confidence >= DUPLICATE_THRESHOLD;
    return !isDuplicate;
  });

  return { apply, suggest };
}

/** Unique tags across a user's clips, most-used first. */
export function rankTags(rows: { tags: unknown }[]): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const tag of (row.tags as string[] | null) ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag);
}

/** Union preserving order, capped. */
export function mergeTags(current: string[], add: string[], max: number): string[] {
  return [...new Set([...current, ...add])].slice(0, max);
}
