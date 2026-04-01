import { config } from './config'

const DASHSCOPE_URL = 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding'

interface DashScopeResponse {
  output: { embeddings: Array<{ embedding: number[] }> }
}

export async function getEmbedding(text: string): Promise<number[]> {
  return getMultimodalEmbedding([{ text }])
}

export async function getMultimodalEmbedding(
  content: Array<{ text?: string; image?: string }>
): Promise<number[]> {
  const res = await fetch(DASHSCOPE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.embedding.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.embedding.model,
      input: { contents: content },
      parameters: { dimension: config.embedding.dimension },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Embedding error (${res.status}): ${err}`)
  }

  const data = (await res.json()) as DashScopeResponse
  return data.output.embeddings[0].embedding
}
