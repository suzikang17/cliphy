import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApi } from "./api.js";
import { prepareImage } from "./images.js";
import { launchdPlist } from "./launchd.js";
import {
  DEFAULT_DB_PATH,
  maxRowId,
  openMessages,
  readThread,
  type MessagesDb,
} from "./messagesDb.js";
import { DEFAULT_DIR, loadConfig, loadState, saveConfig, saveState } from "./store.js";
import { syncOnce, type SyncDeps } from "./sync.js";

// cliphy mac helper: reads the Messages history for the people marked in the
// app and uploads it to the coach. See README.md.

const CYCLE_MS = 20_000;
const here = path.dirname(fileURLToPath(import.meta.url));

const ACCESS_HELP = `Cannot read the Messages history at ${DEFAULT_DB_PATH}.

Messages is protected by macOS. Grant Full Disk Access to the program that runs
this helper:
  System Settings → Privacy & Security → Full Disk Access → add
    ${process.execPath}
  (and your terminal app, if you run the helper from a terminal)
Then run "check" again.`;

function log(message: string): void {
  console.log(`${new Date().toISOString()} ${message}`);
}

function open(): MessagesDb {
  try {
    const db = openMessages();
    maxRowId(db); // Opening succeeds without access; reading is what fails.
    return db;
  } catch {
    console.error(ACCESS_HELP);
    process.exit(1);
  }
}

function deps(db: MessagesDb): SyncDeps {
  const config = loadConfig(DEFAULT_DIR);
  if (!config) {
    console.error(
      "Not signed in. Run: login <api url> <api key>   (create a key in the app: Settings → API keys)",
    );
    process.exit(1);
  }
  const state = loadState(DEFAULT_DIR);
  return {
    api: createApi(config),
    messages: { read: (opts) => readThread(db, opts), maxRowId: () => maxRowId(db) },
    images: { prepare: (file, mimeType) => prepareImage(file, mimeType) },
    state,
    save: () => saveState(DEFAULT_DIR, state),
    now: () => new Date(),
    log,
  };
}

async function login(apiUrl?: string, apiKey?: string): Promise<void> {
  if (!apiUrl || !apiKey) {
    console.error("Usage: login <api url> <api key>");
    process.exit(1);
  }
  const people = await createApi({ apiUrl, apiKey }).people();
  saveConfig(DEFAULT_DIR, { apiUrl, apiKey });
  console.log(
    `Signed in. ${people.length} ${people.length === 1 ? "person" : "people"} in the app.`,
  );
}

async function check(): Promise<void> {
  const db = open();
  const d = deps(db);
  const people = await d.api.people();
  const captured = people.filter((p) => p.captureThread && p.handles.length > 0);
  console.log(`Messages history: readable (${maxRowId(db)} messages).`);
  if (captured.length === 0) {
    console.log("No threads are being captured. In the app: Chat → Setup → People → Capture.");
  }
  for (const person of captured) {
    const all = readThread(db, {
      handles: person.handles,
      afterRowId: 0,
      sinceIso: null,
      limit: 100_000,
    });
    const last = all.at(-1);
    console.log(
      last
        ? `${person.name}: ${all.length} messages, latest ${last.sentAtIso}: ${last.text.slice(0, 60) || "(attachment)"}`
        : `${person.name}: no one-to-one thread found for ${person.handles.join(", ")}`,
    );
  }
  db.close();
}

async function once(): Promise<void> {
  const db = open();
  const result = await syncOnce(deps(db));
  log(
    `${result.uploaded} uploaded, ${result.skippedAttachments} attachments skipped, ` +
      `${result.people} people${result.offline ? " (server unreachable)" : ""}`,
  );
  db.close();
}

async function runForever(): Promise<void> {
  const db = open();
  const d = deps(db);
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  log("Started.");
  while (!stopping) {
    try {
      const result = await syncOnce(d);
      if (result.uploaded > 0 || result.skippedAttachments > 0) {
        log(`${result.uploaded} uploaded, ${result.skippedAttachments} attachments skipped`);
      }
    } catch (err) {
      log(`Cycle failed: ${String(err)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, CYCLE_MS));
  }
  db.close();
  log("Stopped.");
}

function install(): void {
  const agents = path.join(homedir(), "Library", "LaunchAgents");
  const file = path.join(agents, "app.cliphy.helper.plist");
  mkdirSync(agents, { recursive: true });
  mkdirSync(DEFAULT_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(
    file,
    launchdPlist({
      node: process.execPath,
      main: path.join(here, "main.ts"),
      cwd: path.dirname(here),
      logDir: DEFAULT_DIR,
    }),
  );
  console.log(`Wrote ${file}

Start it now and at every login:
  launchctl load -w "${file}"
Stop it:
  launchctl unload -w "${file}"
Log:
  ${path.join(DEFAULT_DIR, "helper.log")}

Full Disk Access must be granted to:
  ${process.execPath}`);
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case "login":
    await login(args[0], args[1]);
    break;
  case "check":
    await check();
    break;
  case "once":
    await once();
    break;
  case "run":
    await runForever();
    break;
  case "install":
    install();
    break;
  default:
    console.log("Usage: login <api url> <api key> | check | once | run | install");
}
