import { Hono } from 'hono'
import { eq, and, sql } from 'drizzle-orm'
import type { HonoEnv } from '../types'
import { notes, noteTags } from '../db/schema'
import { chatCompletion } from '../services/llm'

const router = new Hono<HonoEnv>()

/** Count wiki-links [[...]] in a string using JS regex. */
function countWikiLinks(content: string): number {
  const matches = content.match(/\[\[[^\]]+\]\]/g)
  return matches?.length ?? 0
}

// GET /api/kb-health/overview
router.get('/overview', async (c) => {
  const db = c.get('db')

  // ── Scorecard ─────────────────────────────────────────────────────────────
  const [totalRows, embeddedRows, orphanRows] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(notes)
      .where(eq(notes.status, 'Permanent')),
    db.select({ count: sql<number>`count(*)` }).from(notes)
      .where(and(eq(notes.status, 'Permanent'), eq(notes.embedStatus, 'Done'))),
    db.select({ count: sql<number>`count(*)` }).from(notes)
      .where(and(
        eq(notes.status, 'Permanent'),
        sql`"Id" NOT IN (SELECT DISTINCT "NoteId" FROM "NoteTags")`,
        sql`"Content" NOT LIKE '%[[%]]%'`,
      )),
  ])

  const totalNotes = totalRows[0]?.count ?? 0
  const embeddedCount = embeddedRows[0]?.count ?? 0
  const embeddedPercent = totalNotes > 0 ? Math.round((embeddedCount / totalNotes) * 100) : 0

  // Compute average connections in JS
  const permNotes = await db.select({
    id: notes.id,
    content: notes.content,
  }).from(notes).where(eq(notes.status, 'Permanent'))

  const allTags = await db.select().from(noteTags)
  const tagCountMap: Record<string, number> = {}
  for (const t of allTags) {
    tagCountMap[t.noteId] = (tagCountMap[t.noteId] ?? 0) + 1
  }

  let totalConnections = 0
  for (const n of permNotes) {
    totalConnections += (tagCountMap[n.id] ?? 0) + countWikiLinks(n.content)
  }
  const avgConnections = permNotes.length > 0
    ? Number((totalConnections / permNotes.length).toFixed(1))
    : 0

  // ── New & Unconnected (orphans from last 30 days) ─────────────────────────
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { results: orphanNotes } = await c.env.d1_db
    .prepare(`
      SELECT n."Id" AS id, n."Title" AS title, n."CreatedAt" AS createdAt
      FROM "Notes" n
      WHERE n."Status" = 'Permanent'
        AND n."CreatedAt" >= ?
        AND n."Id" NOT IN (SELECT DISTINCT "NoteId" FROM "NoteTags")
        AND n."Content" NOT LIKE '%[[%]]%'
      ORDER BY n."CreatedAt" DESC
      LIMIT 20
    `)
    .bind(thirtyDaysAgo)
    .all<{ id: string; title: string; createdAt: string }>()

  // For each orphan, count suggestions via Vectorize
  const orphansWithSuggestions = await Promise.all(
    (orphanNotes ?? []).map(async (orphan) => {
      try {
        const vectors = await c.env.vector_db.getByIds([orphan.id])
        if (!vectors.length || !vectors[0]?.values) return { ...orphan, suggestionCount: 0 }
        const vecResults = await c.env.vector_db.query(vectors[0].values, { topK: 6 })
        const count = vecResults.matches.filter(m => m.id !== orphan.id && (m.score ?? 0) > 0.5).length
        return { ...orphan, suggestionCount: count }
      } catch {
        return { ...orphan, suggestionCount: 0 }
      }
    }),
  )

  // ── Richest Clusters (notes with most connections) ────────────────────────
  const clusterData = permNotes
    .map(n => ({
      hubNoteId: n.id,
      noteCount: (tagCountMap[n.id] ?? 0) + countWikiLinks(n.content),
    }))
    .sort((a, b) => b.noteCount - a.noteCount)
    .slice(0, 5)

  // Fetch titles for top clusters
  const clusterIds = clusterData.map(c => c.hubNoteId)
  const clusterNotes = clusterIds.length
    ? await db.select({ id: notes.id, title: notes.title }).from(notes)
        .where(sql`"Id" IN (${sql.join(clusterIds.map(id => sql`${id}`), sql`,`)})`)
    : []
  const titleMap = new Map(clusterNotes.map(n => [n.id, n.title]))

  const clusters = clusterData.map(cd => ({
    hubNoteId: cd.hubNoteId,
    hubTitle: titleMap.get(cd.hubNoteId) ?? '',
    noteCount: cd.noteCount,
  }))

  // ── Never Used as Seeds ───────────────────────────────────────────────────
  const { results: unusedSeeds } = await c.env.d1_db
    .prepare(`
      SELECT n."Id" AS id, n."Title" AS title
      FROM "Notes" n
      WHERE n."Status" = 'Permanent'
        AND n."EmbedStatus" = 'Done'
        AND n."Id" NOT IN (SELECT "NoteId" FROM "UsedSeedNotes")
      ORDER BY n."CreatedAt" DESC
      LIMIT 10
    `)
    .all<{ id: string; title: string }>()

  // Add connection counts for unused seeds
  const unusedSeedsWithCounts = (unusedSeeds ?? []).map(s => {
    const note = permNotes.find(n => n.id === s.id)
    return {
      ...s,
      connectionCount: (tagCountMap[s.id] ?? 0) + (note ? countWikiLinks(note.content) : 0),
    }
  })

  return c.json({
    scorecard: {
      totalNotes,
      embeddedPercent,
      orphanCount: orphanRows[0]?.count ?? 0,
      averageConnections: avgConnections,
    },
    newAndUnconnected: orphansWithSuggestions,
    richestClusters: clusters,
    neverUsedAsSeeds: unusedSeedsWithCounts,
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
    characterCount: sql<number>`LENGTH("Content")`,
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
    updatedAt: new Date().toISOString(),
    embedStatus: 'Stale',
  }).where(eq(notes.id, body.sourceId))

  return c.json({ linked: true })
})

// POST /api/kb-health/summarize — generate a short AI summary for a note
router.post('/summarize', async (c) => {
  const db = c.get('db')
  const body = await c.req.json<{ noteId: string }>()
  if (!body.noteId) return c.json({ error: 'noteId required' }, 400)

  const [note] = await db.select({ title: notes.title, content: notes.content })
    .from(notes).where(eq(notes.id, body.noteId))
  if (!note) return c.json({ error: 'Not found' }, 404)

  const summary = await chatCompletion(c.env, {
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
    maxTokens: 200,
  })

  return c.json({ summary })
})

// POST /api/kb-health/split — suggest split points for a large note
router.post('/split', async (c) => {
  const db = c.get('db')
  const body = await c.req.json<{ noteId: string }>()
  if (!body.noteId) return c.json({ error: 'noteId required' }, 400)

  const [note] = await db.select({ title: notes.title, content: notes.content })
    .from(notes).where(eq(notes.id, body.noteId))
  if (!note) return c.json({ error: 'Not found' }, 404)

  const raw = await chatCompletion(c.env, {
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
    responseFormat: { type: 'json_object' },
    maxTokens: 600,
  })

  try {
    const parsed = JSON.parse(raw || '{}')
    return c.json({ suggestions: parsed.suggestions ?? parsed })
  } catch {
    return c.json({ suggestions: [] })
  }
})

export default router
