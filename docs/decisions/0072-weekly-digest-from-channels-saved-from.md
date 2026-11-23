---
type: decision
title: "Weekly digest: new uploads from channels the person saves from, ranked against their clips and summarized"
date: 2026-11-23
category: Product
revisit: true
---

## Why this choice

The owner wants people to stay up to date on what they follow without opening YouTube: "Here's what this video is about at a glance. You don't need to look at it." The first idea was a recommender ("give them the algorithm"). That would mean finding candidates across the whole internet, which is the hard part of any recommender. The owner then said they did not want to reinvent the algorithm.

So the digest does not recommend from everywhere. It watches the channels a person has already saved videos from, and summarizes the new uploads closest to what they save.

- **Channels come from saved clips.** The last 90 days of saved YouTube videos (up to 200) are looked up once with the YouTube API (one quota unit per 50 videos) to get each video's channel. The 30 channels saved from most are kept. Nothing to set up, and no Google sign-in.
- **New uploads come from each channel's public feed.** Free, no quota. Uploads from the last 7 days, Shorts dropped, at most 3 per channel, 40 in all, and never a video the person already has or has been shown.
- **Ranking is the comparison search already uses.** Each upload's title, channel and description are embedded (one Voyage request for all 40) and compared to the person's clips with `match_clips`. The closest clip is kept as the "Close to:" line.
- **The 5 closest are summarized** with the same transcript reader and summarizer as a saved video. A video with no captions is skipped; it tries 9 at most.
- **Digest videos are not clips.** They live in `digest_items`, so the library, search and the monthly count are untouched. Keep sends the video through the normal queue (`enqueueVideo`), so limits, tags and search work as for any save. Dismiss hides it.
- **Off by default** (`user_settings.weekly_digest`). Turning it on builds the first digest at once; after that, Sundays 15:00 UTC. A push notification says when one is ready.

## Options considered

- **A recommender over the whole of YouTube** (search API or an open-source recommender). The search API allows about 100 searches a day for the whole app, and libraries like `implicit` or LightFM need many people with overlapping saves. Not needed to answer "does this help".
- **Read the person's own YouTube home page with the extension.** Gives their real recommendations, but only on a computer, and it leans on YouTube's page layout and terms.
- **Use their YouTube subscriptions** (Google sign-in). Exact, but needs the Google connection, which had lapsed for the only account that had it (see the devlog), and Google's review for wider use.
- **Make digest videos real clips with a "suggested" mark.** Every library query, count and search would need to exclude them.
- **Channels saved from, feeds, embedding comparison, separate table (chosen).**

## Tradeoffs

- **It cannot find a channel the person has never saved from.**
- **Keep summarizes the video a second time.** It goes through the normal queue rather than copying the digest's summary. One extra model call per kept video, in exchange for no second code path.
- **No floor on closeness yet.** The 5 closest are shown even if none is close. The score is stored, so a floor can be set once there are real digests to look at.
- **Cost per person per week:** one Voyage request, up to 9 transcript reads and 5 summaries. Fine for a handful of people; needs a plan gate or cap before it is offered widely.
- **Transcript reads from the server can be refused by YouTube** more often at volume. Not measured.
- **YouTube only.** Articles would need RSS per site; X has no equivalent.
