---
type: decision
title: "Bark for build notifications to the owner's phone"
date: 2026-11-14
category: Tooling
revisit: true
---

## Why this choice

The manual EAS build workflow (`.github/workflows/eas-build.yml`) now waits for the build and pushes the result to the owner's iPhone through [Bark](https://github.com/Finb/Bark): one `curl` POST to `api.day.app/push` with the device key in the `BARK_KEY` repo secret. The step is skipped while the secret is unset.

- Bark is free, open source (app and server) and sends through Apple's push service directly.
- The only recipient is one iPhone, so iPhone-only is not a cost.
- The message carries no secrets: a title, the profile, and a link to the run.

## Options considered

- **ntfy:** the usual default, but its iPhone app had open reports of no push at all on iOS 27 (issues #2117, #2157, November 2026), and self-hosted servers still relay through ntfy.sh to wake an iPhone.
- **Pushover:** proven, $4.99 once; nothing it adds is needed for build notices.
- **Discord / Slack / Telegram:** a chat room with history is more than this needs; each needs an account or bot.
- **EAS webhooks to a Cliphy endpoint, shown in Chat:** the nicest result, but new server code, and the app's own push only works once the build being announced is installed.
- **GitHub app or email only:** zero setup; kept as the fallback.

## Tradeoffs

- Bark is a one-developer project and the public server is the author's; if it goes away, self-host `bark-server` or switch the one `curl`.
- Waiting for the build holds a CI runner idle for the length of the build (job timeout 120 minutes).
- Not yet confirmed that `eas build --auto-submit` without `--no-wait` also waits for the TestFlight submission, so "Sent to TestFlight" means handed to submission, not processed by Apple.
