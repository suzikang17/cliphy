# Cliphy Mac helper

Reads the Messages history on your Mac for the people you marked in the app and
uploads new messages, with their image attachments, to the Cliphy coach. It runs
in the background; everything you see and do stays on your phone.

- Only one-to-one threads, and only for people with **Capture** on in the app
  (Chat → Setup → People).
- Both directions are uploaded, so the bot has the conversation.
- The Messages database is opened read-only and never changed.
- HEIC photos are converted to JPEG. Attachments that are not images are skipped.

## Setup (once)

Needs Node 22.13 or later, and this repo with `pnpm install` done.

1. **Connect it to your account.**

   ```sh
   cd apps/mac-helper
   pnpm tsx src/main.ts pair
   ```

   It shows a code. On the phone: Chat → Setup → Mac messages → enter the code.
   The helper then says which account it is connected to.

2. **Allow it to read Messages.** System Settings → Privacy & Security → Full
   Disk Access → add the `node` program the helper runs with (`which node`),
   and your terminal app.

3. **Check.** This prints the latest message it can see for each captured person:

   ```sh
   pnpm check
   ```

4. **Run it in the background** from every login:

   ```sh
   pnpm tsx src/main.ts install
   ```

   and run the `launchctl load` command it prints.

## Commands

| Command                     | What it does                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `pair`                      | Shows a code to enter on the phone, then saves this Mac's key in `~/.cliphy-helper/config.json`. |
| `login <api url> <api key>` | The same, with a key made by hand.                                                               |
| `check`                     | Confirms Messages is readable and shows the latest message per captured person.                  |
| `once`                      | Uploads anything new, then exits.                                                                |
| `run`                       | Uploads anything new every 20 seconds until stopped.                                             |
| `install`                   | Writes the launchd job that runs `run` at login and restarts it.                                 |

## How far back it reads

The first time a person's thread is connected, the helper follows the choice
made for that person in the app: new messages only, a number of days back, or
the whole thread. Anything read from the past arrives in the app as history,
with no notifications.

## If the Mac was off

It catches up when it is back: up to 500 messages per person every 20 seconds,
in order. A message is identified by its Messages id, so nothing is uploaded
twice.

## Files

- `~/.cliphy-helper/config.json`: API address and key.
- `~/.cliphy-helper/state.json`: the last message uploaded per person.
- `~/.cliphy-helper/helper.log`: what it did.

To start a person over, turn Capture off and on in the app and delete their
entry from `state.json`.
