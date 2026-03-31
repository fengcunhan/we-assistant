import type { Context } from 'hono'
import type { Env, ChatCompletionRequest, ChatCompletionResponse, ChatMessage } from '../types'
import { runAgent } from '../agent'

export async function chatCompletions(c: Context<{ Bindings: Env }>) {
  const authHeader = c.req.header('Authorization')
  const expectedToken = `Bearer ${c.env.AUTH_TOKEN}`

  if (authHeader !== expectedToken) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const body = await c.req.json<ChatCompletionRequest>()
  const messages = body.messages ?? []

  const userMessages = messages.filter((m) => m.role === 'user')
  const lastUserMessage = userMessages[userMessages.length - 1]?.content ?? ''

  if (!lastUserMessage) {
    return c.json({ error: 'No user message found' }, 400)
  }

  // Extract conversation history (exclude system messages and the last user message)
  const history: ChatMessage[] = messages
    .filter((m) => m.role !== 'system')
    .slice(0, -1)

  // Use a hash of the auth token as userId for now
  const userId = 'default_user'

  let reply: string
  try {
    const result = await runAgent(lastUserMessage, userId, history, c.env)
    reply = result.reply
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return c.json({ error: message }, 500)
  }

  const response: ChatCompletionResponse = {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'pi-agent',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: reply,
        },
        finish_reason: 'stop',
      },
    ],
  }

  return c.json(response)
}
