---
day: 76
date: 2026-11-23
phase: Growth
title: "Day 76 — Voice notes and notes, transcribed and tagged like any clip"
---

## What got done

- **Server** (`98347b2`): `services/transcribe.ts` (Deepgram by default, a Whisper service as the other option); `POST /api/notes` for a note of its own; `POST /api/notes/voice/upload-url` and `POST /api/notes/voice`; the `transcribeVoiceNote` job; `enrichPlan`, which brings notes and voice notes into the tagging step that web pages, tweets and images already went through; a signed address to play a voice note back; clip type `voice` (migration 050).
- **Phone and web, one set of screens:** "Voice note" and "Write a note" in the capture menu; a recorder sheet (one button, a running clock); a player; the saved item's page shows the player, the transcript, the summary, the category and the tags, and fills in by itself while the note is being read; a card for notes and voice notes in the Library (they had been drawn as YouTube videos). The Library is now in the web build at `/coach/library`, with its own nav item.
- ADR 0071; provider page for Deepgram.

## Decisions

- Hosted transcription over the never-built self-hosted Whisper. See ADR 0071 for what was compared.
- `expo-audio` for recording and playback on both phone and web, rather than a browser-only recorder now and a phone one later: the owner asked that voice capture work well on the phone.

## Issues

- **Another session's work went into my commit.** `git add -A apps/server` picked up a second session's uncommitted files in the same checkout, including a migration with the same number as mine. Caught before pushing: soft reset, unstaged theirs, renumbered mine to 050, recommitted. They then committed their own on top and pushed both.
- `pkill -f "dist/preview"` at the start of a command line that also started the preview killed its own shell, twice. The pattern now names the process (`node dist/previe[w]`) and runs in its own command.
- Importing the API client into a file of pure helpers pulled React Native into the test run; the helpers moved to `voiceNote.ts` and the network calls to `voiceApi.ts`.

## What to remember

- **The phone needs a new build.** `expo-audio` changed the native fingerprint (`6e52…` → `dc55…`). The installed build stops receiving updates from this commit on until a build with the new fingerprint is installed.
- Nothing is transcribed until `DEEPGRAM_API_KEY` (or `WHISPER_SERVICE_URL`) is set in Vercel.
- Checked in headless Chromium with a fake microphone on made-up data: record, upload, save, open the note, play. Not checked: a real transcription, tagging of a real note, anything on a phone.
