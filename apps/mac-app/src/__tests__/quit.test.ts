import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { stayInMenuBar } from "../quit.js";

class FakeWindow extends EventEmitter {
  hidden = 0;
  hide(): void {
    this.hidden += 1;
  }
}

/** Ask the window to close, as Electron does; true if it was allowed to. */
function close(win: FakeWindow): boolean {
  let prevented = false;
  win.emit("close", { preventDefault: () => (prevented = true) });
  return !prevented;
}

describe("closing the window", () => {
  it("hides the window and keeps the helper running", () => {
    const app = new EventEmitter();
    const win = new FakeWindow();
    stayInMenuBar(app).keepOpen(win);

    expect(close(win)).toBe(false);
    expect(win.hidden).toBe(1);
  });

  it("lets the window close once the Mac asks the app to quit", () => {
    // Cmd+Q, logging out, shutting down and the tray's Quit all arrive as before-quit.
    const app = new EventEmitter();
    const win = new FakeWindow();
    stayInMenuBar(app).keepOpen(win);

    app.emit("before-quit");

    expect(close(win)).toBe(true);
    expect(win.hidden).toBe(0);
  });
});
