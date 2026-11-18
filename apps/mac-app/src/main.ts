import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  nativeImage,
  protocol,
  shell,
  Tray,
} from "electron";
import { execFile } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, userInfo } from "node:os";
import path from "node:path";
import { createApi } from "../../mac-helper/src/api.js";
import { contactFiles, readContacts, type ContactNames } from "../../mac-helper/src/contacts.js";
import { prepareImage } from "../../mac-helper/src/images.js";
import {
  maxRowId,
  openMessages,
  readThread,
  recentThreads,
  sqlite,
} from "../../mac-helper/src/messagesDb.js";
import { pairWithPhone, realPairDeps } from "../../mac-helper/src/pair.js";
import {
  clearConfig,
  DEFAULT_DIR,
  loadConfig,
  loadState,
  saveConfig,
  saveState,
  type HelperConfig,
} from "../../mac-helper/src/store.js";
import { ApiError, syncOnce } from "../../mac-helper/src/sync.js";
import { createAppServer } from "./appServer.js";
import { claudeCode, mcpCommand, type ClaudeCodeStatus, type ShellResult } from "./claudeCode.js";
import { fakeApi } from "./fakeApi.js";
import { Controller, type AddHistory, type AppState, type NewPerson } from "./controller.js";
import { stayInMenuBar } from "./quit.js";
import { statusLine } from "./status.js";

// Cliphy Helper: lives in the menu bar, pairs with the phone, and uploads the
// chosen Messages threads. All the deciding is in controller.ts.

const DIR = process.env.CLIPHY_HELPER_DIR ?? DEFAULT_DIR;
const API_URL = process.env.CLIPHY_API_URL ?? "https://api.cliphy.app";
const SMOKE_OUT = process.env.CLIPHY_SMOKE_OUT;
const FULL_DISK_ACCESS = "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";

/** Where the window finds the full app: files and /api/ calls, both answered here. */
const APP_URL = "app://cliphy/";
// Must be said before the app is ready: a standard, secure address gets
// storage and ordinary page behaviour.
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
const menuBar = stayInMenuBar(app);

