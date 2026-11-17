import type { ReadOptions } from "./messagesDb.js";
import {
  firstSync,
  toIntakeMessage,
  type CapturedPerson,
  type IntakeMessage,
  type ThreadMessage,
  type UploadedAttachment,
} from "./plan.js";

/** Messages per upload. The server's own limit is 200 per call. */
export const BATCH_SIZE = 100;
/** Batches per person per cycle, so a long catch-up never blocks everyone else. */
export const MAX_BATCHES_PER_CYCLE = 5;
/** Cycles an attachment may fail before the message is sent without it. */
export const ATTACHMENT_TRIES = 3;
/** How long to wait for a photo that Messages is still downloading. */
const PENDING_WAIT_MS = 10 * 60_000;
/**
 * A message this much older than the helper's last sync did not just arrive:
 * it is an old one that Messages gave a new row (an iCloud re-sync, a
 * restore). It is sent as history, not as something new to act on.
 */
const STALE_MS = 24 * 60 * 60_000;

/** An API refusal, with its HTTP status, so a permanent "no" can be told from a blip. */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface HelperState {
  /** The last message row id handled, per person. */
  cursors: Record<string, number>;
  /** People whose first sync (start from now, or read back history) is finished. */
  connected: Record<string, boolean>;
  /** A history read still in progress: its lower bound in time, and the row the thread ended at when it began. */
  backfill: Record<string, { sinceIso: string | null; maxAtStart: number }>;
  /** The handles each person's state was built for. If they change, the person starts over. */
  handles: Record<string, string>;
  /** How far back each person was last read ("all", "window:90", "new"). If it changes, they are read again. */
  history: Record<string, string>;
  /** When the last complete cycle finished. Tells missed messages from re-synced old ones. */
  lastSyncAt: string | null;
  /** Attachments already uploaded for a batch the server has not yet accepted. */
  uploaded: Record<string, UploadedAttachment>;
  /** How many cycles each attachment has failed. */
  attachmentTries: Record<string, number>;
}

export const emptyState = (): HelperState => ({
  cursors: {},
  connected: {},
  backfill: {},
  handles: {},
  history: {},
  lastSyncAt: null,
  uploaded: {},
  attachmentTries: {},
});

/** Everything the sync cycle touches, so it can be run against fakes. */
export interface SyncDeps {
  api: {
    people(): Promise<CapturedPerson[]>;
    uploadUrl(mediaType: string): Promise<{ path: string; signedUrl: string }>;
    put(signedUrl: string, bytes: Buffer, mediaType: string): Promise<void>;
    postMessages(body: {
      personId: string;
      historical: boolean;
      messages: IntakeMessage[];
    }): Promise<void>;
    heartbeat(): Promise<void>;
  };
  messages: {
    read(opts: ReadOptions): ThreadMessage[];
    maxRowId(): number;
  };
  images: {
    /** The bytes to upload for an attachment, or null if it is not an image or cannot be read. */
    prepare(
      file: string,
      mimeType: string | null,
    ): Promise<{ bytes: Buffer; mediaType: string } | null>;
  };
  state: HelperState;
  save(): void;
  now(): Date;
  log(message: string): void;
}

export interface SyncResult {
  uploaded: number;
  skippedAttachments: number;
  people: number;
  offline: boolean;
}

function forget(state: HelperState, personId: string): void {
  delete state.cursors[personId];
  delete state.connected[personId];
  delete state.backfill[personId];
  delete state.handles[personId];
  delete state.history[personId];
}

/**
 * One pass: for each person whose thread is captured, upload what is new.
 *
 * The cursor moves only after the server has accepted a batch. The server
 * ignores messages it already has (by their Messages guid), so a batch that
 * fails part-way is simply sent again next time: nothing skipped, nothing
 * duplicated.
 */
export async function syncOnce(deps: SyncDeps): Promise<SyncResult> {
  const result: SyncResult = { uploaded: 0, skippedAttachments: 0, people: 0, offline: false };
  const { state } = deps;

  let everyone: CapturedPerson[];
  try {
    everyone = await deps.api.people();
  } catch (err) {
    deps.log(`Cannot reach the server: ${String(err)}`);
    return { ...result, offline: true };
  }
  const people = everyone.filter((p) => p.captureThread && p.handles.length > 0);
  result.people = people.length;

  // Capture turned off (or the person removed): forget them, so turning it
  // back on follows the choice made then and does not upload what was sent
  // in between.
  const captured = new Set(people.map((p) => p.id));
  for (const id of new Set([
    ...Object.keys(state.cursors),
    ...Object.keys(state.connected),
    ...Object.keys(state.backfill),
    ...Object.keys(state.handles),
    ...Object.keys(state.history),
  ])) {
    if (!captured.has(id)) forget(state, id);
  }

  for (const person of people) {
    // A different number is a different thread: start over for it.
    const key = [...person.handles].sort().join(",");
    if (state.handles[person.id] !== undefined && state.handles[person.id] !== key) {
      forget(state, person.id);
    }
    state.handles[person.id] = key;

    try {
      await syncPerson(deps, person, result);
    } catch (err) {
      // Leave the cursor where it is; this person is retried next cycle.
      deps.log(`${person.name}: ${String(err)}`);
    }
  }

  state.lastSyncAt = deps.now().toISOString();
  deps.save();

  try {
    await deps.api.heartbeat();
  } catch {
    // Being seen is a nicety; the uploads above are what matter.
  }
  return result;
}

