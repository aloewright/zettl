import { Hono } from 'hono'
import { eq, desc, and, sql, inArray } from 'drizzle-orm'
import type { HonoEnv } from '../types'
import { makeId } from '../types'
import {
  contentGenerations,
  contentPieces,
  usedSeedNotes,
  notes,
  noteTags,
} from '../db/schema'
import { buildOpenAI } from '../services/embeddings'
import { isoNow } from '../types'

const router = new Hono<HonoEnv>()

// ── Generations ────────────────────────────────────────────────────────────────

router.get('/generations', async (c) => {
  const db = c.get('db')
  const { status, page = '1', pageSize = '20' } = c.req.query()
  const pageNum = Math.max(1, parseInt(page))
  const size = Math.min(100, Math.max(1, parseInt(pageSize)))
  const offset = (pageNum - 1) * size

  const condition = status ? eq(contentGenerations.status, status) : undefined
  const [rows, countRows] = await Promise.all([
    db.select().from(contentGenerations)
      .where(condition)
      .orderBy(desc(contentGenerations.generatedAt))
      .limit(size).offset(offset),
    db.select({ count: sql<number>`count(*)::int` })
      .from(contentGenerations).where(condition),
  ])

  return c.json({ items: rows, totalCount: countRows[0]?.count ?? 0 })
})

router.get('/generations/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')

  const [gen] = await db.select().from(contentGenerations)
    .where(eq(contentGenerations.id, id))
  if (!gen) return c.json({ error: 'Not found' }, 404)

  const pieces = await db.select().from(contentPieces)
    .where(eq(contentPieces.generationId, id))
    .orderBy(contentPieces.medium)

  return c.json({ ...gen, pieces })
})

router.post('/generations', async (c) => {
  const db = c.get('db')

  const body = await c.req.json<{
    seedNoteId: string
    clusterNoteIds?: string[]
    topicSummary: string
  }>()

  if (!body.seedNoteId || !body.topicSummary) {
    return c.json({ error: 'seedNoteId and topicSummary are required' }, 400)
  }

  const id = makeId()

  await db.insert(contentGenerations).values({
    id,
    seedNoteId: body.seedNoteId,
    clusterNoteIds: JSON.stringify(body.clusterNoteIds ?? []),
    topicSummary: body.topicSummary,
    status: 'Pending',
    generatedAt: isoNow(),
  })

  // Mark seed note as used
  await db.insert(usedSeedNotes).values({ noteId: body.seedNoteId, usedAt: isoNow() })
    .onConflictDoNothing()

  const [created] = await db.select().from(contentGenerations)
    .where(eq(contentGenerations.id, id))
  return c.json(created, 201)
})

router.put('/generations/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')
  const body = await c.req.json<{ status?: string; reviewedAt?: string }>()

  const [existing] = await db.select().from(contentGenerations)
    .where(eq(contentGenerations.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  await db.update(contentGenerations).set({
    status: body.status ?? existing.status,
    reviewedAt: body.reviewedAt ? new Date(body.reviewedAt) : existing.reviewedAt,
  }).where(eq(contentGenerations.id, id))

  const [updated] = await db.select().from(contentGenerations)
    .where(eq(contentGenerations.id, id))
  return c.json(updated)
})

router.delete('/generations/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')

  const [existing] = await db.select({ id: contentGenerations.id })
    .from(contentGenerations).where(eq(contentGenerations.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  await db.delete(contentGenerations).where(eq(contentGenerations.id, id))
  return c.json({ deleted: true })
})

// ── Pieces ─────────────────────────────────────────────────────────────────────

