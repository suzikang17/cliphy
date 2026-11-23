---
type: decision
title: "Voice notes: transcribed by a hosted API, then tagged by the job every clip goes through"
date: 2026-11-23
category: AI
revisit: true
---

## Why this choice

The owner wants voice notes and written notes in Cliphy, auto-tagged the way videos are, and asked whether to keep the Whisper setup. Podcast transcription pointed at a self-hosted Whisper service (`WHISPER_SERVICE_URL`) that was never stood up.

- **Transcription is a hosted API by default.** `services/transcribe.ts` takes the address of an audio file and returns its words. With `DEEPGRAM_API_KEY` set it calls Deepgram (`POST /v1/listen?model=nova-3&smart_format=true` with `{ url }`; the transcript comes back in the same call). With only `WHISPER_SERVICE_URL` set it speaks to a Whisper service the way the podcast job does. `DEEPGRAM_MODEL` changes the model without a deploy.
- **A voice note is a clip** (`source_type = 'voice'`, migration 050). The recording goes to storage (`voice/<user>/…` in the clips bucket), `POST /api/notes/voice` makes the clip, and `transcribeVoiceNote` puts the words in `content`.
- **Tagging is not special-cased.** The clip is handed to `embed-clip`, which already summarizes, categorizes and tags web pages, tweets and images. `enrichPlan` decides what is read: those three once; a voice note once it has words; a note every time it changes, keeping the tags already on it. Videos and podcasts keep their own pipeline.
- **One recorder and player for phone and web:** `expo-audio`, which has a browser implementation.

## Options considered

- **Self-hosted Whisper (what the podcast job assumed).** No per-minute cost. Needs a machine with a GPU, or a slow CPU one, kept running and patched, for a few minutes of audio a day. It was never set up, which is the usual fate of this option for one person.
- **Open models newer than Whisper** (Parakeet, Canary, Voxtral). Several beat Whisper large-v3 on English in public leaderboards. Same hosting burden, and narrower language coverage.
- **OpenAI's transcription API.** Comparable price. Takes an uploaded file rather than an address, so the server would download each recording and send it on.
- **AssemblyAI.** The lowest listed price found (about $0.0025 a minute). Answers through polling or a callback, not in the same call.
- **Deepgram (chosen).** Reads the file from a signed address and answers in one call, which suits a short serverless function. Listed around $0.004 to $0.008 a minute depending on the source; either way a minute-long note costs under a cent.

## Tradeoffs

- The prices and accuracy figures came from comparison pages that disagree with each other; none was checked against a vendor's own price list. The API contract was read from Deepgram's documentation.
- Recordings are sent to a third party to be transcribed. Self-hosting remains one environment variable away.
- `expo-audio` is a native module: the phone needs a new build before it gets this or any later update (the native fingerprint changed from `6e52…` to `dc55…`).
- A note is re-read by the model on every edit. Each read is small; a note edited fifty times a day would be fifty small calls.
- Nothing works until a transcription key is set in Vercel. Until then a voice note is saved, can be played back, and says "Transcription is not set up".
