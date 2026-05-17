import Database from 'better-sqlite3'
import { config } from './config.js'
import { join } from 'path'

const db = new Database(join(config.dataDir, 'pi.db'))
db.pragma('journal_mode = WAL')

// --- Schema (fresh installs get bot_id from the start) ---

db.exec(`
  CREATE TABLE IF NOT EXISTS credentials (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS bots (
    bot_id TEXT PRIMARY KEY,
    bot_token TEXT NOT NULL,
    base_url TEXT NOT NULL,
    ilink_user_id TEXT NOT NULL DEFAULT '',
    cursor TEXT NOT NULL DEFAULT '',
    nickname TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    proactive_enabled INTEGER NOT NULL DEFAULT 0,
    proactive_user_id TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL DEFAULT '',
    contact_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, timestamp INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS message_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL DEFAULT '',
    contact_id TEXT NOT NULL, direction TEXT NOT NULL, content TEXT NOT NULL,
    msg_type INTEGER NOT NULL DEFAULT 1, media_path TEXT, timestamp INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS vectors (
    id TEXT PRIMARY KEY, embedding BLOB NOT NULL, content TEXT NOT NULL,
    bot_id TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'general', user_id TEXT NOT NULL DEFAULT '',
    intent_type TEXT NOT NULL DEFAULT 'store', media_url TEXT,
    timestamp INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS cron_jobs (
    id TEXT PRIMARY KEY,
    bot_id TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    user_id TEXT NOT NULL,
    schedule_kind TEXT NOT NULL,
    schedule_value TEXT NOT NULL,
    schedule_tz TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    payload TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    next_run_at INTEGER,
    last_run_at INTEGER,
    last_status TEXT,
    job_type TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`)

// --- Idempotent migration: add bot_id to legacy tables + backfill to first bot ---

function columnExists(table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return cols.some((c) => c.name === column)
}

function migrate(): void {
  const BOT_ID_TABLES = ['conversations', 'message_log', 'vectors', 'cron_jobs']

  // 1. Add bot_id to any legacy table missing it (CREATE IF NOT EXISTS was a no-op there)
  for (const table of BOT_ID_TABLES) {
    if (!columnExists(table, 'bot_id')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN bot_id TEXT NOT NULL DEFAULT ''`)
    }
  }

  // 2. Seed the first bot row from legacy credentials, if not already present
  const botCount = (db.prepare('SELECT COUNT(*) AS c FROM bots').get() as { c: number }).c
  const rawCreds = (db.prepare("SELECT value FROM credentials WHERE key = 'ilink_creds'").get() as { value: string } | undefined)?.value
  let firstBotId = ''

  if (rawCreds) {
    try {
      const c = JSON.parse(rawCreds) as { botToken: string; ilinkBotId: string; baseURL: string; ilinkUserId?: string }
      firstBotId = c.ilinkBotId
      if (botCount === 0 && c.ilinkBotId) {
        const cursor = (db.prepare("SELECT value FROM credentials WHERE key = 'ilink_cursor'").get() as { value: string } | undefined)?.value ?? ''
        const now = Date.now()
        db.prepare(
          `INSERT OR IGNORE INTO bots (bot_id, bot_token, base_url, ilink_user_id, cursor, nickname, enabled, proactive_enabled, proactive_user_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
        ).run(
          c.ilinkBotId,
          c.botToken,
          c.baseURL,
          c.ilinkUserId ?? '',
          cursor,
          c.ilinkBotId,
          config.proactive.enabled ? 1 : 0,
          config.proactive.userId ?? '',
          now,
          now,
        )
        console.log(`🔀 迁移: 已从 ilink_creds 建立首个 bot 行 ${c.ilinkBotId}`)
      }
    } catch (err) {
      console.error('⚠️ 迁移: 解析 ilink_creds 失败:', (err as Error).message)
    }
  }

  // 3. Backfill legacy rows (bot_id = '') to the first bot
  if (firstBotId) {
    for (const table of BOT_ID_TABLES) {
      const r = db.prepare(`UPDATE ${table} SET bot_id = ? WHERE bot_id = ''`).run(firstBotId)
      if (r.changes > 0) console.log(`🔀 迁移: ${table} 回填 ${r.changes} 行 → ${firstBotId}`)
    }
  }
}