function log(message: string): void {
  try {
    mkdirSync(DIR, { recursive: true, mode: 0o700 });
    appendFileSync(path.join(DIR, "helper.log"), `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Logging must never stop the app.
  }
}

function canReadMessages(): boolean {
  try {
    const db = openMessages();
    try {
      maxRowId(db); // Opening succeeds without access; reading is what fails.
      return true;
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

async function sync(config: HelperConfig) {
  const db = openMessages();
  try {
    const state = loadState(DIR);
    const result = await syncOnce({
      api: createApi(config),
      messages: { read: (opts) => readThread(db, opts), maxRowId: () => maxRowId(db) },
      images: { prepare: (file, mimeType) => prepareImage(file, mimeType) },
      state,
      save: () => saveState(DIR, state),
      now: () => new Date(),
      log,
    });
    // Counts only: no names, numbers or words go into the log.
    if (result.uploaded > 0) {
      log(`Uploaded ${result.uploaded} message(s) from ${result.people} captured thread(s).`);
    }
    return result;
  } finally {
    db.close();
  }
}

async function setCapture(config: HelperConfig, personId: string, on: boolean): Promise<void> {
  const res = await fetch(`${config.apiUrl.replace(/\/+$/, "")}/api/coach/people/${personId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ captureThread: on }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new ApiError(`PATCH person → ${res.status}`, res.status);
}

async function setHistory(
  config: HelperConfig,
  personId: string,
  choice: { historyWindow: string; historyDays: number | null },
): Promise<void> {
  const res = await fetch(`${config.apiUrl.replace(/\/+$/, "")}/api/coach/people/${personId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      historyWindow: choice.historyWindow,
      ...(choice.historyWindow === "window" ? { historyDays: choice.historyDays } : {}),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new ApiError(`PATCH person → ${res.status}`, res.status);
}

/** Add someone straight from their Messages thread, already switched on. */
async function addPerson(config: HelperConfig, input: NewPerson): Promise<void> {
  const res = await fetch(`${config.apiUrl.replace(/\/+$/, "")}/api/coach/people`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: input.name,
      role: "client",
      handles: [input.handle],
      captureThread: true,
      historyWindow: input.historyWindow,
      ...(input.historyWindow === "window" ? { historyDays: input.historyDays } : {}),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new ApiError(`POST person → ${res.status}`, res.status);
}

let contacts: ContactNames | null = null;

function listRecentThreads() {
  const db = openMessages();
  try {
    // Contacts are read again with each list, so a newly saved name shows up.
    contacts = readContacts(contactFiles());
    return recentThreads(db, 8);
  } finally {
    db.close();
  }
}

/** Run a script the way the owner's terminal would, so `claude` is found as it is there. */
function loginShell(script: string, env: Record<string, string>): Promise<ShellResult> {
  return new Promise((resolve) => {
    execFile(
      userInfo().shell || "/bin/zsh",
      ["-ilc", script],
      { env: { ...process.env, ...env }, timeout: 60_000 },
      (err, stdout, stderr) => {
        const code = !err ? 0 : typeof err.code === "number" ? err.code : 1;
        resolve({ code, output: `${stdout}${stderr}` });
      },
    );
  });
}

const claude = claudeCode({
  run: loginShell,
  readConfig: () => {
    try {
      return readFileSync(path.join(homedir(), ".claude.json"), "utf8");
    } catch {
      return null;
    }
  },
});

/** Present once this app has connected Claude Code, so connecting the Mac again keeps it working. */
const CLAUDE_FLAG = path.join(DIR, "claude-code");

/** What the window is told: where Claude Code stands, and the system's message if it failed. */
async function claudeAnswer(
  work: () => Promise<ClaudeCodeStatus>,
): Promise<{ status: ClaudeCodeStatus | null; error: string | null }> {
  try {
    return { status: await work(), error: null };
  } catch (err) {
    return { status: null, error: err instanceof Error && err.message ? err.message : "Error" };
  }
}

const controller = new Controller({
  apiUrl: API_URL,
  loadConfig: () => loadConfig(DIR),
  saveConfig: (config) => {
    saveConfig(DIR, config);
    // Paired for the first time: come back by itself after a restart.
    app.setLoginItemSettings({ openAtLogin: true });
    // Pairing makes a new key; Claude Code, if this app connected it, moves to it.
    if (existsSync(CLAUDE_FLAG)) {
      claude.connect(config.apiKey, config.apiUrl).catch(() => log("Couldn't update Claude Code."));
    }
  },
  clearConfig: () => clearConfig(DIR),
  pair: (apiUrl, show) => pairWithPhone(apiUrl, realPairDeps(show)),
  canReadMessages,
  people: (config) => createApi(config).people(),
  sync,
  setCapture,
  setHistory,
  recentThreads: listRecentThreads,
  contactName: (handle) => contacts?.nameFor(handle) ?? null,
  addPerson,
  now: () => new Date(),
  onChange: (state) => {
    win?.webContents.send("state", view(state));
    drawTray(state);
  },
});

/** What the window draws: the state plus its one-line summary. */
const view = (state: AppState) => ({ ...state, status: statusLine(state, new Date()) });

function drawTray(state: AppState): void {
  if (!tray) return;
  const status = statusLine(state, new Date());
  tray.setToolTip(`Cliphy Helper: ${status}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: status, enabled: false },
      ...(state.account ? [{ label: state.account, enabled: false }] : []),
      { type: "separator" },
      { label: "Open Cliphy", click: showWindow },
      {
        label: "Start at login",
        type: "checkbox",
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
      },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]),
  );
}

/** Setup is finished once the Mac is connected and may read Messages. */
const setupDone = (): boolean => Boolean(loadConfig(DIR)) && canReadMessages();

/** The Mac's own screen: connect, allow Messages, choose people. */
function showSetup(): void {
  void win?.loadFile(path.join(__dirname, "..", "ui", "index.html"));
}

