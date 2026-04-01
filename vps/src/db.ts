import Database from 'better-sqlite3'
import { config } from './config.js'
import { join } from 'path'

const db = new Database(join(config.dataDir, 'pi.db'))
db.pragma('journal_mode = WAL')

// --- Schema ---

db.exec(`
  CREATE TABLE IF NOT EXISTS credentials (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, timestamp INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_conv_contact ON conversations (contact_id, timestamp DESC);
  CREATE TABLE IF NOT EXISTS message_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id TEXT NOT NULL, direction TEXT NOT NULL, content TEXT NOT NULL,
    msg_type INTEGER NOT NULL DEFAULT 1, media_path TEXT, timestamp INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS vectors (
    id TEXT PRIMARY KEY, embedding BLOB NOT NULL, content TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general', user_id TEXT NOT NULL DEFAULT '',
    intent_type TEXT NOT NULL DEFAULT 'store', media_url TEXT,
    timestamp INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS cron_jobs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    user_id TEXT NOT NULL,
    schedule_kind TEXT NOT NULL,       -- 'at' | 'every' | 'cron'
    schedule_value TEXT NOT NULL,      -- ISO timestamp | ms interval | cron expr
    schedule_tz TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    payload TEXT NOT NULL,             -- message text sent to user or agent prompt
    enabled INTEGER NOT NULL DEFAULT 1,
    next_run_at INTEGER,               -- ms epoch
    last_run_at INTEGER,
    last_status TEXT,                   -- 'ok' | 'error'
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`)

// --- Credentials ---

export function getCredential(key: string): string | null {
  const row = db.prepare('SELECT value FROM credentials WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setCredential(key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO credentials (key, value) VALUES (?, ?)').run(key, value)
}

// --- Conversations ---

export function getHistory(contactId: string, limit = 20): Array<{ role: string; content: string }> {
  return db.prepare(
    'SELECT role, content FROM conversations WHERE contact_id = ? ORDER BY timestamp DESC LIMIT ?'
  ).all(contactId, limit) as Array<{ role: string; content: string }>
}

export function addMessage(contactId: string, role: 'user' | 'assistant', content: string): void {
  const now = Date.now()
  db.prepare('INSERT INTO conversations (contact_id, role, content, timestamp) VALUES (?, ?, ?, ?)').run(contactId, role, content, now)
  db.prepare('INSERT INTO message_log (contact_id, direction, content, msg_type, timestamp) VALUES (?, ?, ?, 1, ?)').run(contactId, role === 'user' ? 'inbound' : 'outbound', content, now)
}

export function logMedia(contactId: string, direction: string, desc: string, msgType: number, mediaPath: string): void {
  db.prepare('INSERT INTO message_log (contact_id, direction, content, msg_type, media_path, timestamp) VALUES (?, ?, ?, ?, ?, ?)').run(contactId, direction, desc, msgType, mediaPath, Date.now())
}

export function getRecentLogs(limit = 50): unknown[] {
  return db.prepare('SELECT contact_id, direction, content, msg_type, media_path, timestamp FROM message_log ORDER BY timestamp DESC LIMIT ?').all(limit)
}

// --- Vectors ---

function float32ToBuffer(arr: number[]): Buffer {
  return Buffer.from(new Float32Array(arr).buffer)
}

function bufferToFloat32(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
}

