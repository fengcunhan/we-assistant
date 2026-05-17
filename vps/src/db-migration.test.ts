import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'

// Build a LEGACY pi.db (pre-bot_id schema) synchronously at module top — this
// runs before the before() hook (and before db.ts is imported), so db.ts's
// startup migration must add bot_id + backfill everything to the first bot.
const DATA_DIR = mkdtempSync(join(tmpdir(), 'pi-db-mig-'))
process.env.DATA_DIR = DATA_DIR
process.env.MEDIA_DIR = join(DATA_DIR, 'media')

const FIRST_BOT = 'legacybot@im.wechat'
const dbFile = join(DATA_DIR, 'pi.db')

{
  const legacy = new Database(dbFile)
  legacy.exec(`
    CREATE TABLE credentials (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, timestamp INTEGER NOT NULL
    );
    CREATE TABLE message_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id TEXT NOT NULL, direction TEXT NOT NULL, content TEXT NOT NULL,
      msg_type INTEGER NOT NULL DEFAULT 1, media_path TEXT, timestamp INTEGER NOT NULL
    );
    CREATE TABLE vectors (
      id TEXT PRIMARY KEY, embedding BLOB NOT NULL, content TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general', user_id TEXT NOT NULL DEFAULT '',
      intent_type TEXT NOT NULL DEFAULT 'store', media_url TEXT, timestamp INTEGER NOT NULL
    );
    CREATE TABLE cron_jobs (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, user_id TEXT NOT NULL,
      schedule_kind TEXT NOT NULL, schedule_value TEXT NOT NULL,
      schedule_tz TEXT NOT NULL DEFAULT 'Asia/Shanghai', payload TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1, next_run_at INTEGER, last_run_at INTEGER,
      last_status TEXT, job_type TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
  `)
  legacy
    .prepare('INSERT INTO credentials (key, value) VALUES (?, ?)')
    .run(
      'ilink_creds',
      JSON.stringify({ botToken: 'tok', ilinkBotId: FIRST_BOT, baseURL: 'https://x', ilinkUserId: 'uid' }),
    )
  legacy.prepare('INSERT INTO credentials (key, value) VALUES (?, ?)').run('ilink_cursor', 'CURSOR_123')
  legacy
    .prepare('INSERT INTO conversations (contact_id, role, content, timestamp) VALUES (?, ?, ?, ?)')
    .run('c1', 'user', 'legacy message', Date.now())
  legacy
    .prepare(
      'INSERT INTO message_log (contact_id, direction, content, msg_type, timestamp) VALUES (?, ?, ?, 1, ?)',
    )
    .run('c1', 'inbound', 'legacy log', Date.now())
  legacy
    .prepare(
      'INSERT INTO vectors (id, embedding, content, category, user_id, intent_type, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run('vec1', Buffer.from(new Float32Array([0.1, 0.2]).buffer), 'legacy note', 'general', 'c1', 'store', Date.now())
  legacy
    .prepare(
      `INSERT INTO cron_jobs (id, name, user_id, schedule_kind, schedule_value, schedule_tz, payload, enabled, next_run_at, last_run_at, last_status, job_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, NULL, NULL, 'message', ?, ?)`,
    )
    .run('job1', 'old reminder', 'c1', 'at', '2099-01-01T00:00:00', 'Asia/Shanghai', 'ping', 1, Date.now(), Date.now())
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

test('migration seeds the first bot row from legacy ilink_creds', () => {
  const all = db.getBots()
  assert.equal(all.length, 1)
  assert.equal(all[0].bot_id, FIRST_BOT)
  assert.equal(all[0].cursor, 'CURSOR_123')
  assert.equal(all[0].bot_token, 'tok')
})

test('migration backfills all legacy rows to the first bot', () => {
  for (const table of ['conversations', 'message_log', 'vectors', 'cron_jobs']) {
    const empties = raw.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE bot_id = ''`).get() as {
      c: number
    }
    assert.equal(empties.c, 0, `${table} still has rows with empty bot_id`)
    const mine = raw.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE bot_id = ?`).get(FIRST_BOT) as {
      c: number
    }
    assert.ok(mine.c >= 1, `${table} should have backfilled rows for ${FIRST_BOT}`)
  }
})

test('backfilled data is reachable through bot-scoped accessors', () => {
  assert.equal(db.getHistory(FIRST_BOT, 'c1').length, 1)
  assert.equal((db.getNotes(FIRST_BOT, '', '') as unknown[]).length, 1)
  assert.deepEqual(
    db.getCronJobs(FIRST_BOT).map((j) => j.id),
    ['job1'],
  )
})

test('migration end-state is idempotent (no empty bot_id, single bot row)', () => {
  assert.equal(db.getBots().length, 1)
  const anyEmpty = raw
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM conversations WHERE bot_id='') +
         (SELECT COUNT(*) FROM message_log WHERE bot_id='') +
         (SELECT COUNT(*) FROM vectors WHERE bot_id='') +
         (SELECT COUNT(*) FROM cron_jobs WHERE bot_id='') AS c`,
    )
    .get() as { c: number }
  assert.equal(anyEmpty.c, 0)
})
