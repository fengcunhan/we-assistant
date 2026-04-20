import type { Skill, ToolResult } from './types.js'

const skill: Skill = {
  name: 'send-image',
  description: '当需要发送图片给用户时使用。必须提供图片的 COS URL。',
  tools: [
    {
      type: 'function',
      function: {
        name: 'send_image',
        description: '发送一张或多张图片给用户。传入图片 URL 数组。',
        parameters: {
          type: 'object',
          properties: {
            urls: {
              type: 'array',
              items: { type: 'string' },
              description: '图片 URL 数组',
            },
          },
          required: ['urls'],
        },
      },
    },
  ],

  async execute(_toolName, args): Promise<ToolResult> {
    const urls = args.urls as string[]
    if (!urls || urls.length === 0) {
      return { content: '没有提供图片 URL。' }
    }
    return {
      content: `已安排发送 ${urls.length} 张图片。`,
      sideEffects: { imageUrls: urls },
    }
  },
}

export default skill
