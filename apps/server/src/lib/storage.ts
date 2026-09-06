import { supabase } from "./supabase.js";

const BUCKET = "clip-images";

function mediaTypeFor(path: string): string {
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

export async function downloadImage(path: string): Promise<{ bytes: Buffer; mediaType: string }> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`Failed to download image ${path}: ${error?.message}`);
  const bytes = Buffer.from(await data.arrayBuffer());
  return { bytes, mediaType: mediaTypeFor(path) };
}

export async function signImageUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
  if (error || !data) return null;
  return data.signedUrl;
}

/** Resolve an image clip's storage path to a short-lived signed URL for display. */
export async function resolveClipImage<T extends { sourceType: string; heroImageUrl?: string }>(
  clip: T,
): Promise<T> {
  if (clip.sourceType === "image" && clip.heroImageUrl) {
    clip.heroImageUrl = (await signImageUrl(clip.heroImageUrl)) ?? clip.heroImageUrl;
  }
  return clip;
}
