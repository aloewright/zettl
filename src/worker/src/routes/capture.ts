import { Hono } from 'hono'
import type { Context } from 'hono'
import type { HonoEnv } from '../types'
import { makeId } from '../types'
import { notes } from '../db/schema'

const router = new Hono<HonoEnv>()

// Shared secret auth for webhook sources (Telegram bot, email forwarder, etc.)
function checkWebhookSecret(c: Context<HonoEnv>): boolean {
  const secret = c.env.CAPTURE_WEBHOOK_SECRET
  if (!secret) return true // not configured → allow all (dev)
  const header = c.req.header('X-Webhook-Secret')
  return header === secret
}

// POST /api/capture/email
router.post('/email', async (c) => {
  if (!checkWebhookSecret(c)) return c.json({ error: 'Unauthorized' }, 401)

  const db = c.get('db')
  const body = await c.req.json<{
    subject?: string
    body?: string
    from?: string
    url?: string
  }>()

  const title = body.subject ?? 'Email capture'
  const content = body.body ?? ''

  if (!content) return c.json({ error: 'body is required' }, 400)

  const id = makeId()
  const now = new Date()

  await db.insert(notes).values({
    id,
    title,
    content,
    status: 'Fleeting',
    noteType: 'Regular',
    source: 'Email',
    sourceAuthor: body.from ?? null,
    sourceUrl: body.url ?? null,
    createdAt: now,
    updatedAt: now,
    embedStatus: 'Pending',
  })

  await c.env.EMBED_QUEUE.send({ noteId: id })

  // Enrich if URL provided
  if (body.url) {
    await c.env.ENRICH_QUEUE.send({ noteId: id, url: body.url })
  }

  return c.json({ id }, 201)
})

// POST /api/capture/telegram
router.post('/telegram', async (c) => {
  if (!checkWebhookSecret(c)) return c.json({ error: 'Unauthorized' }, 401)

  const db = c.get('db')
  const body = await c.req.json<{
    text?: string
    url?: string
    title?: string
  }>()

  const content = body.text ?? body.url ?? ''
  if (!content) return c.json({ error: 'text or url is required' }, 400)

  const title = body.title ?? (body.url ? 'Link capture' : content.slice(0, 80))
  const id = makeId()
  const now = new Date()

  await db.insert(notes).values({
    id,
    title,
    content,
    status: 'Fleeting',
    noteType: 'Regular',
    source: 'Telegram',
    sourceUrl: body.url ?? null,
    createdAt: now,
    updatedAt: now,
    embedStatus: 'Pending',
  })

  await c.env.EMBED_QUEUE.send({ noteId: id })

  if (body.url) {
    await c.env.ENRICH_QUEUE.send({ noteId: id, url: body.url })
  }

  return c.json({ id }, 201)
})

export default router
