import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { sqlite } from "./messagesDb.js";

// Names for the numbers and addresses in Messages, from the Contacts on this
// Mac. Read-only, covered by the same Full Disk Access as Messages. The names
// stay on the Mac unless the owner adds the person.

export const CONTACTS_DIR = path.join(homedir(), "Library", "Application Support", "AddressBook");
const DB_NAME = "AddressBook-v22.abcddb";

export interface ContactNames {
  /** The name Contacts has for this phone number or email, if any. */
  nameFor(handle: string): string | null;
}

/** The Contacts databases: the local one, then one per account (iCloud, Google, …). */
export function contactFiles(root: string = CONTACTS_DIR): string[] {
  const candidates = [path.join(root, DB_NAME)];
  try {
    for (const source of readdirSync(path.join(root, "Sources")).sort()) {
      candidates.push(path.join(root, "Sources", source, DB_NAME));
    }
  } catch {
    // No accounts, or no Contacts at all.
  }
  return candidates.filter((file) => {
    try {
      return statSync(file).isFile();
    } catch {
      return false;
    }
  });
}

/**
 * How a handle is looked up. Emails are lower-cased. Phone numbers keep their
 * last ten digits, so "+1 (415) 555-0142" and "4155550142" are the same person.
 */
function key(handle: string): string | null {
  const trimmed = handle.trim().toLowerCase();
  if (trimmed.includes("@")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7) return null;
  return digits.slice(-10);
}

export function readContacts(files: string[]): ContactNames {
  const names = new Map<string, string>();
  const { DatabaseSync } = sqlite();
  for (const file of files) {
    try {
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        const rows = db
          .prepare(
            `select p.ZFULLNUMBER as handle, r.ZFIRSTNAME as first, r.ZLASTNAME as last,
                    r.ZNICKNAME as nick, r.ZORGANIZATION as org
               from ZABCDPHONENUMBER p join ZABCDRECORD r on r.Z_PK = p.ZOWNER
             union all
             select e.ZADDRESS, r.ZFIRSTNAME, r.ZLASTNAME, r.ZNICKNAME, r.ZORGANIZATION
               from ZABCDEMAILADDRESS e join ZABCDRECORD r on r.Z_PK = e.ZOWNER`,
          )
          .all() as Record<"handle" | "first" | "last" | "nick" | "org", string | null>[];
        for (const row of rows) {
          const k = row.handle ? key(row.handle) : null;
          const name =
            [row.first, row.last].filter(Boolean).join(" ").trim() ||
            row.nick?.trim() ||
            row.org?.trim();
          if (k && name && !names.has(k)) names.set(k, name);
        }
      } finally {
        db.close();
      }
    } catch {
      // One unreadable account must not hide the names from the others.
    }
  }
  return {
    nameFor: (handle) => {
      const k = key(handle);
      return (k && names.get(k)) || null;
    },
  };
}
