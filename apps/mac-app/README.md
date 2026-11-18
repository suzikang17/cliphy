# Cliphy Helper (Mac app)

A menu-bar app that passes the Messages threads you choose to the Cliphy coach,
and a window with the full app: Chat, Projects and Up next.
It wraps the code in `apps/mac-helper`; see that folder for how reading and
uploading work.

## The full app in the window

Once setup is finished the window opens on Chat, with a side nav. Those screens
are the phone app (`apps/mobile`) built for the web into `web/` by `build.mjs`.
The Mac app serves them at `app://cliphy/` and answers their `/api/` calls
itself, adding the Mac's own key (`src/appServer.ts`), so the window has no
sign-in. **Messages** at the foot of the nav goes back to the setup screen;
**Open Cliphy** there returns. See `docs/decisions/0064`.

```sh
pnpm --filter cliphy-helper-app preview   # the full app in a browser, on made-up data (any machine)
node build.mjs --no-web                   # rebuild the Mac's own code only
```

## Claude Code

Settings → Connected tools → Claude Code → **Connect** points Claude Code on this
Mac at the coach (`claude mcp add --scope user cliphy …`), using the Mac's own
key. The key stays in the main process: the window only gets back where Claude
Code stands. The command runs in the login shell (`$SHELL -ilc`) because an app
opened from Finder has a bare PATH. See `src/claudeCode.ts` and
`docs/decisions/0067`.

## Using it

1. Open Cliphy Helper. It shows a code.
2. On the phone: Chat → Setup → Mac messages → enter the code.
3. Press **Open settings** and switch on Cliphy Helper under Full Disk Access.
4. Switch on the people whose texts should go to Chat.
   Someone who is not listed yet can be added from their thread under **From
   Messages**; choose there how far back to read (new messages only, the last
   30 days, or everything).

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
