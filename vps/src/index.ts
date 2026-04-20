import { config } from './config'
import { getCredential, setCredential, getHistory, addMessage, logMedia, getRecentLogs, insertVector } from './db'
import { runAgent } from './agent'
import { getEmbedding, getMultimodalEmbedding } from './embedding'
import { getSignedUrl } from './cos'
import * as ilink from './ilink'
import type { Credentials } from './ilink'
import { startScheduler } from './scheduler'
import { startProactive } from './proactive'
import { initSkills } from './skill-loader'

// --- State ---

let creds: Credentials | null = null
let cursor = ''
let typingTicket = ''
let running = false

function loadCredentials(): boolean {
  const raw = getCredential('ilink_creds')
  if (!raw) return false
  creds = JSON.parse(raw)
  cursor = getCredential('ilink_cursor') ?? ''
  return true
}

function saveCredentials(): void {
  if (creds) setCredential('ilink_creds', JSON.stringify(creds))
}

function saveCursor(): void {
  setCredential('ilink_cursor', cursor)
}

// --- QR Login ---

async function login(): Promise<void> {
  console.log('🔐 获取登录二维码...')
  const { qrcode, qrcodeUrl } = await ilink.getQrCode(config.ilink.baseURL)
  console.log(`📱 请扫码登录: ${qrcodeUrl}`)
  console.log(`   或在浏览器打开上面的链接`)

  while (true) {
    const result = await ilink.pollQrStatus(config.ilink.baseURL, qrcode)
    if (result) {
      creds = result
      saveCredentials()
      console.log(`✅ 登录成功! Bot ID: ${creds.ilinkBotId}`)
      return
    }
    await new Promise(r => setTimeout(r, 2000))
  }
}

// --- Message handler ---

