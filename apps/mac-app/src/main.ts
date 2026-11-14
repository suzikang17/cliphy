import { app, BrowserWindow, ipcMain, Menu, nativeImage, shell, Tray } from "electron";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createApi } from "../../mac-helper/src/api.js";
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
import { Controller, type AppState } from "./controller.js";
import { statusLine } from "./status.js";

// Cliphy Helper: lives in the menu bar, pairs with the phone, and uploads the
// chosen Messages threads. All the deciding is in controller.ts.

const DIR = process.env.CLIPHY_HELPER_DIR ?? DEFAULT_DIR;
const API_URL = process.env.CLIPHY_API_URL ?? "https://api.cliphy.app";
const SMOKE_OUT = process.env.CLIPHY_SMOKE_OUT;
const FULL_DISK_ACCESS = "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

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
    return await syncOnce({
      api: createApi(config),
      messages: { read: (opts) => readThread(db, opts), maxRowId: () => maxRowId(db) },
      images: { prepare: (file, mimeType) => prepareImage(file, mimeType) },
      state,
      save: () => saveState(DIR, state),
      now: () => new Date(),
      log,
    });
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

/** Add someone straight from their Messages thread, already switched on. */
async function addPerson(
  config: HelperConfig,
  input: { name: string; handle: string },
): Promise<void> {
  const res = await fetch(`${config.apiUrl.replace(/\/+$/, "")}/api/coach/people`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: input.name,
      role: "client",
      handles: [input.handle],
      captureThread: true,
      historyWindow: "new",
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new ApiError(`POST person → ${res.status}`, res.status);
}

function listRecentThreads() {
  const db = openMessages();
  try {
    return recentThreads(db, 8);
  } finally {
    db.close();
  }
}

const controller = new Controller({
  apiUrl: API_URL,
  loadConfig: () => loadConfig(DIR),
  saveConfig: (config) => {
    saveConfig(DIR, config);
    // Paired for the first time: come back by itself after a restart.
    app.setLoginItemSettings({ openAtLogin: true });
  },
  clearConfig: () => clearConfig(DIR),
  pair: (apiUrl, show) => pairWithPhone(apiUrl, realPairDeps(show)),
  canReadMessages,
  people: (config) => createApi(config).people(),
  sync,
  setCapture,
  recentThreads: listRecentThreads,
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
      { label: "Open Cliphy Helper", click: showWindow },
      {
        label: "Start at login",
        type: "checkbox",
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function showWindow(): void {
  if (win) {
    win.show();
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 380,
    height: 560,
    resizable: false,
    fullscreenable: false,
    title: "Cliphy Helper",
    titleBarStyle: "hiddenInset",
    backgroundColor: "#FBF7EF",
    show: !SMOKE_OUT,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true },
  });
  void win.loadFile(path.join(__dirname, "..", "ui", "index.html"));
  // Closing the window leaves the helper running in the menu bar.
  win.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    win?.hide();
  });
}

ipcMain.handle("get-state", () => view(controller.state));
ipcMain.handle("open-settings", () => shell.openExternal(FULL_DISK_ACCESS));
ipcMain.handle("show-app", () => {
  // The .app itself, selected in Finder, ready to drag into the Full Disk Access list.
  const bundle = app.getPath("exe").replace(/\/Contents\/MacOS\/[^/]+$/, "");
  shell.showItemInFolder(bundle);
});
ipcMain.handle("relaunch", () => {
  quitting = true;
  app.relaunch();
  app.exit(0);
});
ipcMain.handle("set-capture", (_event, personId: string, on: boolean) =>
  controller.setCapture(String(personId), Boolean(on)),
);
ipcMain.handle("add-person", (_event, handle: string, name: string) =>
  controller.addPerson(String(handle), String(name)),
);
ipcMain.handle("disconnect", () => controller.disconnect());

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
          { id: "1", name: "Maren", capture: true, hasHandle: true },
          { id: "2", name: "Alder House team", capture: false, hasHandle: true },
          { id: "3", name: "Printer", capture: false, hasHandle: false },
        ],
        threads: [
          {
            handle: "+15550142",
            lastAtIso: new Date(Date.now() - 3_600_000).toISOString(),
            preview: "Can we move the sconces up a little on page 2",
          },
          {
            handle: "sam@example.com",
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
    report.screens = screens.map(([name]) => name);
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
    if (SMOKE_OUT) return smoke(SMOKE_OUT);

    const icon = nativeImage.createFromPath(
      path.join(__dirname, "..", "assets", "trayTemplate.png"),
    );
    icon.setTemplateImage(true);
    tray = new Tray(icon);
    drawTray(controller.state);

    // Setup is not finished: show the window. Otherwise stay out of the way.
    if (!loadConfig(DIR) || !canReadMessages()) showWindow();
    void controller.run((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  });
}
