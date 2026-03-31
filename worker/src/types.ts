export interface Env {
  PI_VECTORS: VectorizeIndex
  SILICONFLOW_API_KEY: string
  LLM_API_KEY: string
  LLM_BASE_URL: string
  LLM_MODEL: string
  EMBEDDING_MODEL: string
  AUTH_TOKEN: string
  WECLAW_API_URL?: string
}

// OpenAI-compatible types

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ChatCompletionRequest {
  model: string
  messages: ChatMessage[]
}

export interface ChatCompletionResponse {
  id: string
  object: 'chat.completion'
  created: number
  model: string
  choices: Array<{
    index: number
    message: {
      role: 'assistant'
      content: string
    }
    finish_reason: string
  }>
}

// Note metadata stored in Vectorize

export interface NoteMetadata {
  content: string
  category: string
  userId: string
  timestamp: number
  intentType: 'store' | 'query' | 'chat'
}

// Dashboard API types

export interface NoteItem {
  id: string
  content: string
  category: string
  userId: string
  timestamp: number
}

export interface Stats {
  totalNotes: number
  intentDistribution: {
    store: number
    query: number
    chat: number
  }
  recentActivity: Array<{
    date: string
    count: number
  }>
}
