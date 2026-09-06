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

export async function uploadAndClipImage(localUri: string): Promise<Summary> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) throw new Error("Not signed in");

  // Downscale + recompress to keep uploads small and within Claude vision limits.
  const manipulated = await ImageManipulator.manipulateAsync(
    localUri,
    [{ resize: { width: 2000 } }],
    { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
  );

  const path = storagePathFor(userId);
  const res = await fetch(manipulated.uri);
  const arrayBuffer = await res.arrayBuffer();

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, arrayBuffer, { contentType: "image/jpeg", upsert: false });
  if (error) throw new Error(`Upload failed: ${error.message}`);

  const { clip } = await addClip({ imagePath: path });
  return clip;
}
