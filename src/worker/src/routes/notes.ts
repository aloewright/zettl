import { Hono } from 'hono'
import { eq, desc, and, sql, inArray } from 'drizzle-orm'
import type { HonoEnv } from '../types'
import { makeId, isoNow } from '../types'
import { notes, noteTags, noteVersions } from '../db/schema'
import { hybridSearch, fullTextSearch, findRelated } from '../services/search'
import { generateEmbeddingAI } from '../services/embeddings'

const router = new Hono<HonoEnv>()

// ── List / inbox ───────────────────────────────────────────────────────────────

router.get('/', async (c) => {
  const db = c.get('db')
  const { status, noteType, page = '1', pageSize = '20' } = c.req.query()

  const pageNum = Math.max(1, parseInt(page))
  const size = Math.min(100, Math.max(1, parseInt(pageSize)))
  const offset = (pageNum - 1) * size

  const conditions = []
  if (status) conditions.push(eq(notes.status, status))
  if (noteType) conditions.push(eq(notes.noteType, noteType))

  const [rows, countRows] = await Promise.all([
    db.select().from(notes)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(notes.createdAt))
      .limit(size)
      .offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(notes)
      .where(conditions.length ? and(...conditions) : undefined),
  ])

  const noteIds = rows.map(r => r.id)
  const tags = noteIds.length
    ? await db.select().from(noteTags).where(inArray(noteTags.noteId, noteIds))
    : []

  const tagMap = tags.reduce<Record<string, string[]>>((acc, t) => {
    ;(acc[t.noteId] ??= []).push(t.tag)
    return acc
  }, {})

  return c.json({
    items: rows.map(r => ({ ...r, tags: tagMap[r.id] ?? [] })),
    totalCount: countRows[0]?.count ?? 0,
  })
})

router.get('/inbox', async (c) => {
  const db = c.get('db')
  const rows = await db.select().from(notes)
    .where(eq(notes.status, 'Fleeting'))
    .orderBy(desc(notes.createdAt))
    .limit(100)

  const noteIds = rows.map(r => r.id)
  const tags = noteIds.length
    ? await db.select().from(noteTags).where(inArray(noteTags.noteId, noteIds))
    : []
  const tagMap = tags.reduce<Record<string, string[]>>((acc, t) => {
    ;(acc[t.noteId] ??= []).push(t.tag)
    return acc
  }, {})

  return c.json(rows.map(r => ({ ...r, tags: tagMap[r.id] ?? [] })))
})

router.get('/inbox/count', async (c) => {
  const db = c.get('db')
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(notes)
    .where(eq(notes.status, 'Fleeting'))
  return c.json({ count: row?.count ?? 0 })
})

router.get('/discover', async (c) => {
  const db = c.get('db')
  const rows = await db.select().from(notes)
    .where(and(eq(notes.status, 'Permanent'), eq(notes.noteType, 'Regular')))
    .orderBy(sql`RANDOM()`)
    .limit(5)

  const noteIds = rows.map(r => r.id)
  const tags = noteIds.length
    ? await db.select().from(noteTags).where(inArray(noteTags.noteId, noteIds))
    : []
  const tagMap = tags.reduce<Record<string, string[]>>((acc, t) => {
    ;(acc[t.noteId] ??= []).push(t.tag)
    return acc
  }, {})

  return c.json(rows.map(r => ({ ...r, tags: tagMap[r.id] ?? [] })))
})

router.get('/search-titles', async (c) => {
  const db = c.get('db')
  const q = c.req.query('q') ?? ''
  if (!q) return c.json([])

  const rows = await db.select({ id: notes.id, title: notes.title })
    .from(notes)
    .where(sql`lower("Title") LIKE lower(${`%${q}%`})`)
    .orderBy(notes.title)
    .limit(20)

  return c.json(rows)
})

router.post('/check-duplicate', async (c) => {
  const body = await c.req.json<{ content: string; minimumSimilarity?: number }>()
  if (!body.content) return c.json({ error: 'content required' }, 400)

  const minSim = body.minimumSimilarity ?? 0.92
  const embedding = await generateEmbeddingAI(c.env, body.content)

  const vecResults = await c.env.vector_db.query(embedding, {
    topK: 5,
    returnMetadata: 'all',
  })

  const matches = vecResults.matches.filter(m => (m.score ?? 0) >= minSim)
  if (!matches.length) return c.json({ duplicates: [] })

  // Fetch titles from D1
  const ids = matches.map(m => m.id)
  const placeholders = ids.map(() => '?').join(',')
  const { results } = await c.env.d1_db
    .prepare(`SELECT "Id" AS noteId, "Title" AS title FROM "Notes" WHERE "Id" IN (${placeholders})`)
    .bind(...ids)
    .all<{ noteId: string; title: string }>()

  const titleMap = new Map((results ?? []).map(r => [r.noteId, r.title]))

  const duplicates = matches.map(m => ({
    noteId: m.id,
    title: titleMap.get(m.id) ?? '',
    similarity: m.score ?? 0,
  }))

  return c.json({ duplicates })
})