async function handleMessage(msg: ilink.ILinkMessage): Promise<void> {
  if (msg.message_type !== 1) return // only user messages

  const contactId = msg.from_user_id
  const { text, mediaPaths } = await ilink.extractContent(msg)

  console.log(`📨 ${contactId}: ${text.slice(0, 80)}`)

  // Log media
  for (const p of mediaPaths) {
    logMedia(contactId, 'inbound', p, 2, p)
  }

  // Embed images in background: VLM caption + text embedding + image embedding → vector DB
  for (const url of mediaPaths) {
    if (url.match(/\.(jpg|jpeg|png|gif|webp|bmp)/i)) {
      (async () => {
        try {
          const { isLocalPath, readMediaBytes } = await import('./media.js')
          const bytes = await readMediaBytes(url)
          const MAX_VLM_BYTES = 4 * 1024 * 1024
          if (bytes.byteLength > MAX_VLM_BYTES) {
            console.log(`🖼️ 图片过大 (${bytes.byteLength} bytes)，跳过 VLM 描述与图片检索索引`)
            return
          }
          const mime = url.toLowerCase().endsWith('.png') ? 'image/png'
            : url.toLowerCase().endsWith('.webp') ? 'image/webp'
            : url.toLowerCase().endsWith('.gif') ? 'image/gif'
            : 'image/jpeg'
          const dataUri = `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`

          // 1. VLM caption via DashScope (qwen3.5-27b)
          const captionRes = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${config.embedding.apiKey}`,
            },
            body: JSON.stringify({
              model: 'qwen3.5-27b',
              messages: [
                { role: 'system', content: '用中文简要描述这张图片的内容，包括主体、场景、颜色、风格等关键信息。只输出描述，不要其他内容。不要思考过程。' },
                { role: 'user', content: [{ type: 'image_url', image_url: { url: dataUri } }] },
              ],
            }),
          })
          if (!captionRes.ok) throw new Error(`VLM caption error (${captionRes.status}): ${await captionRes.text()}`)
          const captionData = await captionRes.json() as { choices: Array<{ message: { content: string } }> }
          const caption = captionData.choices[0]?.message?.content ?? ''
          console.log(`📝 图片描述: ${caption.slice(0, 80)}`)

          // 2. Text embedding (for text-to-image search)
          const textEmbedding = await getEmbedding(caption)
          const textId = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
          insertVector(textId, textEmbedding, caption, 'image', contactId, 'store', url)
          console.log(`🧠 图片文本embedding已存库: ${textId}`)

          // 3. Image embedding (for image-to-image search) — requires a public URL,
          // which is unavailable in local-mode, so skip and rely on textual caption.
          if (isLocalPath(url)) {
            console.log('🖼️ 本地模式：跳过图片视觉 embedding（仅保留文本描述检索）')
          } else {
            const { getSignedUrl } = await import('./cos.js')
            const signedUrl = getSignedUrl(url, 600)
            const imgEmbedding = await getMultimodalEmbedding([{ image: signedUrl }])
            const imgId = `imgv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
            insertVector(imgId, imgEmbedding, caption, 'image_visual', contactId, 'store', url)
            console.log(`🧠 图片视觉embedding已存库: ${imgId}`)
          }
        } catch (err) {
          console.error('❌ 图片embedding失败:', (err as Error).message)
        }
      })()
    }
  }

  // If only media with no meaningful text, just confirm receipt
  const hasRealText = text && !text.match(/^\[.+\]$/)
  if (mediaPaths.length > 0 && !hasRealText) {
    const mediaReply = `已收到并存档 ✅ 共 ${mediaPaths.length} 个文件。之后你可以用文字描述来找回这些内容。`
    addMessage(contactId, 'user', text)
    addMessage(contactId, 'assistant', mediaReply)
    await ilink.sendMessage(creds!, contactId, msg.context_token, mediaReply)
    console.log(`📤 → ${contactId}: ${mediaReply}`)
    return
  }

  // Has text (including voice transcription): run agent
  // Typing
  try { if (typingTicket) await ilink.sendTyping(creds!, typingTicket, contactId) } catch {}

  const history = getHistory(contactId).reverse()
  let result: { reply: string; imageUrls?: string[] }
  try {
    const sendIntermediate = (text: string) =>
      ilink.sendMessage(creds!, contactId, msg.context_token, text)
    result = await runAgent(text, contactId, history, sendIntermediate)
  } catch (err) {
    console.error('❌ Agent error:', err)
    result = { reply: '抱歉，我遇到了一些问题，请稍后再试。' }
  }

  // Sign any COS URLs in reply text
  const COS_URL_RE = /https:\/\/weixin-\d+\.cos\.[a-z-]+\.myqcloud\.com\/[^\s)\"'>]+/g
  const signedReply = result.reply.replace(COS_URL_RE, (url) => getSignedUrl(url, 3600))

  // Save & send text reply
  addMessage(contactId, 'user', text)
  addMessage(contactId, 'assistant', signedReply)
  await ilink.sendMessage(creds!, contactId, msg.context_token, signedReply)
  console.log(`📤 → ${contactId}: ${result.reply.slice(0, 80)}`)

  // Auto-index: embed user message into vector DB (fire-and-forget)
  // This ensures ALL conversations are semantically searchable, not just explicit store_note calls
  if (text.length >= 4) {
    autoIndex(text, contactId).catch((err) =>
      console.error('⚠️ Auto-index failed:', (err as Error).message)
    )
  }

  // Send images if agent returned any
  console.log(`🔍 Agent result imageUrls: ${JSON.stringify(result.imageUrls?.map((u: string) => u.slice(-40)) ?? null)}`)
  if (result.imageUrls?.length) {
    for (const url of result.imageUrls) {
      try {
        await ilink.sendImage(creds!, contactId, msg.context_token, url)
        console.log(`🖼️ → ${contactId}: sent image ${url.slice(-30)}`)
      } catch (err) {
        console.error('❌ 发图片失败:', (err as Error).message)
        await ilink.sendMessage(creds!, contactId, msg.context_token, `图片发送失败，你可以直接访问: ${url}`)
      }
    }
  }
}

