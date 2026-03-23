import { Hono } from 'hono'
import { eq, desc, and } from 'drizzle-orm'
import type { HonoEnv } from '../types'
import { makeId } from '../types'
import { researchAgendas, researchTasks, researchFindings, notes } from '../db/schema'

const router = new Hono<HonoEnv>()

// ── Agendas ────────────────────────────────────────────────────────────────────

router.get('/agendas', async (c) => {
  const db = c.get('db')
  const status = c.req.query('status')

  const rows = await db.select().from(researchAgendas)
    .where(status ? eq(researchAgendas.status, status) : undefined)
    .orderBy(desc(researchAgendas.createdAt))
    .limit(50)

  return c.json(rows)
})

router.get('/agendas/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')

  const [agenda] = await db.select().from(researchAgendas)
    .where(eq(researchAgendas.id, id))
  if (!agenda) return c.json({ error: 'Not found' }, 404)

  const tasks = await db.select().from(researchTasks)
    .where(eq(researchTasks.agendaId, id))

  return c.json({ ...agenda, tasks })
})

router.post('/agendas', async (c) => {
  const db = c.get('db')
  const body = await c.req.json<{
    triggeredFromNoteId?: string
    tasks: Array<{
      query: string
      sourceType: string
      motivation: string
      motivationNoteId?: string
    }>
  }>()

  if (!body.tasks?.length) return c.json({ error: 'tasks are required' }, 400)

  const agendaId = makeId()
  await db.insert(researchAgendas).values({
    id: agendaId,
    triggeredFromNoteId: body.triggeredFromNoteId ?? null,
    status: 'Pending',
  })

  await db.insert(researchTasks).values(body.tasks.map(t => ({
    id: makeId(),
    agendaId,
    query: t.query,
    sourceType: t.sourceType,
    motivation: t.motivation,
    motivationNoteId: t.motivationNoteId ?? null,
    status: 'Pending',
  })))

  const [created] = await db.select().from(researchAgendas)
    .where(eq(researchAgendas.id, agendaId))
  const tasks = await db.select().from(researchTasks)
    .where(eq(researchTasks.agendaId, agendaId))

  return c.json({ ...created, tasks }, 201)
})

router.post('/agendas/:id/approve', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')

  const [existing] = await db.select().from(researchAgendas)
    .where(eq(researchAgendas.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  await db.update(researchAgendas).set({
    status: 'Approved',
    approvedAt: new Date(),
  }).where(eq(researchAgendas.id, id))

  const [updated] = await db.select().from(researchAgendas)
    .where(eq(researchAgendas.id, id))
  return c.json(updated)
})

router.delete('/agendas/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')
  const [existing] = await db.select({ id: researchAgendas.id }).from(researchAgendas)
    .where(eq(researchAgendas.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  await db.delete(researchAgendas).where(eq(researchAgendas.id, id))
  return c.json({ deleted: true })
})

// ── Tasks ──────────────────────────────────────────────────────────────────────

router.put('/tasks/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')
  const body = await c.req.json<{ status?: string; blockedAt?: string | null }>()

  const [existing] = await db.select().from(researchTasks)
    .where(eq(researchTasks.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  await db.update(researchTasks).set({
    status: body.status ?? existing.status,
    blockedAt: body.blockedAt !== undefined
      ? (body.blockedAt ? new Date(body.blockedAt) : null)
      : existing.blockedAt,
  }).where(eq(researchTasks.id, id))

  const [updated] = await db.select().from(researchTasks)
    .where(eq(researchTasks.id, id))
  return c.json(updated)
})

// ── Findings ───────────────────────────────────────────────────────────────────

router.get('/findings', async (c) => {
  const db = c.get('db')
  const { status, page = '1', pageSize = '20' } = c.req.query()
  const pageNum = Math.max(1, parseInt(page))
  const size = Math.min(100, Math.max(1, parseInt(pageSize)))
  const offset = (pageNum - 1) * size

  const condition = status ? eq(researchFindings.status, status) : undefined

  const [rows, countRows] = await Promise.all([
    db.select().from(researchFindings)
      .where(condition)
      .orderBy(desc(researchFindings.createdAt))
      .limit(size).offset(offset),
    db.select({ count: researchFindings.id }).from(researchFindings).where(condition),
  ])

  return c.json({ items: rows, totalCount: countRows.length })
})

router.get('/findings/:id', async (c) => {
  const db = c.get('db')
  const [finding] = await db.select().from(researchFindings)
    .where(eq(researchFindings.id, c.req.param('id')))
  if (!finding) return c.json({ error: 'Not found' }, 404)
  return c.json(finding)
})

router.post('/findings', async (c) => {
  const db = c.get('db')
  const body = await c.req.json<{
    taskId: string
    title: string
    synthesis: string
    sourceUrl: string
    sourceType: string
    similarNoteIds?: string[]
    duplicateSimilarity?: number
  }>()

  if (!body.taskId || !body.title || !body.synthesis || !body.sourceUrl || !body.sourceType) {
    return c.json({ error: 'taskId, title, synthesis, sourceUrl, sourceType are required' }, 400)
  }

  const id = makeId()
  await db.insert(researchFindings).values({
    id,
    taskId: body.taskId,
    title: body.title,
    synthesis: body.synthesis,
    sourceUrl: body.sourceUrl,
    sourceType: body.sourceType,
    similarNoteIds: JSON.stringify(body.similarNoteIds ?? []),
    duplicateSimilarity: body.duplicateSimilarity ?? null,
    status: 'Pending',
  })

  const [created] = await db.select().from(researchFindings)
    .where(eq(researchFindings.id, id))
  return c.json(created, 201)
})

router.post('/findings/:id/accept', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')

  const [finding] = await db.select().from(researchFindings)
    .where(eq(researchFindings.id, id))
  if (!finding) return c.json({ error: 'Not found' }, 404)

  // Create a fleeting note from the finding
  const noteId = makeId()
  const now = new Date()

  await db.insert(notes).values({
    id: noteId,
    title: finding.title,
    content: finding.synthesis,
    status: 'Fleeting',
    noteType: 'Regular',
    source: 'Research',
    sourceUrl: finding.sourceUrl,
    sourceType: finding.sourceType,
    createdAt: now,
    updatedAt: now,
    embedStatus: 'Pending',
  })

  await db.update(researchFindings).set({
    status: 'Accepted',
    acceptedFleetingNoteId: noteId,
    reviewedAt: now,
  }).where(eq(researchFindings.id, id))

  const [updated] = await db.select().from(researchFindings)
    .where(eq(researchFindings.id, id))
  return c.json({ finding: updated, noteId })
})

router.post('/findings/:id/reject', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')

  const [existing] = await db.select({ id: researchFindings.id }).from(researchFindings)
    .where(eq(researchFindings.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  await db.update(researchFindings).set({
    status: 'Rejected',
    reviewedAt: new Date(),
  }).where(eq(researchFindings.id, id))

  const [updated] = await db.select().from(researchFindings)
    .where(eq(researchFindings.id, id))
  return c.json(updated)
})

export default router
