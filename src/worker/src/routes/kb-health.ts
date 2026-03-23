import { Hono } from 'hono'
import { eq, and, sql, inArray } from 'drizzle-orm'
import type { HonoEnv } from '../types'
import { notes, noteTags } from '../db/schema'
import { buildOpenAI } from '../services/embeddings'

const router = new Hono<HonoEnv>()

// GET /api/kb-health/overview
router.get('/overview', async (c) => {
  const db = c.get('db')

  const [total, fleeting, permanent, noEmbedding, noTags] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(notes),
    db.select({ count: sql<number>`count(*)::int` }).from(notes)
      .where(eq(notes.status, 'Fleeting')),
    db.select({ count: sql<number>`count(*)::int` }).from(notes)
      .where(eq(notes.status, 'Permanent')),
    db.select({ count: sql<number>`count(*)::int` }).from(notes)
      .where(sql`"Embedding" IS NULL`),
    db.select({ count: sql<number>`count(*)::int` }).from(notes)
      .where(sql`"Id" NOT IN (SELECT DISTINCT "NoteId" FROM "NoteTags")`),
  ])

  return c.json({
    totalNotes: total[0]?.count ?? 0,
    fleetingNotes: fleeting[0]?.count ?? 0,
    permanentNotes: permanent[0]?.count ?? 0,
    notesWithoutEmbedding: noEmbedding[0]?.count ?? 0,
    notesWithoutTags: noTags[0]?.count ?? 0,
  })
})

// GET /api/kb-health/orphans — notes with no backlinks and no tags
router.get('/orphans', async (c) => {
  const db = c.get('db')

  const rows = await db.select({
    id: notes.id,
    title: notes.title,
    createdAt: notes.createdAt,
  }).from(notes)
    .where(and(
      eq(notes.status, 'Permanent'),
      sql`"Id" NOT IN (SELECT DISTINCT "NoteId" FROM "NoteTags")`,
    ))
    .orderBy(notes.createdAt)
    .limit(50)

  return c.json(rows)
})

// GET /api/kb-health/missing-embeddings
router.get('/missing-embeddings', async (c) => {
  const db = c.get('db')

  const rows = await db.select({
    id: notes.id,
    title: notes.title,
    embedStatus: notes.embedStatus,
    embedError: notes.embedError,
  }).from(notes)
    .where(sql`"EmbedStatus" IN ('Pending', 'Failed', 'Stale')`)
    .orderBy(notes.createdAt)
    .limit(100)

  return c.json(rows)
})

// GET /api/kb-health/large-notes — notes with content > threshold chars
router.get('/large-notes', async (c) => {
  const db = c.get('db')
  const threshold = parseInt(c.req.query('threshold') ?? '2000')

  const rows = await db.select({
    id: notes.id,
    title: notes.title,
    contentLength: sql<number>`LENGTH("Content")::int`,
  }).from(notes)
    .where(sql`LENGTH("Content") > ${threshold}`)
    .orderBy(sql`LENGTH("Content") DESC`)
    .limit(50)

  return c.json(rows)
})

// POST /api/kb-health/link — add a wiki-link from one note to another
router.post('/link', async (c) => {
  const db = c.get('db')
  const body = await c.req.json<{ sourceId: string; targetId: string }>()
  if (!body.sourceId || !body.targetId) {
    return c.json({ error: 'sourceId and targetId required' }, 400)
  }

  const [[source], [target]] = await Promise.all([
    db.select({ id: notes.id, content: notes.content }).from(notes)
      .where(eq(notes.id, body.sourceId)),
    db.select({ id: notes.id, title: notes.title }).from(notes)
      .where(eq(notes.id, body.targetId)),
  ])

  if (!source || !target) return c.json({ error: 'Note not found' }, 404)

  const link = `\n\n[[${target.title}]]`
  if (source.content.includes(`[[${target.title}]]`)) {
    return c.json({ message: 'Link already exists' })
  }

  await db.update(notes).set({
    content: source.content + link,
    updatedAt: new Date(),
    embedStatus: 'Stale',
  }).where(eq(notes.id, body.sourceId))

  return c.json({ linked: true })
})

// POST /api/kb-health/summarize — generate a short AI summary for a note
router.post('/summarize', async (c) => {
  const db = c.get('db')
  const openai = await buildOpenAI(c.env)
  const body = await c.req.json<{ noteId: string }>()
  if (!body.noteId) return c.json({ error: 'noteId required' }, 400)

  const [note] = await db.select({ title: notes.title, content: notes.content })
    .from(notes).where(eq(notes.id, body.noteId))
  if (!note) return c.json({ error: 'Not found' }, 404)

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'Summarize the following note in 2-3 sentences. Be concise and capture the core idea.',
      },
      {
        role: 'user',
        content: `Title: ${note.title}\n\n${note.content}`,
      },
    ],
    max_tokens: 200,
  })

  return c.json({ summary: response.choices[0]?.message.content ?? '' })
})

// POST /api/kb-health/split — suggest split points for a large note
router.post('/split', async (c) => {
  const db = c.get('db')
  const openai = await buildOpenAI(c.env)
  const body = await c.req.json<{ noteId: string }>()
  if (!body.noteId) return c.json({ error: 'noteId required' }, 400)

  const [note] = await db.select({ title: notes.title, content: notes.content })
    .from(notes).where(eq(notes.id, body.noteId))
  if (!note) return c.json({ error: 'Not found' }, 404)

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are a Zettelkasten expert. Analyze this note and suggest how it could be split into
        smaller atomic notes. Return a JSON array of objects with "title" and "contentSlice" (a brief description of what content to move there).`,
      },
      {
        role: 'user',
        content: `Title: ${note.title}\n\n${note.content}`,
      },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 600,
  })

  try {
    const parsed = JSON.parse(response.choices[0]?.message.content ?? '{}')
    return c.json({ suggestions: parsed.suggestions ?? parsed })
  } catch {
    return c.json({ suggestions: [] })
  }
})

export default router
