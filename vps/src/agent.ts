import { chatWithTools, chat } from './llm'
import { getEmbedding } from './embedding'
import { insertVector, queryVectors } from './db'

const SYSTEM_PROMPT = `你是 Pi，一个智能个人知识管理助理。你守在用户的微信里，帮助他们管理碎片化信息。

你有三个工具:
1. store_note - 当用户想记录/保存信息时使用（如"帮我记一下..."、"存一下这个..."、转发内容、会议纪要等）
2. query_knowledge - 当用户想检索已存信息时使用（如"之前那个..."、"帮我找..."、"我存过什么关于..."等）
3. search_images - 当用户想找之前发过的图片时使用（如"找一张有猫的图片"、"之前那张风景照"等）

判断规则:
- 如果用户在告诉你一些信息并希望你记住，用 store_note
- 如果用户在提问或查找之前存过的信息，用 query_knowledge
- 如果用户想找图片，用 search_images
- 如果都不是（打招呼、闲聊等），直接回复，不调用工具

回复风格: 简洁、友好、有温度。`

const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'store_note',
      description: '将用户的信息语义化存入知识库。当用户想记录、保存、存储信息时调用。',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '要存储的内容' },
          category: { type: 'string', description: '分类标签', enum: ['work', 'life', 'idea', 'meeting', 'learning', 'general'] },
        },
        required: ['content'],
      },
    },
  },
  {
    type: 'function' as const,
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
  {
    type: 'function' as const,
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
]

export interface AgentResult {
  reply: string
  imageUrls?: string[]  // COS URLs of images to send back
}

export async function runAgent(
  userMessage: string,
  userId: string,
  history: Array<{ role: string; content: string }>
): Promise<AgentResult> {
  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    ...history.map((h) => ({ role: h.role as 'user' | 'assistant', content: h.content })),
    { role: 'user' as const, content: userMessage },
  ]

  const { content, toolCalls } = await chatWithTools(messages, TOOLS)

  if (toolCalls.length === 0) {
    return { reply: content ?? '你好！有什么我能帮你的？' }
  }

  const call = toolCalls[0]
  const args = JSON.parse(call.function.arguments)

  if (call.function.name === 'store_note') {
    return { reply: await storeNote(args.content, args.category ?? 'general', userId) }
  }

  if (call.function.name === 'query_knowledge') {
    return { reply: await queryKnowledge(args.query, args.top_k ?? 3) }
  }

  if (call.function.name === 'search_images') {
    return await searchImages(args.query, args.top_k ?? 1)
  }

  return { reply: content ?? '我没理解你的意思，能再说一遍吗？' }
}

async function storeNote(content: string, category: string, userId: string): Promise<string> {
  const embedding = await getEmbedding(content)
  const id = `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  insertVector(id, embedding, content, category, userId, 'store')
  return `已记录: "${content.slice(0, 50)}${content.length > 50 ? '...' : ''}" [${category}]`
}

async function queryKnowledge(query: string, topK: number): Promise<string> {
  const embedding = await getEmbedding(query)
  const results = queryVectors(embedding, topK)

  if (results.length === 0) return '知识库中没有找到相关内容。'

  const context = results
    .map((r, i) => `[${i + 1}] (相关度: ${(r.score * 100).toFixed(0)}%) ${r.content}`)
    .join('\n')

  return await chat([
    { role: 'system', content: '你是 Pi，用户的个人知识助理。根据以下从用户知识库中检索到的内容，回答用户的问题。如果检索内容不足以回答，请坦诚说明。回答要简洁、自然。' },
    { role: 'user', content: `检索到的知识库内容:\n${context}\n\n用户问题: ${query}` },
  ])
}

async function searchImages(query: string, topK: number): Promise<AgentResult> {
  const embedding = await getEmbedding(query)
  const results = queryVectors(embedding, topK, 'image')

  const withImages = results.filter((r) => r.mediaUrl && r.score > 0.3)
  if (withImages.length === 0) {
    return { reply: '没有找到匹配的图片。试试换个描述？' }
  }

  const imageUrls = withImages.map((r) => r.mediaUrl!)
  const desc = withImages.map((r, i) => `${i + 1}. 相关度 ${(r.score * 100).toFixed(0)}%`).join('\n')
  return {
    reply: `找到 ${withImages.length} 张相关图片：\n${desc}\n正在发送...`,
    imageUrls,
  }
}
