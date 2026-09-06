export interface VisionResult {
  kind: "text" | "visual";
  extractedText: string;
  description: string;
  detectedTweetUrl?: string;
  reconstructedTweet?: { handle: string; author: string; text: string };
  partial?: boolean;
}

const TALL_RATIO = 4;

export function shouldTile(width: number, height: number): boolean {
  if (!width || !height) return false;
  return height / width > TALL_RATIO;
}

export function parseVisionResult(raw: string): VisionResult {
  const jsonText = raw.replace(/```json\s*|\s*```/g, "").trim();
  let p: Partial<VisionResult>;
  try {
    p = JSON.parse(jsonText);
  } catch {
    p = {};
  }
  const kind = p.kind === "text" ? "text" : "visual";
  return {
    kind,
    extractedText: typeof p.extractedText === "string" ? p.extractedText : "",
    description: typeof p.description === "string" ? p.description : "",
    detectedTweetUrl: p.detectedTweetUrl,
    reconstructedTweet: p.reconstructedTweet,
  };
}

export function mergeTiles(results: VisionResult[]): VisionResult {
  const text = results
    .map((r) => r.extractedText)
    .filter(Boolean)
    .join("\n");
  const description = results
    .map((r) => r.description)
    .filter(Boolean)
    .join(" ");
  const tweetUrl = results.find((r) => r.detectedTweetUrl)?.detectedTweetUrl;
  const tweet = results.find((r) => r.reconstructedTweet)?.reconstructedTweet;
  const anyText = results.some((r) => r.kind === "text");
  return {
    kind: anyText ? "text" : "visual",
    extractedText: text,
    description,
    detectedTweetUrl: tweetUrl,
    reconstructedTweet: tweet,
    partial: results.some((r) => r.partial) || undefined,
  };
}
