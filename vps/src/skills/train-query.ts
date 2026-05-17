// 火车票查询 skill —— 数据源途牛接口，有瑞数 WAF，用无头浏览器 + 反检测过墙。
// 进程内复用一个已过 WAF 的浏览器上下文：首次慢(过挑战)，之后命中 Cookie 秒回。
// 依赖：playwright（VPS 需 npx playwright install --with-deps chromium）。
import type { Skill, ToolResult } from './types.js'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'

const HOME = 'https://huoche.tuniu.com/'
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const WAF_TIMEOUT_MS = 30000
const MAX_TRAINS = 12

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

interface Session {
  browser: Browser
  context: BrowserContext
  page: Page
}

// 进程内单例，懒加载，失效时自动重建
let session: Session | null = null

function buildApiUrl(date: string, from: string, to: string): string {
  const params = new URLSearchParams({
    r: 'train/trainTicket/getTickets',
    'primary[departureDate]': date,
    'primary[departureCityName]': from,
    'primary[arrivalCityName]': to,
  })
  return `https://huoche.tuniu.com/yii.php?${params.toString()}`
}

async function createSession(): Promise<Session> {
  // headless:false 让 Playwright 选用完整 chromium 二进制（非 headless-shell），
  // 再用 --headless=new 真无头运行（无显示器服务器免 xvfb，且更不易被瑞数识别）
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--headless=new',
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  })
  const context = await browser.newContext({
    userAgent: UA,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    viewport: { width: 1280, height: 800 },
  })
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] })
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] })
    // @ts-ignore
    window.chrome = { runtime: {} }
  })
  const page = await context.newPage()
  await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: WAF_TIMEOUT_MS })
  await waitWafCleared(page)
  return { browser, context, page }
}

async function waitWafCleared(page: Page): Promise<void> {
  const deadline = Date.now() + WAF_TIMEOUT_MS
  while (Date.now() < deadline) {
    await sleep(800)
    const ok = await page
      .evaluate(
        () =>
          document.readyState === 'complete' &&
          location.host === 'huoche.tuniu.com' &&
          !document.getElementById('_rspj')
      )
      .catch(() => false)
    if (ok) return
  }
  throw new Error('WAF 反爬校验未在 30s 内通过')
}

async function disposeSession(): Promise<void> {
  const s = session
  session = null
  if (s) {
    try {
      await s.browser.close()
    } catch {
      // 忽略关闭异常
    }
  }
}

