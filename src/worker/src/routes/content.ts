import { Hono } from 'hono'
import { eq, desc, and, sql, inArray } from 'drizzle-orm'
import type { HonoEnv } from '../types'
import { makeId, isoNow } from '../types'
import {
  contentGenerations,
  contentPieces,
  usedSeedNotes,
  notes,
  voiceConfigs,
  voiceExamples,
  appSettings,
} from '../db/schema'
import { chatCompletion } from '../services/llm'

const router = new Hono<HonoEnv>()

// ── Helpers ───────────────────────────────────────────────────────────────────

interface ClusterNote {
  id: string
  title: string
  content: string
}

async function pickSeedNote(db: ReturnType<typeof import('../db/client').createDb>): Promise<ClusterNote | null> {
  const rows = await db.select({
    id: notes.id,
    title: notes.title,
    content: notes.content,
  }).from(notes)
    .where(and(
      eq(notes.status, 'Permanent'),
      eq(notes.embedStatus, 'Done'),
      sql`"Id" NOT IN (SELECT "NoteId" FROM "UsedSeedNotes")`,
    ))
    .orderBy(sql`RANDOM()`)
    .limit(1)

  return rows[0] ?? null
}

async function findClusterNotes(
  vectorize: VectorizeIndex,
  db: ReturnType<typeof import('../db/client').createDb>,
  seedNote: ClusterNote,
  limit = 5,
): Promise<ClusterNote[]> {
  try {
    const seedVectors = await vectorize.getByIds([seedNote.id])
    if (!seedVectors.length || !seedVectors[0]?.values?.length) return []

    const results = await vectorize.query(seedVectors[0].values, {
      topK: limit + 1,
      returnMetadata: 'none',
    })

    const similarIds = results.matches
      .filter(m => m.id !== seedNote.id && (m.score ?? 0) >= 0.65)
      .slice(0, limit)
      .map(m => m.id)

    if (!similarIds.length) return []

    return db.select({
      id: notes.id,
      title: notes.title,
      content: notes.content,
    }).from(notes)
      .where(inArray(notes.id, similarIds))
  } catch {
    return []
  }
}

