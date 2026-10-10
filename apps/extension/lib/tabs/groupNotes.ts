import { useCallback, useEffect, useRef, useState } from "react";
import { getGroupNotes, putGroupNote } from "../api";

// Your note per tag group ("invoice due Fri"). Server-backed (tag_notes) so it
// follows you across devices; a local copy shows it instantly on open.

export const GROUP_NOTES_KEY = "tabs:groupNotes"; // storage.local

async function readCache(): Promise<Record<string, string>> {
  try {
    const v = (await browser.storage.local.get(GROUP_NOTES_KEY))?.[GROUP_NOTES_KEY];
    return v && typeof v === "object" ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}
const writeCache = (notes: Record<string, string>) =>
  browser.storage.local.set({ [GROUP_NOTES_KEY]: notes }).catch(() => {});

export function useGroupNotes(authed: boolean | null) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const notesRef = useRef(notes);
  notesRef.current = notes;

  useEffect(() => {
    let live = true;
    let fromServer = false; // the server's answer always wins over the cached copy
    void readCache().then((cached) => {
      if (live && !fromServer) setNotes(cached);
    });
    if (authed) {
      void getGroupNotes()
        .then(({ notes: server }) => {
          if (!live) return;
          fromServer = true;
          setNotes(server);
          void writeCache(server);
        })
        .catch(() => {});
    }
    return () => {
      live = false;
    };
  }, [authed]);

  const save = useCallback(async (tag: string, text: string) => {
    const note = text.trim();
    const before = notesRef.current;
    const next = { ...before };
    if (note) next[tag] = note;
    else delete next[tag];
    setNotes(next);
    setError(null);
    try {
      await putGroupNote(tag, note);
      void writeCache(next);
    } catch {
      setNotes(before);
      setError("Couldn't save the note — try again");
    }
  }, []);

  return { notes, save, error };
}
