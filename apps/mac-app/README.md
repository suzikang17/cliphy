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
pnpm --filter cliphy-helper-app start   # run from source (on a Mac)
pnpm --filter cliphy-helper-app dist    # disk image in release/ (on a Mac)
```

The "Mac app" workflow builds it on every change and uploads two artifacts: the
disk image, and pictures of each screen drawn with made-up data
(`CLIPHY_SMOKE_OUT=<dir>` makes the app do that and exit).

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
