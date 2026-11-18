import { contextBridge, ipcRenderer } from "electron";
import type { AppState } from "./controller.js";

// The only things the window can ask the app to do.
contextBridge.exposeInMainWorld("helper", {
  getState: (): Promise<AppState> => ipcRenderer.invoke("get-state"),
  onState: (listener: (state: AppState) => void) =>
    ipcRenderer.on("state", (_event, state: AppState) => listener(state)),
  openSettings: () => ipcRenderer.invoke("open-settings"),
  showApp: () => ipcRenderer.invoke("show-app"),
  relaunch: () => ipcRenderer.invoke("relaunch"),
  setCapture: (personId: string, on: boolean) => ipcRenderer.invoke("set-capture", personId, on),
  setHistory: (personId: string, history: string) =>
    ipcRenderer.invoke("set-history", personId, history),
  addPerson: (handle: string, name: string, history: string) =>
    ipcRenderer.invoke("add-person", handle, name, history),
  disconnect: () => ipcRenderer.invoke("disconnect"),
  /** Switch the window between the Mac's own screen and the full app. */
  openSetup: () => ipcRenderer.invoke("open-setup"),
  openCoach: () => ipcRenderer.invoke("open-coach"),
  /** Claude Code on this Mac, connected with the Mac's own key. The key never comes back here. */
  claudeCode: {
    status: () => ipcRenderer.invoke("claude-code-status"),
    connect: () => ipcRenderer.invoke("claude-code-connect"),
    disconnect: () => ipcRenderer.invoke("claude-code-disconnect"),
    copyCommand: (): Promise<boolean> => ipcRenderer.invoke("claude-code-copy"),
  },
});
