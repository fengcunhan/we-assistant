import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'

// Build a pre-fix MULTI-BOT pi.db (post per-bot-isolation, but BEFORE the
// account-keyed collapse): data tables already carry bot_id, but every QR
// re-login of the same WeChat account created a fresh ephemeral bot row
// (no ilink_bot_id column yet). db.ts's startup migration must collapse all
// of them onto a single canonical row keyed by ilink_user_id and repoint
// every data table — without losing a single message.
const DATA_DIR = mkdtempSync(join(tmpdir(), 'pi-db-acct-'))
process.env.DATA_DIR = DATA_DIR
process.env.MEDIA_DIR = join(DATA_DIR, 'media')

const ACCT = 'o9account@im.wechat' // stable ilink_user_id (becomes canonical bot_id)
const E1 = 'aaaa1111@im.bot' // first scan, never used, disabled
const E2 = 'bbbb2222@im.bot' // bulk history lives here, disabled
const E3 = 'cccc3333@im.bot' // current live session, enabled
const dbFile = join(DATA_DIR, 'pi.db')

function blob(): Buffer {
  return Buffer.from(new Float32Array([0.1, 0.2, 0.3]).buffer)
}

{
  const legacy = new Database(dbFile)
  legacy.exec(`
    CREATE TABLE credentials (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE bots (
      bot_id TEXT PRIMARY KEY, bot_token TEXT NOT NULL, base_url TEXT NOT NULL,
      ilink_user_id TEXT NOT NULL DEFAULT '', cursor TEXT NOT NULL DEFAULT '',
      nickname TEXT, enabled INTEGER NOT NULL DEFAULT 1,
      proactive_enabled INTEGER NOT NULL DEFAULT 0, proactive_user_id TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id TEXT NOT NULL DEFAULT '',
      contact_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, timestamp INTEGER NOT NULL
    );
    CREATE TABLE message_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id TEXT NOT NULL DEFAULT '',
      contact_id TEXT NOT NULL, direction TEXT NOT NULL, content TEXT NOT NULL,
      msg_type INTEGER NOT NULL DEFAULT 1, media_path TEXT, timestamp INTEGER NOT NULL
    );
    CREATE TABLE vectors (
      id TEXT PRIMARY KEY, embedding BLOB NOT NULL, content TEXT NOT NULL,
      bot_id TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'general',
      user_id TEXT NOT NULL DEFAULT '', intent_type TEXT NOT NULL DEFAULT 'store',
      media_url TEXT, timestamp INTEGER NOT NULL
    );
    CREATE TABLE cron_jobs (
      id TEXT PRIMARY KEY, bot_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL,
      user_id TEXT NOT NULL, schedule_kind TEXT NOT NULL, schedule_value TEXT NOT NULL,
      schedule_tz TEXT NOT NULL DEFAULT 'Asia/Shanghai', payload TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1, next_run_at INTEGER, last_run_at INTEGER,
      last_status TEXT, job_type TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
  `)

  const now = Date.now()
  const insBot = legacy.prepare(
    `INSERT INTO bots (bot_id, bot_token, base_url, ilink_user_id, cursor, nickname, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  insBot.run(E1, 'tok1', 'https://x', ACCT, '', E1, 0, now - 3000, now - 3000)
  insBot.run(E2, 'tok2', 'https://x', ACCT, 'CUR_OLD', E2, 0, now - 2000, now - 2000)
  insBot.run(E3, 'tok3', 'https://x', ACCT, 'CUR_LIVE', E3, 1, now - 1000, now - 1000)

  const insConv = legacy.prepare(
    'INSERT INTO conversations (bot_id, contact_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)',
  )
  for (let i = 0; i < 5; i++) insConv.run(E2, 'c1', 'user', `old msg ${i}`, now - 2000 + i)
  for (let i = 0; i < 2; i++) insConv.run(E3, 'c1', 'user', `live msg ${i}`, now - 500 + i)

  const insLog = legacy.prepare(
    'INSERT INTO message_log (bot_id, contact_id, direction, content, msg_type, timestamp) VALUES (?, ?, ?, ?, 1, ?)',
  )
  for (let i = 0; i < 6; i++) insLog.run(E2, 'c1', 'inbound', `log ${i}`, now - 2000 + i)
  for (let i = 0; i < 2; i++) insLog.run(E3, 'c1', 'inbound', `live log ${i}`, now - 500 + i)

  const insVec = legacy.prepare(
    'INSERT INTO vectors (id, embedding, content, bot_id, category, user_id, intent_type, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
  for (let i = 0; i < 3; i++) insVec.run(`v${i}`, blob(), `note ${i}`, E2, 'general', 'c1', 'store', now)

  legacy
    .prepare(
      `INSERT INTO cron_jobs (id, bot_id, name, user_id, schedule_kind, schedule_value, schedule_tz, payload, enabled, next_run_at, last_run_at, last_status, job_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NULL, NULL, 'message', ?, ?)`,
    )
    .run('job1', E2, 'old reminder', 'c1', 'at', '2099-01-01T00:00:00', 'Asia/Shanghai', 'ping', now, now, now)

  legacy.close()
}

let db: typeof import('./db.js')
let raw: import('better-sqlite3').Database

before(async () => {
  const _log = console.log
  console.log = () => {}
  db = await import('./db.js')
  console.log = _log
  raw = db.default
})

test('all ephemeral bot rows collapse into one canonical (ilink_user_id) row', () => {
  const all = db.getBots()
  assert.equal(all.length, 1)
  const bot = all[0]
  assert.equal(bot.bot_id, ACCT, 'canonical bot_id := ilink_user_id')
  assert.equal(bot.ilink_user_id, ACCT)
  assert.equal(bot.ilink_bot_id, E3, 'live session id (enabled row) demoted to ilink_bot_id')
  assert.equal(bot.enabled, 1, 'inherits the enabled/live row state')
  assert.equal(bot.cursor, 'CUR_LIVE', 'keeps the live login cursor')
  assert.equal(bot.bot_token, 'tok3', 'keeps the live login token')
})

test('every data row is repointed to the canonical id (none orphaned)', () => {
  for (const table of ['conversations', 'message_log', 'vectors', 'cron_jobs']) {
    const orphan = raw
      .prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE bot_id IN (?, ?, ?) OR bot_id = ''`)
      .get(E1, E2, E3) as { c: number }
    assert.equal(orphan.c, 0, `${table} still has rows under an ephemeral bot_id`)
  }
})

