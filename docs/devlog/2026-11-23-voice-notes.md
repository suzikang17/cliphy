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

## Later: the Whisper service, running

The owner asked what self-hosting would take, having two servers. The service was already in the repo (`services/whisper`, FastAPI and faster-whisper) and had never been deployed.

- Added a Dockerfile; built and started it on the devbox (8 cores, 15 GB), bound to localhost on port 9010 (9000 is another project's), key in `~/.config/cliphy-whisper/env`.
- **It did not work as written.** `faster-whisper` opens audio with an option `av` 17 removed, so every transcription failed with `open() got an unexpected keyword argument 'metadata_errors'`. Pinned `av<17`.
- **Proof:** a public 11-second speech sample came back word for word. Without the key: 401.
- **A wait the server cannot do.** The devbox was busy (load 17) and took 20 to 30 seconds for those 11 seconds; Vercel cuts a function off at 60. The service now has `POST /jobs` and `GET /jobs/:id`, and the voice-note job starts a transcription and asks again every five seconds (`startTranscription` / `checkTranscription`, `step.sleep` between looks). The podcast job still makes one long call and has the same limit; it is in the backlog.
- Left for the owner: a public address (`sudo tailscale funnel --bg 9010`) and two settings in Vercel. See `services/whisper/README.md`.
- The iOS build with the audio library finished and went to TestFlight (run 45102846163).
- TDD lapse: `startTranscription`/`checkTranscription` and the job's waiting loop were written together with their tests, not after seeing them fail.

## Later: which model, measured

The owner asked whether Whisper is the best model for this. Measured rather than argued: `services/whisper/compare.py` runs the same recordings through several models. On the devbox (8 ARM cores, no GPU), 24 LibriSpeech recordings with known text, 204 seconds of speech:

| Model                                | Time  | Speed          | Words wrong      |
| ------------------------------------ | ----- | -------------- | ---------------- |
| Parakeet TDT 0.6B v2                 | 12 s  | 17x real time  | 12 of 496 (2.4%) |
| Whisper large-v3-turbo               | 577 s | 0.4x real time | 14 of 496 (2.8%) |
| Whisper small (what the service ran) | 155 s | 1.3x real time | 29 of 496 (5.8%) |

- The service now runs Parakeet by default (`onnx-asr`), with the Whisper models still selectable through `WHISPER_MODEL`. A real job through the running service: 11 seconds of speech in about 3 seconds, word for word.
- **Long recordings.** Read whole, a 5-minute test kept every sentence but took 4 GB of memory. Cut at every pause, sentences were broken up ("Ask not. What your country can do for you."). The service reads up to two minutes whole and cuts longer ones only at pauses of 1.5 s or more, in pieces of at most 40 s; that kept 26 of 28 sentences.
- Caveats: LibriSpeech is clean read speech these models are all tuned on, so the accuracy gap is a rough guide; the machine's load varied during the run (it rose, which if anything hurt the later models, and Parakeet ran last). Parakeet v2 is English only. Not yet run on the owner's own notes: none exist.
- Two sample sources were tried first: one refused automated downloads (left alone), one API returned 503 for a few minutes (the script now retries).