async function syncPerson(
  deps: SyncDeps,
  person: CapturedPerson,
  result: SyncResult,
): Promise<void> {
  const { state } = deps;
  const id = person.id;
  const now = deps.now().getTime();
  // Fixed for the whole cycle: what counts as "old" must not shift as it runs.
  const staleBefore = state.lastSyncAt ? Date.parse(state.lastSyncAt) - STALE_MS : null;

  // The owner changed how far back to read for someone already captured:
  // read again to the new choice. The server keeps one copy of each message,
  // so reading over the same ground is harmless. A helper from before this
  // record was kept has none; "new" is assumed, which only ever reads more.
  const choice = `${person.historyWindow}${person.historyWindow === "window" ? `:${person.historyDays}` : ""}`;
  if (state.connected[id] && !state.backfill[id] && (state.history[id] ?? "new") !== choice) {
    const plan = firstSync(person, deps.now());
    if (plan.mode === "backfill") {
      state.backfill[id] = { sinceIso: plan.sinceIso, maxAtStart: deps.messages.maxRowId() };
      state.cursors[id] = 0;
    }
  }
  if (state.history[id] !== choice) {
    state.history[id] = choice;
    deps.save();
  }

  // First time: follow the person's history choice.
  if (!state.connected[id] && !state.backfill[id]) {
    const plan = firstSync(person, deps.now());
    if (plan.mode === "skip") {
      state.cursors[id] = deps.messages.maxRowId();
      state.connected[id] = true;
      deps.save();
      return;
    }
    state.backfill[id] = { sinceIso: plan.sinceIso, maxAtStart: deps.messages.maxRowId() };
    state.cursors[id] = 0;
    deps.save();
  }

  for (let batch = 0; batch < MAX_BATCHES_PER_CYCLE; batch++) {
    const backfill = state.backfill[id];
    let rows = deps.messages.read({
      handles: person.handles,
      afterRowId: state.cursors[id] ?? 0,
      // History stops where the thread stood when the read began. Anything
      // after that arrived since, and is handled as live once history is done.
      uptoRowId: backfill ? backfill.maxAtStart : null,
      sinceIso: backfill ? backfill.sinceIso : null,
      limit: BATCH_SIZE,
    });

    if (rows.length === 0) {
      if (!backfill) return;
      // History is done. Never go back below where the thread stood, or
      // messages older than the window would be uploaded as new.
      state.cursors[id] = Math.max(state.cursors[id] ?? 0, backfill.maxAtStart);
      delete state.backfill[id];
      state.connected[id] = true;
      deps.save();
      continue;
    }
    const full = rows.length === BATCH_SIZE;

    // A recent message whose photo is still downloading: stop before it and
    // come back, instead of sending it without the photo for good.
    const waiting = rows.findIndex(
      (r) => r.attachments.some((a) => !a.ready) && now - Date.parse(r.sentAtIso) < PENDING_WAIT_MS,
    );
    if (waiting !== -1) rows = rows.slice(0, waiting);
    if (rows.length === 0) return;

    const history: IntakeMessage[] = [];
    const live: IntakeMessage[] = [];
    for (const row of rows) {
      const uploaded = await uploadAttachments(deps, row, result);
      // No words and nothing attached (an unsent message, or one whose only
      // attachment was skipped) says nothing: do not send it.
      if (!row.text.trim() && uploaded.length === 0) continue;
      const old = staleBefore !== null && Date.parse(row.sentAtIso) < staleBefore;
      (backfill || old ? history : live).push(toIntakeMessage(row, uploaded));
    }
    if (history.length > 0) {
      await deps.api.postMessages({ personId: id, historical: true, messages: history });
    }
    if (live.length > 0) {
      await deps.api.postMessages({ personId: id, historical: false, messages: live });
    }

    state.cursors[id] = rows[rows.length - 1].rowId;
    for (const row of rows) {
      row.attachments.forEach((_, i) => {
        delete state.uploaded[`${row.guid}:${i}`];
        delete state.attachmentTries[`${row.guid}:${i}`];
      });
    }
    deps.save();
    result.uploaded += history.length + live.length;

    if (waiting !== -1 || (!full && !backfill)) return;
  }
}

/**
 * Upload a message's image attachments.
 *
 * A missing or non-image attachment is skipped. One the server refuses
 * outright, or that keeps failing for several cycles, is also skipped, so a
 * single bad file cannot hold up a person's thread for ever. What did upload
 * is remembered until the batch is accepted, so a retry does not upload it
 * again.
 */
async function uploadAttachments(
  deps: SyncDeps,
  row: ThreadMessage,
  result: SyncResult,
): Promise<UploadedAttachment[]> {
  const { state } = deps;
  const uploaded: UploadedAttachment[] = [];

  for (const [index, attachment] of row.attachments.entries()) {
    const key = `${row.guid}:${index}`;
    if (state.uploaded[key]) {
      uploaded.push(state.uploaded[key]);
      continue;
    }
    const prepared = attachment.path
      ? await deps.images.prepare(attachment.path, attachment.mimeType)
      : null;
    if (!prepared) {
      result.skippedAttachments++;
      continue;
    }
    try {
      const { path, signedUrl } = await deps.api.uploadUrl(prepared.mediaType);
      await deps.api.put(signedUrl, prepared.bytes, prepared.mediaType);
      state.uploaded[key] = { storagePath: path, mediaType: prepared.mediaType };
      uploaded.push(state.uploaded[key]);
    } catch (err) {
      const refused =
        err instanceof ApiError &&
        err.status >= 400 &&
        err.status < 500 &&
        err.status !== 408 &&
        err.status !== 429;
      const tries = (state.attachmentTries[key] ?? 0) + 1;
      if (refused || tries >= ATTACHMENT_TRIES) {
        deps.log(`Skipping an attachment that will not upload: ${String(err)}`);
        delete state.attachmentTries[key];
        result.skippedAttachments++;
        continue;
      }
      state.attachmentTries[key] = tries;
      deps.save();
      throw err;
    }
  }
  return uploaded;
}
