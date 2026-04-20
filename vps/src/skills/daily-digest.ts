import {
  getConversationsByDateRange,
  getImageCaptionsByDateRange,
  getCronJobs,
  createCronJob,
  updateCronJob,
} from '../db.js'
import { computeNextRunAt, registerJobExecutor } from '../scheduler.js'
import { chat } from '../llm.js'
import type { Skill, ToolResult } from './types.js'

const TZ = 'Asia/Shanghai'
const MAX_CHARS = 30_000

// --- Date helpers ---

function dateToRange(dateStr: string): { startMs: number; endMs: number } {
  const [y, m, d] = dateStr.split('-').map(Number)
  const startMs = zonedMidnightToUtcMs(y, m, d)
  const endMs = zonedMidnightToUtcMs(y, m, d + 1)
  return { startMs, endMs }
}

function zonedMidnightToUtcMs(y: number, m: number, d: number): number {
  const guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0))
  const utcStr = guess.toLocaleString('en-US', { timeZone: 'UTC' })
  const tzStr = guess.toLocaleString('en-US', { timeZone: TZ })
  const offsetMs = new Date(utcStr).getTime() - new Date(tzStr).getTime()
  return guess.getTime() + offsetMs
}

function getTodayDateStr(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ })
}

function getYesterdayDateStr(): string {
  const yesterday = new Date(Date.now() - 86_400_000)
  return yesterday.toLocaleDateString('en-CA', { timeZone: TZ })
}

function getShanghaiHour(): number {
  return parseInt(
    new Date().toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }),
    10,
  )
}

/** For scheduled push: 0:00~12:00 → yesterday, 12:00~24:00 → today */
function computeTargetDate(): string {
  return getShanghaiHour() < 12 ? getYesterdayDateStr() : getTodayDateStr()
}

// --- Core summarization ---

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
}

interface TimelineEntry {
  timestamp: number
  text: string
  kind: 'conversation' | 'image'
}

function buildTimeline(
  conversations: Array<{ role: string; content: string; timestamp: number }>,
  imageCaptions: Array<{ content: string; media_url: string | null; timestamp: number }>,
): string {
  const entries: TimelineEntry[] = []

  for (const msg of conversations) {
    const label = msg.role === 'user' ? '用户' : 'Pi'
    entries.push({ timestamp: msg.timestamp, text: `[${formatTime(msg.timestamp)}] ${label}: ${msg.content}`, kind: 'conversation' })
  }

  for (const img of imageCaptions) {
    entries.push({ timestamp: img.timestamp, text: `[${formatTime(img.timestamp)}] [图片内容: ${img.content}]`, kind: 'image' })
  }

  entries.sort((a, b) => a.timestamp - b.timestamp)

  // Truncate if exceeding MAX_CHARS, keeping the most recent entries + all image captions
  const joined = entries.map((e) => e.text).join('\n')
  if (joined.length <= MAX_CHARS) return joined

  // Keep all image captions, truncate conversations from the beginning
  const imageEntries = entries.filter((e) => e.kind === 'image')
  const convEntries = entries.filter((e) => e.kind === 'conversation')
  const imageJoined = imageEntries.map((e) => e.text).join('\n')
  const remaining = MAX_CHARS - imageJoined.length - 100 // buffer for separator

  // Take the most recent conversation entries that fit
  const kept: TimelineEntry[] = []
  let total = 0
  for (let i = convEntries.length - 1; i >= 0; i--) {
    if (total + convEntries[i].text.length + 1 > remaining) break
    kept.unshift(convEntries[i])
    total += convEntries[i].text.length + 1
  }

  const truncatedCount = convEntries.length - kept.length
  const prefix = truncatedCount > 0 ? `(已省略前 ${truncatedCount} 条对话)\n` : ''

  // Re-merge image captions into the kept conversations by timestamp
  const merged = [...kept, ...imageEntries].sort((a, b) => a.timestamp - b.timestamp)

  return prefix + merged.map((e) => e.text).join('\n')
}

const SUMMARY_SYSTEM_PROMPT = `你是一个聊天内容总结助手。请根据以下一天的聊天记录生成一份简洁的日报摘要。

要求:
1. 关键信息: 提取对话中的重要信息点，包括图片描述中的关键内容
2. 待办事项: 从对话中提取明确或隐含的待办/行动项
3. 内容详略得当，突出重点，不要逐条复述对话

严格禁止: 不要使用任何 markdown 语法！不要用 **加粗**、不要用 ---分割线、不要用 # 标题。这是微信消息，不支持 markdown 渲染。

输出格式:

📋 {date} 聊天总结

【关键信息】
- 要点1
- 要点2

【待办事项】
- 待办1
- 待办2

【今日回顾】
一段简要的总结性文字

如果当天没有重要信息或待办事项，对应部分可以省略。`

