import { getEmbedding } from '../embedding.js'
import { queryVectors } from '../db.js'
import type { Skill, ToolResult } from './types.js'

const skill: Skill = {
  name: 'search-images',
  description: '当用户想找之前发过的图片时使用（如"找一张有猫的图片"、"之前那张风景照"等）',
  tools: [
    {
      type: 'function',
      function: {
        name: 'search_images',
        description: '语义搜索用户之前发过的图片。根据描述找到最匹配的图片并发送给用户。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '图片描述，如"有猫的图片"、"风景照"' },
            top_k: { type: 'number', description: '返回几张，默认1' },
          },
          required: ['query'],
        },
      },
    },
  ],

  async execute(_toolName, args): Promise<ToolResult> {
    const query = args.query as string
    const topK = (args.top_k as number) ?? 1

    const embedding = await getEmbedding(query)
    const results = queryVectors(embedding, topK, 'image')

    const matched = results.filter((r) => r.mediaUrl && r.score > 0.3)
    if (matched.length === 0) {
      return { content: '没有找到匹配的图片。' }
    }

    const desc = matched
      .map((r, i) => `${i + 1}. 相关度 ${(r.score * 100).toFixed(0)}%`)
      .join('\n')

    return {
      content: `找到 ${matched.length} 张相关图片:\n${desc}`,
      sideEffects: { imageUrls: matched.map((r) => r.mediaUrl!) },
    }
  },
}

export default skill
