/** Converts "4:32" or "1:23:45" to total seconds. Returns 0 if unrecognized. */
export function parseDurationToSeconds(duration: string): number {
  const parts = duration.trim().split(":").map(Number);
  if (parts.some(isNaN) || parts.length < 2 || parts.length > 3) return 0;
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return h * 3600 + m * 60 + s;
  }
  const [m, s] = parts;
  return m * 60 + s;
}