// --- Auto-index user messages ---

async function autoIndex(text: string, userId: string): Promise<void> {
  const embedding = await getEmbedding(text)
  const id = `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  insertVector(id, embedding, text, 'general', userId, 'chat')
  console.log(`🧠 Auto-indexed: ${text.slice(0, 40)}...`)
}

// --- Polling loop ---

async function poll(): Promise<void> {
  running = true
  console.log('🚀 开始轮询 iLink...')

  // Get typing ticket
  try { typingTicket = await ilink.getTypingTicket(creds!) } catch {}

  let backoff = 0

  while (running) {
    try {
      const res = await ilink.getUpdates(creds!, cursor)

      if (ilink.isAuthError(res)) {
        console.error('🔒 认证失败，需要重新扫码登录')
        running = false
        creds = null
        break
      }

      if (res.get_updates_buf) {
        cursor = res.get_updates_buf
        saveCursor()
      }

      backoff = 0

      for (const msg of res.msgs ?? []) {
        try {
          await handleMessage(msg)
        } catch (err) {
          console.error('❌ 消息处理失败:', err)
        }
      }
    } catch (err) {
      backoff = Math.min((backoff || 1000) * 2, 30000)
      console.error(`⚠️ 轮询出错, ${backoff / 1000}s 后重试:`, (err as Error).message)
      await new Promise(r => setTimeout(r, backoff))
    }
  }
}

// --- HTTP API (Dashboard + Gateway) ---

import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { createReadStream, existsSync, statSync } from 'fs'
import { join, extname } from 'path'
import { createHmac } from 'crypto'

function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
  res.end(JSON.stringify(data))
}

async function body(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return JSON.parse(Buffer.concat(chunks).toString())
}

// Simple JWT (HMAC-SHA256)
const JWT_SECRET = process.env.JWT_SECRET
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD
if (!JWT_SECRET || !ADMIN_PASSWORD) {
  throw new Error('JWT_SECRET and ADMIN_PASSWORD must be set in environment')
}

function signJwt(sub: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ sub, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 7 * 86400 })).toString('base64url')
  const sig = createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}

function verifyJwt(token: string): string | null {
  try {
    const [header, payload, sig] = token.split('.')
    const expected = createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url')
    if (sig !== expected) return null
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (data.exp < Date.now() / 1000) return null
    return data.sub
  } catch { return null }
}

function requireAuth(req: IncomingMessage): string | null {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) return null
  return verifyJwt(auth.slice(7))
}

// Static file server for dashboard
const STATIC_DIR = join(process.cwd(), 'public')
const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain',
}

function serveStatic(req: IncomingMessage, res: ServerResponse): boolean {
  let filePath = join(STATIC_DIR, req.url?.split('?')[0] ?? '/')
  if (filePath.endsWith('/')) filePath = join(filePath, 'index.html')
  if (!extname(filePath)) filePath += '.html' // Next.js static export: /login -> login.html

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    // SPA fallback: serve index.html for unmatched routes
    filePath = join(STATIC_DIR, 'index.html')
    if (!existsSync(filePath)) return false
  }

  const ext = extname(filePath)
  res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' })
  createReadStream(filePath).pipe(res)
  return true
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url!, `http://localhost:${config.apiPort}`)
  const method = req.method ?? 'GET'

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Allow-Headers': '*' })
    return res.end()
  }

  try {
    // ===== Public routes =====

    if (url.pathname === '/health') {
      return json(res, { status: 'ok', running, botId: creds?.ilinkBotId ?? null })
    }

    // Public: local media files (complements /api/files when COS disabled)
    if (method === 'GET' && url.pathname.startsWith('/media/')) {
      const { resolveLocalMedia, MIME_BY_EXT } = await import('./media.js')
      const rel = decodeURIComponent(url.pathname.slice('/media/'.length))
      const abs = resolveLocalMedia(rel)
      if (!abs || !existsSync(abs) || !statSync(abs).isFile()) {
        return json(res, { error: 'Not found' }, 404)
      }
      const ext = extname(abs).toLowerCase()
      const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream'
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'private, max-age=300' })
      createReadStream(abs).pipe(res)
      return
    }

    // Auth
    if (url.pathname === '/api/auth/login' && method === 'POST') {
      const { username, password } = await body(req)
      if (username !== 'admin' || password !== ADMIN_PASSWORD) return json(res, { error: 'Invalid credentials' }, 401)
      return json(res, { token: signJwt('admin'), user: { username: 'admin' } })
    }

    if (url.pathname === '/api/auth/me') {
      const user = requireAuth(req)
      if (!user) return json(res, { error: 'Unauthorized' }, 401)
      return json(res, { user: { username: user } })
    }

    // ===== Protected routes (require JWT) =====
    if (url.pathname.startsWith('/api/') && url.pathname !== '/api/auth/login') {
      if (!requireAuth(req)) return json(res, { error: 'Unauthorized' }, 401)
    }

    // --- WeChat binding ---
    if (url.pathname === '/api/wechat/qrcode' && method === 'POST') {
      const { qrcode, qrcodeUrl } = await ilink.getQrCode(config.ilink.baseURL)
      return json(res, { qrcodeImgContent: qrcodeUrl, qrcode })
    }

    const qrStatusMatch = url.pathname.match(/^\/api\/wechat\/qrcode\/(.+)\/status$/)
    if (qrStatusMatch) {
      const qr = qrStatusMatch[1]
      const result = await ilink.pollQrStatus(config.ilink.baseURL, qr)
      if (result) {
        creds = result
        saveCredentials()
        if (!running) poll()
        return json(res, { status: 'confirmed' })
      }
      return json(res, { status: 'waiting' })
    }

    if (url.pathname === '/api/wechat/bindings' && method === 'GET') {
      const bindings = creds ? [{ wechatId: creds.ilinkBotId, nickname: creds.ilinkUserId || creds.ilinkBotId, boundAt: Date.now() }] : []
      return json(res, { bindings })
    }

    if (url.pathname.startsWith('/api/wechat/bindings/') && method === 'DELETE') {
      creds = null
      running = false
      setCredential('ilink_creds', '')
      return json(res, { success: true })
    }

    // --- Gateway ---
    if (url.pathname === '/api/gateway/status') {
      return json(res, { status: running ? 'active' : 'stopped', botId: creds?.ilinkBotId ?? null })
    }

    if (url.pathname === '/api/gateway/send' && method === 'POST') {
      if (!creds || !running) return json(res, { error: 'Not running' }, 503)
      const { to, text } = await body(req)
      if (!to || !text) return json(res, { error: '"to" and "text" required' }, 400)
      await ilink.sendMessage(creds, to, '', text)
      addMessage(to, 'assistant', text)
      return json(res, { status: 'ok' })
    }

    if (url.pathname === '/api/messages') {
      const limit = parseInt(url.searchParams.get('limit') ?? '50', 10)
      return json(res, { messages: getRecentLogs(limit) })
    }

    // --- Stats (for dashboard home) ---
    if (url.pathname === '/api/stats') {
      const { getStats } = await import('./db.js')
      return json(res, getStats())
    }

    // --- Notes ---
    if (url.pathname === '/api/notes' && method === 'GET') {
      const { getNotes } = await import('./db.js')
      const q = url.searchParams.get('q') ?? ''
      const category = url.searchParams.get('category') ?? ''
      return json(res, { notes: getNotes(q, category) })
    }

    if (url.pathname.match(/^\/api\/notes\//) && method === 'DELETE') {
      const id = url.pathname.split('/').pop()!
      const { deleteVector } = await import('./db.js')
      deleteVector(id)
      return json(res, { success: true })
    }

    // --- Cron Jobs (Reminders) ---
    if (url.pathname === '/api/cron' && method === 'GET') {
      const { getCronJobs } = await import('./db.js')
      return json(res, { jobs: getCronJobs() })
    }

    if (url.pathname.match(/^\/api\/cron\//) && method === 'PATCH') {
      const id = url.pathname.split('/').pop()!
      const { updateCronJob } = await import('./db.js')
      const fields = await body(req)
      // If schedule_value changed, recompute next_run_at
      if (fields.schedule_value !== undefined) {
        const { getCronJobs } = await import('./db.js')
        const existing = getCronJobs().find(j => j.id === id)
        if (existing) {
          const { computeNextRunAt } = await import('./scheduler.js')
          const updated = { ...existing, schedule_value: fields.schedule_value }
          fields.next_run_at = computeNextRunAt(updated, Date.now())
        }
      }
      // If re-enabling, recompute next_run_at
      if (fields.enabled === 1) {
        const { getCronJobs } = await import('./db.js')
        const existing = getCronJobs().find(j => j.id === id)
        if (existing) {
          const { computeNextRunAt } = await import('./scheduler.js')
          const updated = { ...existing, ...fields }
          const nextRun = computeNextRunAt(updated, Date.now())
          if (nextRun) fields.next_run_at = nextRun
        }
      }
      const result = updateCronJob(id, fields)
      if (!result) return json(res, { error: 'Not found' }, 404)
      return json(res, { job: result })
    }

    if (url.pathname.match(/^\/api\/cron\//) && method === 'DELETE') {
      const id = url.pathname.split('/').pop()!
      const { deleteCronJob } = await import('./db.js')
      deleteCronJob(id)
      return json(res, { success: true })
    }

    // --- Files ---
    if (url.pathname === '/api/files' && method === 'GET') {
      const { getFiles } = await import('./db.js')
      const { toDisplayUrl } = await import('./media.js')
      const files = (getFiles() as any[]).map((f) => {
        let signed_url = null
        if (f.media_path) {
          try { signed_url = toDisplayUrl(f.media_path) }
          catch (err) { console.warn(`⚠️ bad media_path ${f.media_path}:`, (err as Error).message) }
        }
        return { ...f, signed_url }
      })
      return json(res, { files })
    }

    // ===== Static files (dashboard) =====
    if (!url.pathname.startsWith('/api/')) {
      if (serveStatic(req, res)) return
    }

    json(res, { error: 'Not found' }, 404)
  } catch (err: any) {
    console.error('HTTP error:', err.message)
    json(res, { error: err.message }, 500)
  }
})