router.post('/re-embed', async (c) => {
  const db = c.get('db')
  await db.update(notes)
    .set({ embedStatus: 'Stale' })
    .where(eq(notes.embedStatus, 'Done'))
  return c.json({ queued: true })
})

// ── Single note ────────────────────────────────────────────────────────────────

router.get('/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')

  const [note] = await db.select().from(notes).where(eq(notes.id, id))
  if (!note) return c.json({ error: 'Not found' }, 404)

  const tags = await db.select({ tag: noteTags.tag })
    .from(noteTags).where(eq(noteTags.noteId, id))

  return c.json({ ...note, tags: tags.map(t => t.tag) })
})

router.post('/', async (c) => {
  const db = c.get('db')
  const body = await c.req.json<{
    title: string
    content: string
    status?: string
    noteType?: string
    source?: string
    sourceAuthor?: string
    sourceTitle?: string
    sourceUrl?: string
    sourceYear?: number
    sourceType?: string
    tags?: string[]
  }>()

  if (!body.title || !body.content) {
    return c.json({ error: 'title and content are required' }, 400)
  }

  const id = makeId()
  const now = isoNow()

  await db.insert(notes).values({
    id,
    title: body.title,
    content: body.content,
    status: body.status ?? 'Fleeting',
    noteType: body.noteType ?? 'Regular',
    source: body.source ?? null,
    sourceAuthor: body.sourceAuthor ?? null,
    sourceTitle: body.sourceTitle ?? null,
    sourceUrl: body.sourceUrl ?? null,
    sourceYear: body.sourceYear ?? null,
    sourceType: body.sourceType ?? null,
    createdAt: now,
    updatedAt: now,
    embedStatus: 'Pending',
  })

  if (body.tags?.length) {
    await db.insert(noteTags).values(body.tags.map(tag => ({ noteId: id, tag })))
  }

  await c.env.EMBED_QUEUE.send({ noteId: id })

  const [created] = await db.select().from(notes).where(eq(notes.id, id))
  return c.json({ ...created, tags: body.tags ?? [] }, 201)
})

router.put('/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')

  const [existing] = await db.select().from(notes).where(eq(notes.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const body = await c.req.json<{
    title?: string
    content?: string
    status?: string
    noteType?: string
    sourceAuthor?: string
    sourceTitle?: string
    sourceUrl?: string
    sourceYear?: number
    sourceType?: string
    tags?: string[]
  }>()

  // Save version before updating
  const existingTags = await db.select({ tag: noteTags.tag })
    .from(noteTags).where(eq(noteTags.noteId, id))
  await db.insert(noteVersions).values({
    noteId: id,
    title: existing.title,
    content: existing.content,
    tags: existingTags.map(t => t.tag).join(','),
    savedAt: isoNow(),
  })

  const contentChanged = body.content !== undefined && body.content !== existing.content

  await db.update(notes).set({
    title: body.title ?? existing.title,
    content: body.content ?? existing.content,
    status: body.status ?? existing.status,
    noteType: body.noteType ?? existing.noteType,
    sourceAuthor: body.sourceAuthor !== undefined ? body.sourceAuthor : existing.sourceAuthor,
    sourceTitle: body.sourceTitle !== undefined ? body.sourceTitle : existing.sourceTitle,
    sourceUrl: body.sourceUrl !== undefined ? body.sourceUrl : existing.sourceUrl,
    sourceYear: body.sourceYear !== undefined ? body.sourceYear : existing.sourceYear,
    sourceType: body.sourceType !== undefined ? body.sourceType : existing.sourceType,
    updatedAt: isoNow(),
    ...(contentChanged ? { embedStatus: 'Stale' } : {}),
  }).where(eq(notes.id, id))

  if (body.tags !== undefined) {
    await db.delete(noteTags).where(eq(noteTags.noteId, id))
    if (body.tags.length) {
      await db.insert(noteTags).values(body.tags.map(tag => ({ noteId: id, tag })))
    }
  }

  if (contentChanged) {
    await c.env.EMBED_QUEUE.send({ noteId: id })
  }

  const [updated] = await db.select().from(notes).where(eq(notes.id, id))
  const tags = await db.select({ tag: noteTags.tag }).from(noteTags).where(eq(noteTags.noteId, id))
  return c.json({ ...updated, tags: tags.map(t => t.tag) })
})

router.delete('/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')

  const [existing] = await db.select({ id: notes.id }).from(notes).where(eq(notes.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  await db.delete(notes).where(eq(notes.id, id))
  // Also delete from Vectorize
  await c.env.vector_db.deleteByIds([id])
  return c.json({ deleted: true })
})

