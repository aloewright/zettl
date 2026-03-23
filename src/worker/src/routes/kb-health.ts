import { Hono } from 'hono'
import { eq, and, sql, inArray } from 'drizzle-orm'
import type { HonoEnv } from '../types'
import { notes, noteTags } from '../db/schema'
import { buildOpenAI } from '../services/embeddings'

const router = new Hono<HonoEnv>()

// GET /api/kb-health/overview
router.get('/overview', async (c) => {
  const db = c.get('db')
  const rawSql = c.get('sql')

  // ── Scorecard ─────────────────────────────────────────────────────────────
  const [totalRows, embeddedRows, orphanRows, avgRows] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(notes)
      .where(eq(notes.status, 'Permanent')),
    db.select({ count: sql<number>`count(*)::int` }).from(notes)
      .where(and(eq(notes.status, 'Permanent'), sql`"Embedding" IS NOT NULL`)),
    db.select({ count: sql<number>`count(*)::int` }).from(notes)
      .where(and(
        eq(notes.status, 'Permanent'),
        sql`"Id" NOT IN (SELECT DISTINCT "NoteId" FROM "NoteTags")`,
        sql`"Content" NOT LIKE '%[[%]]%'`,
      )),
    rawSql`
      SELECT COALESCE(AVG(link_count), 0)::float8 AS avg
      FROM (
        SELECT n."Id",
          (SELECT count(*) FROM "NoteTags" t WHERE t."NoteId" = n."Id") +
          (SELECT count(*) FROM regexp_matches(n."Content", '\\[\\[[^\\]]+\\]\\]', 'g')) AS link_count
        FROM "Notes" n
        WHERE n."Status" = 'Permanent'
      ) sub
    `,
  ])

  const totalNotes = totalRows[0]?.count ?? 0
  const embeddedCount = embeddedRows[0]?.count ?? 0
  const embeddedPercent = totalNotes > 0 ? Math.round((embeddedCount / totalNotes) * 100) : 0
  const avgConnections = Number((avgRows[0] as { avg: number })?.avg?.toFixed(1) ?? 0)

  // ── New & Unconnected (orphans from last 30 days) ─────────────────────────
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const orphanNotes = await rawSql`
    SELECT n."Id" AS id, n."Title" AS title, n."CreatedAt" AS "createdAt",
      (SELECT count(*) FROM "Notes" n2
       WHERE n2."Status" = 'Permanent'
         AND n2."Embedding" IS NOT NULL
         AND n."Embedding" IS NOT NULL
         AND n2."Id" != n."Id"
         AND (1 - (n."Embedding"::vector(1536) <=> n2."Embedding"::vector(1536))) > 0.5
       LIMIT 5
      )::int AS "suggestionCount"
    FROM "Notes" n
    WHERE n."Status" = 'Permanent'
      AND n."CreatedAt" >= ${thirtyDaysAgo.toISOString()}
      AND n."Id" NOT IN (SELECT DISTINCT "NoteId" FROM "NoteTags")
      AND n."Content" NOT LIKE '%[[%]]%'
    ORDER BY n."CreatedAt" DESC
    LIMIT 20
  `

  // ── Richest Clusters (notes with most connections) ────────────────────────
  const clusters = await rawSql`
    SELECT n."Id" AS "hubNoteId", n."Title" AS "hubTitle",
      (SELECT count(*) FROM "NoteTags" t WHERE t."NoteId" = n."Id") +
      (SELECT count(*) FROM regexp_matches(n."Content", '\\[\\[[^\\]]+\\]\\]', 'g')) AS "noteCount"
    FROM "Notes" n
    WHERE n."Status" = 'Permanent'
    ORDER BY "noteCount" DESC
    LIMIT 5
  `

  // ── Never Used as Seeds ───────────────────────────────────────────────────
  const unusedSeeds = await rawSql`
    SELECT n."Id" AS id, n."Title" AS title,
      (SELECT count(*) FROM "NoteTags" t WHERE t."NoteId" = n."Id") +
      (SELECT count(*) FROM regexp_matches(n."Content", '\\[\\[[^\\]]+\\]\\]', 'g')) AS "connectionCount"
    FROM "Notes" n
    WHERE n."Status" = 'Permanent'
      AND n."Embedding" IS NOT NULL
      AND n."Id" NOT IN (SELECT "NoteId" FROM "UsedSeedNotes")
    ORDER BY n."CreatedAt" DESC
    LIMIT 10
  `

  return c.json({
    scorecard: {
      totalNotes,
      embeddedPercent,
      orphanCount: orphanRows[0]?.count ?? 0,
      averageConnections: avgConnections,
    },
    newAndUnconnected: orphanNotes,
    richestClusters: clusters,
    neverUsedAsSeeds: unusedSeeds,
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