// 在已过 WAF 的页面里同源 fetch；返回 null 表示被 WAF 二次挑战（需重建会话重试）
async function fetchTicketsOnce(page: Page, apiUrl: string): Promise<unknown | null> {
  const body: string = await page.evaluate(
    (u) => fetch(u, { credentials: 'include' }).then((r) => r.text()),
    apiUrl
  )
  const text = body.trim()
  if (!text.startsWith('{') && !text.startsWith('[')) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// 接口一次返回全部车次（不分页），翻页是对完整列表的展示分页。
// 轻量缓存：同路线+日期短时复用，避免每次翻页都重打 WAF。
interface CacheEntry {
  data: unknown
  ts: number
}
const CACHE_TTL_MS = 120000
const cache = new Map<string, CacheEntry>()

async function fetchTickets(date: string, from: string, to: string): Promise<unknown> {
  const key = `${date}|${from}|${to}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
    return hit.data
  }

  const apiUrl = buildApiUrl(date, from, to)

  for (let attempt = 1; attempt <= 2; attempt++) {
    if (!session) {
      session = await createSession()
    }
    try {
      const data = await fetchTicketsOnce(session.page, apiUrl)
      if (data !== null) {
        cache.set(key, { data, ts: Date.now() })
        return data
      }
    } catch {
      // 页面/浏览器已失效，落到下面重建
    }
    // 命中 WAF 二次挑战或会话失效：销毁后重建重试一次
    await disposeSession()
    if (attempt === 2) {
      throw new Error('多次重试后仍被 WAF 拦截，未取得车次数据')
    }
    await sleep(1000)
  }
  throw new Error('未取得车次数据')
}

interface Price {
  seatName: string
  price: number
  leftNumber: number
  seatStatus: string
}
interface Train {
  trainNum: string
  trainTypeName: string
  departStationName: string
  destStationName: string
  departDepartTime: string
  destArriveTime: string
  durationStr: string
  prices: Price[]
}

function formatPrice(p: Price): string {
  const left =
    p.seatStatus && p.seatStatus !== '' ? p.seatStatus : p.leftNumber > 0 ? `${p.leftNumber}` : '无'
  return `${p.seatName}¥${p.price}(${left})`
}

function formatTrain(t: Train): string {
  const seats = (t.prices || [])
    .filter((p) => p.price > 0 && p.seatName)
    .map(formatPrice)
    .join(' ')
  return (
    `🚄 ${t.trainNum} ${t.departStationName}${t.departDepartTime} → ` +
    `${t.destStationName}${t.destArriveTime} (${t.durationStr})\n   ${seats}`
  )
}

function formatResult(
  date: string,
  from: string,
  to: string,
  data: any,
  page: number
): string {
  const d = data?.data
  if (!d || !Array.isArray(d.list) || d.list.length === 0) {
    return `${date} ${from}→${to} 没有查询到车次。`
  }
  const typeSummary = (d.trainTypeDetails || [])
    .map((x: any) => `${x.trainTypeName}${x.number}`)
    .join(' / ')

  const total = d.list.length
  const totalPages = Math.ceil(total / MAX_TRAINS)
  const cur = Math.min(Math.max(1, Math.floor(page) || 1), totalPages)
  const start = (cur - 1) * MAX_TRAINS
  const shown = d.list.slice(start, start + MAX_TRAINS) as Train[]
  const lines = shown.map(formatTrain).join('\n')

  const header = `📅 ${date} ${from} → ${to}\n共 ${d.count} 趟（${typeSummary}）`
  const footer =
    totalPages > 1
      ? `\n\n— 第 ${cur}/${totalPages} 页（本页 ${start + 1}-${start + shown.length} 趟）` +
        (cur < totalPages ? `，说"下一页"或"第${cur + 1}页"看更多` : '，已是最后一页')
      : ''
  return `${header}\n\n${lines}${footer}`
}

const skill: Skill = {
  name: 'train-query',
  description:
    '查询火车票/高铁余票与价格。当用户问"某天从X到Y的火车票/高铁/动车"、车次时刻、票价余票时使用。',
  tools: [
    {
      type: 'function' as const,
      function: {
        name: 'query_train_tickets',
        description:
          '查询指定日期、出发城市到到达城市的火车票车次、时刻、票价和余票。' +
          '车次较多时分页显示，每页 12 趟；用户说"下一页/看后面/第N页"时用同样的日期和城市、带上对应 page 再调一次。',
        parameters: {
          type: 'object',
          properties: {
            departureDate: {
              type: 'string',
              description: '发车日期，必须是 yyyy-MM-dd 格式，如 2026-05-20',
            },
            departureCity: {
              type: 'string',
              description: "出发城市名，如 '北京'、'上海'、'杭州'",
            },
            arrivalCity: {
              type: 'string',
              description: "到达城市名，如 '北京'、'上海'、'杭州'",
            },
            page: {
              type: 'integer',
              description: '页码，从 1 开始，每页 12 趟。不传默认第 1 页。用户要看后续车次时传 2、3…',
            },
          },
          required: ['departureDate', 'departureCity', 'arrivalCity'],
        },
      },
    },
  ],

  async execute(
    _toolName: string,
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    const date = String(args.departureDate ?? '').trim()
    const from = String(args.departureCity ?? '').trim()
    const to = String(args.arrivalCity ?? '').trim()
    const page = Math.max(1, Number(args.page) || 1)

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { content: `发车日期格式不对："${date}"，需要 yyyy-MM-dd（如 2026-05-20）。` }
    }
    if (!from || !to) {
      return { content: '请提供出发城市和到达城市。' }
    }

    try {
      const data = await fetchTickets(date, from, to)
      return { content: formatResult(date, from, to, data, page) }
    } catch (err) {
      return {
        content: `火车票查询失败：${(err as Error).message}。可稍后再试。`,
      }
    }
  },
}

export default skill
