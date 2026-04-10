import { Appearance } from "react-native";
import { colors, shadows, type ColorMode } from "@cliphy/shared";

export function getColorMode(): ColorMode {
  return Appearance.getColorScheme() === "dark" ? "dark" : "light";
}

export function getTheme() {
  const mode = getColorMode();
  return colors[mode];
}

export function brutalShadow(mode?: ColorMode) {
  const s = shadows[mode ?? getColorMode()].brutal;
  return {
    shadowColor: s.color,
    shadowOffset: { width: s.offset, height: s.offset },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: s.offset,
  };
}

export function brutalShadowSm(mode?: ColorMode) {
  const s = shadows[mode ?? getColorMode()].brutalSm;
  return {
    shadowColor: s.color,
    shadowOffset: { width: s.offset, height: s.offset },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: s.offset,
  };
}
