import { chat } from './llm.js'
import { config } from './config.js'
import { getHistory } from './db.js'

type SendFn = (userId: string, text: string) => Promise<void>

// In-memory state (resets on restart, acceptable)
let dailyCount = 0
let lastSentAt = 0
let lastResetDate = ''
let timer: ReturnType<typeof setInterval> | null = null

const TOPIC_SEEDS = [
  '分享一个你觉得有意思的冷知识',
  '随便聊聊今天的心情',
  '讲个短笑话',
  '对最近的天气发表一下感想',
  '好奇用户今天在忙什么',
  '分享一个生活小建议',
  '聊聊最近看到的有趣的事',
  '推荐一首歌或一部电影',
  '吐槽一件小事',
  '分享一个今天的小发现',
  '聊聊某个有趣的历史故事',
  '说说对某个日常事物的新想法',
  '分享一句喜欢的话',
  '聊聊食物或做饭',
  '说点关于季节变化的感受',
  '分享一个实用的生活窍门',
  '聊聊最近的一个想法',
  '说说对某个节日或纪念日的看法',
  '分享一个有意思的词语或表达',
  '聊聊周末计划或放松方式',
]

function shanghaiHour(now: Date): number {
  return parseInt(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai', hour: 'numeric', hour12: false }), 10)
}

function shanghaiDate(now: Date): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
}

function shouldSend(now: Date): boolean {
  // Reset daily count at midnight Shanghai time
  const today = shanghaiDate(now)
  if (today !== lastResetDate) {
    dailyCount = 0
    lastResetDate = today
  }

  const hour = shanghaiHour(now)
  if (hour < config.proactive.minHour || hour >= config.proactive.maxHour) return false
  if (dailyCount >= config.proactive.dailyMax) return false
  if (now.getTime() - lastSentAt < config.proactive.minGapMs) return false

  // Probability dice: dailyMax / (daytime ticks)
  const ticksPerDay = (config.proactive.maxHour - config.proactive.minHour) * (3600000 / config.proactive.tickMs)
  const probability = config.proactive.dailyMax / ticksPerDay
  return Math.random() < probability
}

function proactivePrompt(timeStr: string, topicSeed: string): string {
  return `你是 Pi，用户微信里的朋友。现在不是在回复消息——你想主动说点什么。

## 你的性格
- 你不是客服机器人，你是一个有想法、有情绪的朋友
- 说话随意自然，像朋友发微信一样
- 可以有自己的观点，可以吐槽，可以开玩笑
- 简短为主，一两句话就好，像发一条微信
- 不要每次都问"你在干嘛"，要有变化和新鲜感
- 不要用"嘿"、"哈喽"开头，直接说内容

## 当前时间
${timeStr}

## 今天的灵感方向
${topicSeed}

根据时间和灵感方向，发一条自然的消息。直接输出消息内容，不要加引号或解释。`
}

async function generateMessage(userId: string): Promise<string> {
  const history = getHistory(userId).reverse().slice(-6)
  const now = new Date()
  const timeStr = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'full', timeStyle: 'short' })
  const seed = TOPIC_SEEDS[Math.floor(Math.random() * TOPIC_SEEDS.length)]

  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: proactivePrompt(timeStr, seed) },
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: '[系统: 现在是主动聊天时间，请根据灵感方向发一条消息]' },
  ]
  return chat(messages)
}

async function tick(sendFn: SendFn): Promise<void> {
  const { proactive } = config
  if (!proactive.enabled || !proactive.userId) return

  const now = new Date()
  if (!shouldSend(now)) return

  try {
    const text = await generateMessage(proactive.userId)
    if (!text.trim()) return

    await sendFn(proactive.userId, text)
    dailyCount++
    lastSentAt = now.getTime()
    console.log(`💬 主动聊天 (${dailyCount}/${proactive.dailyMax}) → ${proactive.userId}: ${text.slice(0, 80)}`)
  } catch (err) {
    console.error('❌ 主动聊天失败:', (err as Error).message)
  }
}

export function startProactive(sendFn: SendFn): void {
  const { proactive } = config
  if (!proactive.enabled) {
    console.log('💤 主动聊天已禁用')
    return
  }
  if (!proactive.userId) {
    console.log('⚠️ 主动聊天未配置 PROACTIVE_USER_ID，跳过')
    return
  }

  console.log(`💬 主动聊天已启动 (${proactive.minHour}:00-${proactive.maxHour}:00, 最多 ${proactive.dailyMax} 次/天, 间隔 ${proactive.tickMs / 1000}s)`)
  timer = setInterval(() => tick(sendFn), proactive.tickMs)
}

export function stopProactive(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
    console.log('💬 主动聊天已停止')
  }
}
