import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { contactFiles, readContacts } from "../contacts.js";
import { sqlite } from "../messagesDb.js";

let root: string;

/** A Contacts database with the tables and columns of the real one that the helper reads. */
function addressBook(
  file: string,
  people: {
    first?: string;
    last?: string;
    nick?: string;
    org?: string;
    phones?: string[];
    emails?: string[];
  }[],
) {
  mkdirSync(path.dirname(file), { recursive: true });
  const { DatabaseSync } = sqlite();
  const db = new DatabaseSync(file);
  db.exec(`
    create table ZABCDRECORD (Z_PK integer primary key, ZFIRSTNAME text, ZLASTNAME text,
      ZNICKNAME text, ZORGANIZATION text);
    create table ZABCDPHONENUMBER (Z_PK integer primary key, ZOWNER integer, ZFULLNUMBER text);
    create table ZABCDEMAILADDRESS (Z_PK integer primary key, ZOWNER integer, ZADDRESS text);
  `);
  const record = db.prepare("insert into ZABCDRECORD values (?,?,?,?,?)");
  const phone = db.prepare("insert into ZABCDPHONENUMBER (ZOWNER, ZFULLNUMBER) values (?,?)");
  const email = db.prepare("insert into ZABCDEMAILADDRESS (ZOWNER, ZADDRESS) values (?,?)");
  people.forEach((p, i) => {
    record.run(i + 1, p.first ?? null, p.last ?? null, p.nick ?? null, p.org ?? null);
    for (const n of p.phones ?? []) phone.run(i + 1, n);
    for (const a of p.emails ?? []) email.run(i + 1, a);
  });
  db.close();
}

describe("names from Contacts", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Mac helper");
    root = mkdtempSync(path.join(tmpdir(), "cliphy-contacts-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("finds the name for a number however Contacts wrote it", () => {
    const file = path.join(root, "AddressBook-v22.abcddb");
    addressBook(file, [{ first: "Maren", last: "Holt", phones: ["(415) 555-0142"] }]);
    const names = readContacts([file]);

    expect(names.nameFor("+14155550142")).toBe("Maren Holt");
    expect(names.nameFor("4155550142")).toBe("Maren Holt");
    expect(names.nameFor("+14155550199")).toBeNull();
  });

  it("finds the name for an email address, whatever its case", () => {
    const file = path.join(root, "AddressBook-v22.abcddb");
    addressBook(file, [{ first: "Sam", emails: ["Sam@Example.com"] }]);

    expect(readContacts([file]).nameFor("sam@example.com")).toBe("Sam");
  });

  it("falls back to the nickname, then the company, when there is no name", () => {
    const file = path.join(root, "AddressBook-v22.abcddb");
    addressBook(file, [
      { nick: "Mar", phones: ["+1 415 555 0142"] },
      { org: "Alder House", phones: ["+1 415 555 0143"] },
      { phones: ["+1 415 555 0144"] },
    ]);
    const names = readContacts([file]);

    expect(names.nameFor("+14155550142")).toBe("Mar");
    expect(names.nameFor("+14155550143")).toBe("Alder House");
    expect(names.nameFor("+14155550144")).toBeNull();
  });

  it("reads every account's contacts and skips files it cannot read", () => {
    const top = path.join(root, "AddressBook-v22.abcddb");
    const source = path.join(root, "Sources", "A1", "AddressBook-v22.abcddb");
    const broken = path.join(root, "Sources", "B2", "AddressBook-v22.abcddb");
    addressBook(top, []);
    addressBook(source, [{ first: "Maren", phones: ["415-555-0142"] }]);
    mkdirSync(path.dirname(broken), { recursive: true });
    writeFileSync(broken, "not a database");

    const files = contactFiles(root);
    expect(files).toEqual([top, source, broken]);
    expect(readContacts(files).nameFor("+14155550142")).toBe("Maren");
  });

  it("has no names when Contacts is missing", () => {
    expect(contactFiles(path.join(root, "nowhere"))).toEqual([]);
    expect(readContacts([]).nameFor("+14155550142")).toBeNull();
  });
});
