import type { Config } from "tailwindcss";
import { colors, neon } from "@cliphy/shared";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      fontFamily: {
        sans: ["DMSans"],
      },
      colors: {
        surface: {
          DEFAULT: colors.light.surface,
          secondary: colors.light.surfaceSecondary,
          raised: colors.light.surfaceRaised,
        },
        "border-hard": colors.light.borderHard,
        "border-soft": colors.light.borderSoft,
        "border-muted": colors.light.borderMuted,
        text: {
          DEFAULT: colors.light.text,
          body: colors.light.textBody,
          secondary: colors.light.textSecondary,
          muted: colors.light.textMuted,
          faint: colors.light.textFaint,
        },
        "accent-surface": colors.light.accentSurface,
        "warn-surface": colors.light.warnSurface,
        "error-surface": colors.light.errorSurface,
        neon: {
          100: neon[100],
          200: neon[200],
          400: neon[400],
          500: neon[500],
          600: neon[600],
          700: neon[700],
          800: neon[800],
          900: neon[900],
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
