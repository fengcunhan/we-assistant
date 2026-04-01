import { config } from './config'
import { getCredential, setCredential, getHistory, addMessage, logMedia, getRecentLogs, insertVector } from './db'
import { runAgent } from './agent'
import { getMultimodalEmbedding } from './embedding'
import * as ilink from './ilink'
import type { Credentials } from './ilink'

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

  // If media was uploaded, embed images + reply
  if (mediaPaths.length > 0) {
    // Embed each image and store in vector DB
    for (const url of mediaPaths) {
      if (url.match(/\.(jpg|jpeg|png|gif|webp|bmp)/i)) {
        try {
          const embedding = await getMultimodalEmbedding([{ image: url }])
          const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
          insertVector(id, embedding, `图片来自 ${contactId}`, 'image', contactId, 'store', url)
          console.log(`🧠 图片已embedding并存库: ${id}`)
        } catch (err) {
          console.error('❌ 图片embedding失败:', (err as Error).message)
        }
      }
    }

    const mediaReply = `已收到并存档 ✅ 共 ${mediaPaths.length} 个文件。之后你可以用文字描述来找回这些图片。`
    addMessage(contactId, 'user', text)
    addMessage(contactId, 'assistant', mediaReply)
    await ilink.sendMessage(creds!, contactId, msg.context_token, mediaReply)
    console.log(`📤 → ${contactId}: ${mediaReply}`)
    return
  }

  // Text-only: run agent
  // Typing
  try { if (typingTicket) await ilink.sendTyping(creds!, typingTicket, contactId) } catch {}

  const history = getHistory(contactId).reverse()
  let result: { reply: string; imageUrls?: string[] }
  try {
    result = await runAgent(text, contactId, history)
  } catch (err) {
    console.error('❌ Agent error:', err)
    result = { reply: '抱歉，我遇到了一些问题，请稍后再试。' }
  }

  // Save & send text reply
  addMessage(contactId, 'user', text)
  addMessage(contactId, 'assistant', result.reply)
  await ilink.sendMessage(creds!, contactId, msg.context_token, result.reply)
  console.log(`📤 → ${contactId}: ${result.reply.slice(0, 80)}`)

  // Send images if agent returned any
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
const JWT_SECRET = process.env.JWT_SECRET ?? '<JWT_SECRET>'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '<ADMIN_PASSWORD>'

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

    // --- Files ---
    if (url.pathname === '/api/files' && method === 'GET') {
      const { getFiles } = await import('./db.js')
      const { getSignedUrl } = await import('./cos.js')
      const files = (getFiles() as any[]).map((f) => ({
        ...f,
        signed_url: f.media_path ? getSignedUrl(f.media_path) : null,
      }))
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
