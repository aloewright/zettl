import { Hono } from 'hono'
import { desc } from 'drizzle-orm'
import type { HonoEnv } from '../types'
import { makeId, isoNow } from '../types'
import { notes, noteTags } from '../db/schema'

const router = new Hono<HonoEnv>()

// ── Notion markdown parser ────────────────────────────────────────────────────
//
// Notion exports markdown files with a specific header structure:
//   # Title
//   UID: <id>
//   Created: <date>
//   Last Edited: <date>
//   Tags: tag1, tag2
//   <blank line>
//   <body>

interface ParsedNote {
  title: string
  content: string
  tags: string[]
  createdAt?: Date
  noteType?: string
  sourceAuthor?: string | null
  sourceType?: string | null
  sourceUrl?: string | null
}

function isNotionFormat(text: string): boolean {
  const lines = text.split('\n').slice(0, 10)
  const firstNonEmpty = lines.find(l => l.trim())
  if (!firstNonEmpty?.trimStart().startsWith('# ')) return false
  return lines.some(l => {
    const t = l.trim()
    return t.startsWith('UID:') || t.startsWith('Created:') || t.startsWith('Tags:')
  })
}

function parseNotionDate(s: string): Date | undefined {
  // Format: "3 April 2025 14:00" or ISO
  const d = new Date(s)
  return isNaN(d.getTime()) ? undefined : d
}

// ── Readwise format ────────────────────────────────────────────────────────────────
//
// Readwise exports markdown files with this structure:
//   # Title
//   ![cover](url)
//   ### Metadata
//   - Author: ...
//   - Full Title: ...
//   - Category: #books | #articles | #podcasts
//   - URL: ...          (optional, present in articles/podcasts)
//   ### Highlights
//   - highlight text

function isReadwiseFormat(content: string): boolean {
  return content.includes('### Metadata') &&
    content.includes('- Author:') &&
    content.includes('### Highlights')
}

