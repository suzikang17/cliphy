/**
 * Cliphy design tokens — single source of truth for both extension and mobile.
 *
 * Extension: consumed via CSS variables generated from these values.
 * Mobile: imported directly for NativeWind config and runtime theme helpers.
 */

// ─── Colors ──────────────────────────────────────────────────────────────────

export const colors = {
  light: {
    surface: "#ffffff",
    surfaceSecondary: "#f9fafb",
    surfaceRaised: "#f3f4f6",
    borderHard: "#000000",
    borderSoft: "#e5e7eb",
    borderMuted: "#d1d5db",
    text: "#111827",
    textBody: "#1f2937",
    textSecondary: "#4b5563",
    textMuted: "#6b7280",
    textFaint: "#9ca3af",
    accentSurface: "#f5f0fa",
    warnSurface: "#fffbeb",
    errorSurface: "#fef2f2",
  },
  dark: {
    surface: "#1e1e1e",
    surfaceSecondary: "#282828",
    surfaceRaised: "#333333",
    borderHard: "#505050",
    borderSoft: "#2a2a2a",
    borderMuted: "#383838",
    text: "#ffffff",
    textBody: "#f0f0f0",
    textSecondary: "#cccccc",
    textMuted: "#b0b0b0",
    textFaint: "#999999",
    accentSurface: "#1e0030",
    warnSurface: "#292000",
    errorSurface: "#290000",
  },
} as const;

export type ColorMode = keyof typeof colors;
export type ColorToken = keyof (typeof colors)["light"];

// ─── Neon palette (same in light and dark) ───────────────────────────────────

export const neon = {
  100: "#ede0f8",
  200: "#d5b8f0",
  400: "#b88ae2",
  500: "#a770d8",
  600: "#9358c7",
  700: "#7a3fb0",
  800: "#5e2e8e",
  900: "#221028",
} as const;

// ─── Shadows ─────────────────────────────────────────────────────────────────

export const shadows = {
  light: {
    brutal: { offset: 4, color: "rgba(0, 0, 0, 1)" },
    brutalSm: { offset: 3, color: "rgba(0, 0, 0, 1)" },
    brutalHover: { offset: 2, color: "rgba(0, 0, 0, 1)" },
    brutalPressed: { offset: 1, color: "rgba(0, 0, 0, 1)" },
  },
  dark: {
    brutal: { offset: 4, color: "rgba(255, 255, 255, 0.12)" },
    brutalSm: { offset: 3, color: "rgba(255, 255, 255, 0.12)" },
    brutalHover: { offset: 2, color: "rgba(255, 255, 255, 0.12)" },
    brutalPressed: { offset: 1, color: "rgba(255, 255, 255, 0.12)" },
  },
} as const;

export type ShadowToken = keyof (typeof shadows)["light"];

// ─── Typography ──────────────────────────────────────────────────────────────

export const typography = {
  fontFamily: {
    sans: '"DM Sans Variable", ui-sans-serif, system-ui, sans-serif',
    /** Expo/React Native font name (loaded via expo-font) */
    mobile: "DMSans",
  },
} as const;

// ─── Borders ─────────────────────────────────────────────────────────────────

export const borders = {
  width: 2,
  radius: {
    sm: 4,
    md: 6,
    lg: 8,
    full: 9999,
  },
} as const;

// ─── CSS helpers (extension only) ────────────────────────────────────────────

/** Convert a shadow token to a CSS box-shadow value. */
export function shadowToCSS(s: { offset: number; color: string }): string {
  return `${s.offset}px ${s.offset}px 0px 0px ${s.color}`;
}

/**
 * Generate CSS custom property declarations from token objects.
 * Useful for verifying the extension CSS stays in sync.
 */
export function colorsToCSSVars(mode: ColorMode): Record<string, string> {
  const c = colors[mode];
  return {
    "--color-surface": c.surface,
    "--color-surface-secondary": c.surfaceSecondary,
    "--color-surface-raised": c.surfaceRaised,
    "--color-border-hard": c.borderHard,
    "--color-border-soft": c.borderSoft,
    "--color-border-muted": c.borderMuted,
    "--color-text": c.text,
    "--color-text-body": c.textBody,
    "--color-text-secondary": c.textSecondary,
    "--color-text-muted": c.textMuted,
    "--color-text-faint": c.textFaint,
    "--color-accent-surface": c.accentSurface,
    "--color-warn-surface": c.warnSurface,
    "--color-error-surface": c.errorSurface,
  };
}
