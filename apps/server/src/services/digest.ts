import { logger } from "../lib/logger.js";
import { supabase } from "../lib/supabase.js";
import { generateEmbeddings } from "./embedding.js";
import {
  fetchChannelVideos,
  fetchVideoChannels,
  type VideoChannel,
  type YouTubeVideoPreview,
} from "./youtube.js";

// The weekly digest (ADR 0072): new uploads from the channels a person has
// saved videos from, ranked by how close each is to what they save, with the
// closest few summarized so they need not be watched.

const log = logger.child({ service: "digest" });

/** How far back saved videos count toward "channels you save from". */
export const SAVED_WINDOW_DAYS = 90;
/** Uploads older than this are not news. */
export const NEW_WINDOW_DAYS = 7;
export const MAX_SAVED_VIDEOS = 200;
export const MAX_CHANNELS = 30;
/** Uploads compared against the person's clips each run (one embedding each). */
export const MAX_CANDIDATES = 40;
/** Videos in a digest. */
export const DIGEST_SIZE = 5;
/** Transcripts tried before giving up on filling the digest. */
export const MAX_ATTEMPTS = 9;

const NO_CLIP = "00000000-0000-0000-0000-000000000000";
const DAY_MS = 24 * 60 * 60 * 1000;

export interface Channel {
  channelId: string;
  channelTitle: string;
  saved: number;
}

export interface Candidate {
  videoId: string;
  title: string;
  channelTitle: string;
  publishedAt: string;
  description: string;
}

export interface Scored extends Candidate {
  score: number;
  becauseClipId: string | null;
}

/** The channels saved from most, busiest first. */
export function rankChannels(videos: VideoChannel[], max = MAX_CHANNELS): Channel[] {
  const byId = new Map<string, Channel>();
  for (const v of videos) {
    const c = byId.get(v.channelId);
    if (c) c.saved++;
    else byId.set(v.channelId, { channelId: v.channelId, channelTitle: v.channelTitle, saved: 1 });
  }
  return [...byId.values()].sort((a, b) => b.saved - a.saved).slice(0, max);
}

/**
 * From the channels' feeds, the uploads worth comparing: recent, not a Short,
 * not already saved or shown. Newest first, at most `max`, and no more than
 * three from one channel so a busy channel cannot fill the list.
 */
export function pickCandidates(
  uploads: YouTubeVideoPreview[],
  opts: { now: number; known: Set<string>; max?: number; perChannel?: number },
): Candidate[] {
  const since = opts.now - NEW_WINDOW_DAYS * DAY_MS;
  const perChannel = opts.perChannel ?? 3;
  const taken = new Map<string, number>();
  const seen = new Set<string>();
  const out: Candidate[] = [];
  const newest = [...uploads].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );
  for (const u of newest) {
    if (out.length >= (opts.max ?? MAX_CANDIDATES)) break;
    if (u.isShort || seen.has(u.videoId) || opts.known.has(u.videoId)) continue;
    const at = new Date(u.publishedAt).getTime();
    if (!(at >= since && at <= opts.now)) continue;
    const channel = u.channelTitle ?? "";
    const n = taken.get(channel) ?? 0;
    if (n >= perChannel) continue;
    taken.set(channel, n + 1);
    seen.add(u.videoId);
    out.push({
      videoId: u.videoId,
      title: u.title,
      channelTitle: channel,
      publishedAt: u.publishedAt,
      description: (u.description ?? "").slice(0, 600),
    });
  }
  return out;
}

/** What is compared against the person's clips: what the upload says it is. */
export function candidateText(c: Candidate): string {
  return [c.title, c.channelTitle, c.description].filter(Boolean).join("\n");
}

/** Closest first. */
export function rankScored(scored: Scored[]): Scored[] {
  return [...scored].sort((a, b) => b.score - a.score);
}

/** The channels this person has saved videos from lately. */
export async function savedChannels(userId: string, now = Date.now()): Promise<Channel[]> {
  const since = new Date(now - SAVED_WINDOW_DAYS * DAY_MS).toISOString();
  const { data } = await supabase
    .from("clips")
    .select("youtube_video_id")
    .eq("user_id", userId)
    .eq("source_type", "youtube")
    .is("deleted_at", null)
    .not("youtube_video_id", "is", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(MAX_SAVED_VIDEOS);
  const ids = [...new Set((data ?? []).map((r) => r.youtube_video_id as string))];
  if (ids.length === 0) return [];
  return rankChannels(await fetchVideoChannels(ids));
}

/** Videos this person already has, or has already been shown. */
export async function knownVideos(userId: string): Promise<Set<string>> {
  const [{ data: saved }, { data: shown }] = await Promise.all([
    supabase
      .from("clips")
      .select("youtube_video_id")
      .eq("user_id", userId)
      .not("youtube_video_id", "is", null),
    supabase.from("digest_items").select("youtube_video_id").eq("user_id", userId),
  ]);
  return new Set(
    [...(saved ?? []), ...(shown ?? [])].map((r) => r.youtube_video_id as string).filter(Boolean),
  );
}

/** New uploads from this person's channels, ready to compare. */
export async function findCandidates(userId: string, now = Date.now()): Promise<Candidate[]> {
  const channels = await savedChannels(userId, now);
  if (channels.length === 0) return [];
  const feeds = await Promise.all(
    channels.map((c) =>
      fetchChannelVideos(c.channelId).catch((err) => {
        // One unreadable feed should not cost the whole digest.
        log.warn("Channel feed unreadable", {
          channelId: c.channelId,
          error: err instanceof Error ? err.message : String(err),
        });
        return [] as YouTubeVideoPreview[];
      }),
    ),
  );
  return pickCandidates(feeds.flat(), { now, known: await knownVideos(userId) });
}

/** How close each upload is to what this person saves, and to which clip. Closest first. */
export async function scoreCandidates(userId: string, candidates: Candidate[]): Promise<Scored[]> {
  const embeddings = await generateEmbeddings(candidates.map(candidateText));
  const scored: Scored[] = [];
  for (const [i, c] of candidates.entries()) {
    const { data, error } = await supabase.rpc("match_clips", {
      query_embedding: embeddings[i],
      match_user_id: userId,
      exclude_id: NO_CLIP,
      match_count: 1,
    });
    if (error) throw new Error(`match_clips failed: ${error.message}`);
    const top = (data as { id: string; similarity: number }[] | null)?.[0];
    scored.push({ ...c, score: top?.similarity ?? 0, becauseClipId: top?.id ?? null });
  }
  return rankScored(scored);
}
