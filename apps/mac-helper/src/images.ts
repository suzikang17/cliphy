import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Image types the coach accepts as they are. Everything else image-like is converted to JPEG. */
const AS_IS = new Set(["image/jpeg", "image/png", "image/webp"]);

export type Converter = (source: string, output: string) => Promise<void>;

/** macOS's built-in converter. Handles HEIC, the iPhone's default photo format. */
const sips: Converter = async (source, output) => {
  await run("/usr/bin/sips", ["-s", "format", "jpeg", source, "--out", output]);
};

/**
 * The bytes to upload for an attachment, at full quality.
 * Returns null when it is not an image, is not on disk (still downloading,
 * or deleted), or cannot be converted; the message is then sent without it.
 */
export async function prepareImage(
  file: string,
  mimeType: string | null,
  convert: Converter = sips,
): Promise<{ bytes: Buffer; mediaType: string } | null> {
  if (!mimeType?.startsWith("image/")) return null;

  if (AS_IS.has(mimeType)) {
    try {
      return { bytes: await readFile(file), mediaType: mimeType };
    } catch {
      return null;
    }
  }

  // HEIC and the rest: the bot cannot read them, so send a JPEG.
  const dir = await mkdtemp(path.join(tmpdir(), "cliphy-convert-"));
  const output = path.join(dir, "converted.jpg");
  try {
    await readFile(file); // missing → skip without running the converter
    await convert(file, output);
    return { bytes: await readFile(output), mediaType: "image/jpeg" };
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
