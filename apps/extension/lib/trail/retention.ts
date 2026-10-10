import { MAX_RETENTION_DAYS } from "@cliphy/shared";

// "Keep closed tabs for [3] [weeks]" ⇄ retentionDays (null = forever).

export type RetentionUnit = "days" | "weeks" | "months" | "forever";

export const UNIT_DAYS: Record<Exclude<RetentionUnit, "forever">, number> = {
  days: 1,
  weeks: 7,
  months: 30,
};

export function toDays(r: { amount: number; unit: RetentionUnit }): number | null {
  if (r.unit === "forever") return null;
  const d = Math.round(r.amount) * UNIT_DAYS[r.unit];
  return Math.min(MAX_RETENTION_DAYS, Math.max(1, d));
}

/** The largest unit that divides evenly, so 21 reads as "3 weeks" and 30 as "1 month". */
export function fromDays(days: number | null): { amount: number; unit: RetentionUnit } {
  if (days === null) return { amount: 1, unit: "forever" };
  if (days % UNIT_DAYS.months === 0) return { amount: days / UNIT_DAYS.months, unit: "months" };
  if (days % UNIT_DAYS.weeks === 0) return { amount: days / UNIT_DAYS.weeks, unit: "weeks" };
  return { amount: days, unit: "days" };
}
