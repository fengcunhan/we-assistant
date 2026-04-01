import { createCronJob, getCronJobs, deleteCronJob } from '../db.js'
import { computeNextRunAt } from '../scheduler.js'
import type { Skill, ToolResult } from './types.js'

const skill: Skill = {
  name: 'reminder',
  description: '当用户想设置提醒、定时任务、闹钟时使用（如"提醒我明天下午3点开会"、"每天早上9点提醒我喝水"、"1小时后提醒我..."）',
  tools: [
    {
      type: 'function',
      function: {
        name: 'create_reminder',
        description: '创建一个定时提醒。支持一次性提醒和重复提醒。',
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
            message: { type: 'string', description: '提醒时发送的消息内容' },
          },
          required: ['name', 'schedule_kind', 'schedule_value', 'message'],
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
      return createReminder(args, context.userId)
    }
    if (toolName === 'list_reminders') {
      return listReminders(context.userId)
    }
    if (toolName === 'delete_reminder') {
      return deleteReminder(args.reminder_id as string)
    }
    return { content: '未知操作' }
  },
}

function createReminder(args: Record<string, unknown>, userId: string): ToolResult {
  const id = `rem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const kind = args.schedule_kind as 'at' | 'every' | 'cron'
  const value = args.schedule_value as string
  const name = args.name as string
  const message = args.message as string

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
      id, name, user_id: userId, schedule_kind: kind, schedule_value: value,
      schedule_tz: 'Asia/Shanghai', payload: message, enabled: 1,
      next_run_at: null, last_run_at: null, last_status: null, created_at: 0, updated_at: 0,
    }
    nextRunAt = computeNextRunAt(tempJob, Date.now())
    if (!nextRunAt) {
      return { content: '无法计算下次执行时间，请检查时间格式。' }
    }
  }

  createCronJob({
    id, name, user_id: userId, schedule_kind: kind, schedule_value: value,
    schedule_tz: 'Asia/Shanghai', payload: message, enabled: 1,
    next_run_at: nextRunAt, last_run_at: null, last_status: null,
  })

  const nextDate = new Date(nextRunAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
  const kindLabel = kind === 'at' ? '一次性' : kind === 'every' ? '重复' : '每日'
  return {
    content: `提醒已创建！\n- 名称: ${name}\n- 类型: ${kindLabel}\n- 下次触发: ${nextDate}\n- 消息: ${message}\n- ID: ${id}`,
  }
}

function listReminders(userId: string): ToolResult {
  const jobs = getCronJobs(userId)
  if (jobs.length === 0) {
    return { content: '你目前没有任何提醒。' }
  }

  const lines = jobs.map((j, i) => {
    const status = j.enabled ? '✅' : '⏸️'
    const nextRun = j.next_run_at
      ? new Date(j.next_run_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
      : '无'
    const kindLabel = j.schedule_kind === 'at' ? '一次性' : j.schedule_kind === 'every' ? '重复' : '每日'
    return `${i + 1}. ${status} [${kindLabel}] ${j.name}\n   下次: ${nextRun} | ID: ${j.id}`
  })

  return { content: `你的提醒列表:\n${lines.join('\n')}` }
}

function deleteReminder(id: string): ToolResult {
  deleteCronJob(id)
  return { content: `提醒 ${id} 已删除。` }
}

export default skill
