// The helper keeps its own copy of the few server shapes it uses, so it has no
// dependency on the app's shared package (which pulls in UI code).

export type HistoryWindow = "new" | "window" | "all";

/** A person as `GET /coach/people` returns them; only what the helper needs. */
export interface CapturedPerson {
  id: string;
  name: string;
  handles: string[];
  captureThread: boolean;
  historyWindow: HistoryWindow;
  historyDays: number | null;
}

/** One message as read from Messages, already converted. */
export interface ThreadMessage {
  rowId: number;
  /** Messages' own stable id for the message; what makes re-uploads harmless. */
  guid: string;
  text: string;
  sentAtIso: string;
  isFromMe: boolean;
  attachments: { path: string | null; mimeType: string | null }[];
}

export interface UploadedAttachment {
  storagePath: string;
  mediaType: string;
}

/** The shape `POST /coach/intake/messages` takes for one message. */
export interface IntakeMessage {
  externalId: string;
  direction: "in" | "out";
  text: string;
  sentAt: string;
  attachments: UploadedAttachment[];
}

/**
 * What to do the first time a person's thread is connected, by their choice:
 * start from now, or read back (a window of days, or everything). `sinceIso`
 * null means from the beginning.
 */
export function firstSync(
  person: { historyWindow: HistoryWindow; historyDays: number | null },
  now: Date,
): { mode: "skip" } | { mode: "backfill"; sinceIso: string | null } {
  if (person.historyWindow === "all") return { mode: "backfill", sinceIso: null };
  if (person.historyWindow === "window" && person.historyDays && person.historyDays > 0) {
    return {
      mode: "backfill",
      sinceIso: new Date(now.getTime() - person.historyDays * 86_400_000).toISOString(),
    };
  }
  return { mode: "skip" };
}

export function toIntakeMessage(row: ThreadMessage, uploaded: UploadedAttachment[]): IntakeMessage {
  return {
    externalId: row.guid,
    direction: row.isFromMe ? "out" : "in",
    text: row.text,
    sentAt: row.sentAtIso,
    attachments: uploaded,
  };
}
