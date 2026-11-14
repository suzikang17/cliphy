# Cliphy Helper (Mac app)

A menu-bar app that passes the Messages threads you choose to the Cliphy coach.
It wraps the code in `apps/mac-helper`; see that folder for how reading and
uploading work.

## Using it

1. Open Cliphy Helper. It shows a code.
2. On the phone: Chat → Setup → Mac messages → enter the code.
3. Press **Open settings** and switch on Cliphy Helper under Full Disk Access.
4. Switch on the people whose texts should go to Chat.

It then stays in the menu bar and starts at login. Closing the window does not
stop it; Quit is in the menu-bar item.

## Building

```sh
pnpm --filter cliphy-helper-app build   # bundle into dist/
pnpm --filter cliphy-helper-app start   # run from source (on a Mac); fetches Electron the first time
pnpm --filter cliphy-helper-app dist    # disk image in release/ (on a Mac)
```

The "Mac app" workflow builds it on every change and uploads two artifacts: the
disk image, and pictures of each screen drawn with made-up data
(`CLIPHY_SMOKE_OUT=<dir>` makes the app do that and exit).

## Working on it

Run it from source on the Mac with `start`. Full Disk Access then belongs to
the Electron program inside `node_modules`, which does not change when the code
does, so it is granted once: add
`node_modules/electron/dist/Electron.app` (at the top of the repo) under Full Disk Access.
It is listed there as **Electron**, not Cliphy Helper.
Quit the installed Cliphy Helper first; only one copy runs at a time.

`start` opens Electron through `open` (see `start.mjs`) rather than as a child
of the terminal. macOS charges Full Disk Access to the program that started a
process, so a child of a terminal without that access is refused Messages even
with Electron switched on. Two more things to know:

- If macOS offers "Quit & Reopen" after the switch, it reopens a bare Electron
  without the app. Quit that and run `start` again.
- If Electron is switched on and still refused, remove it from the list and add
  it again. If that does not help, give it a complete signature first:
  `codesign --force --deep --sign - node_modules/electron/dist/Electron.app`.

With setup finished the app starts without a window; run `start` a second time
(or use the menu-bar item) to open it.

## Until it is signed

Builds are not signed with a Developer ID yet. After copying the app to
Applications, either allow it in System Settings → Privacy & Security → "Open
Anyway", or run:

```sh
xattr -dr com.apple.quarantine "/Applications/Cliphy Helper.app"
```

Full Disk Access has to be switched on again after each new build.

## Settings for development

- `CLIPHY_API_URL`: the server (default `https://api.cliphy.app`).
- `CLIPHY_HELPER_DIR`: where the key and cursor are kept (default `~/.cliphy-helper`, shared with the terminal helper).
