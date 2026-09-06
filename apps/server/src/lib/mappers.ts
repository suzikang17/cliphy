import type { Summary, Subscription, PinnedItem } from "@cliphy/shared";

/** Map a DB row (snake_case) to a Summary/Clip object (camelCase). */
export function toClip(row: Record<string, unknown>): Summary {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    sourceType: (row.source_type as Summary["sourceType"]) ?? "youtube",
    sourceUrl: (row.source_url as string) ?? undefined,
    content: (row.content as string) ?? undefined,
    author: (row.author as string) ?? undefined,
    publishedAt: (row.published_at as string) ?? undefined,
    sourceMetadata: (row.source_metadata as Record<string, unknown>) ?? undefined,
    category: (row.category as Summary["category"]) ?? undefined,
    heroImageUrl: (row.hero_image_url as string) ?? undefined,
    excerpt: (row.excerpt as string) ?? undefined,
    videoId: (row.youtube_video_id as string) ?? undefined,
    videoTitle: (row.video_title as string) ?? undefined,
    videoUrl: (row.video_url as string) ?? undefined,
    videoChannel: (row.video_channel as string) ?? undefined,
    videoDurationSeconds: (row.video_duration_seconds as number) ?? undefined,
    status: row.status as Summary["status"],
    summaryJson: (row.summary_json as Summary["summaryJson"]) ?? undefined,
    summaryLanguage: (row.summary_language as string) ?? undefined,
    translations: (row.translations as Summary["translations"]) ?? undefined,
    errorMessage: (row.error_message as string) ?? undefined,
    tags: (row.tags as string[]) ?? [],
    userNotes: (row.user_notes as string) ?? undefined,
    enrichmentTier: (row.enrichment_tier as Summary["enrichmentTier"]) ?? "full",
    archivedAt: (row.archived_at as string) ?? undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// Backwards-compat alias — existing callers keep working
export const toSummary = toClip;

export function toSubscription(row: Record<string, unknown>): Subscription {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    type: row.type as Subscription["type"],
    sourceId: (row.source_id as string) ?? undefined,
    sourceName: row.source_name as string,
    sourceUrl: (row.source_url as string) ?? undefined,
    isActive: row.is_active as boolean,
    lastCheckedAt: (row.last_checked_at as string) ?? undefined,
    skippedCount: (row.skipped_count as number) ?? 0,
    lastSkippedAt: (row.last_skipped_at as string) ?? undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

type JoinedClip = {
  source_url?: string | null;
  video_url?: string | null;
  video_title?: string | null;
};

function joinedClip(row: Record<string, unknown>): JoinedClip | undefined {
  // PostgREST returns an embedded to-one relation as an object (or null).
  const c = row.clip as JoinedClip | JoinedClip[] | null | undefined;
  if (!c) return undefined;
  return Array.isArray(c) ? c[0] : c;
}

function joinedClipUrl(row: Record<string, unknown>): string | undefined {
  const c = joinedClip(row);
  return c?.source_url ?? c?.video_url ?? undefined;
}

export function toPinnedItem(row: Record<string, unknown>): PinnedItem {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    kind: row.kind as PinnedItem["kind"],
    layout: row.layout as PinnedItem["layout"],
    position: row.position as number,
    label: (row.label as string) ?? undefined,
    iconUrl: (row.icon_url as string) ?? undefined,
    clipId: (row.clip_id as string) ?? undefined,
    clipUrl: joinedClipUrl(row),
    clipTitle: joinedClip(row)?.video_title ?? undefined,
    viewQuery: (row.view_query as PinnedItem["viewQuery"]) ?? undefined,
    pinnedAt: row.pinned_at as string,
    updatedAt: row.updated_at as string,
  };
}
