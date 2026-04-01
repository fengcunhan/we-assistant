import { chatWithTools } from './llm.js'
import type { Skill, SkillContext, ToolDef, ToolResult } from './skills/types.js'

// --- Skill registry ---

import storeNote from './skills/store-note.js'
import queryKnowledge from './skills/query-knowledge.js'
import searchImages from './skills/search-images.js'
import reminder from './skills/reminder.js'

const skills: Skill[] = [storeNote, queryKnowledge, searchImages, reminder]

/** All tools from all registered skills */
const allTools: ToolDef[] = skills.flatMap((s) => s.tools)

/** Map tool name → skill for fast dispatch */
const toolToSkill = new Map<string, Skill>()
for (const skill of skills) {
  for (const tool of skill.tools) {
    toolToSkill.set(tool.function.name, skill)
  }
}

// --- System prompt (lean base + skill descriptions) ---

const BASE_PROMPT = `你是 Pi，一个智能个人知识管理助理。你守在用户的微信里，帮助他们管理碎片化信息。

回复风格: 简洁、友好、有温度。用自然的中文回复，不要机械地复述工具返回的内容。`

function buildSystemPrompt(): string {
  const now = new Date()
  const timeStr = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'full', timeStyle: 'short' })
  const isoStr = now.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace(' ', 'T')

  const skillSection = skills
    .map((s) => `- ${s.tools.map((t) => t.function.name).join(', ')}: ${s.description}`)
    .join('\n')

  return `${BASE_PROMPT}

## 当前时间
${timeStr} (${isoStr}, Asia/Shanghai)

## 可用技能
${skillSection}

## 知识库回忆 (Memory Recall)
在回答任何涉及以下内容的问题前，你**必须**先调用 query_knowledge 检索知识库:
- 用户之前说过/存过的信息（"之前那个..."、"上次..."、"我存过..."）
- 日程安排、待办事项、会议内容
- 具体的人名、日期、数字、决定
- 任何你不确定的历史信息

如果检索后没有找到相关内容，坦诚告诉用户"我查了知识库，没有找到相关记录"。
不要凭空编造用户没有存过的信息。

## 使用规则
- 根据用户意图选择合适的工具，闲聊/打招呼时直接回复
- 工具返回的是原始数据，你需要用自然语言向用户总结
- 一次对话中可以调用多个工具（如先检索再存储）`
}

// --- Multi-turn agent loop ---

const MAX_TURNS = 5

export interface AgentResult {
  reply: string
  imageUrls?: string[]
}

export async function runAgent(
  userMessage: string,
  userId: string,
  history: Array<{ role: string; content: string }>
): Promise<AgentResult> {
  const systemPrompt = buildSystemPrompt()
  const context: SkillContext = { userId, userMessage }

  // Build message array: system + history + current user message
  const messages: Array<{ role: string; content: string; tool_call_id?: string }> = [
    { role: 'system', content: systemPrompt },
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: userMessage },
  ]

  // Collect side effects across turns
  const allSideEffects: Record<string, unknown>[] = []

  // Multi-turn loop: keep going until LLM stops calling tools
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await chatWithTools(messages, allTools)

    // No tool calls → final answer
    if (response.toolCalls.length === 0) {
      return buildResult(response.content ?? '你好！有什么我能帮你的？', allSideEffects)
    }

    // Append assistant message with tool calls (required by OpenAI protocol)
    messages.push({
      role: 'assistant',
      content: response.content ?? '',
      ...({ tool_calls: response.toolCalls } as any),
    })

    // Execute each tool call and append results
    for (const call of response.toolCalls) {
      const skill = toolToSkill.get(call.function.name)
      let result: ToolResult

      if (!skill) {
        result = { content: `未知工具: ${call.function.name}` }
      } else {
        try {
          const args = JSON.parse(call.function.arguments)
          result = await skill.execute(call.function.name, args, context)
        } catch (err) {
          result = { content: `工具执行出错: ${(err as Error).message}` }
        }
      }

      // Collect side effects (e.g. imageUrls)
      if (result.sideEffects) {
        allSideEffects.push(result.sideEffects)
      }

      // Append tool result for next LLM turn
      messages.push({
        role: 'tool',
        content: result.content,
        tool_call_id: call.id,
      })
    }
  }

  // Exhausted max turns — return last content
  return buildResult('处理完成。', allSideEffects)
}

function buildResult(reply: string, sideEffects: Record<string, unknown>[]): AgentResult {
  const imageUrls = sideEffects
    .filter((e) => Array.isArray(e.imageUrls))
    .flatMap((e) => e.imageUrls as string[])

  return {
    reply,
    ...(imageUrls.length > 0 ? { imageUrls } : {}),
  }
}
