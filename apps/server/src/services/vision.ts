import Anthropic from "@anthropic-ai/sdk";

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

const anthropic = new Anthropic({ timeout: 60_000 });
const VISION_MODEL = "claude-sonnet-4-6";

const VISION_PROMPT =
  `Analyze this image. Return ONLY JSON: {` +
  `"kind": "text" if the image is dominated by readable text (screenshot, tweet, ` +
  `article, label, receipt) else "visual", ` +
  `"extractedText": all readable text verbatim (empty string if kind is visual), ` +
  `"description": one-sentence description of what the image is, ` +
  `"detectedTweetUrl": a visible tweet URL like https://x.com/user/status/123 or omit, ` +
  `"reconstructedTweet": {"handle","author","text"} if this is clearly a tweet/thread, else omit}.`;

export async function analyzeImage(imageBytes: Buffer, mediaType: string): Promise<VisionResult> {
  const res = await anthropic.messages.create({
    model: VISION_MODEL,
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: VISION_PROMPT },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
              data: imageBytes.toString("base64"),
            },
          },
        ],
      },
    ],
  });
  const text = res.content.map((b) => ("text" in b ? b.text : "")).join("");
  return parseVisionResult(text);
}
