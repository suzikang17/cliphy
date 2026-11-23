const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_MODEL = "voyage-3.5";

export async function generateEmbedding(text: string): Promise<number[]> {
  const res = await fetch(VOYAGE_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input: text, model: VOYAGE_MODEL }),
  });

  if (!res.ok) {
    throw new Error(`Voyage AI embedding failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return data.data[0].embedding;
}

/** Many texts in one request, answered in the same order. */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await fetch(VOYAGE_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input: texts, model: VOYAGE_MODEL }),
  });

  if (!res.ok) {
    throw new Error(`Voyage AI embedding failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { data: Array<{ index: number; embedding: number[] }> };
  return [...data.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
}
