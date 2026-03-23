import { Hono } from 'hono'
import { desc, inArray } from 'drizzle-orm'
import type { HonoEnv } from '../types'
import { makeId } from '../types'
import { notes, noteTags } from '../db/schema'

const router = new Hono<HonoEnv>()

// GET /api/export — export all notes as JSON
router.get('/', async (c) => {
  const db = c.get('db')

  const allNotes = await db.select().from(notes).orderBy(desc(notes.createdAt))
  const allTags = await db.select().from(noteTags)

  const tagMap = allTags.reduce<Record<string, string[]>>((acc, t) => {
    ;(acc[t.noteId] ??= []).push(t.tag)
    return acc
  }, {})

  const exported = allNotes.map(n => ({
    ...n,
    tags: tagMap[n.id] ?? [],
  }))

  return new Response(JSON.stringify({ notes: exported, exportedAt: new Date().toISOString() }, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="zettel-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  })
})

// POST /api/import — import notes from JSON
router.post('/', async (c) => {
  const db = c.get('db')
  const body = await c.req.json<{
    notes: Array<{
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
      createdAt?: string
      updatedAt?: string
    }>
    mode?: 'skip' | 'overwrite'
  }>()

  if (!Array.isArray(body.notes)) {
    return c.json({ error: 'notes array required' }, 400)
  }

  const mode = body.mode ?? 'skip'
  let imported = 0
  let skipped = 0

  for (const n of body.notes) {
    if (!n.title || !n.content) { skipped++; continue }

    const id = makeId()
    const now = new Date()

    try {
      await db.insert(notes).values({
        id,
        title: n.title,
        content: n.content,
        status: n.status ?? 'Permanent',
        noteType: n.noteType ?? 'Regular',
        source: n.source ?? null,
        sourceAuthor: n.sourceAuthor ?? null,
        sourceTitle: n.sourceTitle ?? null,
        sourceUrl: n.sourceUrl ?? null,
        sourceYear: n.sourceYear ?? null,
        sourceType: n.sourceType ?? null,
        createdAt: n.createdAt ? new Date(n.createdAt) : now,
        updatedAt: n.updatedAt ? new Date(n.updatedAt) : now,
        embedStatus: 'Pending',
      })

      if (n.tags?.length) {
        await db.insert(noteTags).values(n.tags.map(tag => ({ noteId: id, tag })))
      }

      // Enqueue for embedding
      await c.env.EMBED_QUEUE.send({ noteId: id })
      imported++
    } catch {
      skipped++
    }
  }

  return c.json({ imported, skipped })
})

export default router
