# YouTube Transcript Fetching — Design

## Summary

Server-side transcript fetching using the `youtube-transcript` npm package. Takes a video ID, returns cleaned plain text for AI summarization.

## Approach

Use `youtube-transcript` — lightweight package that hits YouTube's internal captions endpoint (same one the player uses). No API key needed. Handles auto-generated and manual captions.

Rejected alternatives:

- **YouTube Data API v3** — can only download captions for videos you own (OAuth requirement). Not viable.
- **Manual scraping** — reimplements what the package already does, more maintenance for no benefit.

## Architecture

Single function in `apps/server/src/services/transcript.ts`:

1. Call `youtube-transcript` with video ID
2. Receive array of `{ text, offset, duration }` segments
3. Strip non-speech markers (`[Music]`, `[Applause]`, etc.)
4. Join segments into single string
5. Truncate at ~100k chars if over token limit
6. Return cleaned transcript string

## Error handling

- No captions available → `TranscriptNotAvailableError`
- Video not found / private → `TranscriptNotAvailableError` with appropriate message
- Network failure → bubble up, queue processor retries

## Out of scope

- No transcript caching (single fetch per summary is fine)
- No language selection (library defaults to English / auto-generated)
- No API route exposing raw transcripts (YouTube ToS compliance)
- No multi-language support (future task)

## Files to modify

- `apps/server/src/services/transcript.ts` — implement `fetchTranscript()`
- `apps/server/package.json` — add `youtube-transcript` dependency
