import type { ExtractResult } from "../tabs/extractPage";
import type { SaveToastState } from "./saveToast";

export interface QuickSaveBody {
  url: string;
  title: string;
  description?: string;
  text?: string;
}

export interface QuickSaveResponse {
  tags: string[];
  suggestedTags: string[];
  duplicate: boolean;
  video: boolean;
}

export interface QuickSaveDeps {
  isAuthed: () => Promise<boolean>;
  /** Show or update the on-page toast; false if the page can't host one. */
  toast: (tabId: number, state: SaveToastState) => Promise<boolean>;
  extract: (tabId: number) => Promise<ExtractResult | null>;
  save: (body: QuickSaveBody) => Promise<QuickSaveResponse>;
  /** Fallback feedback on the toolbar icon when the page can't show a toast. */
  badge: (tabId: number, text: string, ok: boolean) => void;
}

const isWeb = (url: string | undefined): url is string => !!url && /^https?:\/\//i.test(url);

/**
 * ⌘⇧S: toast immediately, read the page (works on logged-in pages), save, then
 * animate the applied tags into the same toast. Every failure ends in visible
 * feedback — never a silent no-op.
 */
export async function runQuickSave(
  tab: { id: number; url?: string; title?: string },
  deps: QuickSaveDeps,
): Promise<void> {
  if (!isWeb(tab.url)) {
    deps.badge(tab.id, "✕", false);
    return;
  }
  const url = tab.url;
  const title = tab.title || url;

  const hasToast = await deps.toast(tab.id, { phase: "saving", title }).catch(() => false);
  const finish = async (state: SaveToastState, badgeText: string, ok: boolean) => {
    if (hasToast && (await deps.toast(tab.id, state).catch(() => false))) return;
    deps.badge(tab.id, badgeText, ok);
  };

  if (!(await deps.isAuthed().catch(() => false))) {
    await finish({ phase: "error", message: "Sign in to Cliphy to save pages" }, "!", false);
    return;
  }

  const page = await deps.extract(tab.id).catch(() => null);
  const body: QuickSaveBody = { url, title };
  if (page && !("skipped" in page)) {
    if (page.title) body.title = page.title;
    if (page.description) body.description = page.description;
    if (page.text) body.text = page.text;
  }

  try {
    const res = await deps.save(body);
    if (res.duplicate) {
      await finish({ phase: "duplicate", title: body.title, tags: res.tags }, "✓", true);
    } else {
      await finish(
        {
          phase: "saved",
          title: body.title,
          tags: res.tags,
          suggested: res.suggestedTags,
          video: res.video,
        },
        "✓",
        true,
      );
    }
  } catch (err) {
    const message =
      err instanceof Error && /limit|too many/i.test(err.message)
        ? "Save limit reached — try again later"
        : "Couldn’t save — press ⌘⇧S to retry";
    await finish({ phase: "error", message }, "!", false);
  }
}
