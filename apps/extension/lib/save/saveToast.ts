// The ⌘⇧S on-page toast. Both functions are injected with
// `scripting.executeScript` (activeTab), so each must be self-contained: no
// imports, no module references. The first call creates the toast and keeps an
// updater on `window` (the extension's isolated world persists between
// injections); later calls just pass new state to it.

export type SaveToastState =
  | { phase: "saving"; title: string }
  | { phase: "saved"; title: string; tags: string[]; suggested: string[]; video?: boolean }
  | { phase: "duplicate"; title: string; tags: string[] }
  | { phase: "error"; message: string };

export function showSaveToast(state: SaveToastState): void {
  type W = Window & { __cliphySaveToast?: (s: SaveToastState) => void };
  const w = window as W;
  const ID = "cliphy-save-toast";
  document.getElementById(ID)?.remove();

  const host = document.createElement("div");
  host.id = ID;
  host.style.cssText =
    "position:fixed;z-index:2147483647;top:16px;right:16px;opacity:0;transform:translateY(-8px);transition:opacity .16s ease,transform .16s ease;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      .t{font:600 13px/1.35 system-ui,sans-serif;min-width:220px;max-width:340px;background:#111;color:#fff;
        padding:10px 12px;border-radius:10px;border:2px solid #000;box-shadow:0 8px 28px rgba(0,0,0,.28)}
      .h{display:flex;align-items:center;gap:8px}
      .dot{width:8px;height:8px;border-radius:50%;background:#d4ff3a;flex:none}
      .saving .dot{animation:p 1s ease-in-out infinite}
      .err .dot{background:#ff5d5d}
      @keyframes p{50%{opacity:.25}}
      .title{font-weight:500;opacity:.7;font-size:11px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
      .tag{font-size:11px;padding:2px 7px;border-radius:999px;background:#d4ff3a;color:#111;border:1.5px solid #000;
        opacity:0;transform:translateY(4px) scale(.92);transition:opacity .22s ease,transform .22s cubic-bezier(.2,1.4,.4,1)}
      .tag.sug{background:transparent;color:#d4ff3a;border:1.5px dashed #d4ff3a}
      .tag.in{opacity:1;transform:none}
    </style>
    <div class="t saving" role="status" aria-live="polite">
      <div class="h"><span class="dot"></span><span class="msg"></span></div>
      <div class="title"></div>
      <div class="tags"></div>
    </div>`;
  document.documentElement.appendChild(host);
  requestAnimationFrame(() => {
    host.style.opacity = "1";
    host.style.transform = "none";
  });

  const box = root.querySelector(".t") as HTMLElement;
  const msg = root.querySelector(".msg") as HTMLElement;
  const title = root.querySelector(".title") as HTMLElement;
  const tags = root.querySelector(".tags") as HTMLElement;
  let timer: number | undefined;
  let hovering = false;
  host.addEventListener("mouseenter", () => (hovering = true));
  host.addEventListener("mouseleave", () => {
    hovering = false;
    scheduleClose(1500);
  });

  function close() {
    if (hovering) return;
    host.style.opacity = "0";
    host.style.transform = "translateY(-8px)";
    setTimeout(() => host.remove(), 200);
    delete w.__cliphySaveToast;
  }
  function scheduleClose(ms: number) {
    clearTimeout(timer);
    timer = window.setTimeout(close, ms);
  }
  function chips(list: string[], suggested: boolean, startDelay: number) {
    list.forEach((t, i) => {
      const el = document.createElement("span");
      el.className = suggested ? "tag sug" : "tag";
      el.textContent = (suggested ? "+ " : "") + t.split(":").join(" › ");
      el.title = suggested ? "Suggested — accept it in Cliphy" : "Tag applied";
      tags.appendChild(el);
      setTimeout(() => el.classList.add("in"), startDelay + i * 90);
    });
  }

  function render(s: SaveToastState) {
    box.className = "t" + (s.phase === "saving" ? " saving" : s.phase === "error" ? " err" : "");
    tags.textContent = "";
    if (s.phase === "error") {
      msg.textContent = s.message;
      title.textContent = "";
      scheduleClose(4000);
      return;
    }
    title.textContent = s.title;
    if (s.phase === "saving") {
      msg.textContent = "Saving to Cliphy…";
      scheduleClose(20000); // safety net if no update ever comes
      return;
    }
    if (s.phase === "duplicate") {
      msg.textContent = "Already in Cliphy";
      chips(s.tags, false, 60);
      scheduleClose(3000);
      return;
    }
    msg.textContent = s.video ? "Saved — summarizing…" : "Saved to Cliphy";
    chips(s.tags, false, 80);
    chips(s.suggested, true, 80 + s.tags.length * 90);
    scheduleClose(3500 + (s.tags.length + s.suggested.length) * 90);
  }

  w.__cliphySaveToast = render;
  render(state);
}

/** Update an existing toast; creates one if the page was reloaded meanwhile. */
export function updateSaveToast(state: SaveToastState): boolean {
  const w = window as Window & { __cliphySaveToast?: (s: SaveToastState) => void };
  if (!w.__cliphySaveToast) return false;
  w.__cliphySaveToast(state);
  return true;
}
