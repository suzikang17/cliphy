import type { TweetMedia } from "@cliphy/shared";

export interface TweetClip {
  text: string;
  author: { name: string; handle: string; avatarUrl?: string };
  media: TweetMedia[];
  quotedTweet?: { handle: string; text: string } | null;
  threadTweetIds: string[];
  threadTruncated: boolean;
  likeCount?: number;
  retweetCount?: number;
  publishedAt?: string;
  heroImageUrl?: string;
}

const TWEET_HOSTS = new Set(["twitter.com", "x.com", "mobile.twitter.com"]);

export function parseTweetId(url: string): string | null {
  try {
    const { hostname, pathname } = new URL(url);
    if (!TWEET_HOSTS.has(hostname.replace(/^www\./, ""))) return null;
    const m = pathname.match(/\/status\/(\d+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

interface SyndicationMedia {
  type?: string;
  media_url_https?: string;
  video_info?: { variants?: { url?: string }[] };
}
interface SyndicationTweet {
  id_str?: string;
  full_text?: string;
  text?: string;
  created_at?: string;
  favorite_count?: number;
  retweet_count?: number;
  conversation_count?: number;
  /** Present when the post is long-form: `text` is then only its opening. */
  note_tweet?: unknown;
  user?: { name?: string; screen_name?: string; profile_image_url_https?: string };
  mediaDetails?: SyndicationMedia[];
  quoted_tweet?: { user?: { screen_name?: string }; full_text?: string; text?: string };
}

export function mapSyndicationTweet(json: unknown): TweetClip {
  const t = json as SyndicationTweet;
  const media: TweetMedia[] = (t.mediaDetails ?? []).map((m) => ({
    type: m.type === "video" ? "video" : m.type === "animated_gif" ? "gif" : "photo",
    url:
      m.type === "video"
        ? (m.video_info?.variants?.at(-1)?.url ?? m.media_url_https ?? "")
        : (m.media_url_https ?? ""),
    previewUrl: m.media_url_https,
  }));
  const quoted = t.quoted_tweet
    ? {
        handle: t.quoted_tweet.user?.screen_name ?? "",
        text: t.quoted_tweet.full_text ?? t.quoted_tweet.text ?? "",
      }
    : null;

  return {
    text: (t.full_text ?? t.text ?? "").trim(),
    author: {
      name: t.user?.name ?? "",
      handle: t.user?.screen_name ?? "",
      avatarUrl: t.user?.profile_image_url_https,
    },
    media,
    quotedTweet: quoted,
    threadTweetIds: t.id_str ? [t.id_str] : [],
    // The embed endpoint cuts a long post at about 280 characters and says so
    // with `note_tweet`. (`conversation_count` is the number of replies, not
    // the length of the author's thread, so it says nothing about this.)
    threadTruncated: Boolean(t.note_tweet),
    likeCount: t.favorite_count,
    retweetCount: t.retweet_count,
    publishedAt: t.created_at ? new Date(t.created_at).toISOString() : undefined,
    heroImageUrl: media[0]?.previewUrl ?? media[0]?.url ?? undefined,
  };
}

// Twitter's syndication endpoint requires a token derived from the tweet id.
function syndicationToken(id: string): string {
  const n = (Number(id) / 1e15) * Math.PI;
  return n.toString(6 ** 2).replace(/(0+|\.)/g, "");
}

async function fetchSyndication(id: string): Promise<TweetClip | null> {
  const token = syndicationToken(id);
  const url = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}`;
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!res.ok) return null;
  return mapSyndicationTweet(await res.json());
}

interface FxPost {
  id?: string;
  text?: string;
  author?: { name?: string; screen_name?: string; avatar_url?: string };
  media?: {
    photos?: { url: string }[];
    videos?: { url: string; thumbnail_url?: string }[];
  };
  quote?: { author?: { screen_name?: string }; text?: string };
  likes?: number;
  retweets?: number;
  reposts?: number;
  created_at?: string;
}

const fxMedia = (post: FxPost): TweetMedia[] => [
  ...(post.media?.photos ?? []).map((p) => ({ type: "photo" as const, url: p.url })),
  ...(post.media?.videos ?? []).map((v) => ({
    type: "video" as const,
    url: v.url,
    previewUrl: v.thumbnail_url,
  })),
];

/**
 * FxTwitter's thread answer as a clip: the post in full (long posts are not
 * cut), followed by the rest of the author's own thread when there is one.
 */
export function mapFxThread(json: unknown, id: string): TweetClip | null {
  const data = json as { status?: FxPost; thread?: FxPost[] | null };
  const main = data.status ?? data.thread?.find((p) => p.id === id) ?? data.thread?.[0];
  if (!main) return null;
  // The thread is the author's own run of posts, oldest first. A lone post
  // comes back as a thread of one, or with no thread at all.
  const posts = data.thread?.length ? data.thread : [main];
  const media = posts.flatMap(fxMedia);
  return {
    text: posts
      .map((p) => (p.text ?? "").trim())
      .filter(Boolean)
      .join("\n\n"),
    author: {
      name: main.author?.name ?? "",
      handle: main.author?.screen_name ?? "",
      avatarUrl: main.author?.avatar_url,
    },
    media,
    quotedTweet: main.quote
      ? { handle: main.quote.author?.screen_name ?? "", text: main.quote.text ?? "" }
      : null,
    threadTweetIds: posts.map((p) => p.id).filter((x): x is string => Boolean(x)),
    threadTruncated: false,
    likeCount: main.likes,
    retweetCount: main.reposts ?? main.retweets,
    publishedAt: main.created_at ? new Date(main.created_at).toISOString() : undefined,
    heroImageUrl: media[0]?.previewUrl ?? media[0]?.url,
  };
}

async function fetchFxThread(id: string): Promise<TweetClip | null> {
  const res = await fetch(`https://api.fxtwitter.com/2/thread/${id}`, {
    headers: { "user-agent": "Cliphy" },
  });
  if (!res.ok) return null;
  return mapFxThread(await res.json(), id);
}

/**
 * Read a post two ways at once and keep the best of both.
 *
 * - X's own embed endpoint: dependable for who wrote it, the media and the
 *   counts, but it returns one post only and cuts a long post at about 280
 *   characters.
 * - FxTwitter (a community service): the post in full, and the author's
 *   thread.
 *
 * With both, the words and thread come from FxTwitter and the rest from X.
 * With only X's, a long post is saved as its opening and marked
 * `threadTruncated`, so the card can say there is more on X.
 */
export async function extractTweetClip(url: string): Promise<TweetClip> {
  const id = parseTweetId(url);
  if (!id) throw new Error(`Not a tweet URL: ${url}`);
  const [embed, full] = await Promise.all([
    fetchSyndication(id).catch(() => null),
    fetchFxThread(id).catch(() => null),
  ]);
  if (!embed && !full) throw new Error(`Failed to fetch tweet ${id}`);
  if (!embed) return full!;
  if (!full || !full.text) return embed;
  return {
    ...embed,
    text: full.text,
    media: full.media.length >= embed.media.length ? full.media : embed.media,
    quotedTweet: embed.quotedTweet ?? full.quotedTweet,
    threadTweetIds: full.threadTweetIds.length ? full.threadTweetIds : embed.threadTweetIds,
    threadTruncated: false,
    heroImageUrl: embed.heroImageUrl ?? full.heroImageUrl,
  };
}
