/**
 * Injected into the tab the user was switched to via
 * `scripting.executeScript({ func: showDupeToast, args: [url] })`.
 *
 * Self-contained (serialized by Chrome): no imports, no module references.
 * Runs in the isolated world, so `chrome.runtime.sendMessage` reaches the
 * background worker for Undo.
 */
export function showDupeToast(reopenUrl: string): void {
  const ID = "cliphy-dupe-toast";
  document.getElementById(ID)?.remove();

  const host = document.createElement("div");
  host.id = ID;
  host.style.cssText =
    "position:fixed;z-index:2147483647;bottom:20px;left:50%;transform:translateX(-50%) translateY(12px);opacity:0;transition:opacity .18s ease,transform .18s ease;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      .t{font:600 13px/1.3 system-ui,sans-serif;display:flex;gap:12px;align-items:center;
        background:#111;color:#fff;padding:10px 14px;border-radius:10px;
        box-shadow:0 6px 24px rgba(0,0,0,.25);border:2px solid #000}
      button{font:inherit;background:#d4ff3a;color:#111;border:2px solid #000;border-radius:7px;
        padding:3px 10px;cursor:pointer}
    </style>
    <div class="t" role="status">Already open — switched you here<button type="button">Undo</button></div>`;
  document.documentElement.appendChild(host);
  requestAnimationFrame(() => {
    host.style.opacity = "1";
    host.style.transform = "translateX(-50%) translateY(0)";
  });

  const dismiss = () => {
    host.style.opacity = "0";
    setTimeout(() => host.remove(), 200);
  };
  root.querySelector("button")?.addEventListener("click", () => {
    void chrome.runtime.sendMessage({ type: "DEDUPE_UNDO", url: reopenUrl });
    dismiss();
  });
  setTimeout(dismiss, 6000);
}