server.listen(config.apiPort)

// --- Main ---

console.log(`
╔══════════════════════════════════╗
║   Pi Assistant - VPS Gateway     ║
╚══════════════════════════════════╝
`)
console.log(`📡 API server: http://0.0.0.0:${config.apiPort}`)

// Load skills + watch for hot-reload
await initSkills()

// Start scheduler (sends reminders via iLink)
startScheduler(async (userId: string, text: string) => {
  if (!creds || !running) throw new Error('Gateway not running')
  await ilink.sendMessage(creds, userId, '', text)
  addMessage(userId, 'assistant', `⏰ ${text}`)
})

startProactive(async (userId: string, text: string) => {
  if (!creds || !running) throw new Error('Gateway not running')
  await ilink.sendMessage(creds, userId, '', text)
  addMessage(userId, 'assistant', text)
})

if (loadCredentials()) {
  console.log(`🔑 已加载保存的凭据: ${creds!.ilinkBotId}`)
  poll()
} else if (process.env.BOT_TOKEN) {
  creds = {
    botToken: process.env.BOT_TOKEN,
    ilinkBotId: process.env.ILINK_BOT_ID ?? '',
    baseURL: process.env.ILINK_BASE_URL ?? config.ilink.baseURL,
    ilinkUserId: process.env.ILINK_USER_ID ?? '',
  }
  saveCredentials()
  poll()
} else {
  await login()
  poll()
}