function parseReadwiseFile(fileName: string, content: string): ParsedNote {
  const lines = content.split('\n')
  let title = fileName.replace(/\.md$/i, '')
  let author: string | null = null
  let category = ''
  let url: string | null = null
  let highlightsStart = -1
  let inMetadata = false

  for (let i = 0; i < lines.length; i++) {
    const raw = (lines[i] ?? '').replace(/\r$/, '')
    const t = raw.trim()

    if (t.startsWith('# ') && i === 0) {
      title = t.slice(2).trim()
    } else if (t === '### Metadata') {
      inMetadata = true
    } else if (t === '### Highlights') {
      highlightsStart = i
      break
    } else if (inMetadata) {
      if (t.startsWith('- Full Title:')) {
        const v = t.slice('- Full Title:'.length).trim()
        if (v) title = v
      } else if (t.startsWith('- Author:')) {
        const v = t.slice('- Author:'.length).trim()
        if (v && v !== 'None') author = v
      } else if (t.startsWith('- Category:')) {
        category = t.slice('- Category:'.length).trim().replace(/^#/, '')
      } else if (t.startsWith('- URL:')) {
        const v = t.slice('- URL:'.length).trim()
        if (v) url = v
      }
    }
  }

  // Highlights section as content; fall back to whole file if not found
  const highlightContent = highlightsStart >= 0
    ? lines.slice(highlightsStart + 1).join('\n').trim()
    : content.trim()

  const sourceType =
    category === 'books' ? 'book'
    : category === 'articles' ? 'article'
    : category === 'podcasts' ? 'podcast'
    : category ? 'other'
    : null

  return {
    title,
    content: highlightContent || content.trim(),
    tags: category ? [category] : [],
    noteType: 'Source',
    sourceAuthor: author,
    sourceType,
    sourceUrl: url,
  }
}

function parseMarkdownFile(fileName: string, content: string): ParsedNote {
  if (isReadwiseFormat(content)) return parseReadwiseFile(fileName, content)
  if (isNotionFormat(content)) {
    const lines = content.split('\n')
    let title = ''
    let tags: string[] = []
    let createdAt: Date | undefined
    let bodyStart = lines.length

    for (let i = 0; i < lines.length; i++) {
      const line = (lines[i] ?? '').replace(/\r$/, '')
      const trimmed = line.trim()

      if (!title && trimmed.startsWith('# ')) {
        title = trimmed.slice(2).trim()
        continue
      }
      if (title) {
        if (!trimmed) {
          bodyStart = i + 1
          break
        }
        if (trimmed.startsWith('Tags:')) {
          const tagStr = trimmed.slice('Tags:'.length).trim()
          if (tagStr) tags = tagStr.split(',').map(t => t.trim()).filter(Boolean)
        } else if (trimmed.startsWith('Created:')) {
          createdAt = parseNotionDate(trimmed.slice('Created:'.length).trim())
        }
        // UID / Last Edited — parsed but not used beyond dedup
      }
    }

    // Strip Notion page links: [text](text-uid32hex.md) → [[text]]
    const body = lines
      .slice(bodyStart)
      .join('\n')
      .replace(/\[([^\]]+)\]\([^)]+[a-f0-9]{32}\.md\)/g, '[[$1]]')
      .trimEnd()

    return { title: title || fileName.replace(/\.md$/i, ''), content: body, tags, createdAt }
  }

  // Plain markdown — filename becomes title
  return {
    title: fileName.replace(/\.md$/i, '').replace(/[-_]/g, ' '),
    content: content.trimEnd(),
    tags: [],
  }
}

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

  const date = new Date().toISOString().slice(0, 10)
  return new Response(JSON.stringify({ notes: exported, exportedAt: new Date().toISOString() }, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="alex-notes-export-${date}.json"`,
    },
  })
})

// POST /api/import
// Accepts two formats:
//   1. Markdown files (frontend):  [{ fileName: string, content: string }, ...]
//   2. JSON export round-trip:     { notes: [...], mode?: 'skip'|'overwrite' }
router.post('/', async (c) => {
  const db = c.get('db')
  const raw = await c.req.json()

  // Detect format A: array of { fileName, content } markdown files
  if (Array.isArray(raw)) {
    const files = raw as Array<{ fileName: string; content: string }>
    let imported = 0
    let skipped = 0

    for (const file of files) {
      if (!file.fileName || !file.content) { skipped++; continue }
      if (!file.fileName.toLowerCase().endsWith('.md')) { skipped++; continue }

      const parsed = parseMarkdownFile(file.fileName, file.content)
      if (!parsed.title || !parsed.content) { skipped++; continue }

      const id = makeId()
      const now = isoNow()
      try {
        await db.insert(notes).values({
          id,
          title: parsed.title,
          content: parsed.content,
          status: 'Permanent',
          noteType: parsed.noteType ?? 'Regular',
          source: null,
          sourceAuthor: parsed.sourceAuthor ?? null,
          sourceTitle: null,
          sourceUrl: parsed.sourceUrl ?? null,
          sourceYear: null,
          sourceType: parsed.sourceType ?? null,
          createdAt: parsed.createdAt ? parsed.createdAt.toISOString() : now,
          updatedAt: now,
          embedStatus: 'Pending',
        })

        if (parsed.tags.length) {
          await db.insert(noteTags).values(parsed.tags.map(tag => ({ noteId: id, tag })))
        }

        // Queue send is best-effort: don't fail the whole import if it errors
        c.env.EMBED_QUEUE.send({ noteId: id }).catch(err =>
          console.error(`[import] failed to enqueue ${id}:`, err),
        )
        imported++
      } catch (err) {
        console.error(`[import] failed to insert "${file.fileName}":`, err)
        skipped++
      }
    }

    // Match the ImportResult shape the frontend expects
    return c.json({ total: files.length, imported, skipped, noteIds: [] })
  }

  // Format B: JSON export round-trip { notes: [...] }
  const body = raw as {
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
  }

  if (!Array.isArray(body.notes)) {
    return c.json({ error: 'Expected an array of markdown files or { notes: [...] }' }, 400)
  }

  let imported = 0
  let skipped = 0

  for (const n of body.notes) {
    if (!n.title || !n.content) { skipped++; continue }

    const id = makeId()
    const now = isoNow()
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
        createdAt: n.createdAt ?? now,
        updatedAt: n.updatedAt ?? now,
        embedStatus: 'Pending',
      })

      if (n.tags?.length) {
        await db.insert(noteTags).values(n.tags.map(tag => ({ noteId: id, tag })))
      }

      await c.env.EMBED_QUEUE.send({ noteId: id })
      imported++
    } catch {
      skipped++
    }
  }

  return c.json({ total: body.notes.length, imported, skipped, noteIds: [] })
})

export default router
