import { config } from './config.js'

interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

interface ToolDef {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

/**
 * Send a chat completion request with optional tool definitions.
 * Supports system, user, assistant, and tool role messages.
 */
export async function chatWithTools(
  messages: Array<Record<string, unknown>>,
  tools: ToolDef[]
): Promise<{ content: string | null; toolCalls: ToolCall[] }> {
  const body: Record<string, unknown> = {
    model: config.llm.model,
    messages,
  }
  if (tools.length > 0) {
    body.tools = tools
  }

  const res = await fetch(`${config.llm.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.llm.apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`LLM error (${res.status}): ${err}`)
  }

  const data = await res.json() as {
    choices: Array<{ message: { content?: string; tool_calls?: ToolCall[] } }>
  }

  const msg = data.choices[0]?.message
  return {
    content: msg?.content ?? null,
    toolCalls: msg?.tool_calls ?? [],
  }
}

/** Simple chat without tools */
export async function chat(messages: Array<Record<string, unknown>>): Promise<string> {
  const { content } = await chatWithTools(messages, [])
  return content ?? ''
}
