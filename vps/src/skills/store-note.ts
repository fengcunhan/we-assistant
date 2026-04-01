import { getEmbedding } from '../embedding.js'
import { insertVector } from '../db.js'
import type { Skill, ToolResult } from './types.js'

const skill: Skill = {
  name: 'store-note',
  description: '当用户想记录、保存、存储信息时使用（如"帮我记一下..."、"存一下这个..."、转发内容、会议纪要等）',
  tools: [
    {
      type: 'function',
      function: {
        name: 'store_note',
        description: '将用户的信息语义化存入知识库。当用户想记录、保存、存储信息时调用。',
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string', description: '要存储的内容' },
            category: {
              type: 'string',
              description: '分类标签',
              enum: ['work', 'life', 'idea', 'meeting', 'learning', 'general'],
            },
          },
          required: ['content'],
        },
      },
    },
  ],

  async execute(_toolName, args, context): Promise<ToolResult> {
    const content = args.content as string
    const category = (args.category as string) ?? 'general'

    const embedding = await getEmbedding(content)
    const id = `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    insertVector(id, embedding, content, category, context.userId, 'store')

    return {
      content: `已成功存入知识库。内容: "${content.slice(0, 80)}${content.length > 80 ? '...' : ''}"，分类: ${category}`,
    }
  },
}

export default skill
