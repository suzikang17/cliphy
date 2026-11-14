import * as ImageManipulator from "expo-image-manipulator";
import { getUploadUrl, sendToChat } from "./coachApi";
import type { PendingShare } from "./shareStore";
import { supabase } from "./supabase";

const BUCKET = "clip-images";

/** Upload one shared image to the coach's intake folder, as a JPEG the bot can read. */
async function upload(localUri: string): Promise<{ storagePath: string; mediaType: string }> {
  const jpeg = await ImageManipulator.manipulateAsync(localUri, [{ resize: { width: 2000 } }], {
    compress: 0.85,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  const { path, token } = await getUploadUrl("image/jpeg");
  const bytes = await (await fetch(jpeg.uri)).arrayBuffer();
  const { error } = await supabase.storage
    .from(BUCKET)
    .uploadToSignedUrl(path, token, bytes, { contentType: "image/jpeg" });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return { storagePath: path, mediaType: "image/jpeg" };
}

/**
 * Hand a share to the bot as if `personId` had sent it: the images and the
 * words go in together, so they are read as one request.
 */
export async function sendShareToChat(personId: string, share: PendingShare): Promise<void> {
  const attachments = [];
  for (const uri of share.imageUris) attachments.push(await upload(uri));

  const stamp = Date.now();
  const now = new Date(stamp).toISOString();
  const text = share.text.trim();
  await sendToChat({
    personId,
    messages: [
      {
        externalId: `share-${stamp}-${Math.floor(Math.random() * 1e9).toString(36)}`,
        direction: "in",
        text: text || undefined,
        sentAt: now,
        attachments,
      },
    ],
  });
}
