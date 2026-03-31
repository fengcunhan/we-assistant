import type { Env } from '../types'
import { getEmbedding } from '../services/embedding'
import { insertVector } from '../services/vectorize'

interface StoreParams {
  content: string
  category?: string
}

export async function storeNote(
  params: StoreParams,
  userId: string,
  env: Env
): Promise<string> {
  const { content, category = 'general' } = params

  const embedding = await getEmbedding(content, env)

  const id = `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  await insertVector(env, id, embedding, {
    content,
    category,
    userId,
    timestamp: Date.now(),
    intentType: 'store',
  })

  return `已记录: "${content.slice(0, 50)}${content.length > 50 ? '...' : ''}" [${category}]`
}
