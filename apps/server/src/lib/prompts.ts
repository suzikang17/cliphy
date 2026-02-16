export const SUMMARY_PROMPT = (
  videoTitle: string,
  transcript: string,
) => `Summarize the following YouTube video transcript.

Video title: ${videoTitle}

Provide:
1. A concise summary (2-3 paragraphs)
2. Key points as a bullet list (5-10 items)

Format your response as JSON:
{
  "summary": "...",
  "keyPoints": ["...", "..."]
}

Transcript:
${transcript}`;
