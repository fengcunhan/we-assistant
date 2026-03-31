import type { Env, ChatMessage, ToolDefinition } from './types'
import { chatWithTools } from './services/llm'
import { storeNote } from './tools/store'
import { queryKnowledge } from './tools/query'
import { insertVector } from './services/vectorize'
import { getEmbedding } from './services/embedding'

const SYSTEM_PROMPT = `你是 Pi，一个智能个人知识管理助理。你守在用户的微信里，帮助他们管理碎片化信息。

你有两个工具:
1. store_note - 当用户想记录/保存信息时使用（如"帮我记一下..."、"存一下这个..."、转发内容、会议纪要等）
2. query_knowledge - 当用户想检索已存信息时使用（如"之前那个..."、"帮我找..."、"我存过什么关于..."等）

判断规则:
- 如果用户在告诉你一些信息并希望你记住，用 store_note
- 如果用户在提问或查找之前存过的信息，用 query_knowledge
- 如果都不是（打招呼、闲聊等），直接回复，不调用工具

回复风格: 简洁、友好、有温度。`

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'store_note',
      description: '将用户的信息语义化存入知识库。当用户想记录、保存、存储信息时调用。',
      parameters: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: '要存储的内容',
          },
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
  {
    type: 'function',
    function: {
      name: 'query_knowledge',
      description: '从知识库中语义检索相关信息。当用户想查找、提问之前存过的信息时调用。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '检索问题',
          },
          top_k: {
            type: 'number',
            description: '返回条数，默认3',
          },
        },
        required: ['query'],
      },
    },
  },
]

export async function runAgent(
  userMessage: string,
  userId: string,
  conversationHistory: ChatMessage[],
  env: Env
): Promise<{ reply: string; intentType: 'store' | 'query' | 'chat' }> {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...conversationHistory,
    { role: 'user', content: userMessage },
  ]

  const { content, toolCalls } = await chatWithTools(messages, TOOL_DEFINITIONS, env)

  if (toolCalls.length === 0) {
    await recordInteraction(userMessage, userId, 'chat', env)
    return { reply: content ?? '你好！有什么我能帮你的？', intentType: 'chat' }
  }

  const toolCall = toolCalls[0]
  const args = JSON.parse(toolCall.function.arguments)

  if (toolCall.function.name === 'store_note') {
    const result = await storeNote(args, userId, env)
    return { reply: result, intentType: 'store' }
  }

  if (toolCall.function.name === 'query_knowledge') {
    const result = await queryKnowledge(args, env)
    await recordInteraction(userMessage, userId, 'query', env)
    return { reply: result, intentType: 'query' }
  }

  return { reply: content ?? '我没理解你的意思，能再说一遍吗？', intentType: 'chat' }
}

async function recordInteraction(
  content: string,
  userId: string,
  intentType: 'chat' | 'query',
  env: Env
): Promise<void> {
  try {
    const embedding = await getEmbedding(content, env)
    const id = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    await insertVector(env, id, embedding, {
      content,
      category: 'interaction_log',
      userId,
      timestamp: Date.now(),
      intentType,
    })
  } catch {
    // Non-critical: don't fail the request if logging fails
  }
}
