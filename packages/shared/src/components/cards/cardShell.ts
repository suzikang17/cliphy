/**
 * Shared neobrutalist card chrome, kept in one place so the four DOM cards
 * stay visually identical to each other and to their React Native siblings in
 * apps/mobile. Values mirror tokens.ts (shadows.*.brutalSm = 3px offset).
 */
export const CARD_SHELL =
  "block w-full text-left border-2 border-black dark:border-[#505050] rounded-lg p-3 " +
  "bg-[#f9fafb] dark:bg-[#282828] " +
  "shadow-[3px_3px_0_0_rgba(0,0,0,1)] dark:shadow-[3px_3px_0_0_rgba(255,255,255,0.12)]";

/**
 * Card media caps its height. The per-type aspect ratios come from mobile,
 * where a tall phone screen carries them; in a ~400px sidepanel column an
 * unbounded 3/4 image is ~530px and swallows the whole feed. object-cover
 * crops instead — the text content still sits below the image.
 */
export const CARD_MEDIA =
  "w-full rounded-md border-2 border-black dark:border-[#505050] object-cover " +
  "max-h-52 bg-[#e5e7eb] dark:bg-[#1e1e1e]";

export const CARD_TITLE = "text-[15px] font-bold text-[#111827] dark:text-white tracking-[-0.01em]";
export const CARD_META = "text-xs text-[#6b7280] dark:text-[#9ca3af]";
export const CARD_BODY = "text-[13px] text-[#374151] dark:text-[#d1d5db]";