migrate()

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_conv_bot ON conversations (bot_id, contact_id, timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_log_bot ON message_log (bot_id, timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_vec_bot ON vectors (bot_id, category);
  CREATE INDEX IF NOT EXISTS idx_cron_bot ON cron_jobs (bot_id);
`)

// --- Credentials (legacy key/value; retained for cursor fallback + migration) ---

export function getCredential(key: string): string | null {
  const row = db.prepare('SELECT value FROM credentials WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setCredential(key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO credentials (key, value) VALUES (?, ?)').run(key, value)
}

// --- Bots ---

export interface BotRow {
  bot_id: string
  bot_token: string
  base_url: string
  ilink_user_id: string
  cursor: string
  nickname: string | null
  enabled: number
  proactive_enabled: number
  proactive_user_id: string
  created_at: number
  updated_at: number
}

export function getBots(): BotRow[] {
  return db.prepare('SELECT * FROM bots ORDER BY created_at ASC').all() as BotRow[]
}

export function getEnabledBots(): BotRow[] {
  return db.prepare('SELECT * FROM bots WHERE enabled = 1 ORDER BY created_at ASC').all() as BotRow[]
}

export function getBot(botId: string): BotRow | null {
  return (db.prepare('SELECT * FROM bots WHERE bot_id = ?').get(botId) as BotRow | undefined) ?? null
}

export function upsertBot(bot: {
  bot_id: string
  bot_token: string
  base_url: string
  ilink_user_id: string
  cursor?: string
  nickname?: string
}): void {
  const now = Date.now()
  const existing = getBot(bot.bot_id)
  if (existing) {
    db.prepare(
      'UPDATE bots SET bot_token = ?, base_url = ?, ilink_user_id = ?, nickname = ?, enabled = 1, updated_at = ? WHERE bot_id = ?',
    ).run(bot.bot_token, bot.base_url, bot.ilink_user_id, bot.nickname ?? existing.nickname ?? bot.bot_id, now, bot.bot_id)
  } else {
    db.prepare(
      `INSERT INTO bots (bot_id, bot_token, base_url, ilink_user_id, cursor, nickname, enabled, proactive_enabled, proactive_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 0, '', ?, ?)`,
    ).run(bot.bot_id, bot.bot_token, bot.base_url, bot.ilink_user_id, bot.cursor ?? '', bot.nickname ?? bot.bot_id, now, now)
  }
}

export function updateBotCursor(botId: string, cursor: string): void {
  db.prepare('UPDATE bots SET cursor = ?, updated_at = ? WHERE bot_id = ?').run(cursor, Date.now(), botId)
}

export function setBotEnabled(botId: string, enabled: boolean): void {
  db.prepare('UPDATE bots SET enabled = ?, updated_at = ? WHERE bot_id = ?').run(enabled ? 1 : 0, Date.now(), botId)
}

export function updateBotProactive(botId: string, enabled: boolean, userId: string): void {
  db.prepare('UPDATE bots SET proactive_enabled = ?, proactive_user_id = ?, updated_at = ? WHERE bot_id = ?').run(
    enabled ? 1 : 0,
    userId,
    Date.now(),
    botId,
  )
}

export function deleteBot(botId: string): void {
  db.prepare('DELETE FROM bots WHERE bot_id = ?').run(botId)
}

// --- Conversations ---

export function getHistory(
  botId: string,
  contactId: string,
  limit = 20,
): Array<{ role: string; content: string; timestamp: number }> {
  return db.prepare(
    'SELECT role, content, timestamp FROM conversations WHERE bot_id = ? AND contact_id = ? ORDER BY timestamp DESC LIMIT ?',
  ).all(botId, contactId, limit) as Array<{ role: string; content: string; timestamp: number }>
}

export function getConversationsByDateRange(
  botId: string,
  userId: string,
  startMs: number,
  endMs: number,
): Array<{ role: string; content: string; timestamp: number }> {
  return db.prepare(
    'SELECT role, content, timestamp FROM conversations WHERE bot_id = ? AND contact_id = ? AND timestamp >= ? AND timestamp < ? ORDER BY timestamp ASC',
  ).all(botId, userId, startMs, endMs) as Array<{ role: string; content: string; timestamp: number }>
}

export function getImageCaptionsByDateRange(
  botId: string,
  userId: string,
  startMs: number,
  endMs: number,
): Array<{ content: string; media_url: string | null; timestamp: number }> {
  return db.prepare(
    "SELECT content, media_url, timestamp FROM vectors WHERE bot_id = ? AND user_id = ? AND intent_type = 'image' AND timestamp >= ? AND timestamp < ? ORDER BY timestamp ASC",
  ).all(botId, userId, startMs, endMs) as Array<{ content: string; media_url: string | null; timestamp: number }>
}

export function addMessage(botId: string, contactId: string, role: 'user' | 'assistant', content: string): void {
  const now = Date.now()
  db.prepare('INSERT INTO conversations (bot_id, contact_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)').run(
    botId,
    contactId,
    role,
    content,
    now,
  )
  db.prepare(
    'INSERT INTO message_log (bot_id, contact_id, direction, content, msg_type, timestamp) VALUES (?, ?, ?, ?, 1, ?)',
  ).run(botId, contactId, role === 'user' ? 'inbound' : 'outbound', content, now)
}

export function logMedia(
  botId: string,
  contactId: string,
  direction: string,
  desc: string,
  msgType: number,
  mediaPath: string,
): void {
  db.prepare(
    'INSERT INTO message_log (bot_id, contact_id, direction, content, msg_type, media_path, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(botId, contactId, direction, desc, msgType, mediaPath, Date.now())
}

export function getRecentLogs(botId: string, limit = 50): unknown[] {
  return db.prepare(
    'SELECT contact_id, direction, content, msg_type, media_path, timestamp FROM message_log WHERE bot_id = ? ORDER BY timestamp DESC LIMIT ?',
  ).all(botId, limit)
}

export interface ContactRow {
  contactId: string
  lastSeen: number
  messageCount: number
  lastContent: string
}

// Distinct wxids this bot has exchanged messages with — used to populate the
// proactive-chat target picker so users don't have to guess a raw wxid.
export function getContacts(botId: string): ContactRow[] {
  return db
    .prepare(
      `SELECT contact_id AS contactId,
              MAX(timestamp) AS lastSeen,
              COUNT(*) AS messageCount,
              (SELECT content FROM message_log m2
                 WHERE m2.bot_id = ml.bot_id AND m2.contact_id = ml.contact_id
                 ORDER BY timestamp DESC LIMIT 1) AS lastContent
         FROM message_log ml
        WHERE bot_id = ?
        GROUP BY contact_id
        ORDER BY lastSeen DESC`,
    )
    .all(botId) as ContactRow[]
}

// --- Vectors ---

function float32ToBuffer(arr: number[]): Buffer {
  return Buffer.from(new Float32Array(arr).buffer)
}

function bufferToFloat32(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
}

export function insertVector(
  botId: string,
  id: string,
  embedding: number[],
  content: string,
  category: string,
  userId: string,
  intentType: string,
  mediaUrl?: string,
): void {
  db.prepare(
    'INSERT OR REPLACE INTO vectors (id, bot_id, embedding, content, category, user_id, intent_type, media_url, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, botId, float32ToBuffer(embedding), content, category, userId, intentType, mediaUrl ?? null, Date.now())
}

export interface VectorResult {
  id: string
  score: number
  content: string
  category: string
  mediaUrl: string | null
}

export function queryVectors(botId: string, queryEmbedding: number[], topK = 3, category?: string): VectorResult[] {
  const rows = (
    category
      ? db
          .prepare('SELECT id, embedding, content, category, media_url FROM vectors WHERE bot_id = ? AND category = ?')
          .all(botId, category)
      : db.prepare('SELECT id, embedding, content, category, media_url FROM vectors WHERE bot_id = ?').all(botId)
  ) as Array<{ id: string; embedding: Buffer; content: string; category: string; media_url: string | null }>
  if (rows.length === 0) return []

  const qNorm = Math.sqrt(queryEmbedding.reduce((s, v) => s + v * v, 0))
  const scored = rows.map((row) => {
    const vec = bufferToFloat32(row.embedding)
    let dot = 0,
      norm = 0
    for (let i = 0; i < vec.length; i++) {
      dot += queryEmbedding[i] * vec[i]
      norm += vec[i] * vec[i]
    }
    return {
      id: row.id,
      score: dot / (qNorm * Math.sqrt(norm) + 1e-10),
      content: row.content,
      category: row.category,
      mediaUrl: row.media_url,
    }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topK)
}

export function deleteVector(botId: string, id: string): void {
  db.prepare('DELETE FROM vectors WHERE id = ? AND bot_id = ?').run(id, botId)
}

// --- Stats ---

export function getStats(botId: string) {
  const totalNotes =
    (db.prepare("SELECT COUNT(*) as c FROM vectors WHERE bot_id = ? AND intent_type = 'store'").get(botId) as any)?.c ?? 0
  const intentRows = db
    .prepare('SELECT intent_type, COUNT(*) as c FROM vectors WHERE bot_id = ? GROUP BY intent_type')
    .all(botId) as Array<{ intent_type: string; c: number }>
  const intentDistribution: Record<string, number> = { store: 0, query: 0, chat: 0 }
  for (const r of intentRows) intentDistribution[r.intent_type] = r.c

  const activityRows = db
    .prepare(
      `SELECT date(timestamp/1000, 'unixepoch') as d, COUNT(*) as c
       FROM message_log WHERE bot_id = ? AND timestamp > ? GROUP BY d ORDER BY d DESC LIMIT 7`,
    )
    .all(botId, Date.now() - 7 * 86400000) as Array<{ d: string; c: number }>

  const vectorCount = (db.prepare('SELECT COUNT(*) as c FROM vectors WHERE bot_id = ?').get(botId) as any)?.c ?? 0

  const recentOps = db
    .prepare(
      'SELECT id, intent_type, content, category, timestamp FROM vectors WHERE bot_id = ? ORDER BY timestamp DESC LIMIT 8',
    )
    .all(botId) as Array<{ id: string; intent_type: string; content: string; category: string; timestamp: number }>

  return {
    totalNotes,
    vectorCount,
    intentDistribution,
    recentActivity: activityRows.map((r) => ({ date: r.d, count: r.c })).reverse(),
    recentOperations: recentOps.map((r) => ({
      id: r.id,
      type: r.intent_type,
      content: r.content,
      category: r.category,
      timestamp: r.timestamp,
    })),
  }
}

// --- Notes ---

export function getNotes(botId: string, q: string, category: string) {
  let sql = "SELECT id, content, category, user_id, timestamp FROM vectors WHERE bot_id = ? AND intent_type = 'store'"
  const params: any[] = [botId]
  if (category) {
    sql += ' AND category = ?'
    params.push(category)
  }
  if (q) {
    sql += ' AND content LIKE ?'
    params.push(`%${q}%`)
  }
  sql += ' ORDER BY timestamp DESC LIMIT 100'
  return db.prepare(sql).all(...params)
}

export function getFiles(botId: string) {
  return db
    .prepare(
      'SELECT id, content, media_path, msg_type, timestamp FROM message_log WHERE bot_id = ? AND media_path IS NOT NULL ORDER BY timestamp DESC LIMIT 200',
    )
    .all(botId)
}

// --- Cron Jobs ---

export interface CronJob {
  id: string
  bot_id: string
  name: string
  user_id: string
  schedule_kind: 'at' | 'every' | 'cron'
  schedule_value: string
  schedule_tz: string
  payload: string
  enabled: number
  next_run_at: number | null
  last_run_at: number | null
  last_status: string | null
  job_type: string | null
  created_at: number
  updated_at: number
}

export function createCronJob(job: Omit<CronJob, 'created_at' | 'updated_at'>): void {
  const now = Date.now()
  db.prepare(
    `INSERT INTO cron_jobs (id, bot_id, name, user_id, schedule_kind, schedule_value, schedule_tz, payload, enabled, next_run_at, last_run_at, last_status, job_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    job.id,
    job.bot_id,
    job.name,
    job.user_id,
    job.schedule_kind,
    job.schedule_value,
    job.schedule_tz,
    job.payload,
    job.enabled,
    job.next_run_at,
    job.last_run_at,
    job.last_status,
    job.job_type,
    now,
    now,
  )
}

export function getCronJobs(botId: string, userId?: string): CronJob[] {
  if (userId) {
    return db
      .prepare('SELECT * FROM cron_jobs WHERE bot_id = ? AND user_id = ? ORDER BY created_at DESC')
      .all(botId, userId) as CronJob[]
  }
  return db.prepare('SELECT * FROM cron_jobs WHERE bot_id = ? ORDER BY created_at DESC').all(botId) as CronJob[]
}

export function getEnabledDueJobs(nowMs: number): CronJob[] {
  return db
    .prepare('SELECT * FROM cron_jobs WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?')
    .all(nowMs) as CronJob[]
}

export function updateCronJobAfterRun(id: string, status: string, nextRunAt: number | null): void {
  db.prepare('UPDATE cron_jobs SET last_run_at = ?, last_status = ?, next_run_at = ?, updated_at = ? WHERE id = ?').run(
    Date.now(),
    status,
    nextRunAt,
    Date.now(),
    id,
  )
}

export function updateCronJob(
  id: string,
  fields: Partial<Pick<CronJob, 'name' | 'payload' | 'enabled' | 'schedule_value' | 'next_run_at'>>,
): CronJob | null {
  const existing = db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get(id) as CronJob | undefined
  if (!existing) return null
  const updated = { ...existing, ...fields, updated_at: Date.now() }
  db.prepare(
    'UPDATE cron_jobs SET name = ?, payload = ?, enabled = ?, schedule_value = ?, next_run_at = ?, updated_at = ? WHERE id = ?',
  ).run(updated.name, updated.payload, updated.enabled, updated.schedule_value, updated.next_run_at, updated.updated_at, id)
  return updated
}

export function deleteCronJob(id: string): void {
  db.prepare('DELETE FROM cron_jobs WHERE id = ?').run(id)
}

export default db
