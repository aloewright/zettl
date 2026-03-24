import { Hono } from 'hono'
import { eq, and, sql } from 'drizzle-orm'
import type { HonoEnv } from '../types'
import { makeId, isoNow } from '../types'
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

// GET /api/kb-health/orphan/:noteId/suggestions — connection suggestions for an orphan
router.get('/orphan/:noteId/suggestions', async (c) => {
  const noteId = c.req.param('noteId')
  const limit = parseInt(c.req.query('limit') ?? '5')

  try {
    const vectors = await c.env.vector_db.getByIds([noteId])
    if (!vectors.length || !vectors[0]?.values) {
      return c.json([])
    }

    const results = await c.env.vector_db.query(vectors[0].values, { topK: limit + 1 })
    const matches = results.matches.filter(m => m.id !== noteId && (m.score ?? 0) > 0.4)

    if (!matches.length) return c.json([])

    const db = c.get('db')
    const matchIds = matches.map(m => m.id)
    const { results: noteRows } = await c.env.d1_db
      .prepare(`SELECT "Id" AS id, "Title" AS title FROM "Notes" WHERE "Id" IN (${matchIds.map(() => '?').join(',')})`)
      .bind(...matchIds)
      .all<{ id: string; title: string }>()

    const titleMap = new Map((noteRows ?? []).map(n => [n.id, n.title]))

    return c.json(
      matches
        .map(m => ({
          noteId: m.id,
          title: titleMap.get(m.id) ?? '',
          similarity: m.score ?? 0,
        }))
        .filter(s => s.title)
        .slice(0, limit),
    )
  } catch {
    return c.json([])
  }
})

// POST /api/kb-health/orphan/:orphanId/link — add a wiki-link from orphan to target
router.post('/orphan/:orphanId/link', async (c) => {
  const db = c.get('db')
  const orphanId = c.req.param('orphanId')
  const body = await c.req.json<{ targetNoteId: string }>()

  if (!body.targetNoteId) return c.json({ error: 'targetNoteId required' }, 400)

  const [[source], [target]] = await Promise.all([
    db.select({ id: notes.id, content: notes.content }).from(notes)
      .where(eq(notes.id, orphanId)),
    db.select({ id: notes.id, title: notes.title }).from(notes)
      .where(eq(notes.id, body.targetNoteId)),
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
  }).where(eq(notes.id, orphanId))

  // Return the updated note
  const [updated] = await db.select().from(notes).where(eq(notes.id, orphanId))
  return c.json(updated)
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

// POST /api/kb-health/missing-embeddings/:noteId/requeue
router.post('/missing-embeddings/:noteId/requeue', async (c) => {
  const db = c.get('db')
  const noteId = c.req.param('noteId')

  const [note] = await db.select({ id: notes.id }).from(notes).where(eq(notes.id, noteId))
  if (!note) return c.json({ error: 'Not found' }, 404)

  await db.update(notes).set({
    embedStatus: 'Pending',
    embedRetryCount: 0,
    embedError: null,
  }).where(eq(notes.id, noteId))

  // If there's an embed queue, send a message
  try {
    await c.env.EMBED_QUEUE?.send({ noteId })
  } catch {
    // Queue may not be available, that's OK — cron will pick it up
  }

  return c.json({ queued: true })
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

// POST /api/kb-health/large-notes/:noteId/summarize
router.post('/large-notes/:noteId/summarize', async (c) => {
  const db = c.get('db')
  const noteId = c.req.param('noteId')

  const [note] = await db.select({ id: notes.id, title: notes.title, content: notes.content })
    .from(notes).where(eq(notes.id, noteId))
  if (!note) return c.json({ error: 'Not found' }, 404)

  const originalLength = note.content.length

  const summary = await chatCompletion(c.env, {
    messages: [
      {
        role: 'system',
        content: 'Summarize the following Zettelkasten note into a concise atomic note. Keep the core insight in 2-4 paragraphs. Preserve any wiki-links [[like this]]. Return only the summarized content.',
      },
      {
        role: 'user',
        content: `Title: ${note.title}\n\n${note.content}`,
      },
    ],
    maxTokens: 600,
  })

  const summarizedLength = summary.length

  // Update the note content
  await db.update(notes).set({
    content: summary,
    updatedAt: new Date().toISOString(),
    embedStatus: 'Stale',
  }).where(eq(notes.id, noteId))

  return c.json({
    noteId,
    originalLength,
    summarizedLength,
    stillLarge: summarizedLength > 2000,
  })
})

// POST /api/kb-health/large-notes/:noteId/split-suggestions
router.post('/large-notes/:noteId/split-suggestions', async (c) => {
  const db = c.get('db')
  const noteId = c.req.param('noteId')

  const [note] = await db.select({ title: notes.title, content: notes.content })
    .from(notes).where(eq(notes.id, noteId))
  if (!note) return c.json({ error: 'Not found' }, 404)

  const raw = await chatCompletion(c.env, {
    messages: [
      {
        role: 'system',
        content: `You are a Zettelkasten expert. Analyze this note and suggest how it could be split into
smaller atomic notes. Return a JSON object with key "notes" containing an array of objects, each with "title" (string) and "content" (string — the full content for that atomic note).`,
      },
      {
        role: 'user',
        content: `Title: ${note.title}\n\n${note.content}`,
      },
    ],
    responseFormat: { type: 'json_object' },
    maxTokens: 2000,
  })

  try {
    const parsed = JSON.parse(raw || '{}')
    const suggestedNotes = parsed.notes ?? parsed.suggestions ?? []
    return c.json({
      noteId,
      originalTitle: note.title,
      notes: suggestedNotes.map((n: { title: string; content?: string; contentSlice?: string }) => ({
        title: n.title ?? '',
        content: n.content ?? n.contentSlice ?? '',
      })),
    })
  } catch {
    return c.json({
      noteId,
      originalTitle: note.title,
      notes: [],
    })
  }
})

// POST /api/kb-health/large-notes/:noteId/apply-split — create notes from split suggestions
router.post('/large-notes/:noteId/apply-split', async (c) => {
  const db = c.get('db')
  const noteId = c.req.param('noteId')
  const body = await c.req.json<{
    notes: { title: string; content: string }[]
  }>()

  if (!body.notes?.length) return c.json({ error: 'notes array required' }, 400)

  const [original] = await db.select({ id: notes.id }).from(notes).where(eq(notes.id, noteId))
  if (!original) return c.json({ error: 'Original note not found' }, 404)

  const createdNoteIds: string[] = []

  for (const splitNote of body.notes) {
    const id = makeId()
    await db.insert(notes).values({
      id,
      title: splitNote.title,
      content: splitNote.content,
      createdAt: isoNow(),
      updatedAt: isoNow(),
      status: 'Permanent',
      embedStatus: 'Pending',
    })
    createdNoteIds.push(id)

    // Queue for embedding
    try {
      await c.env.EMBED_QUEUE?.send({ noteId: id })
    } catch { /* queue may not be available */ }
  }

  return c.json({ createdNoteIds })
})

// ── Legacy routes (keep for backward compat) ─────────────────────────────────

// GET /api/kb-health/orphans
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

export default router
