export interface ExtractedPage {
  title: string;
  description: string;
  text: string;
  scrolledToEnd: boolean;
}

export type ExtractResult = ExtractedPage | { skipped: "sensitive" };

export const EXTRACT_TEXT_LIMIT = 2000;

/**
 * Injected into a page via `scripting.executeScript({ target: { tabId }, func })`.
 *
 * Chrome serializes this function's source and runs it in the page, so it MUST
 * stay self-contained: no imports, no references to module scope (the 2,000
 * limit is inlined on purpose), no closures.
 */
export function extractPage(): ExtractResult {
  if (document.querySelector('input[type="password"], input[type=password]')) {
    return { skipped: "sensitive" };
  }

  const meta = document.querySelector('meta[name="description"]');
  const description = (meta?.getAttribute("content") ?? "").trim();

  const root =
    document.querySelector("article") ??
    document.querySelector("main") ??
    document.querySelector('[role="main"]') ??
    document.body;
  const el = root as HTMLElement | null;
  // innerText respects CSS (skips hidden nodes and <script>); textContent is the
  // fallback for environments without layout.
  const raw = (el && (el.innerText || el.textContent)) || "";
  const text = raw.replace(/\s+/g, " ").trim().slice(0, 2000);

  const doc = document.documentElement;
  const scrollHeight = Math.max(doc?.scrollHeight ?? 0, document.body?.scrollHeight ?? 0);
  // Only meaningful for pages long enough to read through — a short page that
  // fits on screen (dashboard, issue) is not "read to the end".
  const isLong = scrollHeight > window.innerHeight * 1.5;
  const scrolledToEnd = isLong && window.scrollY + window.innerHeight >= scrollHeight * 0.9;

  return { title: document.title, description, text, scrolledToEnd };
}

export function isSkipped(r: ExtractResult | null | undefined): r is { skipped: "sensitive" } {
  return !!r && "skipped" in r;
}
