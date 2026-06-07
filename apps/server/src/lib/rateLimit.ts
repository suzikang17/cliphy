// Best-effort, in-memory per-key token window. NOTE: on Vercel serverless this
// Map is per-instance, so it is a mitigation, not a guarantee. See spec §Security.
const buckets = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count += 1;
  return true;
}

/** Test-only: clear all buckets. */
export function __resetRateLimit(): void {
  buckets.clear();
}
