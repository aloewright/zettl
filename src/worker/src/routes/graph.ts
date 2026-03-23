import { Hono } from 'hono'
import type { HonoEnv } from '../types'
import { notes, noteTags } from '../db/schema'

const router = new Hono<HonoEnv>()

router.get('/', async (c) => {
  const db = c.get('db')

  const [allNotes, allTags] = await Promise.all([
    db.select({ id: notes.id, title: notes.title, status: notes.status, noteType: notes.noteType })
      .from(notes),
    db.select().from(noteTags),
  ])

  // Build nodes
  const nodeMap = new Map(allNotes.map(n => [n.id, { id: n.id, title: n.title, status: n.status, noteType: n.noteType }]))

  // Build edges from wiki-links [[title]] in content
  const allNotesWithContent = await db.select({ id: notes.id, content: notes.content }).from(notes)
  const titleToId = new Map(allNotes.map(n => [n.title.toLowerCase(), n.id]))

  const edges: { source: string; target: string }[] = []
  const wikiLinkRe = /\[\[([^\]]+)\]\]/g

  for (const note of allNotesWithContent) {
    let match: RegExpExecArray | null
    wikiLinkRe.lastIndex = 0
    while ((match = wikiLinkRe.exec(note.content)) !== null) {
      const targetTitle = (match[1] ?? '').toLowerCase()
      const targetId = titleToId.get(targetTitle)
      if (targetId && targetId !== note.id) {
        edges.push({ source: note.id, target: targetId })
      }
    }
  }

  // Tag clusters: group notes by shared tags
  const tagMap: Record<string, string[]> = {}
  for (const t of allTags) {
    ;(tagMap[t.tag] ??= []).push(t.noteId)
  }

  return c.json({
    nodes: [...nodeMap.values()],
    edges,
    tagClusters: Object.entries(tagMap).map(([tag, noteIds]) => ({ tag, noteIds })),
  })
})

export default router
