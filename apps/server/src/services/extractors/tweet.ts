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
    threadTruncated: false,
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

async function fetchFixTweet(id: string): Promise<TweetClip | null> {
  const res = await fetch(`https://api.fxtwitter.com/status/${id}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { tweet?: Record<string, unknown> };
  const tw = data.tweet as
    | {
        text?: string;
        author?: { name?: string; screen_name?: string; avatar_url?: string };
        media?: {
          photos?: { url: string }[];
          videos?: { url: string; thumbnail_url?: string }[];
        };
        likes?: number;
        retweets?: number;
        created_at?: string;
      }
    | undefined;
  if (!tw) return null;
  const media: TweetMedia[] = [
    ...(tw.media?.photos ?? []).map((p) => ({ type: "photo" as const, url: p.url })),
    ...(tw.media?.videos ?? []).map((v) => ({
      type: "video" as const,
      url: v.url,
      previewUrl: v.thumbnail_url,
    })),
  ];
  return {
    text: (tw.text ?? "").trim(),
    author: {
      name: tw.author?.name ?? "",
      handle: tw.author?.screen_name ?? "",
      avatarUrl: tw.author?.avatar_url,
    },
    media,
    quotedTweet: null,
    threadTweetIds: [id],
    threadTruncated: false,
    likeCount: tw.likes,
    retweetCount: tw.retweets,
    publishedAt: tw.created_at ? new Date(tw.created_at).toISOString() : undefined,
    heroImageUrl: media[0]?.previewUrl ?? media[0]?.url,
  };
}

export async function extractTweetClip(url: string): Promise<TweetClip> {
  const id = parseTweetId(url);
  if (!id) throw new Error(`Not a tweet URL: ${url}`);
  const clip = (await fetchSyndication(id).catch(() => null)) ?? (await fetchFixTweet(id));
  if (!clip) throw new Error(`Failed to fetch tweet ${id}`);
  return clip;
}
