import { compactText } from "@cliphy/shared";

// One-click keyword suggestions for a tag group, computed locally from open
// tabs (no AI, instant): phrases that 2+ tabs in the group share and no tab in
// another group contains. E.g. the Lotus Bech tabs all say "We Curate Life" →
// suggest "we curate life", which then also catches wecuratelife-mockups.vercel.app.

const MAX_SUGGESTIONS = 2;
const MAX_WORDS = 3;
const MIN_COMPACT = 4;
const MIN_TABS = 2;

/** Words that say nothing about which project a page belongs to. */
const GENERIC = new Set(
  `a an and the of on in at to for with by from or is are be your my our you we us it this that
  home page website site web app apps dashboard login sign signin up account settings usage docs
  documentation guide help support about contact blog news search results new untitled inbox mail
  gmail google drive docs sheets slides notion linear figma github vercel stripe wix cloudflare
  com net org io ai co www http https html start started collaborating collaborate design designs
  project projects file files folder folders view edit share draft drafts`
    .split(/\s+/)
    .filter(Boolean),
);

interface TabText {
  title: string;
  url: string;
}

function words(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Candidate phrases from one tab: n-grams within title segments, plus host labels. */
function phrases(tab: TabText): Set<string> {
  const out = new Set<string>();
  // Titles are usually "Page – Site | Brand": n-grams never span a separator.
  for (const segment of tab.title.split(/\s[|–—\-:·]\s|\s\|\s/)) {
    const w = words(segment);
    for (let n = 1; n <= MAX_WORDS; n++) {
      for (let i = 0; i + n <= w.length; i++) {
        const gram = w.slice(i, i + n);
        // A phrase can't start or end on a generic word ("we curate life" is fine
        // because "curate"/"life" anchor it; "the design" is not).
        if (GENERIC.has(gram[0]) && n === 1) continue;
        if (GENERIC.has(gram[gram.length - 1])) continue;
        out.add(gram.join(" "));
      }
    }
  }
  try {
    const host = new URL(tab.url).hostname.replace(/^www\./, "");
    for (const label of host.split(".").slice(0, -1)) {
      for (const part of [label, ...label.split("-")]) {
        if (!GENERIC.has(part)) out.add(part);
      }
    }
  } catch {
    // not a URL — titles only
  }
  return out;
}

/** Up to two keywords for `group`, from phrases its tabs share and `others` lack. */
export function suggestKeywords(
  group: TabText[],
  others: TabText[],
  existingKeywords: string[],
): string[] {
  if (group.length < MIN_TABS) return [];

  // Count tabs per phrase, merging spacing variants ("we curate life" = "wecuratelife").
  const counts = new Map<string, { phrase: string; tabs: number }>();
  for (const tab of group) {
    const seen = new Set<string>();
    for (const p of phrases(tab)) {
      const key = compactText(p);
      if (key.length < MIN_COMPACT || seen.has(key)) continue;
      seen.add(key);
      const entry = counts.get(key);
      // Prefer the spaced, readable form as the display phrase.
      if (entry) {
        entry.tabs++;
        if (p.includes(" ") && !entry.phrase.includes(" ")) entry.phrase = p;
      } else counts.set(key, { phrase: p, tabs: 1 });
    }
  }

  const otherText = others.map((t) => compactText(`${t.title} ${t.url}`));
  const covered = existingKeywords.map(compactText).filter(Boolean);

  const candidates = [...counts.entries()]
    .filter(([, { tabs }]) => tabs >= MIN_TABS)
    .filter(([key]) => !otherText.some((o) => o.includes(key)))
    .filter(([key]) => !covered.some((c) => c.includes(key) || key.includes(c)))
    .sort(([ka, a], [kb, b]) => b.tabs - a.tabs || kb.length - ka.length);

  const picked: string[] = [];
  const pickedKeys: string[] = [];
  for (const [key, { phrase }] of candidates) {
    // Drop sub-phrases of something already picked ("curate life" ⊂ "we curate life").
    if (pickedKeys.some((k) => k.includes(key) || key.includes(k))) continue;
    picked.push(phrase);
    pickedKeys.push(key);
    if (picked.length === MAX_SUGGESTIONS) break;
  }
  return picked;
}
