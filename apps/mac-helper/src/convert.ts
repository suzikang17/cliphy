// Turning what Messages stores into what the coach wants.

/** Seconds between the Unix epoch and Apple's (2001-01-01T00:00:00Z). */
const APPLE_EPOCH_S = 978_307_200;

/**
 * `message.date` → ISO time. Modern macOS stores nanoseconds since 2001;
 * older versions stored seconds. Values arrive as number or bigint.
 */
export function appleTimeToIso(date: number | bigint): string {
  const n = typeof date === "bigint" ? date : BigInt(Math.trunc(date));
  // Anything this large cannot be seconds (it would be thousands of years out).
  const seconds = n > 100_000_000_000n ? Number(n / 1_000_000_000n) : Number(n);
  return new Date((seconds + APPLE_EPOCH_S) * 1000).toISOString();
}

/**
 * Recover the plain text from `message.attributedBody`.
 *
 * Newer macOS leaves `message.text` empty and stores an archived
 * NSAttributedString instead. The string's bytes sit after the marker
 * 0x01 0x2B, preceded by their length: one byte, or 0x81 followed by a
 * two-byte little-endian length for longer text.
 */
export function textFromAttributedBody(body: Uint8Array | null | undefined): string {
  if (!body || body.length === 0) return "";
  const bytes = Buffer.from(body);
  const marker = bytes.indexOf("NSString");
  if (marker === -1) return "";

  const start = bytes.indexOf(Buffer.from([0x01, 0x2b]), marker);
  if (start === -1) return "";
  let at = start + 2;
  if (at >= bytes.length) return "";

  let length = bytes[at];
  at += 1;
  if (length === 0x81) {
    if (at + 2 > bytes.length) return "";
    length = bytes.readUInt16LE(at);
    at += 2;
  } else if (length === 0x82) {
    if (at + 4 > bytes.length) return "";
    length = bytes.readUInt32LE(at);
    at += 4;
  }
  if (at + length > bytes.length) return "";
  return bytes.subarray(at, at + length).toString("utf8");
}

const UTI_TYPES: Record<string, string> = {
  "public.jpeg": "image/jpeg",
  "public.png": "image/png",
  "public.heic": "image/heic",
  "public.heif": "image/heif",
  "public.webp": "image/webp",
  "org.webmproject.webp": "image/webp",
  "com.compuserve.gif": "image/gif",
  "public.tiff": "image/tiff",
};
const EXTENSION_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  heif: "image/heif",
  webp: "image/webp",
  gif: "image/gif",
  tif: "image/tiff",
  tiff: "image/tiff",
};

/**
 * An attachment's type. Messages often leaves `mime_type` empty and records
 * only a uti, or nothing but the file name, so fall back through those.
 * Null when it is not something recognisable as an image.
 */
export function mimeFor(
  mimeType: string | null | undefined,
  uti: string | null | undefined,
  filename: string | null | undefined,
): string | null {
  if (mimeType) return mimeType;
  if (uti && UTI_TYPES[uti]) return UTI_TYPES[uti];
  const extension = filename?.split(".").pop()?.toLowerCase();
  return (extension && EXTENSION_TYPES[extension]) || null;
}