router.get('/pieces', async (c) => {
  const db = c.get('db')
  const { status, medium, page = '1', pageSize = '20' } = c.req.query()
  const pageNum = Math.max(1, parseInt(page))
  const size = Math.min(100, Math.max(1, parseInt(pageSize)))
  const offset = (pageNum - 1) * size

  const conditions = []
  if (status) conditions.push(eq(contentPieces.status, status))
  if (medium) conditions.push(eq(contentPieces.medium, medium))
  const condition = conditions.length ? and(...conditions) : undefined

  const [rows, countRows] = await Promise.all([
    db.select().from(contentPieces)
      .where(condition)
      .orderBy(desc(contentPieces.createdAt))
      .limit(size).offset(offset),
    db.select({ count: sql<number>`count(*)::int` })
      .from(contentPieces).where(condition),
  ])

  return c.json({ items: rows, totalCount: countRows[0]?.count ?? 0 })
})

router.get('/pieces/:id', async (c) => {
  const db = c.get('db')
  const [piece] = await db.select().from(contentPieces)
    .where(eq(contentPieces.id, c.req.param('id')))
  if (!piece) return c.json({ error: 'Not found' }, 404)
  return c.json(piece)
})

router.post('/pieces', async (c) => {
  const db = c.get('db')
  const body = await c.req.json<{
    generationId: string
    medium: string
    body: string
    description?: string
    generatedTags?: string[]
  }>()

  if (!body.generationId || !body.medium || !body.body) {
    return c.json({ error: 'generationId, medium, and body are required' }, 400)
  }

  const id = makeId()
  await db.insert(contentPieces).values({
    id,
    generationId: body.generationId,
    medium: body.medium,
    body: body.body,
    description: body.description ?? null,
    generatedTags: JSON.stringify(body.generatedTags ?? []),
    status: 'Draft',
  })

  const [created] = await db.select().from(contentPieces).where(eq(contentPieces.id, id))
  return c.json(created, 201)
})

router.put('/pieces/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')
  const body = await c.req.json<{
    body?: string
    description?: string
    generatedTags?: string[]
    status?: string
    reviewedAt?: string
  }>()

  const [existing] = await db.select().from(contentPieces).where(eq(contentPieces.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  await db.update(contentPieces).set({
    body: body.body ?? existing.body,
    description: body.description !== undefined ? body.description : existing.description,
    generatedTags: body.generatedTags !== undefined
      ? JSON.stringify(body.generatedTags)
      : existing.generatedTags,
    status: body.status ?? existing.status,
    reviewedAt: body.reviewedAt ? new Date(body.reviewedAt) : existing.reviewedAt,
  }).where(eq(contentPieces.id, id))

  const [updated] = await db.select().from(contentPieces).where(eq(contentPieces.id, id))
  return c.json(updated)
})

router.delete('/pieces/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')

  const [existing] = await db.select({ id: contentPieces.id })
    .from(contentPieces).where(eq(contentPieces.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  await db.delete(contentPieces).where(eq(contentPieces.id, id))
  return c.json({ deleted: true })
})

router.post('/pieces/:id/publish', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')

  const [existing] = await db.select().from(contentPieces).where(eq(contentPieces.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  await db.update(contentPieces).set({
    status: 'Published',
    reviewedAt: new Date(),
  }).where(eq(contentPieces.id, id))

  const [updated] = await db.select().from(contentPieces).where(eq(contentPieces.id, id))
  return c.json(updated)
})

// ── Seed note pool ─────────────────────────────────────────────────────────────

router.get('/seed-candidates', async (c) => {
  const db = c.get('db')
  const medium = c.req.query('medium') ?? 'Blog'
  const limit = parseInt(c.req.query('limit') ?? '10')

  // Permanent notes with embeddings not yet used as seeds
  const rows = await db.select({
    id: notes.id,
    title: notes.title,
    content: notes.content,
    createdAt: notes.createdAt,
  }).from(notes)
    .where(and(
      eq(notes.status, 'Permanent'),
      eq(notes.embedStatus, 'Done'),
      sql`"Id" NOT IN (SELECT "NoteId" FROM "UsedSeedNotes")`,
    ))
    .orderBy(sql`RANDOM()`)
    .limit(limit)

  return c.json(rows)
})

export default router
