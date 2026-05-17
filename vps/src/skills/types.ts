/** Tool definition in OpenAI function-calling format */
export interface ToolDef {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

/** Result returned by a tool handler */
export interface ToolResult {
  /** Text content returned to the LLM as tool output */
  content: string
  /** Optional side-channel data (e.g. image URLs to send via WeChat) */
  sideEffects?: Record<string, unknown>
}

/** A Skill is a self-contained capability module */
export interface Skill {
  /** Unique skill name */
  name: string
  /** When/why the agent should use this skill (injected into system prompt) */
  description: string
  /** Tools this skill provides */
  tools: ToolDef[]
  /** Execute a tool call. Returns content for the LLM to synthesize. */
  execute: (
    toolName: string,
    args: Record<string, unknown>,
    context: SkillContext
  ) => Promise<ToolResult>
}

/** Context passed to skill handlers */
export interface SkillContext {
  /** The bot (iLink login) that received this message — data isolation key */
  botId: string
  userId: string
  userMessage: string
  /** Optional: image URLs attached to the inbound message (for image-to-image search) */
  imageUrls?: string[]
  /** Send an intermediate message to the user (before tool result is ready) */
  sendMessage?: (text: string) => Promise<void>
}
