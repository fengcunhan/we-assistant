import { Hono } from 'hono'
import type { Env, NoteMetadata } from '../types'
import { getEmbedding } from '../services/embedding'
import { insertVector, deleteVector, queryVectors } from '../services/vectorize'

export const notesRoutes = new Hono<{ Bindings: Env }>()

// List notes (search via embedding to get recent notes)
notesRoutes.get('/', async (c) => {
  const category = c.req.query('category')
  const searchQuery = c.req.query('q') ?? '所有笔记'
  const limit = parseInt(c.req.query('limit') ?? '20', 10)

  const embedding = await getEmbedding(searchQuery, c.env)
  const results = await queryVectors(c.env, embedding, limit)

  const notes = results
    .filter((r) => {
      if (r.metadata.intentType !== 'store') return false
      if (category && r.metadata.category !== category) return false
      return true
    })
    .map((r) => ({
      id: r.id,
      content: r.metadata.content,
      category: r.metadata.category,
      userId: r.metadata.userId,
      timestamp: r.metadata.timestamp,
      score: r.score,
    }))

  return c.json({ notes })
})

// Update a note
notesRoutes.put('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{ content: string; category?: string }>()

  if (!body.content) {
    return c.json({ error: 'content is required' }, 400)
  }

  const embedding = await getEmbedding(body.content, c.env)

  await insertVector(c.env, id, embedding, {
    content: body.content,
    category: body.category ?? 'general',
    userId: 'default_user',
    timestamp: Date.now(),
    intentType: 'store',
  })

  return c.json({ success: true, id })
})

// Delete a note
notesRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id')
  await deleteVector(c.env, id)
  return c.json({ success: true })
})

// Push note back to WeChat via WeClaw
notesRoutes.post('/:id/push', async (c) => {
  const weclawUrl = c.env.WECLAW_API_URL
  if (!weclawUrl) {
    return c.json({ error: 'WECLAW_API_URL not configured' }, 500)
  }

  const id = c.req.param('id')
  const body = await c.req.json<{ to: string; content: string }>()

  const response = await fetch(`${weclawUrl}/api/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: body.to,
      text: `[Pi 知识库更新] ${body.content}`,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    return c.json({ error: `WeClaw send failed: ${error}` }, 502)
  }

  return c.json({ success: true })
})
