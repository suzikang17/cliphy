import type { Summary } from "@cliphy/shared";
import { apiFetch } from "./api";
import type { Recording } from "./voiceNote";

/** Put a finished recording in storage and save it as a voice note. */
export async function saveRecording(recording: Recording): Promise<Summary> {
  const { path, signedUrl } = await apiFetch<{ path: string; signedUrl: string }>(
    "/api/notes/voice/upload-url",
    { method: "POST", body: JSON.stringify({ mediaType: recording.mediaType }) },
  );
  const body =
    recording.source instanceof Blob
      ? recording.source
      : await (await fetch(recording.source.uri)).blob();
  const put = await fetch(signedUrl, {
    method: "PUT",
    headers: { "Content-Type": recording.mediaType.split(";")[0] },
    body,
  });
  if (!put.ok) throw new Error(`Upload failed (${put.status})`);
  const { note } = await apiFetch<{ note: Summary }>("/api/notes/voice", {
    method: "POST",
    body: JSON.stringify({
      storagePath: path,
      mediaType: recording.mediaType,
      seconds: recording.seconds,
    }),
  });
  return note;
}

/** Save something written as a note of its own. */
export const saveNote = (text: string) =>
  apiFetch<{ note: Summary }>("/api/notes", { method: "POST", body: JSON.stringify({ text }) });
