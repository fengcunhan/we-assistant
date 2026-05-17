import { getEmbedding, getMultimodalEmbedding } from '../embedding.js'
import { queryVectors } from '../db.js'
import { getSignedUrl } from '../cos.js'
import type { Skill, SkillContext, ToolResult } from './types.js'

const skill: Skill = {
  name: 'search-images',
  description: '当用户想找之前发过的图片时使用（如"找一张有猫的图片"、"之前那张风景照"）。支持以图搜图。搜到图片后需要调用 send_image 发送给用户。',
  tools: [
    {
      type: 'function',
      function: {
        name: 'search_images',
        description: '语义搜索用户之前发过的图片。支持两种模式：1) 文字描述搜索（传 query）；2) 以图搜图（用户发了图片时自动使用）。每次对话只调用一次。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '图片描述，如"有猫的图片"、"风景照"。以图搜图时可传简短描述如"类似的图片"' },
            top_k: { type: 'number', description: '返回几张，默认1' },
          },
          required: ['query'],
        },
      },
    },
  ],

  async execute(_toolName, args, context: SkillContext): Promise<ToolResult> {
    const query = args.query as string
    const topK = Math.min((args.top_k as number) ?? 1, 3)

    // If user sent an image, use visual embedding for image-to-image search
    const hasImage = context.imageUrls && context.imageUrls.length > 0
    let results

    if (hasImage) {
      const imageUrl = context.imageUrls![0]
      const signedUrl = getSignedUrl(imageUrl, 600)
      console.log(`🔍 以图搜图: ${imageUrl.slice(-40)}`)
      const embedding = await getMultimodalEmbedding([{ image: signedUrl }])
      results = queryVectors(context.botId, embedding, 10, 'image_visual')
      console.log(`🔍 视觉搜索 → ${results.length} 条结果:`, results.map((r) => ({ id: r.id, score: r.score.toFixed(4), content: r.content.slice(0, 30) })))

      // Exclude the source image itself (same mediaUrl)
      results = results.filter((r) => r.mediaUrl !== imageUrl)
    } else {
      const embedding = await getEmbedding(query)
      results = queryVectors(context.botId, embedding, 10, 'image')
      console.log(`🔍 图片搜索 "${query}" → ${results.length} 条结果:`, results.map((r) => ({ id: r.id, score: r.score.toFixed(4), content: r.content.slice(0, 30) })))
    }

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

    const lines = matched.map((r, i) => {
      const url = getSignedUrl(r.mediaUrl!, 3600)
      return `${i + 1}. 相关度 ${(r.score * 100).toFixed(0)}% — ${r.content.slice(0, 40)}\n   URL: ${url}`
    })

    return {
      content: `找到 ${matched.length} 张相关图片:\n${lines.join('\n')}\n\n请调用 send_image 工具将图片发送给用户。`,
    }
  },
}

export default skill
