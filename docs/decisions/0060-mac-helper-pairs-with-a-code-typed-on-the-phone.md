---
type: decision
title: "Mac helper pairs with a code typed on the phone"
date: 2026-11-14
category: Capture
revisit: true
---

## Why this choice

Connecting the Mac helper meant creating an API key on the phone and pasting it into a terminal on the Mac. Now the Mac shows an 8-character code, the owner types it into Setup on the phone, and the Mac collects its own key (`routes/pair.ts`, migration `044`).

- `POST /api/pair/start` (open): makes the code and a poll secret; only the secret's hash is stored. Codes last ten minutes; at most 200 wait at once.
- `POST /api/coach/pair/claim` (signed in, not with an API key): attaches an unclaimed, unexpired code to the account.
- `POST /api/pair/poll` (open, needs the poll secret): once claimed, deletes the pairing, then issues a key named "Mac helper" and returns it with the account's email. Whichever poll deletes the row gets the key; pairing again replaces the earlier helper key.

## Options considered

- **Phone shows the code, Mac enters it:** the open endpoint would then hand an API key to anyone who guessed a code. With the Mac showing it, a guess only attaches someone's Mac to the guesser's account, and the Mac names that account before uploading.
- **Six digits:** easier to type, but guessable within the window without attempt tracking. Eight characters from a 31-letter alphabet needs none.
- **QR code scanned by the phone:** nicer; needs the camera flow in Setup. Later, on top of the same endpoints.
- **Sign in with Google on the Mac:** a browser round trip and token storage for a program that only needs one key.

## Tradeoffs

- One helper key per account, so one Mac at a time.
- The start endpoint is open to the internet; the cap on waiting codes is its only limit.
- If issuing the key fails after the pairing is deleted, the owner has to start again.
