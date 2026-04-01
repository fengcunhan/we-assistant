import { config } from './config'

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

interface ToolDef {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export async function chatWithTools(
  messages: ChatMessage[],
  tools: ToolDef[]
): Promise<{ content: string | null; toolCalls: ToolCall[] }> {
  const res = await fetch(`${config.llm.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.llm.apiKey}`,
    },
    body: JSON.stringify({ model: config.llm.model, messages, tools }),
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

export async function chat(messages: ChatMessage[]): Promise<string> {
  const { content } = await chatWithTools(messages, [])
  return content ?? ''
}
