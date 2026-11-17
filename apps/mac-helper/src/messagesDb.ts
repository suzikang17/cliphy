import { homedir } from "node:os";
import path from "node:path";
import { appleTimeToIso, mimeFor, textFromAttributedBody } from "./convert.js";
import { placePictures, type ThreadMessage } from "./plan.js";

// Reading the Messages history. The database is opened read-only and is never
// written to. Needs Full Disk Access for the program that runs this.

type Sqlite = typeof import("node:sqlite");
export type MessagesDb = InstanceType<Sqlite["DatabaseSync"]>;

/** Node's built-in SQLite, loaded in a way bundlers and test runners leave alone. */
export function sqlite(): Sqlite {
  return process.getBuiltinModule("node:sqlite") as Sqlite;
}

export const DEFAULT_DB_PATH = path.join(homedir(), "Library", "Messages", "chat.db");

/** `chat.style` for a one-to-one conversation. Group chats are 43. */
const ONE_TO_ONE = 45;
const APPLE_EPOCH_S = 978_307_200;

export function openMessages(file: string = DEFAULT_DB_PATH): MessagesDb {
  const { DatabaseSync } = sqlite();
  return new DatabaseSync(file, { readOnly: true });
}

export function maxRowId(db: MessagesDb): number {
  const row = db.prepare("select max(ROWID) as id from message").get() as { id: number | null };
  return Number(row?.id ?? 0);
}

export interface ReadOptions {
  /** Phone numbers or emails that identify the person. */
  handles: string[];
  /** Only messages with a larger row id. */
  afterRowId: number;
  /** Only messages up to and including this row id (for reading history up to a fixed point). */
  uptoRowId?: number | null;
  /** Only messages sent at or after this time, or null for no lower bound. */
  sinceIso: string | null;
  limit: number;
}

/**
 * A person's one-to-one thread, oldest first, both directions.
 * Group chats they are in are left out, and so are reactions ("Loved …") and
 * other rows Messages stores as messages that nobody wrote. A message that
 * belongs to two chat rows for the same person (SMS and iMessage) comes once.
 */
export function readThread(db: MessagesDb, opts: ReadOptions): ThreadMessage[] {
  if (opts.handles.length === 0) return [];
  const marks = opts.handles.map(() => "?").join(", ");
  const since =
    opts.sinceIso === null
      ? null
      : BigInt(Math.floor(Date.parse(opts.sinceIso) / 1000) - APPLE_EPOCH_S) * 1_000_000_000n;

  const messages = db.prepare(`
    select m.ROWID as rowId, m.guid as guid, m.text as text, m.attributedBody as body,
           m.date as date, m.is_from_me as fromMe
    from message m
    join chat_message_join cmj on cmj.message_id = m.ROWID
    join chat c on c.ROWID = cmj.chat_id
    where c.style = ${ONE_TO_ONE}
      and c.ROWID in (
        select chj.chat_id from chat_handle_join chj
        join handle h on h.ROWID = chj.handle_id
        where h.id in (${marks})
      )
      and m.ROWID > ?
      and (? is null or m.ROWID <= ?)
      and coalesce(m.associated_message_type, 0) = 0
      and coalesce(m.item_type, 0) = 0
      and (? is null or m.date >= ?)
    group by m.ROWID
    order by m.ROWID asc
    limit ?
  `);
  // Times are nanoseconds since 2001: too large for a double without losing precision.
  messages.setReadBigInts(true);

  const attachments = db.prepare(`
    select a.filename as filename, a.mime_type as mimeType, a.uti as uti,
           a.transfer_state as transferState
    from attachment a
    join message_attachment_join j on j.attachment_id = a.ROWID
    where j.message_id = ?
    order by a.ROWID asc
  `);

  const upto = opts.uptoRowId ?? null;
  const rows = messages.all(
    ...opts.handles,
    opts.afterRowId,
    upto,
    upto,
    since,
    since,
    opts.limit,
  ) as {
    rowId: bigint;
    guid: string;
    text: string | null;
    body: Uint8Array | null;
    date: bigint;
    fromMe: bigint;
  }[];

  return rows.map((r) => {
    const rowId = Number(r.rowId);
    const files = attachments.all(rowId) as {
      filename: string | null;
      mimeType: string | null;
      uti: string | null;
      transferState: bigint | number | null;
    }[];
    // Newer macOS leaves `text` empty and keeps the words in `attributedBody`.
    // Messages marks where an image sits with U+FFFC; that is not something
    // anyone wrote, but where it stood says which words a picture goes with.
    const placed = placePictures(r.text || textFromAttributedBody(r.body));
    // Only trusted when there is one mark per attachment, in the same order.
    const marked = placed.at.length === files.length && placed.text.length > 0;
    return {
      rowId,
      guid: r.guid,
      text: placed.text,
      sentAtIso: appleTimeToIso(r.date),
      isFromMe: Number(r.fromMe) === 1,
      attachments: files.map((f, i) => ({
        ...(marked ? { at: placed.at[i] } : {}),
        // Messages writes paths as "~/Library/…". No filename means it is not on disk (yet).
        path: f.filename ? f.filename.replace(/^~(?=\/)/, homedir()) : null,
        mimeType: mimeFor(f.mimeType, f.uti, f.filename),
        // 5 is "finished". Anything else, or no file, means it is still arriving.
        ready: Boolean(f.filename) && (f.transferState === null || Number(f.transferState) === 5),
      })),
    };
  });
}

export interface RecentThread {
  /** The phone number or email, lower-cased, as Messages stores it. */
  handle: string;
  lastAtIso: string;
  /** The latest words in the thread, or "Photo" when it was only a picture. */
  preview: string;
  /** Their name in Contacts on this Mac, when the number or address is saved there. */
  name?: string;
}

/** A person, not a service: an email address, or a number long enough to be a phone. */
function isPersonHandle(handle: string): boolean {
  return handle.includes("@") || handle.replace(/\D/g, "").length >= 7;
}

/**
 * The most recent one-to-one threads, newest first, one per person, for
 * choosing who to capture. Looks at the latest `scan` messages only, so it
 * stays quick on a history of any size.
 */
export function recentThreads(db: MessagesDb, limit: number, scan = 4000): RecentThread[] {
  const statement = db.prepare(`
    select h.id as handle, m.text as text, m.attributedBody as body, m.date as date
    from message m
    join chat_message_join cmj on cmj.message_id = m.ROWID
    join chat c on c.ROWID = cmj.chat_id
    join chat_handle_join chj on chj.chat_id = c.ROWID
    join handle h on h.ROWID = chj.handle_id
    where c.style = ${ONE_TO_ONE}
      and coalesce(m.associated_message_type, 0) = 0
      and coalesce(m.item_type, 0) = 0
    order by m.date desc
    limit ?
  `);
  statement.setReadBigInts(true);
  const rows = statement.all(scan) as {
    handle: string | null;
    text: string | null;
    body: Uint8Array | null;
    date: bigint;
  }[];

  const threads = new Map<string, RecentThread>();
  for (const row of rows) {
    const handle = (row.handle ?? "").toLowerCase();
    if (!handle || threads.has(handle) || !isPersonHandle(handle)) continue;
    const words = (row.text || textFromAttributedBody(row.body)).replace(/￼/g, "").trim();
    threads.set(handle, {
      handle,
      lastAtIso: appleTimeToIso(row.date),
      preview: words ? words.replace(/\s+/g, " ").slice(0, 80) : "Photo",
    });
    if (threads.size >= limit) break;
  }
  return [...threads.values()];
}
