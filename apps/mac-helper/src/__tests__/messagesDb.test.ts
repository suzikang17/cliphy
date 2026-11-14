import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { maxRowId, openMessages, readThread, sqlite } from "../messagesDb.js";

/** Seconds after 2001-01-01, as nanoseconds, the way Messages stores a time. */
const apple = (iso: string) => BigInt(Date.parse(iso) / 1000 - 978_307_200) * 1_000_000_000n;

let dir: string;
let file: string;

/** Build a database with the tables and columns of the real chat.db that the helper reads. */
function fixture() {
  const { DatabaseSync } = sqlite();
  const db = new DatabaseSync(file);
  db.exec(`
    create table handle (ROWID integer primary key, id text);
    create table chat (ROWID integer primary key, chat_identifier text, style integer);
    create table chat_handle_join (chat_id integer, handle_id integer);
    create table message (ROWID integer primary key, guid text, text text, attributedBody blob,
      handle_id integer, date integer, is_from_me integer, associated_message_type integer default 0);
    create table chat_message_join (chat_id integer, message_id integer);
    create table attachment (ROWID integer primary key, filename text, mime_type text, transfer_state integer);
    create table message_attachment_join (message_id integer, attachment_id integer);

    insert into handle values (1, '+15550100'), (2, '+15550199');
    -- chat 1: one-to-one with Maren (style 45). chat 2: a group including her (style 43).
    insert into chat values (1, '+15550100', 45), (2, 'chat-group', 43);
    insert into chat_handle_join values (1, 1), (2, 1), (2, 2);
  `);
  const msg = db.prepare(
    "insert into message (ROWID, guid, text, attributedBody, handle_id, date, is_from_me, associated_message_type) values (?,?,?,?,?,?,?,?)",
  );
  const link = db.prepare("insert into chat_message_join values (?, ?)");
  msg.run(10, "g-10", "First", null, 1, apple("2026-11-14T17:40:00Z"), 0, 0);
  msg.run(11, "g-11", null, null, 1, apple("2026-11-14T17:41:00Z"), 0, 0);
  msg.run(12, "g-12", "On it", null, 0, apple("2026-11-14T17:42:00Z"), 1, 0);
  msg.run(13, "g-13", "Group chatter", null, 1, apple("2026-11-14T17:43:00Z"), 0, 0);
  msg.run(14, "g-14", "Loved “First”", null, 1, apple("2026-11-14T17:44:00Z"), 0, 2000);
  msg.run(15, "g-15", "Old one", null, 1, apple("2022-03-01T10:00:00Z"), 0, 0);
  for (const id of [10, 11, 12, 14, 15]) link.run(1, id);
  link.run(2, 13);
  db.exec(`
    insert into attachment values
      (1, '~/Library/Messages/Attachments/aa/page1.heic', 'image/heic', 5),
      (2, null, 'image/png', 0);
    insert into message_attachment_join values (11, 1), (11, 2);
  `);
  db.close();
}

describe("reading Messages", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Mac helper");
    dir = mkdtempSync(path.join(tmpdir(), "cliphy-helper-"));
    file = path.join(dir, "chat.db");
    fixture();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("reads a person's one-to-one thread in order, both directions", () => {
    const db = openMessages(file);
    const rows = readThread(db, {
      handles: ["+15550100"],
      afterRowId: 0,
      sinceIso: null,
      limit: 50,
    });
    expect(rows.map((r) => [r.rowId, r.guid, r.isFromMe])).toEqual([
      [10, "g-10", false],
      [11, "g-11", false],
      [12, "g-12", true],
      [15, "g-15", false],
    ]);
    expect(rows[0]).toMatchObject({ text: "First", sentAtIso: "2026-11-14T17:40:00.000Z" });
    db.close();
  });

  // Review Focus 3: a group chat that includes the person.
  it("leaves out group chats the person is in", () => {
    const db = openMessages(file);
    const guids = readThread(db, {
      handles: ["+15550100"],
      afterRowId: 0,
      sinceIso: null,
      limit: 50,
    }).map((r) => r.guid);
    expect(guids).not.toContain("g-13");
    db.close();
  });

  it("leaves out reactions, which are not messages", () => {
    const db = openMessages(file);
    const guids = readThread(db, {
      handles: ["+15550100"],
      afterRowId: 0,
      sinceIso: null,
      limit: 50,
    }).map((r) => r.guid);
    expect(guids).not.toContain("g-14");
    db.close();
  });

  it("returns a message's attachments, with a full path and a null path for one not on disk", () => {
    const db = openMessages(file);
    const row = readThread(db, {
      handles: ["+15550100"],
      afterRowId: 10,
      sinceIso: null,
      limit: 1,
    })[0];
    expect(row.guid).toBe("g-11");
    expect(row.text).toBe("");
    expect(row.attachments).toHaveLength(2);
    expect(row.attachments[0].mimeType).toBe("image/heic");
    expect(row.attachments[0].path).toMatch(/\/Library\/Messages\/Attachments\/aa\/page1\.heic$/);
    expect(row.attachments[0].path?.startsWith("~")).toBe(false);
    expect(row.attachments[1]).toEqual({ path: null, mimeType: "image/png" });
    db.close();
  });

  it("returns only messages after the cursor, up to the limit", () => {
    const db = openMessages(file);
    const rows = readThread(db, {
      handles: ["+15550100"],
      afterRowId: 11,
      sinceIso: null,
      limit: 1,
    });
    expect(rows.map((r) => r.rowId)).toEqual([12]);
    db.close();
  });

  it("returns only messages since a time when reading back a window", () => {
    const db = openMessages(file);
    const rows = readThread(db, {
      handles: ["+15550100"],
      afterRowId: 0,
      sinceIso: "2026-01-01T00:00:00Z",
      limit: 50,
    });
    expect(rows.map((r) => r.guid)).not.toContain("g-15");
    expect(rows).toHaveLength(3);
    db.close();
  });

  it("matches a person by any of their handles and returns nothing for an unknown one", () => {
    const db = openMessages(file);
    expect(
      readThread(db, {
        handles: ["nobody@example.com", "+15550100"],
        afterRowId: 0,
        sinceIso: null,
        limit: 50,
      }),
    ).toHaveLength(4);
    expect(
      readThread(db, { handles: ["+19990000"], afterRowId: 0, sinceIso: null, limit: 50 }),
    ).toEqual([]);
    expect(readThread(db, { handles: [], afterRowId: 0, sinceIso: null, limit: 50 })).toEqual([]);
    db.close();
  });

  it("knows the newest message id, to start from now", () => {
    const db = openMessages(file);
    expect(maxRowId(db)).toBe(15);
    db.close();
  });

  it("opens the database read-only", () => {
    const db = openMessages(file);
    expect(() => db.exec("delete from message")).toThrow();
    db.close();
  });
});
