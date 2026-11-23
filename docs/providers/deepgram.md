---
type: provider
title: Deepgram
category: AI
status: Evaluating
plan: "Pay per minute of audio"
date_evaluated: 2026-11-23
---

# Deepgram

## Why

Speech to text for voice notes (ADR 0071). It reads the recording from a signed address and returns the transcript in the same call, so the serverless job needs no file upload and no polling. Used by `apps/server/src/services/transcribe.ts` when `DEEPGRAM_API_KEY` is set (Vercel production and preview); `DEEPGRAM_MODEL` overrides the default `nova-3`. Not set up: no account or key exists as of 2026-11-23. The owner is trying the self-hosted Whisper service first (`services/whisper`); this stays the fallback.

## Cost notes

Comparison pages list Nova-3 pre-recorded at roughly $0.004 to $0.008 per minute; not checked against Deepgram's own price list. At a few short notes a day this is cents a month. Requests that take over 10 minutes to process time out; a voice note is far below that.
