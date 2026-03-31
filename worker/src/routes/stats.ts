import type { Context } from 'hono'
import type { Env } from '../types'
import { getEmbedding } from '../services/embedding'
import { queryVectors } from '../services/vectorize'

export async function statsRoute(c: Context<{ Bindings: Env }>) {
  try {
    const embedding = await getEmbedding('统计所有交互记录', c.env)
    const results = await queryVectors(c.env, embedding, 50)

    const distribution = { store: 0, query: 0, chat: 0 }
    const dailyCounts: Record<string, number> = {}

    for (const r of results) {
      if (!r.metadata) continue
      const intentType = r.metadata.intentType ?? 'chat'
      if (intentType in distribution) {
        distribution[intentType as keyof typeof distribution]++
      }

      const date = new Date(r.metadata.timestamp).toISOString().slice(0, 10)
      dailyCounts[date] = (dailyCounts[date] ?? 0) + 1
    }

    const recentActivity = Object.entries(dailyCounts)
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 7)
      .map(([date, count]) => ({ date, count }))

    return c.json({
      totalNotes: results.filter((r) => r.metadata.intentType === 'store').length,
      intentDistribution: distribution,
      recentActivity,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return c.json({ error: message }, 500)
  }
}