async function generateContentFromNotes(
  env: HonoEnv['Bindings'],
  db: ReturnType<typeof import('../db/client').createDb>,
  medium: string,
  seedNote: ClusterNote,
  clusterNotes: ClusterNote[],
): Promise<{ topicSummary: string; body: string; description: string; tags: string[] }> {
  const [voiceConfig] = await db.select().from(voiceConfigs)
    .where(eq(voiceConfigs.medium, medium))
    .limit(1)

  const examples = await db.select({ content: voiceExamples.content })
    .from(voiceExamples)
    .where(eq(voiceExamples.medium, medium))
    .limit(3)

  const toneContext = voiceConfig?.toneDescription
    ? `\nTone: ${voiceConfig.toneDescription}`
    : ''
  const audienceContext = voiceConfig?.audienceDescription
    ? `\nAudience: ${voiceConfig.audienceDescription}`
    : ''
  const exampleBlock = examples.length
    ? `\n\nExamples of my previous ${medium} content:\n${examples.slice(0, 2).map(e => e.content).join('\n\n---\n\n')}`
    : ''

  const notesBlock = [seedNote, ...clusterNotes]
    .map(n => `### ${n.title}\n${n.content}`)
    .join('\n\n')

  const isBlog = medium.toLowerCase() === 'blog'
  const systemPrompt = isBlog
    ? `You are a ghost-writer helping create a blog post from Zettelkasten notes.${toneContext}${audienceContext}${exampleBlock}
Return a JSON object with keys: topicSummary (1 sentence), body (full markdown blog post), description (2-sentence excerpt), tags (array of 3-5 strings).`
    : `You are a ghost-writer helping create social media content from Zettelkasten notes.${toneContext}${audienceContext}${exampleBlock}
Return a JSON object with keys: topicSummary (1 sentence), body (tweet thread or LinkedIn post, markdown), description (1-sentence summary), tags (array of 3-5 hashtag strings without #).`

  const raw = await chatCompletion(env, {
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Generate ${isBlog ? 'a blog post' : 'a social media post'} from these notes:\n\n${notesBlock}`,
      },
    ],
    responseFormat: { type: 'json_object' },
    maxTokens: isBlog ? 2000 : 800,
  })

  const parsed = JSON.parse(raw || '{}')
  return {
    topicSummary: parsed.topicSummary ?? 'Generated content',
    body: parsed.body ?? '',
    description: parsed.description ?? '',
    tags: parsed.tags ?? [],
  }
}

/** Parse a JSON-stringified tags column, returning an array. */
function parseTags(raw: string | null): string[] {
  if (!raw) return []
  try { return JSON.parse(raw) } catch { return [] }
}

/** Normalize a piece row for the frontend (parse JSON tags, add missing nullable fields). */
function normalizePiece(row: Record<string, unknown>) {
  return {
    ...row,
    title: row.title ?? null,
    generatedTags: parseTags(row.generatedTags as string),
    editorFeedback: row.editorFeedback ?? null,
    sentToDraftAt: row.sentToDraftAt ?? null,
    draftReference: row.draftReference ?? null,
    description: row.description ?? null,
    sequence: row.sequence ?? 0,
    approvedAt: row.reviewedAt ?? null,
  }
}

/** Normalize a generation row (parse clusterNoteIds JSON). */
function normalizeGeneration(row: Record<string, unknown>) {
  return {
    ...row,
    clusterNoteIds: parseTags(row.clusterNoteIds as string),
  }
}

// ── Generate (AI content creation) ──────────────────────────────────────────

// POST /api/content/generate — pick a random seed note and generate content
router.post('/generate', async (c) => {
  const db = c.get('db')

  const seedNote = await pickSeedNote(db)
  if (!seedNote) {
    return c.json({ error: 'No eligible seed notes found. Ensure you have permanent notes with completed embeddings.' }, 422)
  }

  const clusterNotes = await findClusterNotes(c.env.vector_db, db, seedNote)

  const generated = await generateContentFromNotes(c.env, db, 'blog', seedNote, clusterNotes)

  const generationId = makeId()
  await db.insert(contentGenerations).values({
    id: generationId,
    seedNoteId: seedNote.id,
    clusterNoteIds: JSON.stringify(clusterNotes.map(n => n.id)),
    topicSummary: generated.topicSummary,
    status: 'Pending',
    generatedAt: isoNow(),
  })

  // Create blog piece
  const blogPieceId = makeId()
  await db.insert(contentPieces).values({
    id: blogPieceId,
    generationId,
    medium: 'blog',
    body: generated.body,
    description: generated.description,
    generatedTags: JSON.stringify(generated.tags),
    status: 'Draft',
    createdAt: isoNow(),
  })

  // Also generate a social piece
  try {
    const socialGenerated = await generateContentFromNotes(c.env, db, 'social', seedNote, clusterNotes)
    await db.insert(contentPieces).values({
      id: makeId(),
      generationId,
      medium: 'social',
      body: socialGenerated.body,
      description: socialGenerated.description,
      generatedTags: JSON.stringify(socialGenerated.tags),
      status: 'Draft',
      createdAt: isoNow(),
    })
  } catch (e) {
    console.warn('Social generation failed, continuing with blog only:', e)
  }

  // Mark seed as used
  await db.insert(usedSeedNotes).values({ noteId: seedNote.id, usedAt: isoNow() })
    .onConflictDoNothing()

  // Return the full generation with pieces
  const [gen] = await db.select().from(contentGenerations).where(eq(contentGenerations.id, generationId))
  const pieces = await db.select().from(contentPieces).where(eq(contentPieces.generationId, generationId))

  return c.json({
    ...normalizeGeneration(gen as unknown as Record<string, unknown>),
    pieces: pieces.map(p => normalizePiece(p as unknown as Record<string, unknown>)),
  }, 201)
})

// POST /api/content/generate/from-note/:noteId — generate content from a specific note
router.post('/generate/from-note/:noteId', async (c) => {
  const db = c.get('db')
  const noteId = c.req.param('noteId')

  const [seedRow] = await db.select({
    id: notes.id,
    title: notes.title,
    content: notes.content,
  }).from(notes).where(eq(notes.id, noteId))

  if (!seedRow) return c.json({ error: 'Note not found' }, 404)

  const seedNote: ClusterNote = seedRow
  const clusterNotes = await findClusterNotes(c.env.vector_db, db, seedNote)

  const generated = await generateContentFromNotes(c.env, db, 'blog', seedNote, clusterNotes)

  const generationId = makeId()
  await db.insert(contentGenerations).values({
    id: generationId,
    seedNoteId: seedNote.id,
    clusterNoteIds: JSON.stringify(clusterNotes.map(n => n.id)),
    topicSummary: generated.topicSummary,
    status: 'Pending',
    generatedAt: isoNow(),
  })

  await db.insert(contentPieces).values({
    id: makeId(),
    generationId,
    medium: 'blog',
    body: generated.body,
    description: generated.description,
    generatedTags: JSON.stringify(generated.tags),
    status: 'Draft',
    createdAt: isoNow(),
  })

  // Mark seed as used
  await db.insert(usedSeedNotes).values({ noteId: seedNote.id, usedAt: isoNow() })
    .onConflictDoNothing()

  const [gen] = await db.select().from(contentGenerations).where(eq(contentGenerations.id, generationId))
  const pieces = await db.select().from(contentPieces).where(eq(contentPieces.generationId, generationId))

  return c.json({
    ...normalizeGeneration(gen as unknown as Record<string, unknown>),
    pieces: pieces.map(p => normalizePiece(p as unknown as Record<string, unknown>)),
  }, 201)
})

// ── Generations ────────────────────────────────────────────────────────────────

router.get('/generations', async (c) => {
  const db = c.get('db')
  // Support both skip/take (frontend) and page/pageSize patterns
  const { status, skip, take, page, pageSize } = c.req.query()
  let offset: number
  let size: number

  if (skip !== undefined || take !== undefined) {
    offset = Math.max(0, parseInt(skip ?? '0'))
    size = Math.min(100, Math.max(1, parseInt(take ?? '20')))
  } else {
    const pageNum = Math.max(1, parseInt(page ?? '1'))
    size = Math.min(100, Math.max(1, parseInt(pageSize ?? '20')))
    offset = (pageNum - 1) * size
  }

  const condition = status ? eq(contentGenerations.status, status) : undefined
  const [rows, countRows] = await Promise.all([
    db.select().from(contentGenerations)
      .where(condition)
      .orderBy(desc(contentGenerations.generatedAt))
      .limit(size).offset(offset),
    db.select({ count: sql<number>`count(*)` })
      .from(contentGenerations).where(condition),
  ])

  return c.json({
    items: rows.map(r => normalizeGeneration(r as unknown as Record<string, unknown>)),
    totalCount: countRows[0]?.count ?? 0,
  })
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

  // Fetch source notes for display
  const clusterIds = parseTags(gen.clusterNoteIds)
  const sourceNoteIds = [gen.seedNoteId, ...clusterIds]
  const sourceNotes = sourceNoteIds.length
    ? await db.select({
        id: notes.id,
        title: notes.title,
        content: notes.content,
      }).from(notes).where(inArray(notes.id, sourceNoteIds))
    : []

  return c.json({
    ...normalizeGeneration(gen as unknown as Record<string, unknown>),
    pieces: pieces.map(p => normalizePiece(p as unknown as Record<string, unknown>)),
    sourceNotes,
  })
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
  return c.json(normalizeGeneration(created as unknown as Record<string, unknown>), 201)
})

// POST /api/content/generations/:id/regenerate — regenerate all content for a generation
router.post('/generations/:id/regenerate', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')

  const [gen] = await db.select().from(contentGenerations).where(eq(contentGenerations.id, id))
  if (!gen) return c.json({ error: 'Not found' }, 404)

  // Load the seed note
  const [seedRow] = await db.select({
    id: notes.id,
    title: notes.title,
    content: notes.content,
  }).from(notes).where(eq(notes.id, gen.seedNoteId))

  if (!seedRow) return c.json({ error: 'Seed note not found' }, 404)

  const clusterIds = parseTags(gen.clusterNoteIds)
  const clusterNotes = clusterIds.length
    ? await db.select({ id: notes.id, title: notes.title, content: notes.content })
        .from(notes).where(inArray(notes.id, clusterIds))
    : []

  // Delete old pieces
  await db.delete(contentPieces).where(eq(contentPieces.generationId, id))

  // Regenerate blog
  const blogGen = await generateContentFromNotes(c.env, db, 'blog', seedRow, clusterNotes)
  await db.insert(contentPieces).values({
    id: makeId(),
    generationId: id,
    medium: 'blog',
    body: blogGen.body,
    description: blogGen.description,
    generatedTags: JSON.stringify(blogGen.tags),
    status: 'Draft',
    createdAt: isoNow(),
  })

  // Regenerate social
  try {
    const socialGen = await generateContentFromNotes(c.env, db, 'social', seedRow, clusterNotes)
    await db.insert(contentPieces).values({
      id: makeId(),
      generationId: id,
      medium: 'social',
      body: socialGen.body,
      description: socialGen.description,
      generatedTags: JSON.stringify(socialGen.tags),
      status: 'Draft',
      createdAt: isoNow(),
    })
  } catch { /* continue without social */ }

  // Update generation status
  await db.update(contentGenerations).set({
    topicSummary: blogGen.topicSummary,
    status: 'Pending',
    generatedAt: isoNow(),
    reviewedAt: null,
  }).where(eq(contentGenerations.id, id))

  const [updated] = await db.select().from(contentGenerations).where(eq(contentGenerations.id, id))
  const pieces = await db.select().from(contentPieces).where(eq(contentPieces.generationId, id))

  return c.json({
    ...normalizeGeneration(updated as unknown as Record<string, unknown>),
    pieces: pieces.map(p => normalizePiece(p as unknown as Record<string, unknown>)),
  })
})

// POST /api/content/generations/:id/regenerate/:medium — regenerate just one medium
router.post('/generations/:id/regenerate/:medium', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')
  const medium = c.req.param('medium')

  const [gen] = await db.select().from(contentGenerations).where(eq(contentGenerations.id, id))
  if (!gen) return c.json({ error: 'Not found' }, 404)

  const [seedRow] = await db.select({
    id: notes.id,
    title: notes.title,
    content: notes.content,
  }).from(notes).where(eq(notes.id, gen.seedNoteId))

  if (!seedRow) return c.json({ error: 'Seed note not found' }, 404)

  const clusterIds = parseTags(gen.clusterNoteIds)
  const clusterNotes = clusterIds.length
    ? await db.select({ id: notes.id, title: notes.title, content: notes.content })
        .from(notes).where(inArray(notes.id, clusterIds))
    : []

  // Delete old pieces of this medium
  await db.delete(contentPieces).where(
    and(eq(contentPieces.generationId, id), eq(contentPieces.medium, medium)),
  )

  const generated = await generateContentFromNotes(c.env, db, medium, seedRow, clusterNotes)
  const pieceId = makeId()
  await db.insert(contentPieces).values({
    id: pieceId,
    generationId: id,
    medium,
    body: generated.body,
    description: generated.description,
    generatedTags: JSON.stringify(generated.tags),
    status: 'Draft',
    createdAt: isoNow(),
  })

  const newPieces = await db.select().from(contentPieces)
    .where(and(eq(contentPieces.generationId, id), eq(contentPieces.medium, medium)))

  return c.json(newPieces.map(p => normalizePiece(p as unknown as Record<string, unknown>)))
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
    reviewedAt: body.reviewedAt ?? existing.reviewedAt,
  }).where(eq(contentGenerations.id, id))

  const [updated] = await db.select().from(contentGenerations)
    .where(eq(contentGenerations.id, id))
  return c.json(normalizeGeneration(updated as unknown as Record<string, unknown>))
})

router.delete('/generations/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')

  const [existing] = await db.select({ id: contentGenerations.id })
    .from(contentGenerations).where(eq(contentGenerations.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  // Delete pieces first, then generation
  await db.delete(contentPieces).where(eq(contentPieces.generationId, id))
  await db.delete(contentGenerations).where(eq(contentGenerations.id, id))
  return c.json({ deleted: true })
})

// ── Pieces ─────────────────────────────────────────────────────────────────────

router.get('/pieces', async (c) => {
  const db = c.get('db')
  const { status, medium, skip, take, page, pageSize } = c.req.query()
  let offset: number
  let size: number

  if (skip !== undefined || take !== undefined) {
    offset = Math.max(0, parseInt(skip ?? '0'))
    size = Math.min(100, Math.max(1, parseInt(take ?? '20')))
  } else {
    const pageNum = Math.max(1, parseInt(page ?? '1'))
    size = Math.min(100, Math.max(1, parseInt(pageSize ?? '20')))
    offset = (pageNum - 1) * size
  }

  const conditions = []
  if (status) conditions.push(eq(contentPieces.status, status))
  if (medium) conditions.push(eq(contentPieces.medium, medium))
  const condition = conditions.length ? and(...conditions) : undefined

  const [rows, countRows] = await Promise.all([
    db.select().from(contentPieces)
      .where(condition)
      .orderBy(desc(contentPieces.createdAt))
      .limit(size).offset(offset),
    db.select({ count: sql<number>`count(*)` })
      .from(contentPieces).where(condition),
  ])

  return c.json({
    items: rows.map(r => normalizePiece(r as unknown as Record<string, unknown>)),
    totalCount: countRows[0]?.count ?? 0,
  })
})

router.get('/pieces/:id', async (c) => {
  const db = c.get('db')
  const [piece] = await db.select().from(contentPieces)
    .where(eq(contentPieces.id, c.req.param('id')))
  if (!piece) return c.json({ error: 'Not found' }, 404)
  return c.json(normalizePiece(piece as unknown as Record<string, unknown>))
})

// PUT /api/content/pieces/:id/approve
router.put('/pieces/:id/approve', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')

  const [existing] = await db.select().from(contentPieces).where(eq(contentPieces.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  await db.update(contentPieces).set({
    status: 'Approved',
    reviewedAt: isoNow(),
  }).where(eq(contentPieces.id, id))

  // Check if all pieces in the generation are approved
  const allPieces = await db.select().from(contentPieces)
    .where(eq(contentPieces.generationId, existing.generationId))
  const allApproved = allPieces.every(p => p.id === id || p.status === 'Approved')
  if (allApproved) {
    await db.update(contentGenerations).set({
      status: 'Approved',
      reviewedAt: isoNow(),
    }).where(eq(contentGenerations.id, existing.generationId))
  }

  return c.json({ success: true })
})

// PUT /api/content/pieces/:id/reject
router.put('/pieces/:id/reject', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')

  const [existing] = await db.select().from(contentPieces).where(eq(contentPieces.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  await db.update(contentPieces).set({
    status: 'Rejected',
    reviewedAt: isoNow(),
  }).where(eq(contentPieces.id, id))

  return c.json({ success: true })
})

// GET /api/content/pieces/:id/export — markdown export
router.get('/pieces/:id/export', async (c) => {
  const db = c.get('db')
  const [piece] = await db.select().from(contentPieces)
    .where(eq(contentPieces.id, c.req.param('id')))
  if (!piece) return c.json({ error: 'Not found' }, 404)

  const tags = parseTags(piece.generatedTags)
  const frontmatter = [
    '---',
    piece.description ? `description: "${piece.description}"` : null,
    tags.length ? `tags: [${tags.map(t => `"${t}"`).join(', ')}]` : null,
    `medium: ${piece.medium}`,
    `date: ${piece.createdAt}`,
    '---',
  ].filter(Boolean).join('\n')

  const markdown = `${frontmatter}\n\n${piece.body}`

  return new Response(markdown, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${piece.medium}-${piece.id.slice(0, 8)}.md"`,
    },
  })
})

