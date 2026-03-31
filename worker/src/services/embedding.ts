import type { Env } from '../types'

interface EmbeddingResponse {
  data: Array<{
    embedding: number[]
    index: number
  }>
  model: string
  usage: {
    prompt_tokens: number
    total_tokens: number
  }
}

export async function getEmbedding(text: string, env: Env): Promise<number[]> {
  const response = await fetch('https://api.siliconflow.cn/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.SILICONFLOW_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env.EMBEDDING_MODEL,
      input: text,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Embedding API error (${response.status}): ${error}`)
  }

  const result = (await response.json()) as EmbeddingResponse
  return result.data[0].embedding
}