async function generateDailySummary(userId: string, dateStr: string): Promise<string> {
  const { startMs, endMs } = dateToRange(dateStr)
  const conversations = getConversationsByDateRange(userId, startMs, endMs)
  const imageCaptions = getImageCaptionsByDateRange(userId, startMs, endMs)

  if (conversations.length === 0 && imageCaptions.length === 0) {
    return `${dateStr} 没有聊天记录。`
  }

  const timeline = buildTimeline(conversations, imageCaptions)
  const prompt = SUMMARY_SYSTEM_PROMPT.replace('{date}', dateStr)

  const summary = await chat([
    { role: 'system', content: prompt },
    { role: 'user', content: `以下是 ${dateStr} 的聊天记录:\n\n${timeline}` },
  ])

  return summary
}

// --- Register scheduler executor ---

registerJobExecutor('daily_summary', async (job) => {
  const targetDate = computeTargetDate()
  return generateDailySummary(job.user_id, targetDate)
})

// --- Skill definition ---

const skill: Skill = {
  name: 'daily-digest',
  description:
    '生成每日聊天总结摘要。用户说"总结今天的聊天"、"帮我回顾一下昨天聊了什么"时使用，也可以设置每天定时推送摘要或关闭定时推送。',
  tools: [
    {
      type: 'function',
      function: {
        name: 'generate_summary',
        description: '生成指定日期的聊天总结。不传 date 则默认今天。',
        parameters: {
          type: 'object',
          properties: {
            date: {
              type: 'string',
              description: '日期，格式 YYYY-MM-DD，如 "2026-04-07"。不传则默认今天。',
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'enable_daily_digest',
        description: '启用每日聊天总结定时推送。指定每天推送的时间。',
        parameters: {
          type: 'object',
          properties: {
            time: {
              type: 'string',
              description: '每天推送时间，HH:MM 格式，如 "21:00"',
            },
          },
          required: ['time'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'disable_daily_digest',
        description: '关闭每日聊天总结定时推送',
        parameters: { type: 'object', properties: {} },
      },
    },
  ],

  async execute(toolName, args, context): Promise<ToolResult> {
    if (toolName === 'generate_summary') {
      const dateStr = (args.date as string) || getTodayDateStr()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return { content: '日期格式无效，请使用 YYYY-MM-DD 格式。' }
      }
      const summary = await generateDailySummary(context.userId, dateStr)
      return { content: summary, exclusive: true }
    }

    if (toolName === 'enable_daily_digest') {
      return enableDigest(args.time as string, context.userId)
    }

    if (toolName === 'disable_daily_digest') {
      return disableDigest(context.userId)
    }

    return { content: '未知操作' }
  },
}

// --- Enable / Disable ---

function enableDigest(time: string, userId: string): ToolResult {
  if (!/^\d{1,2}:\d{2}$/.test(time)) {
    return { content: '时间格式无效，请使用 HH:MM 格式（如 21:00）。' }
  }
  const [h, m] = time.split(':').map(Number)
  if (h < 0 || h > 23 || m < 0 || m > 59) {
    return { content: '时间超出范围，小时 0-23，分钟 0-59。' }
  }

  const existing = getCronJobs(userId).find((j) => j.job_type === 'daily_summary')

  if (existing) {
    const tempJob = { ...existing, schedule_value: time }
    const nextRunAt = computeNextRunAt(tempJob, Date.now())
    updateCronJob(existing.id, { schedule_value: time, enabled: 1, next_run_at: nextRunAt })
    const nextDate = nextRunAt
      ? new Date(nextRunAt).toLocaleString('zh-CN', { timeZone: TZ })
      : '未知'
    return { content: `每日摘要已更新！每天 ${time} 推送。下次推送: ${nextDate}` }
  }

  const id = `digest_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const tempJob = {
    id,
    name: '每日聊天总结',
    user_id: userId,
    schedule_kind: 'cron' as const,
    schedule_value: time,
    schedule_tz: TZ,
    payload: '{}',
    enabled: 1,
    next_run_at: null as number | null,
    last_run_at: null,
    last_status: null,
    job_type: 'daily_summary' as const,
  }
  tempJob.next_run_at = computeNextRunAt(tempJob, Date.now())

  createCronJob(tempJob)

  const nextDate = tempJob.next_run_at
    ? new Date(tempJob.next_run_at).toLocaleString('zh-CN', { timeZone: TZ })
    : '未知'
  return { content: `每日摘要已开启！每天 ${time} 推送聊天总结。\n下次推送: ${nextDate}\nID: ${id}` }
}

function disableDigest(userId: string): ToolResult {
  const existing = getCronJobs(userId).find((j) => j.job_type === 'daily_summary')
  if (!existing) {
    return { content: '你还没有设置每日摘要推送。' }
  }
  updateCronJob(existing.id, { enabled: 0 })
  return { content: '每日摘要推送已关闭。你可以随时重新开启。' }
}

export default skill