export function insertVector(id: string, embedding: number[], content: string, category: string, userId: string, intentType: string, mediaUrl?: string): void {
  db.prepare('INSERT OR REPLACE INTO vectors (id, embedding, content, category, user_id, intent_type, media_url, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, float32ToBuffer(embedding), content, category, userId, intentType, mediaUrl ?? null, Date.now())
}

export interface VectorResult {
  id: string; score: number; content: string; category: string; mediaUrl: string | null
}

export function queryVectors(queryEmbedding: number[], topK = 3, category?: string): VectorResult[] {
  const sql = category
    ? 'SELECT id, embedding, content, category, media_url FROM vectors WHERE category = ?'
    : 'SELECT id, embedding, content, category, media_url FROM vectors'
  const rows = (category ? db.prepare(sql).all(category) : db.prepare(sql).all()) as Array<{
    id: string; embedding: Buffer; content: string; category: string; media_url: string | null
  }>
  if (rows.length === 0) return []

  const qNorm = Math.sqrt(queryEmbedding.reduce((s, v) => s + v * v, 0))
  const scored = rows.map((row) => {
    const vec = bufferToFloat32(row.embedding)
    let dot = 0, norm = 0
    for (let i = 0; i < vec.length; i++) { dot += queryEmbedding[i] * vec[i]; norm += vec[i] * vec[i] }
    return { id: row.id, score: dot / (qNorm * Math.sqrt(norm) + 1e-10), content: row.content, category: row.category, mediaUrl: row.media_url }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topK)
}

// --- Stats ---

export function getStats() {
  const totalNotes = (db.prepare('SELECT COUNT(*) as c FROM vectors WHERE intent_type = ?').get('store') as any)?.c ?? 0
  const intentRows = db.prepare("SELECT intent_type, COUNT(*) as c FROM vectors GROUP BY intent_type").all() as Array<{ intent_type: string; c: number }>
  const intentDistribution: Record<string, number> = { store: 0, query: 0, chat: 0 }
  for (const r of intentRows) intentDistribution[r.intent_type] = r.c

  const activityRows = db.prepare(`
    SELECT date(timestamp/1000, 'unixepoch') as d, COUNT(*) as c
    FROM message_log WHERE timestamp > ? GROUP BY d ORDER BY d DESC LIMIT 7
  `).all(Date.now() - 7 * 86400000) as Array<{ d: string; c: number }>

  const vectorCount = (db.prepare('SELECT COUNT(*) as c FROM vectors').get() as any)?.c ?? 0

  return {
    totalNotes,
    vectorCount,
    intentDistribution,
    recentActivity: activityRows.map((r) => ({ date: r.d, count: r.c })).reverse(),
  }
}

// --- Notes ---

export function getNotes(q: string, category: string) {
  let sql = 'SELECT id, content, category, user_id, timestamp FROM vectors WHERE intent_type = ?'
  const params: any[] = ['store']
  if (category) { sql += ' AND category = ?'; params.push(category) }
  if (q) { sql += ' AND content LIKE ?'; params.push(`%${q}%`) }
  sql += ' ORDER BY timestamp DESC LIMIT 100'
  return db.prepare(sql).all(...params)
}

export function getFiles() {
  return db.prepare(
    'SELECT id, content, media_path, msg_type, timestamp FROM message_log WHERE media_path IS NOT NULL ORDER BY timestamp DESC LIMIT 200'
  ).all()
}

export function deleteVector(id: string) {
  db.prepare('DELETE FROM vectors WHERE id = ?').run(id)
}

// --- Cron Jobs ---

export interface CronJob {
  id: string
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
  created_at: number
  updated_at: number
}

export function createCronJob(job: Omit<CronJob, 'created_at' | 'updated_at'>): void {
  const now = Date.now()
  db.prepare(
    `INSERT INTO cron_jobs (id, name, user_id, schedule_kind, schedule_value, schedule_tz, payload, enabled, next_run_at, last_run_at, last_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(job.id, job.name, job.user_id, job.schedule_kind, job.schedule_value, job.schedule_tz, job.payload, job.enabled, job.next_run_at, job.last_run_at, job.last_status, now, now)
}

export function getCronJobs(userId?: string): CronJob[] {
  if (userId) {
    return db.prepare('SELECT * FROM cron_jobs WHERE user_id = ? ORDER BY created_at DESC').all(userId) as CronJob[]
  }
  return db.prepare('SELECT * FROM cron_jobs ORDER BY created_at DESC').all() as CronJob[]
}

export function getEnabledDueJobs(nowMs: number): CronJob[] {
  return db.prepare(
    'SELECT * FROM cron_jobs WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?'
  ).all(nowMs) as CronJob[]
}

export function updateCronJobAfterRun(id: string, status: string, nextRunAt: number | null): void {
  db.prepare(
    'UPDATE cron_jobs SET last_run_at = ?, last_status = ?, next_run_at = ?, updated_at = ? WHERE id = ?'
  ).run(Date.now(), status, nextRunAt, Date.now(), id)
}

export function updateCronJob(id: string, fields: Partial<Pick<CronJob, 'name' | 'payload' | 'enabled' | 'schedule_value' | 'next_run_at'>>): CronJob | null {
  const existing = db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get(id) as CronJob | undefined
  if (!existing) return null
  const updated = { ...existing, ...fields, updated_at: Date.now() }
  db.prepare(
    'UPDATE cron_jobs SET name = ?, payload = ?, enabled = ?, schedule_value = ?, next_run_at = ?, updated_at = ? WHERE id = ?'
  ).run(updated.name, updated.payload, updated.enabled, updated.schedule_value, updated.next_run_at, updated.updated_at, id)
  return updated
}

export function deleteCronJob(id: string): void {
  db.prepare('DELETE FROM cron_jobs WHERE id = ?').run(id)
}

export default db