/** The full app: Chat, Projects, Up next. */
function showCoach(): void {
  void win?.loadURL(APP_URL);
}

function showWindow(): void {
  if (win) {
    win.show();
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    title: "Cliphy",
    titleBarStyle: "hiddenInset",
    backgroundColor: "#FBF7EF",
    show: !SMOKE_OUT,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true },
  });
  // Links to other sites open in the browser, never in this window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|sms|mailto):/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(APP_URL) || url.startsWith("file:")) return;
    event.preventDefault();
    if (/^(https?|sms|mailto):/.test(url)) void shell.openExternal(url);
  });
  // The full app leaves a blank strip along its top (DesktopShell); this makes
  // that strip drag the window, as the title bar it replaces would.
  win.webContents.on("did-finish-load", () => {
    if (!win?.webContents.getURL().startsWith(APP_URL)) return;
    void win.webContents.insertCSS(
      "body::before{content:'';position:fixed;top:0;left:0;right:0;height:30px;-webkit-app-region:drag;z-index:9999}",
    );
  });
  if (setupDone() && !SMOKE_OUT) showCoach();
  else showSetup();
  // Closing the window leaves the helper running in the menu bar.
  menuBar.keepOpen(win);
}

ipcMain.handle("get-state", () => view(controller.state));
ipcMain.handle("open-settings", () => shell.openExternal(FULL_DISK_ACCESS));
ipcMain.handle("show-app", () => {
  // The .app itself, selected in Finder, ready to drag into the Full Disk Access list.
  const bundle = app.getPath("exe").replace(/\/Contents\/MacOS\/[^/]+$/, "");
  shell.showItemInFolder(bundle);
});
ipcMain.handle("relaunch", () => {
  app.relaunch();
  app.exit(0);
});
ipcMain.handle("set-capture", (_event, personId: string, on: boolean) =>
  controller.setCapture(String(personId), Boolean(on)),
);
ipcMain.handle("set-history", (_event, personId: string, history: AddHistory) =>
  controller.setHistory(String(personId), history),
);
ipcMain.handle("add-person", (_event, handle: string, name: string, history?: AddHistory) =>
  controller.addPerson(String(handle), String(name), history),
);
ipcMain.handle("disconnect", async () => {
  controller.disconnect();
  // Claude Code was using this Mac's key: it goes with it.
  rmSync(CLAUDE_FLAG, { force: true });
  await claude.disconnect().catch(() => log("Couldn't remove Cliphy from Claude Code."));
});
ipcMain.handle("claude-code-status", () =>
  claudeAnswer(() => claude.status(loadConfig(DIR)?.apiKey ?? null)),
);
ipcMain.handle("claude-code-connect", () =>
  claudeAnswer(async () => {
    const config = loadConfig(DIR);
    if (!config) throw new Error("This Mac is not connected");
    const status = await claude.connect(config.apiKey, config.apiUrl);
    if (status === "on") {
      mkdirSync(DIR, { recursive: true, mode: 0o700 });
      writeFileSync(CLAUDE_FLAG, "");
    }
    return status;
  }),
);
ipcMain.handle("claude-code-disconnect", () =>
  claudeAnswer(async () => {
    rmSync(CLAUDE_FLAG, { force: true });
    await claude.disconnect();
    return "off";
  }),
);
// The key goes straight to the clipboard; the window never holds it.
ipcMain.handle("claude-code-copy", () => {
  const config = loadConfig(DIR);
  if (!config) return false;
  clipboard.writeText(mcpCommand(config.apiKey, config.apiUrl));
  return true;
});
ipcMain.handle("open-setup", showSetup);
ipcMain.handle("open-coach", showCoach);

/**
 * For CI: draw each screen with made-up state, save a picture of it, and
 * report whether this Electron can open SQLite. Touches no network and no
 * Messages history.
 */
