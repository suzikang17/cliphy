import type { CoachRequest } from "@cliphy/shared";

export interface HistoryEntry {
  request: CoachRequest;
  /** What this request replaced, most recently replaced first. */
  replaced: CoachRequest[];
}

/**
 * A project's history, newest first. A request that was replaced appears only
 * under the request that replaced it, so the evolution of one thing reads as
 * one entry with its older versions beneath.
 */
export function buildHistory(requests: CoachRequest[]): HistoryEntry[] {
  const byId = new Map(requests.map((r) => [r.id, r]));
  const newestFirst = [...requests].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const placed = new Set<string>();
  const entries: HistoryEntry[] = [];

  const addEntry = (request: CoachRequest) => {
    placed.add(request.id);
    const replaced: CoachRequest[] = [];
    let next = request.replacesId ? byId.get(request.replacesId) : undefined;
    while (next && !placed.has(next.id)) {
      placed.add(next.id);
      replaced.push(next);
      next = next.replacesId ? byId.get(next.replacesId) : undefined;
    }
    entries.push({ request, replaced });
  };

  // Heads first: requests nothing else in the list replaces.
  const replacedIds = new Set(
    requests.map((r) => r.replacesId).filter((id): id is string => !!id && byId.has(id)),
  );
  for (const r of newestFirst) if (!replacedIds.has(r.id)) addEntry(r);
  // Anything left is part of a cycle in bad data; show it rather than lose it.
  for (const r of newestFirst) if (!placed.has(r.id)) addEntry(r);

  return entries.sort((a, b) => b.request.createdAt.localeCompare(a.request.createdAt));
}