router.post('/:id/promote', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')

  const [existing] = await db.select().from(notes).where(eq(notes.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  await db.update(notes).set({ status: 'Permanent', updatedAt: isoNow() }).where(eq(notes.id, id))
  const [updated] = await db.select().from(notes).where(eq(notes.id, id))
  const tags = await db.select({ tag: noteTags.tag }).from(noteTags).where(eq(noteTags.noteId, id))
  return c.json({ ...updated, tags: tags.map(t => t.tag) })
})

// ── Related / backlinks ────────────────────────────────────────────────────────

router.get('/:id/related', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')
  const minSim = parseFloat(c.req.query('minimumSimilarity') ?? '0.7')
  const limit = parseInt(c.req.query('limit') ?? '5')

  const results = await findRelated(c.env.vector_db, db, id, minSim, limit)
  return c.json(results)
})

router.get('/:id/backlinks', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')

  const [note] = await db.select({ title: notes.title }).from(notes).where(eq(notes.id, id))
  if (!note) return c.json({ error: 'Not found' }, 404)

  // Find notes whose content contains a wiki-link [[title]] or the note id
  const { results } = await c.env.d1_db
    .prepare(`
      SELECT "Id" AS id, "Title" AS title
      FROM "Notes"
      WHERE "Id" != ?
        AND ("Content" LIKE ? OR "Content" LIKE ?)
      ORDER BY "Title"
      LIMIT 50
    `)
    .bind(id, `%[[${note.title}]]%`, `%${id}%`)
    .all<{ id: string; title: string }>()

  return c.json(results ?? [])
})

// ── Merge ──────────────────────────────────────────────────────────────────────

router.post('/:fleetingId/merge/:targetId', async (c) => {
  const db = c.get('db')
  const { fleetingId, targetId } = c.req.param()

  const [fleeting] = await db.select().from(notes).where(eq(notes.id, fleetingId))
  const [target] = await db.select().from(notes).where(eq(notes.id, targetId))
  if (!fleeting || !target) return c.json({ error: 'Note not found' }, 404)

  const fleetingTags = await db.select({ tag: noteTags.tag })
    .from(noteTags).where(eq(noteTags.noteId, fleetingId))

  // Save version of target before merging
  const targetTags = await db.select({ tag: noteTags.tag })
    .from(noteTags).where(eq(noteTags.noteId, targetId))
  await db.insert(noteVersions).values({
    noteId: targetId,
    title: target.title,
    content: target.content,
    tags: targetTags.map(t => t.tag).join(','),
    savedAt: isoNow(),
  })

  const mergedContent = `${target.content}\n\n---\n\n${fleeting.content}`
  const mergedTagSet = new Set([...targetTags.map(t => t.tag), ...fleetingTags.map(t => t.tag)])

  await db.update(notes).set({
    content: mergedContent,
    updatedAt: isoNow(),
    embedStatus: 'Stale',
  }).where(eq(notes.id, targetId))

  await db.delete(noteTags).where(eq(noteTags.noteId, targetId))
  if (mergedTagSet.size) {
    await db.insert(noteTags).values([...mergedTagSet].map(tag => ({ noteId: targetId, tag })))
  }

  await db.delete(notes).where(eq(notes.id, fleetingId))
  // Delete fleeting note vector from Vectorize
  await c.env.vector_db.deleteByIds([fleetingId])
  await c.env.EMBED_QUEUE.send({ noteId: targetId })

  const [updated] = await db.select().from(notes).where(eq(notes.id, targetId))
  return c.json({ ...updated, tags: [...mergedTagSet] })
})

// ── Suggested tags ─────────────────────────────────────────────────────────────

router.get('/:id/suggested-tags', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')

  const [note] = await db.select().from(notes).where(eq(notes.id, id))
  if (!note) return c.json({ error: 'Not found' }, 404)

  // Find semantically similar notes and collect their tags
  const similar = await findRelated(c.env.vector_db, db, id, 0.7, 10)
  if (!similar.length) return c.json({ suggestions: [] })

  const similarIds = similar.map(r => r.noteId)
  const tags = await db.select({ tag: noteTags.tag })
    .from(noteTags).where(inArray(noteTags.noteId, similarIds))

  const freq = tags.reduce<Record<string, number>>((acc, t) => {
    acc[t.tag] = (acc[t.tag] ?? 0) + 1
    return acc
  }, {})

  // Get existing tags for this note to exclude them
  const existingTags = await db.select({ tag: noteTags.tag })
    .from(noteTags).where(eq(noteTags.noteId, id))
  const existing = new Set(existingTags.map(t => t.tag))

  const suggestions = Object.entries(freq)
    .filter(([tag]) => !existing.has(tag))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }))

  return c.json({ suggestions })
})

// ── Versions ───────────────────────────────────────────────────────────────────

router.get('/:id/versions', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')

  const versions = await db.select().from(noteVersions)
    .where(eq(noteVersions.noteId, id))
    .orderBy(desc(noteVersions.savedAt))

  return c.json(versions)
})

router.get('/:id/versions/:versionId', async (c) => {
  const db = c.get('db')
  const { id, versionId } = c.req.param()

  const [version] = await db.select().from(noteVersions)
    .where(and(
      eq(noteVersions.noteId, id),
      eq(noteVersions.id, parseInt(versionId)),
    ))

  if (!version) return c.json({ error: 'Not found' }, 404)
  return c.json(version)
})

export default router
