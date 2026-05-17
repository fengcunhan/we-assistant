// Shell skill —— 在 pi-assistant 所在主机执行命令行。
// 通过微信暴露 RCE，风险高：默认带超时、输出截断、灾难性命令拦截。
// 可用 SHELL_SKILL_ENABLED=false 关闭；SHELL_TIMEOUT_MS / SHELL_MAX_OUTPUT / SHELL_CWD 调参。
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { config } from '../config.js'
import type { Skill, ToolResult } from './types.js'

const execAsync = promisify(exec)

// 不可逆 / 高破坏性操作：宁可误拒也不执行
const DANGEROUS_PATTERNS: ReadonlyArray<RegExp> = [
  /\brm\s+(-[a-z]*\s+)*(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/i, // rm -rf 类
  /\bmkfs\b/i,
  /\bdd\b[^|]*\bof=\/dev\//i,
  /\b(shutdown|reboot|halt|poweroff|init\s+0|init\s+6)\b/i,
  /\b(:\s*\(\s*\)\s*\{|fork\s*bomb)/i, // :(){ :|:& };: fork bomb
  /\bchmod\s+-R\s+0*\s+\//i,
  />\s*\/dev\/(sd|nvme|hd)[a-z]/i,
  /\b(useradd|userdel|passwd)\b/i,
]

function isDangerous(command: string): boolean {
  return DANGEROUS_PATTERNS.some((re) => re.test(command))
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n…（已截断，共 ${text.length} 字符）`
}

function formatOutput(
  command: string,
  exitCode: number,
  stdout: string,
  stderr: string,
): string {
  const max = config.shell.maxOutputChars
  const parts = [`$ ${command}`, `退出码: ${exitCode}`]
  const out = stdout.trim()
  const err = stderr.trim()
  if (out) parts.push(`stdout:\n${truncate(out, max)}`)
  if (err) parts.push(`stderr:\n${truncate(err, max)}`)
  if (!out && !err) parts.push('(无输出)')
  return parts.join('\n\n')
}

async function runCommand(args: Record<string, unknown>): Promise<ToolResult> {
  if (!config.shell.enabled) {
    return { content: 'Shell 技能已被管理员禁用（SHELL_SKILL_ENABLED=false）。' }
  }

  const command = String(args.command ?? '').trim()
  if (!command) {
    return { content: '请提供要执行的命令。' }
  }
  if (isDangerous(command)) {
    return {
      content: `已拒绝执行：命令 "${command}" 命中高破坏性/不可逆操作黑名单，出于安全考虑不会运行。`,
    }
  }

  const cwd =
    typeof args.cwd === 'string' && args.cwd.trim()
      ? args.cwd.trim()
      : config.shell.cwd
  const timeoutMs =
    Number.isFinite(Number(args.timeout_ms)) && Number(args.timeout_ms) > 0
      ? Math.min(Number(args.timeout_ms), 600000)
      : config.shell.timeoutMs

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
      encoding: 'utf8',
    })
    return { content: formatOutput(command, 0, stdout, stderr) }
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      stdout?: string
      stderr?: string
      code?: number | string
      killed?: boolean
      signal?: string
    }
    if (e.killed && e.signal === 'SIGTERM') {
      return {
        content: `命令执行超时（${timeoutMs}ms 后被终止）：\n$ ${command}`,
      }
    }
    const exitCode = typeof e.code === 'number' ? e.code : 1
    return {
      content: formatOutput(command, exitCode, e.stdout ?? '', e.stderr ?? String(e.message ?? '')),
    }
  }
}

const skill: Skill = {
  name: 'shell',
  description:
    '在服务器本机执行命令行（bash）。当用户想查看服务器状态、磁盘/内存/进程、运维操作、跑脚本、看日志或文件时使用（如"看看磁盘空间"、"ps 一下 pi-assistant"、"重启某服务"、"tail 日志"）。高破坏性命令会被拦截。',
  tools: [
    {
      type: 'function' as const,
      function: {
        name: 'run_command',
        description:
          '在 pi-assistant 所在主机用 shell 执行一条命令，返回 stdout、stderr 和退出码。' +
          '支持管道/重定向。超时默认 30s，输出过长会被截断。',
        parameters: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: "要执行的 shell 命令，如 'df -h'、'free -m'、'systemctl status pi-assistant'",
            },
            cwd: {
              type: 'string',
              description: '工作目录（绝对路径）。不传则用默认目录。',
            },
            timeout_ms: {
              type: 'integer',
              description: '超时毫秒数，默认 30000，最大 600000。长任务可调大。',
            },
          },
          required: ['command'],
        },
      },
    },
  ],

  async execute(_toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    return runCommand(args)
  },
}

export default skill
