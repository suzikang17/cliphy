---
title: "Tweet fetching via Twitter syndication API + FixTweet fallback (no paid X API)"
date: 2026-09-05
category: Tech
revisit: true
---

## Why this choice

The universal-clip pivot makes tweets a first-class content type: a shared/pasted
tweet URL must capture full text, author identity, and media — not a degraded
link. The official X API's basic tier is ~$100/mo and overkill for read-only
public-tweet fetches, so we needed a free path.

We use the **Twitter syndication API**
(`https://cdn.syndication.twimg.com/tweet-result?id=<id>&token=<derived>`) as the
primary source — the same endpoint the official `react-tweet` embed library uses.
It returns rich JSON (text, author name/handle/avatar, media, quoted tweet,
favorite count, timestamp) with no auth. A live probe confirmed it works for
current tweets and returns `text`, `user`, `favorite_count`, `created_at`,
`entities`, and `conversation_count`. **FixTweet** (`api.fxtwitter.com`) is the
fallback when syndication fails. Screenshot OCR (subproject #2) is the last-resort
path for anything both miss.

## Options considered

- Paid X API v2 — reliable, but ~$100/mo and account/approval overhead.
- Twitter syndication API — free, rich JSON, battle-tested by react-tweet. Chosen primary.
- FixTweet / vxtwitter — free public API, clean data. Chosen fallback.
- Nitter scraping — instances are unreliable and frequently rate-limited/down.
- Screenshot + OCR — deferred to subproject #2 as the universal last resort.

## Tradeoffs

- **Gain:** zero cost, no auth, rich structured tweet data, first-class rendering.
- **Give up:** these are undocumented endpoints X can change or break at any time;
  the layered fallback (syndication → FixTweet → OCR) is what mitigates that risk,
  hence `revisit: true`.
- **Known limitation — no forward thread stitching.** The `tweet-result` endpoint
  returns only the single tweet plus a `conversation_count`; it does not expose the
  forward children of a self-thread, and FixTweet's basic endpoint doesn't either.
  Since a shared thread URL is usually the _first_ tweet, walking forward isn't
  possible via free endpoints. We therefore capture the single (root) tweet
  reliably and set `threadTweetIds = [rootId]`. Full self-thread capture is deferred
  to the screenshot-OCR path (subproject #2) or a future paid approach.
