import { Hono } from 'hono'
import { eq, desc } from 'drizzle-orm'
import type { HonoEnv } from '../types'
import { makeId } from '../types'
import { voiceExamples, voiceConfigs } from '../db/schema'

const router = new Hono<HonoEnv>()

// ── Examples ───────────────────────────────────────────────────────────────────

router.get('/examples', async (c) => {
  const db = c.get('db')
  const medium = c.req.query('medium')

  const rows = await db.select().from(voiceExamples)
    .where(medium ? eq(voiceExamples.medium, medium) : undefined)
    .orderBy(desc(voiceExamples.createdAt))

  return c.json(rows)
})

router.get('/examples/:id', async (c) => {
  const db = c.get('db')
  const [row] = await db.select().from(voiceExamples)
    .where(eq(voiceExamples.id, c.req.param('id')))
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

router.post('/examples', async (c) => {
  const db = c.get('db')
  const body = await c.req.json<{ medium: string; content: string }>()
  if (!body.medium || !body.content) {
    return c.json({ error: 'medium and content are required' }, 400)
  }

  const id = makeId()
  await db.insert(voiceExamples).values({ id, medium: body.medium, content: body.content, createdAt: new Date().toISOString() })
  const [created] = await db.select().from(voiceExamples).where(eq(voiceExamples.id, id))
  return c.json(created, 201)
})

router.delete('/examples/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')
  const [existing] = await db.select({ id: voiceExamples.id }).from(voiceExamples)
    .where(eq(voiceExamples.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  await db.delete(voiceExamples).where(eq(voiceExamples.id, id))
  return c.json({ deleted: true })
})

// ── Configs ────────────────────────────────────────────────────────────────────

router.get('/configs', async (c) => {
  const db = c.get('db')
  const medium = c.req.query('medium')

  const rows = await db.select().from(voiceConfigs)
    .where(medium ? eq(voiceConfigs.medium, medium) : undefined)

  return c.json(rows)
})

router.get('/configs/:id', async (c) => {
  const db = c.get('db')
  const [row] = await db.select().from(voiceConfigs)
    .where(eq(voiceConfigs.id, c.req.param('id')))
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

router.post('/configs', async (c) => {
  const db = c.get('db')
  const body = await c.req.json<{
    medium: string
    toneDescription?: string
    audienceDescription?: string
  }>()
  if (!body.medium) return c.json({ error: 'medium is required' }, 400)

  const id = makeId()
  await db.insert(voiceConfigs).values({
    id,
    medium: body.medium,
    toneDescription: body.toneDescription ?? null,
    audienceDescription: body.audienceDescription ?? null,
    updatedAt: new Date().toISOString(),
  })

  const [created] = await db.select().from(voiceConfigs).where(eq(voiceConfigs.id, id))
  return c.json(created, 201)
})

router.put('/configs/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')
  const body = await c.req.json<{
    toneDescription?: string
    audienceDescription?: string
  }>()

  const [existing] = await db.select().from(voiceConfigs).where(eq(voiceConfigs.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  await db.update(voiceConfigs).set({
    toneDescription: body.toneDescription !== undefined ? body.toneDescription : existing.toneDescription,
    audienceDescription: body.audienceDescription !== undefined ? body.audienceDescription : existing.audienceDescription,
    updatedAt: new Date().toISOString(),
  }).where(eq(voiceConfigs.id, id))

  const [updated] = await db.select().from(voiceConfigs).where(eq(voiceConfigs.id, id))
  return c.json(updated)
})

router.delete('/configs/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')
  const [existing] = await db.select({ id: voiceConfigs.id }).from(voiceConfigs)
    .where(eq(voiceConfigs.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  await db.delete(voiceConfigs).where(eq(voiceConfigs.id, id))
  return c.json({ deleted: true })
})

export default router
