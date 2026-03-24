import { Hono } from 'hono'
import { eq, and, sql } from 'drizzle-orm'
import type { HonoEnv } from '../types'
import { makeId, getOptionalSecret } from '../types'
import { notes, noteTags } from '../db/schema'
import { ReadwiseClient } from '../services/readwise'

const router = new Hono<HonoEnv>()

async function getClient(env: HonoEnv['Bindings']): Promise<ReadwiseClient | null> {
  const token = await getOptionalSecret(env.READWISE_ACCESS_TOKEN)
  if (!token) return null
  return new ReadwiseClient(token)
}

// GET /api/readwise/status
router.get('/status', async (c) => {
  const client = await getClient(c.env)
  if (!client) return c.json({ configured: false })

  const valid = await client.validateToken()
  return c.json({ configured: true, tokenValid: valid })
})

// POST /api/readwise/push — push permanent notes to Readwise as highlights
router.post('/push', async (c) => {
  const client = await getClient(c.env)
  if (!client) return c.json({ error: 'READWISE_ACCESS_TOKEN not configured' }, 400)

  const db = c.get('db')
  const body = await c.req.json<{ noteIds?: string[] }>().catch(() => ({ noteIds: undefined }))

  // Fetch notes to push — either specified IDs or all permanent notes
  const rows = body.noteIds?.length
    ? await db.select().from(notes)
        .where(and(
          sql`"Id" = ANY(${body.noteIds})`,
          eq(notes.status, 'Permanent'),
        ))
    : await db.select().from(notes)
        .where(eq(notes.status, 'Permanent'))
        .limit(500)

  if (!rows.length) return c.json({ pushed: 0 })

  const noteIds = rows.map(r => r.id)
  const allTags = await db.select().from(noteTags)
    .where(sql`"NoteId" = ANY(${noteIds})`)

  const tagMap = allTags.reduce<Record<string, string[]>>((acc, t) => {
    ;(acc[t.noteId] ??= []).push(t.tag)
    return acc
  }, {})

  const highlights = rows.map(note => ({
    text: note.content.slice(0, 8191),
    title: note.title.slice(0, 511),
    source_type: 'zettl',
    category: 'articles' as const,
    // Tags become inline Readwise tags via the note field: .tag1 .tag2
    note: (tagMap[note.id] ?? []).map(t => `.${t}`).join(' ') || undefined,
    highlighted_at: note.createdAt,
    // Stable URL — used for idempotent upserts
    highlight_url: `https://postpilot.cc/notes/${note.id}`,
    ...(note.sourceAuthor ? { author: note.sourceAuthor.slice(0, 1024) } : {}),
    ...(note.sourceUrl ? { source_url: note.sourceUrl.slice(0, 2047) } : {}),
  }))

  await client.createHighlights(highlights)

  return c.json({ pushed: highlights.length })
})

// POST /api/readwise/pull — import Readwise highlights as fleeting notes
router.post('/pull', async (c) => {
  const client = await getClient(c.env)
  if (!client) return c.json({ error: 'READWISE_ACCESS_TOKEN not configured' }, 400)

  const db = c.get('db')
  const body = await c.req.json<{ updatedAfter?: string }>().catch(() => ({ updatedAfter: undefined }))

  const books = await client.exportHighlights(body.updatedAfter)

  let created = 0
  let skipped = 0

  for (const book of books) {
    for (const highlight of book.highlights) {
      // Skip if we've already imported this highlight (match by sourceUrl)
      const [existing] = await db.select({ id: notes.id }).from(notes)
        .where(eq(notes.sourceUrl, highlight.readwise_url))
        .limit(1)

      if (existing) { skipped++; continue }

      const id = makeId()
      const title = book.title
        ? `[${book.title}] ${highlight.text.slice(0, 60)}${highlight.text.length > 60 ? '…' : ''}`
        : highlight.text.slice(0, 80)

      let content = highlight.text
      if (highlight.note) content += `\n\n> ${highlight.note}`

      await db.insert(notes).values({
        id,
        title: title.slice(0, 511),
        content,
        status: 'Fleeting',
        noteType: 'Regular',
        source: 'Readwise',
        sourceTitle: book.title ?? null,
        sourceAuthor: book.author ?? null,
        sourceUrl: highlight.readwise_url,
        sourceType: book.category ?? null,
        createdAt: highlight.highlighted_at ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        embedStatus: 'Pending',
      })

      // Import tags from Readwise highlight tags
      if (highlight.tags?.length) {
        await db.insert(noteTags).values(
          highlight.tags.map(t => ({ noteId: id, tag: t.name })),
        )
      }

      await c.env.EMBED_QUEUE.send({ noteId: id })
      created++
    }
  }

  return c.json({ created, skipped })
})

export default router
