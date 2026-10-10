import type { PinPageResponse } from "@cliphy/shared";
import type { SaveToastState } from "./saveToast";

// ⌘⇧P: pin the page you're on without opening the panel. Same shape as
// runQuickSave: toast first, then the request, every outcome visible.

export interface PinPageDeps {
  isAuthed: () => Promise<boolean>;
  toast: (tabId: number, state: SaveToastState) => Promise<boolean>;
  /** Your name/note for the page (Tabs view), if any. */
  meta: (url: string) => Promise<{ title?: string; note?: string }>;
  pin: (body: { url: string; title?: string; note?: string }) => Promise<PinPageResponse>;
  badge: (tabId: number, text: string, ok: boolean) => void;
}

const isWeb = (url: string | undefined): url is string => !!url && /^https?:\/\//i.test(url);

export async function runPinPage(
  tab: { id: number; url?: string; title?: string },
  deps: PinPageDeps,
): Promise<void> {
  if (!isWeb(tab.url)) {
    deps.badge(tab.id, "✕", false);
    return;
  }
  const url = tab.url;
  const meta = await deps.meta(url).catch(() => ({}) as { title?: string; note?: string });
  const title = meta.title || tab.title || url;

  const hasToast = await deps
    .toast(tab.id, { phase: "saving", title, label: "Pinning…" })
    .catch(() => false);
  const finish = async (state: SaveToastState, badgeText: string, ok: boolean) => {
    if (hasToast && (await deps.toast(tab.id, state).catch(() => false))) return;
    deps.badge(tab.id, badgeText, ok);
  };

  if (!(await deps.isAuthed().catch(() => false))) {
    await finish({ phase: "error", message: "Sign in to Cliphy to pin pages" }, "!", false);
    return;
  }
  try {
    const res = await deps.pin({ url, title, ...(meta.note && { note: meta.note }) });
    await finish(
      {
        phase: "saved",
        title,
        tags: res.clip.tags ?? [],
        suggested: [],
        video: false,
        label: res.created ? "Pinned" : "Already pinned",
      },
      "✓",
      true,
    );
  } catch {
    await finish({ phase: "error", message: "Couldn’t pin — press ⌘⇧P to retry" }, "!", false);
  }
}
