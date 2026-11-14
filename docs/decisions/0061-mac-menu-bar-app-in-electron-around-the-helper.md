---
type: decision
title: "Cliphy Helper: an Electron menu-bar app around the existing helper code"
date: 2026-11-14
category: Capture
revisit: true
---

## Why this choice

The Mac helper was a terminal program: clone the repo, install Node, paste a key, grant Full Disk Access to `node`. `apps/mac-app` is a menu-bar app that does the same job with three screens (Connect, Allow Messages, People) and bundles the helper's own code (`apps/mac-helper/src`) with esbuild, so the tested sync, paging and attachment logic is reused unchanged.

- All deciding is in `controller.ts` (pair → access → ready), with the Mac and the network passed in, so it is tested on Linux. The window only draws state.
- `node:sqlite` works inside Electron 45 (checked on a Mac runner), so no native module is needed.
- CI (`.github/workflows/mac-app.yml`) builds on `macos-latest`, runs the packaged app in a mode that draws each screen with made-up data and saves pictures, then packs the disk image. The pictures are how the UI is reviewed without a Mac at hand.

## Options considered

- **Native Swift/SwiftUI:** a few MB and the most Mac-like, but the sync logic would be rewritten in a language that cannot be compiled or tested on the dev machine.
- **Package the Node helper as one binary plus a terminal command:** removes the repo and Node, keeps the terminal and has no status display.
- **Tauri with the helper as a sidecar:** small, but two runtimes and a Rust toolchain for no gain here.

## Tradeoffs

- The disk image is about 220 MB (universal build). arm64-only would halve it.
- **Not signed yet.** CI signs "for this machine only" so the test run can start. A downloaded copy is blocked by Gatekeeper until allowed by hand, and Full Disk Access has to be granted again after every new build. Fix: a Developer ID Application certificate and notarization credentials in the repo's secrets.
- Full Disk Access cannot be granted by the app; the screen opens the right Settings pane and waits.
- People are switched on from the list the phone app already has, or added from the recent one-to-one threads, which are named from the Mac's Contacts when the number is saved there. The names are read locally and only sent when the owner adds the person.
- Run from source on a real Mac on 2026-11-14 (launch, Full Disk Access, People, From Messages). Pairing from source reached the code screen only; see the devlog for that day.
