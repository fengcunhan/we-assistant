import type { Env, ChatMessage, ToolDefinition, ToolCall } from '../types'

interface LLMResponse {
  choices: Array<{
    message: {
      role: 'assistant'
      content: string | null
      tool_calls?: ToolCall[]
    }
    finish_reason: string
  }>
}

export async function chatWithTools(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  env: Env
): Promise<{ content: string | null; toolCalls: ToolCall[] }> {
  const response = await callLLM(messages, tools, env)
  const choice = response.choices[0]

  return {
    content: choice.message.content,
    toolCalls: choice.message.tool_calls ?? [],
  }
}

export async function chat(
  messages: ChatMessage[],
  env: Env
): Promise<string> {
  const response = await callLLM(messages, undefined, env)
  return response.choices[0].message.content ?? ''
}

async function callLLM(
  messages: ChatMessage[],
  tools: ToolDefinition[] | undefined,
  env: Env
): Promise<LLMResponse> {
  const body: Record<string, unknown> = {
    model: env.LLM_MODEL,
    messages,
  }

  if (tools && tools.length > 0) {
    body.tools = tools
    body.tool_choice = 'auto'
  }

  const response = await fetch(`${env.LLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.LLM_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`LLM API error (${response.status}): ${error}`)
  }

  return (await response.json()) as LLMResponse
}