// PUT /api/content/pieces/:id/description
router.put('/pieces/:id/description', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')
  const body = await c.req.json<{ description: string }>()

  const [existing] = await db.select().from(contentPieces).where(eq(contentPieces.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  await db.update(contentPieces).set({ description: body.description })
    .where(eq(contentPieces.id, id))

  return c.json({ success: true })
})

// PUT /api/content/pieces/:id/tags
router.put('/pieces/:id/tags', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')
  const body = await c.req.json<{ tags: string[] }>()

  const [existing] = await db.select().from(contentPieces).where(eq(contentPieces.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  await db.update(contentPieces).set({ generatedTags: JSON.stringify(body.tags) })
    .where(eq(contentPieces.id, id))

  return c.json({ success: true })
})

// POST /api/content/pieces/:id/send-to-draft — stub (no external integration yet)
router.post('/pieces/:id/send-to-draft', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')

  const [existing] = await db.select().from(contentPieces).where(eq(contentPieces.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  // No external publishing integration yet — return 422
  return c.json({ error: 'External publishing (GitHub Pages / Publer) is not yet configured.' }, 422)
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
    createdAt: isoNow(),
  })

  const [created] = await db.select().from(contentPieces).where(eq(contentPieces.id, id))
  return c.json(normalizePiece(created as unknown as Record<string, unknown>), 201)
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
    reviewedAt: body.reviewedAt ?? existing.reviewedAt,
  }).where(eq(contentPieces.id, id))

  const [updated] = await db.select().from(contentPieces).where(eq(contentPieces.id, id))
  return c.json(normalizePiece(updated as unknown as Record<string, unknown>))
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

// ── Seed note pool ─────────────────────────────────────────────────────────────

router.get('/seed-candidates', async (c) => {
  const db = c.get('db')
  const medium = c.req.query('medium') ?? 'Blog'
  const limit = parseInt(c.req.query('limit') ?? '10')

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

// ── Voice examples (mounted at /api/content/voice/examples) ──────────────────

router.get('/voice/examples', async (c) => {
  const db = c.get('db')
  const medium = c.req.query('medium')

  const rows = await db.select().from(voiceExamples)
    .where(medium ? eq(voiceExamples.medium, medium) : undefined)
    .orderBy(desc(voiceExamples.createdAt))

  // Normalize for frontend VoiceExample type
  return c.json(rows.map(r => ({
    ...r,
    title: null,
    source: null,
  })))
})

router.post('/voice/examples', async (c) => {
  const db = c.get('db')
  const body = await c.req.json<{ medium: string; title?: string; content: string; source?: string }>()
  if (!body.medium || !body.content) {
    return c.json({ error: 'medium and content are required' }, 400)
  }

  const id = makeId()
  await db.insert(voiceExamples).values({
    id,
    medium: body.medium,
    content: body.content,
    createdAt: isoNow(),
  })
  const [created] = await db.select().from(voiceExamples).where(eq(voiceExamples.id, id))
  return c.json({ ...created, title: body.title ?? null, source: body.source ?? null }, 201)
})

router.delete('/voice/examples/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')
  const [existing] = await db.select({ id: voiceExamples.id }).from(voiceExamples)
    .where(eq(voiceExamples.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  await db.delete(voiceExamples).where(eq(voiceExamples.id, id))
  return c.json({ deleted: true })
})

// ── Voice config (mounted at /api/content/voice/config) ──────────────────────

router.get('/voice/config', async (c) => {
  const db = c.get('db')
  const medium = c.req.query('medium')

  const rows = await db.select().from(voiceConfigs)
    .where(medium ? eq(voiceConfigs.medium, medium) : undefined)

  // Normalize: frontend VoiceConfig has `styleNotes` not `toneDescription`
  return c.json(rows.map(r => ({
    id: r.id,
    medium: r.medium,
    styleNotes: r.toneDescription ?? null,
    updatedAt: r.updatedAt,
  })))
})

router.put('/voice/config', async (c) => {
  const db = c.get('db')
  const body = await c.req.json<{ medium: string; styleNotes?: string }>()
  if (!body.medium) return c.json({ error: 'medium is required' }, 400)

  // Find existing config for this medium
  const [existing] = await db.select().from(voiceConfigs)
    .where(eq(voiceConfigs.medium, body.medium))

  if (existing) {
    await db.update(voiceConfigs).set({
      toneDescription: body.styleNotes ?? existing.toneDescription,
      updatedAt: isoNow(),
    }).where(eq(voiceConfigs.id, existing.id))

    const [updated] = await db.select().from(voiceConfigs).where(eq(voiceConfigs.id, existing.id))
    if (!updated) return c.json({ error: 'Config not found after update' }, 500)
    return c.json({
      id: updated.id,
      medium: updated.medium,
      styleNotes: updated.toneDescription ?? null,
      updatedAt: updated.updatedAt,
    })
  } else {
    const id = makeId()
    await db.insert(voiceConfigs).values({
      id,
      medium: body.medium,
      toneDescription: body.styleNotes ?? null,
      audienceDescription: null,
      updatedAt: isoNow(),
    })
    const [created] = await db.select().from(voiceConfigs).where(eq(voiceConfigs.id, id))
    if (!created) return c.json({ error: 'Config not found after create' }, 500)
    return c.json({
      id: created.id,
      medium: created.medium,
      styleNotes: created.toneDescription ?? null,
      updatedAt: created.updatedAt,
    }, 201)
  }
})

// ── Schedule (mounted at /api/content/schedule) ──────────────────────────────

router.get('/schedule', async (c) => {
  const db = c.get('db')

  const settings = await db.select().from(appSettings)
    .where(sql`"Key" LIKE 'schedule:%'`)

  const settingsMap: Record<string, string> = {}
  for (const s of settings) {
    settingsMap[s.key] = s.value
  }

  return c.json({
    blog: {
      enabled: settingsMap['schedule:blog:enabled'] === 'true',
      dayOfWeek: settingsMap['schedule:blog:dayOfWeek'] ?? 'Monday',
      timeOfDay: settingsMap['schedule:blog:timeOfDay'] ?? '09:00',
    },
    social: {
      enabled: settingsMap['schedule:social:enabled'] === 'true',
      timeOfDay: settingsMap['schedule:social:timeOfDay'] ?? '09:00',
    },
  })
})

router.put('/schedule/blog', async (c) => {
  const db = c.get('db')
  const body = await c.req.json<{ enabled: boolean; dayOfWeek: string; timeOfDay: string }>()

  const pairs = [
    { key: 'schedule:blog:enabled', value: String(body.enabled) },
    { key: 'schedule:blog:dayOfWeek', value: body.dayOfWeek },
    { key: 'schedule:blog:timeOfDay', value: body.timeOfDay },
  ]

  for (const { key, value } of pairs) {
    await db.insert(appSettings).values({ key, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value } })
  }

  return c.json(body)
})

router.put('/schedule/social', async (c) => {
  const db = c.get('db')
  const body = await c.req.json<{ enabled: boolean; timeOfDay: string }>()

  const pairs = [
    { key: 'schedule:social:enabled', value: String(body.enabled) },
    { key: 'schedule:social:timeOfDay', value: body.timeOfDay },
  ]

  for (const { key, value } of pairs) {
    await db.insert(appSettings).values({ key, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value } })
  }

  return c.json(body)
})

export default router
