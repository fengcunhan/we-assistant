import type { Env, ChatMessage } from '../types'
import { getEmbedding } from '../services/embedding'
import { queryVectors } from '../services/vectorize'
import { chat } from '../services/llm'

interface QueryParams {
  query: string
  top_k?: number
}

export async function queryKnowledge(
  params: QueryParams,
  env: Env
): Promise<string> {
  const { query, top_k = 3 } = params

  const embedding = await getEmbedding(query, env)

  const results = await queryVectors(env, embedding, top_k)

  if (results.length === 0) {
    return '知识库中没有找到相关内容。'
  }

  const context = results
    .map((r, i) => `[${i + 1}] (相关度: ${(r.score * 100).toFixed(0)}%) ${r.metadata.content}`)
    .join('\n')

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: '你是 Pi，用户的个人知识助理。根据以下从用户知识库中检索到的内容，回答用户的问题。如果检索内容不足以回答，请坦诚说明。回答要简洁、自然。',
    },
    {
      role: 'user',
      content: `检索到的知识库内容:\n${context}\n\n用户问题: ${query}`,
    },
  ]

  return await chat(messages, env)
}
