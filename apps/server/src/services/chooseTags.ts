import { MAX_TAGS_PER_SUMMARY } from "@cliphy/shared";
import { logger } from "../lib/logger.js";
import { isTaggerConfigured, mergeTags, tagClip } from "./tagger.js";

const log = logger.child({ service: "choose-tags" });

export interface ChooseTagsInput {
  /** What the thing is, for the question Jev is asked: "note", "voice note". */
  kind: string;
  title?: string;
  summary: string;
  /** The owner's tags, most used first. */
  existingTags: string[];
  /** Tag names the summarizing model came up with. */
  proposed: string[];
  /** Tags already on the clip. They are kept. */
  current: string[];
}

/**
 * Tags for something written or said, chosen the way a video's are: tags the
 * owner already uses are applied when they fit (Jev decides), and anything
 * new is offered as a suggestion, never applied by itself. Without Jev, or if
 * it fails, a proposed tag is applied only when it is exactly an existing
 * one, so saving a note never depends on that service being up.
 */
export async function chooseTags(
  input: ChooseTagsInput,
): Promise<{ tags: string[]; suggested: string[] }> {
  const existing = new Set(input.existingTags);
  const proposed = [...new Set(input.proposed.map((t) => t.trim().toLowerCase()).filter(Boolean))];
  const fresh = proposed.filter((t) => !existing.has(t));

  let apply = proposed.filter((t) => existing.has(t));
  let suggest = fresh;

  if (isTaggerConfigured() && input.existingTags.length > 0) {
    try {
      ({ apply, suggest } = await tagClip({
        kind: input.kind,
        title: input.title,
        summaryJson: { summary: input.summary, keyPoints: [], timestamps: [] },
        existingTags: input.existingTags,
        candidates: fresh,
      }));
    } catch (err) {
      log.warn("Jev could not be asked; using exact matches", { err: String(err) });
    }
  }

  const tags = mergeTags(input.current, apply, MAX_TAGS_PER_SUMMARY);
  return { tags, suggested: suggest.filter((t) => !tags.includes(t)) };
}
