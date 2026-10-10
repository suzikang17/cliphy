export type SummaryStatus = "pending" | "processing" | "completed" | "failed";

export type PlanTier = "free" | "pro";

export type SubscriptionStatus =
  | "none"
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "unpaid";

export interface User {
  id: string;
  email: string;
  plan: PlanTier;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt?: string;
  monthlySummaryCount: number;
  monthlyCountResetAt: string;
  createdAt: string;
  updatedAt: string;
}

/** A labeled sub-group inside a context section (e.g. "Ingredients", "Steps") */
export interface ContextGroup {
  label: string;
  items: string[];
}

/** AI-chosen section that adapts to video content (e.g. Recipe, Steps, Action Items) */
export interface ContextSection {
  title: string;
  icon: string;
  /** Flat list of items (used when groups is absent) */
  items: string[];
  /** Optional sub-groups for structured content like recipes (ingredients + steps) */
  groups?: ContextGroup[];
}

/** Shape of the AI-generated summary stored as JSONB in summaries.summary_json */
export interface SummaryJson {
  summary: string;
  keyPoints: string[];
  /** @deprecated Use contextSection instead. Kept for backward compat with existing summaries. */
  actionItems?: string[];
  contextSection?: ContextSection;
  timestamps: string[];
  /** True if the transcript was too long and was truncated before summarization */
  truncated?: boolean;
  /** Candidate tag names proposed by the summarizer; input to auto-tagging */
  topics?: string[];
}

export type SourceType = "youtube" | "tweet" | "podcast" | "web" | "image" | "note";

export type ClipCategory = "idea" | "reading" | "design" | "reference";

export interface TweetMedia {
  type: "photo" | "video" | "gif";
  url: string;
  previewUrl?: string;
}

export interface TweetClipMetadata {
  handle: string;
  avatarUrl?: string;
  media?: TweetMedia[];
  quotedTweet?: { handle: string; text: string } | null;
  threadTweetIds?: string[];
  threadTruncated?: boolean;
  likeCount?: number;
  retweetCount?: number;
}

export interface NoteClipMetadata {
  /** The note's day in the user's local timezone, as YYYY-MM-DD. */
  noteDate: string;
}

export interface WebClipMetadata {
  siteName?: string;
  faviconUrl?: string;
  readingTimeMin?: number;
  kind: "article" | "visual";
}

export interface ImageClipMetadata {
  kind: "text" | "visual";
  storagePath: string;
  width?: number;
  height?: number;
  tiled?: boolean;
  partial?: boolean;
  detectedTweetUrl?: string;
  tweet?: { handle: string; author: string; text: string };
}

