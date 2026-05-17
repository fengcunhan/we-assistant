// Manual one-off: re-point all data from one bot_id onto another, then drop
// the now-empty source bot row. Use for ad-hoc merges the startup
// account-keyed migration doesn't cover (e.g. two genuinely different bot_ids
// that should be the same account). Backs up pi.db first; merge is in a single
// transaction.
//
//   node --import tsx src/merge-bots.ts <fromBotId> <toBotId>
//
// Run with the service stopped to avoid concurrent writes.

import Database from 'better-sqlite3'
import { copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { config } from './config.js'

const BOT_ID_TABLES = ['conversations', 'message_log', 'vectors', 'cron_jobs'] as const

function main(): void {
  const [, , fromId, toId] = process.argv
  if (!fromId || !toId) {
    console.error('Usage: node --import tsx src/merge-bots.ts <fromBotId> <toBotId>')
    process.exit(1)
  }
  if (fromId === toId) {
    console.error('❌ fromBotId 与 toBotId 不能相同')
    process.exit(1)
  }

  const dbPath = join(config.dataDir, 'pi.db')
  const backupPath = `${dbPath}.bak.${Date.now()}`
  copyFileSync(dbPath, backupPath)
  console.log(`📦 已备份: ${backupPath}`)

  const db = new Database(dbPath)
  try {
    const toExists = db.prepare('SELECT 1 FROM bots WHERE bot_id = ?').get(toId)
    if (!toExists) {
      console.error(`❌ 目标 bot 不存在: ${toId} (拒绝合并，避免把数据指向幽灵 bot)`)
      process.exit(1)
    }

    const before: Record<string, number> = {}
    for (const t of BOT_ID_TABLES) {
      before[t] = (db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE bot_id = ?`).get(fromId) as { c: number }).c
    }

    const merge = db.transaction(() => {
      for (const t of BOT_ID_TABLES) {
        db.prepare(`UPDATE ${t} SET bot_id = ? WHERE bot_id = ?`).run(toId, fromId)
      }
      db.prepare('DELETE FROM bots WHERE bot_id = ?').run(fromId)
    })
    merge()

    for (const t of BOT_ID_TABLES) {
      const total = (db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE bot_id = ?`).get(toId) as { c: number }).c
      console.log(`✅ ${t}: 迁移 ${before[t]} 行 → ${toId} (现共 ${total})`)
    }
    console.log(`🎉 合并完成: ${fromId} → ${toId} (源 bot 行已删除)`)
  } finally {
    db.close()
  }
}

main()
