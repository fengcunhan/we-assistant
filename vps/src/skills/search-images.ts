import { getEmbedding } from '../embedding.js'
import { queryVectors } from '../db.js'
import { getSignedUrl } from '../cos.js'
import type { Skill, ToolResult } from './types.js'

const skill: Skill = {
  name: 'search-images',
  description: '当用户想找之前发过的图片时使用（如"找一张有猫的图片"、"之前那张风景照"等）',
  tools: [
    {
      type: 'function',
      function: {
        name: 'search_images',
        description: '语义搜索用户之前发过的图片。只搜索用户当前明确要求的内容，不要自行补充额外的搜索。每次对话只调用一次。',
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
    const topK = Math.min((args.top_k as number) ?? 1, 3)

    const embedding = await getEmbedding(query)
    const results = queryVectors(embedding, 10, 'image')
    console.log(`🔍 图片搜索 "${query}" → ${results.length} 条结果:`, results.map((r) => ({ id: r.id, score: r.score.toFixed(4), content: r.content.slice(0, 30) })))

    // Only keep results with mediaUrl
    const candidates = results.filter((r) => r.mediaUrl)
    if (candidates.length === 0 || candidates[0].score < 0.4) {
      return { content: '没有找到匹配的图片。' }
    }

    // Take top result, then only include additional results if they are close to the top score
    // (within 95% of the top score — tight threshold to avoid unrelated results)
    const topScore = candidates[0].score
    const matched = candidates
      .filter((r, i) => i === 0 || r.score >= topScore * 0.95)
      .slice(0, topK)

    const desc = matched
      .map((r, i) => `${i + 1}. 相关度 ${(r.score * 100).toFixed(0)}% — ${r.content.slice(0, 40)}`)
      .join('\n')

    return {
      content: `找到 ${matched.length} 张相关图片，图片将自动单独发送给用户，你只需要简要告诉用户找到了什么图片即可，不要说没有图片链接:\n${desc}`,
      sideEffects: { imageUrls: matched.map((r) => getSignedUrl(r.mediaUrl!, 3600)) },
    }
  },
}

export default skill