/** Unified queue + result row from the `summaries` table */
export interface Summary {
  id: string;
  userId: string;
  // Universal fields (all source types)
  sourceType: SourceType;
  sourceUrl?: string;
  content?: string;
  author?: string;
  publishedAt?: string;
  sourceMetadata?: Record<string, unknown>;
  // Universal display/triage fields
  category?: ClipCategory;
  heroImageUrl?: string;
  excerpt?: string;
  // YouTube-specific (kept for backwards compat — undefined for tweets)
  videoId?: string;
  videoTitle?: string;
  videoUrl?: string;
  videoChannel?: string;
  videoDurationSeconds?: number;
  // Shared processing fields
  status: SummaryStatus;
  summaryJson?: SummaryJson;
  summaryLanguage?: string;
  translations?: Partial<Record<import("./constants.js").SummaryLanguageCode, SummaryJson>>;
  errorMessage?: string;
  tags: string[];
  /** New tags proposed by auto-tagging, awaiting accept/dismiss */
  suggestedTags?: string[];
  userNotes?: string;
  enrichmentTier?: EnrichmentTier;
  archivedAt?: string;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// Forward alias — use Clip in new code
export type Clip = Summary;
export type ClipStatus = SummaryStatus;

export interface UsageInfo {
  used: number;
  /** Effective monthly cap: plan limit + recurring admin bonus. */
  limit: number;
  plan: PlanTier;
  resetAt: string;
  totalTimeSavedSeconds: number;
  /** One-off admin-granted credit wallet. Spent only after the monthly allowance runs out. */
  bonusCredits: number;
}

// API request/response types

export interface QueueAddRequest {
  videoUrl: string;
  videoTitle?: string;
  videoChannel?: string;
  videoDurationSeconds?: number;
  transcript?: string;
}

export interface QueueAddResponse {
  summary: Summary;
}

export interface ClipAddRequest {
  sourceType: SourceType;
  sourceUrl: string;
  content?: string;
  author?: string;
  publishedAt?: string;
  title?: string;
  sourceMetadata?: Record<string, unknown>;
}

export interface ClipAddResponse {
  clip: Summary;
}

export interface SummaryResponse {
  summary: Summary;
}

export interface UsageResponse {
  usage: UsageInfo;
}

export interface ErrorResponse {
  error: string;
  code?: string;
}

export interface TagsResponse {
  tags: string[];
}

export interface AutoTagSuggestion {
  existing: string[];
  new: string[];
}

export interface BulkAutoTagSuggestion {
  summaryId: string;
  existing?: string[];
  new?: string[];
  skipped?: boolean;
}

export interface BulkAutoTagResponse {
  suggestions: BulkAutoTagSuggestion[];
}

/** Returned with 402 when a free user attempts a pro-only feature. */
export interface ProRequiredResponse {
  error: string;
  code: "pro_required";
  feature: string;
  upgrade_url: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type ChatUpdatedSection = "summary" | "keyPoints" | "timestamps" | "contextSection";

export interface ChatResponse {
  type: "chat" | "update";
  content: string;
  updatedSection?: ChatUpdatedSection;
  updatedSummaryJson?: SummaryJson;
}

export interface UserSettings {
  summaryLanguage: import("./constants.js").SummaryLanguageCode;
  /** Auto-subscribe the user's own playlists with "cliphy" in the name. */
  autoDiscoverPlaylists: boolean;
}

export type SubscriptionType = "channel" | "playlist" | "watch_later" | "liked" | "podcast_feed";

export interface Subscription {
  id: string;
  userId: string;
  type: SubscriptionType;
  sourceId?: string;
  sourceName: string;
  sourceUrl?: string;
  isActive: boolean;
  lastCheckedAt?: string;
  skippedCount: number;
  lastSkippedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionCreateRequest {
  type: SubscriptionType;
  sourceUrl?: string;
  /** liked-only: queue the N most recent existing likes on creation (0-50). */
  importCount?: number;
}

export interface SubscriptionUpdateRequest {
  isActive?: boolean;
}

export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt?: string;
  createdAt: string;
}

export interface ApiKeyCreateResponse {
  apiKey: ApiKey;
  /** Full plaintext key — shown once, never retrievable again. */
  key: string;
}

export interface GoogleConnectionStatus {
  connected: boolean;
}

export type EmailAuthStatus = "new" | "password" | "google";

export interface CheckEmailResponse {
  status: EmailAuthStatus;
}

// ── Podcast types ──────────────────────────────────────────────────────────

export type PodcastFeed = {
  id: string;
  userId: string;
  rssUrl: string;
  title: string;
  author?: string;
  artworkUrl?: string;
  autoQueue: boolean;
  minDurationSeconds?: number;
  maxDurationSeconds?: number;
  lastPolledAt?: string;
  createdAt: string;
};

export type PodcastEpisodeStatus =
  | "pending_approval"
  | "queued"
  | "processing"
  | "done"
  | "skipped";

export type PodcastEpisode = {
  id: string;
  feedId: string;
  userId: string;
  guid: string;
  title: string;
  description?: string;
  audioUrl: string;
  artworkUrl?: string;
  durationSeconds?: number;
  publishedAt: string;
  status: PodcastEpisodeStatus;
  clipId?: string;
  createdAt: string;
};

export type PodcastFeedSettings = {
  autoQueue?: boolean;
  minDurationSeconds?: number | null;
  maxDurationSeconds?: number | null;
};

export type EnrichmentTier = "metadata" | "full";
export type PinKind = "clip" | "view";
export type PinLayout = "tile" | "panel";

/**
 * A saved filter backing a view pin. Deliberately a closed struct — never raw
 * SQL and never an open filter DSL, because this is user-authored JSON that
 * becomes a database query. Unknown keys are ignored by the server.
 */
export interface ViewQuery {
  semantic?: string;
  search?: string;
  tags?: string[];
  sourceType?: SourceType[];
  category?: ClipCategory;
  author?: string;
  limit?: number;
}

export interface PinnedItem {
  id: string;
  userId: string;
  kind: PinKind;
  layout: PinLayout;
  position: number;
  label?: string;
  iconUrl?: string;
  clipId?: string;
  /** Resolved from the referenced clip by GET /api/pins — not stored on the pin. */
  clipUrl?: string;
  clipTitle?: string;
  /** The referenced clip's tags (GET /api/pins) — lets the Tabs view match pins to a group. */
  clipTags?: string[];
  viewQuery?: ViewQuery;
  pinnedAt: string;
  updatedAt: string;
}

// ── Tabs view (side panel tab organizer) ─────────────────────

/** One open tab sent for organizing. `text` only when page-content reading is granted. */
export interface TabInput {
  /** Client-chosen id, echoed back in assignments (e.g. String(tab.id)). */
  key: string;
  url: string;
  title: string;
  description?: string;
  /** Up to 2,000 chars of main page text. */
  text?: string;
  /** Page scrolled to ≥ 90% — a "done reading" signal. */
  scrolledToEnd?: boolean;
}

export type TabAssignment = { tag: string } | { proposed: string } | { none: true };

export interface OrganizeTabsResponse {
  assignments: Record<string, TabAssignment>;
  /** Keys of tabs judged "probably done". */
  done: string[];
  /** Claude-suggested keywords per proposed group name, saved on "＋ Save as tag". */
  proposalKeywords?: Record<string, string[]>;
  /** One-line "why these belong together" per proposed group name. */
  proposalReasons?: Record<string, string>;
  /** Your manual group choices saved for these pages (e.g. from another device), by key. */
  overrides?: Record<string, string>;
}

/** PUT /api/tabs/overrides — save (or clear, with null) your manual group choice for pages. */
export interface PageOverrideItem {
  url: string;
  /** Tabs-view group key ("tag:x", "site:host", "proposed:x"), or null to clear. */
  override: string | null;
}

/**
 * Tabs the user worked on together, inferred locally from behavior: opened
 * close together, opened from one another, or switched between repeatedly.
 * Sent with an organize request as evidence for grouping.
 */
export interface TabCluster {
  /** TabInput keys in this cluster (2+). */
  keys: string[];
  /** ms since epoch: earliest open / latest activity in the cluster. */
  start: number;
  end: number;
  /** Switches between tabs of this cluster within the activity log. */
  switches: number;
  /** Tab pairs where one opened the other. */
  openerLinks: number;
}

export interface TabHintsResponse {
  hints: Record<string, string>;
  /** Per-tag keywords that deterministically match tabs (see keywords.ts). */
  keywords: Record<string, string[]>;
}

// ── Trail (tabs saved automatically when closed) ─────────────

/** A page you had open and closed. Kept apart from clips; promote one to keep it. */
export interface TrailItem {
  id: string;
  url: string;
  title: string;
  host: string;
  tags: string[];
  /** ISO time the tab was opened, when known. */
  openedAt?: string;
  /** ISO time it was (last) closed. */
  closedAt: string;
  /** How many times this page was closed (one row per URL). */
  closeCount: number;
  /** Your own name for the page, set in the Tabs view. */
  customTitle?: string;
  /** Your quick note on the page. */
  note?: string;
}

/** POST /api/trail body — sent by the extension in small batches. */
export interface TrailCaptureItem {
  url: string;
  title: string;
  /** ms since epoch */
  openedAt?: number;
  closedAt: number;
  customTitle?: string;
  note?: string;
}

export interface TrailListResponse {
  items: TrailItem[];
  /** Pass as ?before= for the next page; absent at the end. */
  nextBefore?: string;
}

export interface TrailSettings {
  /** Auto-delete entries older than this many days; null keeps them forever. */
  retentionDays: number | null;
}

// ── Durable groups & pins (spec 2026-10-10) ──────────────────

/** A page recorded when a Tabs-view group was closed. Address + title only. */
export interface ClosedGroupPage {
  url: string;
  title: string;
}

export interface ClosedGroup {
  /** Tabs-view group key, e.g. "tag:freelance:lotus-bech". */
  key: string;
  label: string;
  pages: ClosedGroupPage[];
  closedAt: string;
}

/** POST /api/pins/page — pin a page (bookmark-tier clip + new-tab pin). */
export interface PinPageResponse {
  pin: PinnedItem;
  clip: Summary;
  /** false when the page was already pinned. */
  created: boolean;
}
