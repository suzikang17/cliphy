---
type: decision
title: "Articles and posts are saved as a bare link and read in the background; posts are read from two sources"
date: 2026-11-23
category: Capture
revisit: true
---

## Why this choice

After ADR 0069, a shared article or post was confirmed at once on the phone, but the server still fetched the page and wrote the summary inside the request, so the clip took seconds to appear, and saves from inside the app or the extension still waited. That in-request work dates from 2026-09-06 (`898b37b`, `70d4e7f`), when it was pulled out of Inngest because the worker "wasn't firing reliably". The cause was found on day 72: Inngest only runs the jobs it was last told about, and they are now re-registered after every deploy.

- **`POST /clips` for web and tweet links** stores the link with status `processing` and the address as its title, fires `clip/extract.requested` and answers. Two database calls, no page fetch.
- **`extract-clip`** (new Inngest job, 2 retries) reads the page and fills the clip in; `embed-clip` then adds summary, tags and category, as it already did for any web or tweet clip without them. After the last failed try the clip is marked `failed` with the reason. The in-request version tried once and failed silently on enrichment.
- **Pictures** are confirmed from the phone's outbox too (a resized copy in the app's storage, uploaded after). The server's vision pass for pictures stays inside the request, unchanged.
- **Posts are read from two sources together.** Measured on six real long posts: X's embed endpoint (`cdn.syndication.twimg.com`), which was tried first, returned 268–304 characters of posts that are 2,805–11,347 characters long. FxTwitter's thread endpoint (`api.fxtwitter.com/2/thread/:id`) returned them whole, plus the author's thread. Now: who, media and counts from X; the words and thread from FxTwitter. With only X answering, the opening is saved and marked `threadTruncated`. That flag used to come from `conversation_count`, which is the reply count, so it was set on nearly every post.

## Options considered

- **Keep reading in the request.** No worker to depend on; every save waits on someone else's web server and a model call.
- **Answer first, keep working in the same function (`waitUntil`).** No worker either, but no retries, and it could not be tried from here.
- **The official X API** (pay per use, about half a cent per post read as of this writing). Full text and threads from the source, with an account, a key and a bill; worth it only if FxTwitter proves unreliable.

## Tradeoffs

- A clip depends on Inngest again. If jobs stop being registered, articles stay as bare links marked processing. An event sent in the few seconds between a deploy going live and the re-registration could be missed the same way.
- FxTwitter is a community service with no promise of uptime; when it is down, long posts are saved cut (and marked so).
- X Articles (the long-form format, not long posts) are not read by either source.
- The save's answer no longer carries the title or tags; clients show the address until the clip fills in.
