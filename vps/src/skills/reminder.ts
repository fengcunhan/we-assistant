import { createCronJob, getCronJobs, deleteCronJob } from '../db.js'
import { computeNextRunAt, registerJobExecutor } from '../scheduler.js'
import type { Skill, ToolResult } from './types.js'

// 动态提醒: 到点时把存储的指令交给完整 Agent 实时执行，发送新生成的内容（可含图片）
registerJobExecutor('agent_prompt', async (job) => {
  const { runAgent } = await import('../agent.js')
  const prompt = `[定时任务自动触发] 现在请直接执行下面这条指令，并把结果整理成一条可以直接发给用户的微信消息。不要说"好的""我来帮你查"之类的开场白，不要反问用户，直接给结果：\n\n${job.payload}`
  const result = await runAgent(prompt, job.bot_id, job.user_id, [])
  return { content: result.reply, imageUrls: result.imageUrls }
})

const skill: Skill = {
  name: 'reminder',
  description:
    '当用户想设置提醒、定时任务、闹钟时使用。支持两种内容: 固定文本提醒(如"提醒我明天下午3点开会")、以及到点时实时生成的动态内容(如"每天早上8点告诉我今天天气""每天晚上汇总我今天的日程""每周一发我本周新闻摘要")。',
  tools: [
    {
      type: 'function',
      function: {
        name: 'create_reminder',
        description: '创建一个定时提醒。支持一次性/重复，以及固定文本或到点实时生成的动态内容。',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '提醒名称/描述' },
            schedule_kind: {
              type: 'string',
              enum: ['at', 'every', 'cron'],
              description: 'at=一次性(指定时间), every=固定间隔(毫秒), cron=每天定时(HH:MM格式)',
            },
            schedule_value: {
              type: 'string',
              description: 'at: ISO时间如"2026-04-02T15:00:00"; every: 毫秒间隔如"3600000"; cron: 时间如"09:00"',
            },
            content_mode: {
              type: 'string',
              enum: ['static', 'dynamic'],
              description:
                '由你在创建时判断: static=固定文本，到点原样发送(如"提醒我开会"、"该吃药了"); dynamic=到点时让 AI 实时执行 message 里的指令再发结果，适用于任何需要实时数据/检索/计算的内容(如"今天的天气""我今天的日程汇总""最新新闻摘要""我的待办")。拿不准且内容会随时间变化时选 dynamic。',
            },
            message: {
              type: 'string',
              description:
                'static 模式: 到点原样发送的文本。dynamic 模式: 到点时交给 AI 执行的指令，要写成完整明确的祈使句(如"查询上海今天的天气并用一句话概括"、"汇总用户今天的日程和待办")。',
            },
          },
          required: ['name', 'schedule_kind', 'schedule_value', 'content_mode', 'message'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_reminders',
        description: '列出用户当前的所有提醒/定时任务',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'delete_reminder',
        description: '删除一个提醒',
        parameters: {
          type: 'object',
          properties: {
            reminder_id: { type: 'string', description: '要删除的提醒ID' },
          },
          required: ['reminder_id'],
        },
      },
    },
  ],

  async execute(toolName, args, context): Promise<ToolResult> {
    if (toolName === 'create_reminder') {
      return createReminder(args, context.botId, context.userId)
    }
    if (toolName === 'list_reminders') {
      return listReminders(context.botId, context.userId)
    }
    if (toolName === 'delete_reminder') {
      return deleteReminder(args.reminder_id as string)
    }
    return { content: '未知操作' }
  },
}

function createReminder(args: Record<string, unknown>, botId: string, userId: string): ToolResult {
  const id = `rem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const kind = args.schedule_kind as 'at' | 'every' | 'cron'
  const value = args.schedule_value as string
  const name = args.name as string
  const message = args.message as string
  const isDynamic = args.content_mode === 'dynamic'
  const jobType = isDynamic ? 'agent_prompt' : 'message'

  // Compute first run time
  let nextRunAt: number | null = null
  if (kind === 'at') {
    const ms = new Date(value).getTime()
    if (!Number.isFinite(ms) || ms <= Date.now()) {
      return { content: '提醒时间无效或已过期，请检查时间格式。' }
    }
    nextRunAt = ms
  } else {
    const tempJob = {
      id, bot_id: botId, name, user_id: userId, schedule_kind: kind, schedule_value: value,
      schedule_tz: 'Asia/Shanghai', payload: message, enabled: 1,
      next_run_at: null, last_run_at: null, last_status: null, job_type: jobType,
      created_at: 0, updated_at: 0,
    }
    nextRunAt = computeNextRunAt(tempJob, Date.now())
    if (!nextRunAt) {
      return { content: '无法计算下次执行时间，请检查时间格式。' }
    }
  }

  createCronJob({
    id, bot_id: botId, name, user_id: userId, schedule_kind: kind, schedule_value: value,
    schedule_tz: 'Asia/Shanghai', payload: message, enabled: 1,
    next_run_at: nextRunAt, last_run_at: null, last_status: null, job_type: jobType,
  })

  const nextDate = new Date(nextRunAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
  const kindLabel = kind === 'at' ? '一次性' : kind === 'every' ? '重复' : '每日'
  const modeLabel = isDynamic ? '动态(到点实时生成)' : '固定文本'
  const msgLabel = isDynamic ? '指令' : '消息'
  return {
    content: `提醒已创建！\n- 名称: ${name}\n- 类型: ${kindLabel}\n- 内容: ${modeLabel}\n- 下次触发: ${nextDate}\n- ${msgLabel}: ${message}\n- ID: ${id}`,
  }
}

function listReminders(botId: string, userId: string): ToolResult {
  const jobs = getCronJobs(botId, userId)
  if (jobs.length === 0) {
    return { content: '你目前没有任何提醒。' }
  }

  const lines = jobs.map((j, i) => {
    const status = j.enabled ? '✅' : '⏸️'
    const nextRun = j.next_run_at
      ? new Date(j.next_run_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
      : '无'
    const kindLabel = j.schedule_kind === 'at' ? '一次性' : j.schedule_kind === 'every' ? '重复' : '每日'
    const modeLabel = j.job_type === 'agent_prompt' ? '动态' : '固定'
    return `${i + 1}. ${status} [${kindLabel}·${modeLabel}] ${j.name}\n   下次: ${nextRun} | ID: ${j.id}`
  })

  return { content: `你的提醒列表:\n${lines.join('\n')}` }
}

function deleteReminder(id: string): ToolResult {
  deleteCronJob(id)
  return { content: `提醒 ${id} 已删除。` }
}

export default skill
