// wechat-cli skill —— 通过本机 wechat-cli 查询/分析/发送微信数据。
//
// wechat-cli 是 macOS-only 工具，读取本机微信本地库。pi-assistant 跑在 Linux VPS 时
// 该二进制通常不存在 —— 此时 skill 不会崩溃，而是返回清晰的"未安装"提示。
//
// 安全：所有聊天名/关键词均来自用户/LLM，全程用 execFile + argv 数组传参，
// 绝不拼 shell 字符串，杜绝命令注入。
//
// 配置（config.wechatCli）：
//   WECHAT_CLI_ENABLED=false        关闭整个 skill
//   WECHAT_CLI_BIN=/abs/wechat-cli  覆盖二进制路径（systemd PATH 常不含 homebrew）
//   WECHAT_CLI_SEND_ENABLED=false   仅熔断 send（写操作），读能力不受影响
//   WECHAT_CLI_TIMEOUT_MS / WECHAT_CLI_MAX_OUTPUT  调参
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { config } from '../config.js'
import type { Skill, ToolResult, ToolDef } from './types.js'

const execFileAsync = promisify(execFile)

/** 二进制路径解析：env 覆盖优先，否则按常见安装位置兜底 */
function resolveBin(): string {
  const configured = config.wechatCli.binPath
  if (configured.includes('/')) return configured
  const candidates = [
    '/opt/homebrew/bin/wechat-cli',
    '/usr/local/bin/wechat-cli',
  ]
  const found = candidates.find((p) => existsSync(p))
  return found ?? configured // 退回裸名，依赖 PATH
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n…（输出已截断，原始 ${text.length} 字符；请用更窄的时间范围或更小的 limit 重试）`
}

const MSG_TYPES = [
  'text', 'image', 'voice', 'video', 'sticker',
  'location', 'link', 'file', 'call', 'system',
] as const

/** 执行 wechat-cli，统一错误处理 */
async function run(args: ReadonlyArray<string>): Promise<ToolResult> {
  if (!config.wechatCli.enabled) {
    return { content: 'wechat-cli 技能已被管理员禁用（WECHAT_CLI_ENABLED=false）。' }
  }

  const bin = resolveBin()
  try {
    const { stdout, stderr } = await execFileAsync(bin, [...args], {
      timeout: config.wechatCli.timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      encoding: 'utf8',
      windowsHide: true,
    })
    const out = (stdout ?? '').trim()
    const err = (stderr ?? '').trim()
    const body = out || (err ? `（stderr）${err}` : '（无输出）')
    return { content: truncate(body, config.wechatCli.maxOutputChars) }
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      stdout?: string
      stderr?: string
      code?: number | string
      killed?: boolean
      signal?: string
    }
    if (e.code === 'ENOENT') {
      return {
        content:
          `未找到 wechat-cli 可执行文件（已尝试: ${bin}）。\n` +
          'wechat-cli 是 macOS-only 工具，需在本机安装并 `wechat-cli init` 初始化；' +
          '若已安装，请用环境变量 WECHAT_CLI_BIN 指定绝对路径。',
      }
    }
    if (e.killed && e.signal === 'SIGTERM') {
      return { content: `wechat-cli 执行超时（${config.wechatCli.timeoutMs}ms 后被终止）。请缩小查询范围后重试。` }
    }
    const detail = (e.stderr ?? '').trim() || (e.stdout ?? '').trim() || String(e.message ?? '未知错误')
    return { content: `wechat-cli 执行失败：${truncate(detail, config.wechatCli.maxOutputChars)}` }
  }
}

/** 可选参数 → argv 片段（不可变：始终返回新数组） */
function optStr(flag: string, v: unknown): string[] {
  const s = typeof v === 'string' ? v.trim() : ''
  return s ? [flag, s] : []
}
function optNum(flag: string, v: unknown): string[] {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? [flag, String(Math.floor(n))] : []
}
function optEnum(flag: string, v: unknown, allowed: ReadonlyArray<string>): string[] {
  const s = typeof v === 'string' ? v.trim() : ''
  return s && allowed.includes(s) ? [flag, s] : []
}

const tools: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'wechat_sessions',
      description: '获取最近的微信会话列表（按时间倒序，含群和单聊、未读数、最后一条消息）。',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'integer', description: '返回会话数，默认 20' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wechat_unread',
      description: '查看当前所有有未读消息的会话。',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'integer', description: '最多返回多少个未读会话' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wechat_new_messages',
      description: '获取自上次调用以来的增量新消息（首次调用返回当前未读并记录游标）。适合"有什么新消息"。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wechat_history',
      description: '获取与某个联系人或群的聊天记录。可按时间范围、消息类型过滤、分页。',
      parameters: {
        type: 'object',
        properties: {
          chat_name: { type: 'string', description: '联系人昵称/备注/群名' },
          limit: { type: 'integer', description: '返回条数，默认 50' },
          offset: { type: 'integer', description: '分页偏移量' },
          start_time: { type: 'string', description: '起始时间，如 2026-04-01 或 2026-04-01 09:00' },
          end_time: { type: 'string', description: '结束时间，同格式' },
          type: { type: 'string', enum: MSG_TYPES as unknown as string[], description: '只看某类型消息' },
        },
        required: ['chat_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wechat_search',
      description: '在微信消息内容里搜索关键词，可限定一个或多个聊天对象、时间范围、消息类型。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '搜索关键词' },
          chat: { type: 'array', items: { type: 'string' }, description: '限定的聊天对象（可多个）；不传则全局搜索' },
          start_time: { type: 'string', description: '起始时间' },
          end_time: { type: 'string', description: '结束时间' },
          limit: { type: 'integer', description: '返回数量，最大 500' },
          offset: { type: 'integer', description: '分页偏移量' },
          type: { type: 'string', enum: MSG_TYPES as unknown as string[], description: '消息类型过滤' },
        },
        required: ['keyword'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wechat_contacts',
      description: '搜索联系人或查看某个联系人详情（昵称/备注/wxid 均可）。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词，匹配昵称/备注/wxid' },
          detail: { type: 'string', description: '查看某联系人详情（传昵称/备注/wxid）；与 query 二选一' },
          limit: { type: 'integer', description: '返回数量' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wechat_members',
      description: '查询某个群聊的成员列表。',
      parameters: {
        type: 'object',
        properties: { group_name: { type: 'string', description: '群名' } },
        required: ['group_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wechat_stats',
      description: '对某个聊天做统计分析（消息量、活跃时段、参与者等），可限定时间范围。',
      parameters: {
        type: 'object',
        properties: {
          chat_name: { type: 'string', description: '联系人或群名' },
          start_time: { type: 'string', description: '起始时间' },
          end_time: { type: 'string', description: '结束时间' },
        },
        required: ['chat_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wechat_favorites',
      description: '查看/搜索微信收藏，可按类型过滤（text/image/article/card/video）。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '关键词搜索' },
          type: {
            type: 'string',
            enum: ['text', 'image', 'article', 'card', 'video'],
            description: '按类型过滤',
          },
          limit: { type: 'integer', description: '返回数量' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wechat_export',
      description: '把某个聊天的记录导出为 markdown 或纯文本（直接返回内容，过长会截断）。适合"整理/汇总某群聊天记录"。',
      parameters: {
        type: 'object',
        properties: {
          chat_name: { type: 'string', description: '联系人或群名' },
          format: { type: 'string', enum: ['markdown', 'txt'], description: '导出格式，默认 markdown' },
          start_time: { type: 'string', description: '起始时间' },
          end_time: { type: 'string', description: '结束时间' },
          limit: { type: 'integer', description: '导出条数（建议设置，避免输出过大）' },
        },
        required: ['chat_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wechat_send',
      description:
        '向指定微信联系人/群发送一条文本消息（写操作，会真实发出）。仅当用户明确要求"发/回复/转告某人某内容"时调用。',
      parameters: {
        type: 'object',
        properties: {
          contact: { type: 'string', description: '收件人：联系人昵称/备注/群名/wxid' },
          message: { type: 'string', description: '要发送的文本内容' },
        },
        required: ['contact', 'message'],
      },
    },
  },
]

const skill: Skill = {
  name: 'wechat-cli',
  description:
    '查询/分析/发送本机微信数据（wechat-cli，macOS）。当用户想"看最近会话/未读消息"、' +
    '"查某人或某群的聊天记录"、"在聊天里搜关键词"、"找联系人/看群成员"、"统计群活跃度"、' +
    '"看微信收藏"、"导出/汇总某群聊天记录"、或"帮我给某人发条微信"时使用。',
  tools,

  async execute(toolName, args, context): Promise<ToolResult> {
    switch (toolName) {
      case 'wechat_sessions':
        return run(['sessions', '--format', 'json', ...optNum('--limit', args.limit)])

      case 'wechat_unread':
        return run(['unread', '--format', 'json', ...optNum('--limit', args.limit)])

      case 'wechat_new_messages':
        return run(['new-messages', '--format', 'json'])

      case 'wechat_history': {
        const chat = String(args.chat_name ?? '').trim()
        if (!chat) return { content: '请提供聊天对象（chat_name）。' }
        return run([
          'history', chat, '--format', 'json',
          ...optNum('--limit', args.limit),
          ...optNum('--offset', args.offset),
          ...optStr('--start-time', args.start_time),
          ...optStr('--end-time', args.end_time),
          ...optEnum('--type', args.type, MSG_TYPES),
        ])
      }

      case 'wechat_search': {
        const kw = String(args.keyword ?? '').trim()
        if (!kw) return { content: '请提供搜索关键词（keyword）。' }
        const chats = Array.isArray(args.chat)
          ? (args.chat as unknown[])
              .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
              .flatMap((c) => ['--chat', c.trim()])
          : []
        return run([
          'search', kw, '--format', 'json',
          ...chats,
          ...optStr('--start-time', args.start_time),
          ...optStr('--end-time', args.end_time),
          ...optNum('--limit', args.limit),
          ...optNum('--offset', args.offset),
          ...optEnum('--type', args.type, MSG_TYPES),
        ])
      }

      case 'wechat_contacts': {
        const detail = typeof args.detail === 'string' ? args.detail.trim() : ''
        if (detail) {
          return run(['contacts', '--detail', detail, '--format', 'json'])
        }
        return run([
          'contacts', '--format', 'json',
          ...optStr('--query', args.query),
          ...optNum('--limit', args.limit),
        ])
      }

      case 'wechat_members': {
        const group = String(args.group_name ?? '').trim()
        if (!group) return { content: '请提供群名（group_name）。' }
        return run(['members', group, '--format', 'json'])
      }

      case 'wechat_stats': {
        const chat = String(args.chat_name ?? '').trim()
        if (!chat) return { content: '请提供聊天对象（chat_name）。' }
        return run([
          'stats', chat, '--format', 'json',
          ...optStr('--start-time', args.start_time),
          ...optStr('--end-time', args.end_time),
        ])
      }

      case 'wechat_favorites':
        return run([
          'favorites', '--format', 'json',
          ...optStr('--query', args.query),
          ...optEnum('--type', args.type, ['text', 'image', 'article', 'card', 'video']),
          ...optNum('--limit', args.limit),
        ])

      case 'wechat_export': {
        const chat = String(args.chat_name ?? '').trim()
        if (!chat) return { content: '请提供聊天对象（chat_name）。' }
        const fmt = args.format === 'txt' ? 'txt' : 'markdown'
        return run([
          'export', chat, '--format', fmt,
          ...optStr('--start-time', args.start_time),
          ...optStr('--end-time', args.end_time),
          ...optNum('--limit', args.limit),
        ])
      }

      case 'wechat_send': {
        if (!config.wechatCli.sendEnabled) {
          return { content: 'wechat-cli 发送功能已被管理员禁用（WECHAT_CLI_SEND_ENABLED=false），仅支持查询。' }
        }
        const contact = String(args.contact ?? '').trim()
        const message = String(args.message ?? '').trim()
        if (!contact) return { content: '请提供收件人（contact）。' }
        if (!message) return { content: '消息内容不能为空（message）。' }
        if (context.sendMessage) {
          await context.sendMessage(`正在通过微信发送给「${contact}」…`)
        }
        // --yes 跳过二次确认（按需求："发消息也自动"）
        return run(['send', contact, message, '--yes', '--format', 'json'])
      }

      default:
        return { content: `未知操作: ${toolName}` }
    }
  },
}

export default skill