async function smoke(outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const report: Record<string, unknown> = { versions: process.versions };
  try {
    const { DatabaseSync } = sqlite();
    const db = new DatabaseSync(":memory:");
    db.exec("create table t (a)");
    db.prepare("insert into t values (?)").run(7);
    report.sqlite = db.prepare("select a from t").get();
    db.close();
  } catch (err) {
    report.sqliteError = String(err);
  }
  const base: AppState = { ...controller.state };
  const screens: [string, Partial<AppState>][] = [
    ["1-pair", { step: "pair", code: "K7QM-3XVP" }],
    ["2-access", { step: "access", account: "maren@example.com" }],
    [
      "3-ready",
      {
        step: "ready",
        account: "maren@example.com",
        lastSyncAt: new Date(Date.now() - 120_000).toISOString(),
        lastUploaded: 3,
        people: [
          { id: "1", name: "Maren", capture: true, hasHandle: true, history: "all" },
          { id: "2", name: "Alder House team", capture: false, hasHandle: true, history: "new" },
          { id: "3", name: "Printer", capture: false, hasHandle: false, history: "new" },
        ],
        threads: [
          {
            handle: "+15550142",
            lastAtIso: new Date(Date.now() - 3_600_000).toISOString(),
            preview: "Can we move the sconces up a little on page 2",
          },
          {
            handle: "sam@example.com",
            name: "Sam",
            lastAtIso: new Date(Date.now() - 86_400_000).toISOString(),
            preview: "Photo",
          },
        ],
      },
    ],
    ["4-offline", { step: "ready", account: "maren@example.com", offline: true, people: [] }],
  ];
  try {
    showWindow();
    await new Promise<void>((resolve) => win!.webContents.once("did-finish-load", () => resolve()));
    win!.showInactive();
    for (const [name, patch] of screens) {
      win!.webContents.send("state", view({ ...base, ...patch }));
      await new Promise((resolve) => setTimeout(resolve, 600));
      const image = await win!.webContents.capturePage();
      writeFileSync(path.join(outDir, `${name}.png`), image.toPNG());
    }
    // The full app, on made-up data.
    const appScreens: [string, string][] = [
      ["5-app-chat", "chat"],
      ["6-app-projects", "projects"],
      ["7-app-project", "coach/project/project-1"],
    ];
    for (const [name, route] of appScreens) {
      await win!.loadURL(`${APP_URL}${route}`);
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const image = await win!.webContents.capturePage();
      writeFileSync(path.join(outDir, `${name}.png`), image.toPNG());
    }
    report.screens = [...screens, ...appScreens].map(([name]) => name);
  } catch (err) {
    report.windowError = String(err);
  }
  writeFileSync(path.join(outDir, "smoke.json"), JSON.stringify(report, null, 2));
  app.exit(report.sqlite && report.screens ? 0 : 1);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWindow);
  app.on("window-all-closed", () => {
    // Stay in the menu bar.
  });
  void app.whenReady().then(async () => {
    const serve = createAppServer({
      webDir: path.join(__dirname, "..", "web"),
      apiUrl: API_URL,
      // Read each time: connecting or disconnecting takes effect at once.
      // The pictures for CI are drawn unpaired, on made-up data.
      apiKey: () => (SMOKE_OUT ? "smoke" : (loadConfig(DIR)?.apiKey ?? null)),
      fetch: SMOKE_OUT ? fakeApi : (request) => fetch(request),
    });
    protocol.handle("app", (request) => serve(request));

    if (SMOKE_OUT) return smoke(SMOKE_OUT);

    const icon = nativeImage.createFromPath(
      path.join(__dirname, "..", "assets", "trayTemplate.png"),
    );
    icon.setTemplateImage(true);
    tray = new Tray(icon);
    log(`Started ${app.getVersion()} (${loadConfig(DIR) ? "connected" : "not connected"}).`);
    drawTray(controller.state);

    // Setup is not finished: show the window. Otherwise stay out of the way.
    if (!loadConfig(DIR) || !canReadMessages()) showWindow();
    void controller.run((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  });
}
