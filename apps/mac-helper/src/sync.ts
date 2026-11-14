import type { ReadOptions } from "./messagesDb.js";
import {
  firstSync,
  toIntakeMessage,
  type CapturedPerson,
  type IntakeMessage,
  type ThreadMessage,
  type UploadedAttachment,
} from "./plan.js";

/** Messages per upload. Also the server's own limit is 200 per call. */
export const BATCH_SIZE = 100;
/** Batches per person per cycle, so a long catch-up never blocks everyone else. */
export const MAX_BATCHES_PER_CYCLE = 5;

export interface HelperState {
  /** The last message row id uploaded, per person. */
  cursors: Record<string, number>;
  /** People whose first sync (start from now, or read back history) is finished. */
  connected: Record<string, boolean>;
  /** A history read still in progress: its fixed lower bound, and where the thread ended when it began. */
  backfill: Record<string, { sinceIso: string | null; maxAtStart: number }>;
}

export const emptyState = (): HelperState => ({ cursors: {}, connected: {}, backfill: {} });

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

  let people: CapturedPerson[];
  try {
    people = (await deps.api.people()).filter((p) => p.captureThread && p.handles.length > 0);
  } catch (err) {
    deps.log(`Cannot reach the server: ${String(err)}`);
    return { ...result, offline: true };
  }
  result.people = people.length;

  for (const person of people) {
    try {
      await syncPerson(deps, person, result);
    } catch (err) {
      // Leave the cursor where it is; this person is retried next cycle.
      deps.log(`${person.name}: ${String(err)}`);
    }
  }

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

  const backfill = state.backfill[id];
  const historical = backfill !== undefined;

  for (let batch = 0; batch < MAX_BATCHES_PER_CYCLE; batch++) {
    const rows = deps.messages.read({
      handles: person.handles,
      afterRowId: state.cursors[id] ?? 0,
      sinceIso: backfill ? backfill.sinceIso : null,
      limit: BATCH_SIZE,
    });

    if (rows.length === 0) {
      if (backfill) {
        // History is done. Never go back below where the thread stood when it
        // began, or messages older than the window would be uploaded as new.
        state.cursors[id] = Math.max(state.cursors[id] ?? 0, backfill.maxAtStart);
        delete state.backfill[id];
        state.connected[id] = true;
        deps.save();
      }
      return;
    }

    const messages: IntakeMessage[] = [];
    for (const row of rows) {
      messages.push(toIntakeMessage(row, await uploadAttachments(deps, row, result)));
    }
    await deps.api.postMessages({ personId: id, historical, messages });

    state.cursors[id] = rows[rows.length - 1].rowId;
    deps.save();
    result.uploaded += rows.length;

    if (rows.length < BATCH_SIZE && !backfill) return;
  }
}

/** Upload a message's image attachments. A missing or non-image attachment is skipped, not fatal. */
async function uploadAttachments(
  deps: SyncDeps,
  row: ThreadMessage,
  result: SyncResult,
): Promise<UploadedAttachment[]> {
  const uploaded: UploadedAttachment[] = [];
  for (const attachment of row.attachments) {
    const prepared = attachment.path
      ? await deps.images.prepare(attachment.path, attachment.mimeType)
      : null;
    if (!prepared) {
      result.skippedAttachments++;
      continue;
    }
    const { path, signedUrl } = await deps.api.uploadUrl(prepared.mediaType);
    await deps.api.put(signedUrl, prepared.bytes, prepared.mediaType);
    uploaded.push({ storagePath: path, mediaType: prepared.mediaType });
  }
  return uploaded;
}
