import * as ImageManipulator from "expo-image-manipulator";
import type { Summary } from "@cliphy/shared";
import { supabase } from "./supabase";
import { addClip } from "./api";

const BUCKET = "clip-images";

// A stable-enough unique id without pulling in a uuid dep.
function uid(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export function storagePathFor(userId: string): string {
  return `${userId}/${uid()}.jpg`;
}

/**
 * Downscale + recompress to keep uploads small and within Claude vision
 * limits. The result is a new file in the app's own storage, so it is still
 * there after the shared original is gone.
 */
export async function prepareImage(localUri: string): Promise<string> {
  const manipulated = await ImageManipulator.manipulateAsync(
    localUri,
    [{ resize: { width: 2000 } }],
    { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
  );
  return manipulated.uri;
}

/** Upload an image made by `prepareImage` and save it as a clip. */
export async function uploadPreparedImage(preparedUri: string): Promise<Summary> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) throw new Error("Not signed in");

  const path = storagePathFor(userId);
  const res = await fetch(preparedUri);
  const arrayBuffer = await res.arrayBuffer();

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, arrayBuffer, { contentType: "image/jpeg", upsert: false });
  if (error) throw new Error(`Upload failed: ${error.message}`);

  const { clip } = await addClip({ imagePath: path });
  return clip;
}

export async function uploadAndClipImage(localUri: string): Promise<Summary> {
  return uploadPreparedImage(await prepareImage(localUri));
}
