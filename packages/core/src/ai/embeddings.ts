const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const MAX_BATCH_SIZE = 2048;

interface EmbeddingResult {
  text: string;
  embedding: number[];
}

export async function embedText(
  text: string,
  apiKey: string
): Promise<number[]> {
  const [result] = await embedBatch([text], apiKey);
  return result.embedding;
}

export async function embedBatch(
  texts: string[],
  apiKey: string
): Promise<EmbeddingResult[]> {
  const results: EmbeddingResult[] = [];

  for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
    const batch = texts.slice(i, i + MAX_BATCH_SIZE);
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: batch,
        dimensions: EMBEDDING_DIMENSIONS,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI embeddings API error ${response.status}: ${err}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    for (const item of data.data) {
      results.push({
        text: batch[item.index],
        embedding: item.embedding,
      });
    }
  }

  return results;
}

export function chunkText(
  text: string,
  maxChunkSize = 1000,
  overlap = 200
): string[] {
  if (text.length <= maxChunkSize) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + maxChunkSize;

    if (end < text.length) {
      const lastParagraph = text.lastIndexOf("\n\n", end);
      const lastSentence = text.lastIndexOf(". ", end);
      const lastNewline = text.lastIndexOf("\n", end);

      if (lastParagraph > start + maxChunkSize / 2) {
        end = lastParagraph + 2;
      } else if (lastSentence > start + maxChunkSize / 2) {
        end = lastSentence + 2;
      } else if (lastNewline > start + maxChunkSize / 2) {
        end = lastNewline + 1;
      }
    }

    chunks.push(text.slice(start, end).trim());
    start = end - overlap;
    if (start < 0) start = 0;
    if (end >= text.length) break;
  }

  return chunks.filter((c) => c.length > 0);
}

export { EMBEDDING_DIMENSIONS };
