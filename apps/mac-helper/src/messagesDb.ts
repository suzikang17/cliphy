import { homedir } from "node:os";
import path from "node:path";
import { appleTimeToIso, textFromAttributedBody } from "./convert.js";
import type { ThreadMessage } from "./plan.js";

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
  /** Only messages sent at or after this time, or null for no lower bound. */
  sinceIso: string | null;
  limit: number;
}

/**
 * A person's one-to-one thread, oldest first, both directions.
 * Group chats they are in are left out, and so are reactions ("Loved …"),
 * which Messages stores as messages but are not something anyone wrote.
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
      and coalesce(m.associated_message_type, 0) = 0
      and (? is null or m.date >= ?)
    order by m.ROWID asc
    limit ?
  `);
  // Times are nanoseconds since 2001: too large for a double without losing precision.
  messages.setReadBigInts(true);

  const attachments = db.prepare(`
    select a.filename as filename, a.mime_type as mimeType
    from attachment a
    join message_attachment_join j on j.attachment_id = a.ROWID
    where j.message_id = ?
    order by a.ROWID asc
  `);

  const rows = messages.all(...opts.handles, opts.afterRowId, since, since, opts.limit) as {
    rowId: bigint;
    guid: string;
    text: string | null;
    body: Uint8Array | null;
    date: bigint;
    fromMe: bigint;
  }[];

  return rows.map((r) => {
    const rowId = Number(r.rowId);
    const files = attachments.all(rowId) as { filename: string | null; mimeType: string | null }[];
    return {
      rowId,
      guid: r.guid,
      // Newer macOS leaves `text` empty and keeps the words in `attributedBody`.
      text: r.text ?? textFromAttributedBody(r.body),
      sentAtIso: appleTimeToIso(r.date),
      isFromMe: Number(r.fromMe) === 1,
      attachments: files.map((f) => ({
        // Messages writes paths as "~/Library/…". No filename means it is not on disk (yet).
        path: f.filename ? f.filename.replace(/^~(?=\/)/, homedir()) : null,
        mimeType: f.mimeType,
      })),
    };
  });
}
