import { getEmbedding } from '../embedding.js'
import { queryVectors } from '../db.js'
import type { Skill, ToolResult } from './types.js'

const skill: Skill = {
  name: 'query-knowledge',
  description: '当用户想检索已存信息时使用（如"之前那个..."、"帮我找..."、"我存过什么关于..."等）',
  tools: [
    {
      type: 'function',
      function: {
        name: 'query_knowledge',
        description: '从知识库中语义检索相关信息。当用户想查找、提问之前存过的信息时调用。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '检索问题' },
            top_k: { type: 'number', description: '返回条数，默认3' },
          },
          required: ['query'],
        },
      },
    },
  ],

  async execute(_toolName, args): Promise<ToolResult> {
    const query = args.query as string
    const topK = (args.top_k as number) ?? 3

    const embedding = await getEmbedding(query)
    const results = queryVectors(embedding, topK)

    if (results.length === 0) {
      return { content: '知识库中没有找到相关内容。' }
    }

    const items = results
      .map((r, i) => `[${i + 1}] (相关度: ${(r.score * 100).toFixed(0)}%) ${r.content}`)
      .join('\n')

    return { content: `从知识库中检索到以下内容:\n${items}` }
  },
}

export default skill