test('row counts are conserved through the merge', () => {
  const count = (t: string) =>
    (raw.prepare(`SELECT COUNT(*) AS c FROM ${t} WHERE bot_id = ?`).get(ACCT) as { c: number }).c
  assert.equal(count('conversations'), 7, '5 old + 2 live messages')
  assert.equal(count('message_log'), 8, '6 old + 2 live logs')
  assert.equal(count('vectors'), 3)
  assert.equal(count('cron_jobs'), 1)
})

test('merged history is reachable through bot-scoped accessors', () => {
  const hist = db.getHistory(ACCT, 'c1', 100)
  assert.equal(hist.length, 7)
  assert.ok(hist.some((m) => m.content === 'old msg 0'))
  assert.ok(hist.some((m) => m.content === 'live msg 1'))
  assert.equal((db.getNotes(ACCT, '', '') as unknown[]).length, 3)
  assert.deepEqual(
    db.getCronJobs(ACCT).map((j) => j.id),
    ['job1'],
  )
})

test('end-state is idempotent (no ephemeral rows remain anywhere)', () => {
  const all = db.getBots()
  assert.equal(all.length, 1)
  assert.equal(all[0].bot_id, ACCT)
  const strayBots = raw
    .prepare('SELECT COUNT(*) AS c FROM bots WHERE bot_id != ilink_user_id')
    .get() as { c: number }
  assert.equal(strayBots.c, 0)
})
