import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Env } from './types'
import { chatCompletions } from './routes/chat'
import { notesRoutes } from './routes/notes'
import { statsRoute } from './routes/stats'

const app = new Hono<{ Bindings: Env }>()

app.use('/*', cors())

app.onError((err, c) => {
  return c.json({ error: err.message }, 500)
})

app.post('/v1/chat/completions', chatCompletions)

app.route('/api/notes', notesRoutes)
app.get('/api/stats', statsRoute)

app.get('/', (c) => c.json({ service: 'Pi Assistant', status: 'running' }))

export default app
