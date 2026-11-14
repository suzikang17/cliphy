// Closing the window leaves the helper in the menu bar; quitting the app must
// still work however it is asked for.

interface Emitter<Listener> {
  on(event: string, listener: Listener): unknown;
}

interface ClosableWindow extends Emitter<(event: { preventDefault(): void }) => void> {
  hide(): void;
}

export function stayInMenuBar(app: Emitter<() => void>) {
  let quitting = false;
  // Cmd+Q, logging out, shutting down and the tray's Quit all arrive here first.
  // Without this the hidden window refuses to close and the quit is cancelled.
  app.on("before-quit", () => {
    quitting = true;
  });
  return {
    keepOpen(win: ClosableWindow): void {
      win.on("close", (event) => {
        if (quitting) return;
        event.preventDefault();
        win.hide();
      });
    },
  };
}
