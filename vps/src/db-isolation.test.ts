import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Isolate the SQLite file to a temp dir BEFORE db is imported (config reads
// env at import time). Done synchronously at module top so it runs before
// the before() hook and before any test.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'pi-db-iso-'))
process.env.MEDIA_DIR = join(process.env.DATA_DIR, 'media')

// Imported in before() (not top-level await) so test() registrations stay
// synchronous and the test runner counts them correctly.
let db: typeof import('./db.js')

before(async () => {
  const _log = console.log
  console.log = () => {}
  db = await import('./db.js')
  console.log = _log
})

const BOT_A = 'bot_A@im.wechat'
const BOT_B = 'bot_B@im.wechat'
const USER = 'userX@im.wechat'

function vec(): number[] {
  return Array.from({ length: 8 }, () => Math.random())
}

test('bots: upsert + list + getEnabled', () => {
  db.upsertBot({ ilink_user_id: BOT_A, ilink_bot_id: 'sess_A', bot_token: 'tA', base_url: 'u' })
  db.upsertBot({ ilink_user_id: BOT_B, ilink_bot_id: 'sess_B', bot_token: 'tB', base_url: 'u' })
  const all = db.getBots()
  assert.equal(all.length, 2)
  assert.ok(db.getBot(BOT_A))
  assert.equal(db.getEnabledBots().length, 2)
  db.setBotEnabled(BOT_B, false)
  assert.equal(db.getEnabledBots().length, 1)
  db.setBotEnabled(BOT_B, true)
})

test('re-scan (same account, new ephemeral id) reuses the row, keeps history', () => {
  const RESCAN_CONTACT = 'rescan_contact@im.wechat'
  db.addMessage(BOT_A, RESCAN_CONTACT, 'user', 'before re-scan')
  const canonical = db.upsertBot({
    ilink_user_id: BOT_A,
    ilink_bot_id: 'sess_A_v2',
    bot_token: 'tA2',
    base_url: 'u',
  })
  assert.equal(canonical, BOT_A, 'canonical id stays = ilink_user_id')
  assert.equal(db.getBots().length, 2, 're-scan must not create a new bot row')
  const row = db.getBot(BOT_A)!
  assert.equal(row.ilink_bot_id, 'sess_A_v2', 'ephemeral session id refreshed')
  assert.equal(row.bot_token, 'tA2', 'token refreshed')
  assert.deepEqual(
    db.getHistory(BOT_A, RESCAN_CONTACT).map((m) => m.content),
    ['before re-scan'],
    'prior history still reachable after re-scan',
  )
})

test('vectors are isolated per bot', () => {
  db.insertVector(BOT_A, 'v_a', vec(), 'secret of A', 'general', USER, 'store')
  db.insertVector(BOT_B, 'v_b', vec(), 'secret of B', 'general', USER, 'store')

  const q = vec()
  const aResults = db.queryVectors(BOT_A, q, 10)
  const bResults = db.queryVectors(BOT_B, q, 10)

  assert.ok(aResults.every((r) => r.id !== 'v_b'), 'A must not see B vectors')
  assert.ok(bResults.every((r) => r.id !== 'v_a'), 'B must not see A vectors')
  assert.ok(aResults.some((r) => r.id === 'v_a'))
})

test('conversation history is isolated per bot', () => {
  db.addMessage(BOT_A, USER, 'user', 'hello from A side')
  db.addMessage(BOT_B, USER, 'user', 'hello from B side')

  const aHist = db.getHistory(BOT_A, USER)
  const bHist = db.getHistory(BOT_B, USER)

  assert.equal(aHist.length, 1)
  assert.equal(aHist[0].content, 'hello from A side')
  assert.equal(bHist.length, 1)
  assert.equal(bHist[0].content, 'hello from B side')
})

test('cron jobs are isolated per bot but due-scan is global with bot_id', () => {
  const base = {
    name: 'r',
    user_id: USER,
    schedule_kind: 'at' as const,
    schedule_value: '2099-01-01T00:00:00',
    schedule_tz: 'Asia/Shanghai',
    payload: 'ping',
    enabled: 1,
    next_run_at: 1,
    last_run_at: null,
    last_status: null,
    job_type: 'message',
  }
  db.createCronJob({ ...base, id: 'j_a', bot_id: BOT_A })
  db.createCronJob({ ...base, id: 'j_b', bot_id: BOT_B })

  assert.deepEqual(
    db.getCronJobs(BOT_A).map((j) => j.id),
    ['j_a'],
  )
  assert.deepEqual(
    db.getCronJobs(BOT_B).map((j) => j.id),
    ['j_b'],
  )

  const due = db.getEnabledDueJobs(Date.now())
  const byId = Object.fromEntries(due.map((j) => [j.id, j.bot_id]))
  assert.equal(byId['j_a'], BOT_A)
  assert.equal(byId['j_b'], BOT_B)
})

test('stats are scoped per bot', () => {
  const sA = db.getStats(BOT_A)
  const sB = db.getStats(BOT_B)
  assert.equal(sA.totalNotes, 1)
  assert.equal(sB.totalNotes, 1)
  assert.ok(sA.vectorCount >= 1 && sB.vectorCount >= 1)
})

test('notes listing is scoped per bot', () => {
  const aNotes = db.getNotes(BOT_A, '', '') as Array<{ content: string }>
  assert.ok(aNotes.every((n) => n.content !== 'secret of B'))
  assert.ok(aNotes.some((n) => n.content === 'secret of A'))
})

test('deleteVector is bot-scoped (cannot cross-delete)', () => {
  db.deleteVector(BOT_B, 'v_a') // wrong bot — must be a no-op
  assert.ok(db.queryVectors(BOT_A, vec(), 10).some((r) => r.id === 'v_a'))
  db.deleteVector(BOT_A, 'v_a') // correct bot — removes it
  assert.ok(db.queryVectors(BOT_A, vec(), 10).every((r) => r.id !== 'v_a'))
})
