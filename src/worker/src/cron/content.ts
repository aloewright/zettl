import OpenAI from 'openai'
import { eq, and, sql, inArray } from 'drizzle-orm'
import type { Env } from '../types'
import { makeId, isoNow } from '../types'
import * as schema from '../db/schema'
import { createDb } from '../db/client'
import { buildOpenAI } from '../services/embeddings'

type Db = ReturnType<typeof createDb>
type Medium = 'Blog' | 'Social'

interface ClusterNote {
  id: string
  title: string
  content: string
}

async function pickSeedNote(db: Db, medium: Medium): Promise<ClusterNote | null> {
  const rows = await db.select({
    id: schema.notes.id,
    title: schema.notes.title,
    content: schema.notes.content,
  }).from(schema.notes)
    .where(and(
      eq(schema.notes.status, 'Permanent'),
      eq(schema.notes.embedStatus, 'Done'),
      sql`"Id" NOT IN (SELECT "NoteId" FROM "UsedSeedNotes")`,
    ))
    .orderBy(sql`RANDOM()`)
    .limit(1)

  return rows[0] ?? null
}

async function findClusterNotes(
  vectorize: VectorizeIndex,
  db: Db,
  seedNote: ClusterNote,
  limit = 5,
): Promise<ClusterNote[]> {
  // Get seed note's vector from Vectorize
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
    id: schema.notes.id,
    title: schema.notes.title,
    content: schema.notes.content,
  }).from(schema.notes)
    .where(inArray(schema.notes.id, similarIds))
}

async function generateContent(
  openai: OpenAI,
  medium: Medium,
  seedNote: ClusterNote,
  clusterNotes: ClusterNote[],
  voiceConfig: { toneDescription?: string | null; audienceDescription?: string | null } | null,
  examples: { content: string }[],
): Promise<{ topicSummary: string; body: string; description: string; tags: string[] }> {
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

  const systemPrompt = medium === 'Blog'
    ? `You are a ghost-writer helping create a blog post from Zettelkasten notes.${toneContext}${audienceContext}${exampleBlock}
Return a JSON object with keys: topicSummary (1 sentence), body (full markdown blog post), description (2-sentence excerpt), tags (array of 3-5 strings).`
    : `You are a ghost-writer helping create social media content from Zettelkasten notes.${toneContext}${audienceContext}${exampleBlock}
Return a JSON object with keys: topicSummary (1 sentence), body (tweet thread or LinkedIn post, markdown), description (1-sentence summary), tags (array of 3-5 hashtag strings without #).`

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Generate ${medium === 'Blog' ? 'a blog post' : 'a social media post'} from these notes:\n\n${notesBlock}`,
      },
    ],
    response_format: { type: 'json_object' },
    max_tokens: medium === 'Blog' ? 2000 : 800,
  })

  const parsed = JSON.parse(response.choices[0]?.message.content ?? '{}')
  return {
    topicSummary: parsed.topicSummary ?? 'Generated content',
    body: parsed.body ?? '',
    description: parsed.description ?? '',
    tags: parsed.tags ?? [],
  }
}

export async function runContentCron(env: Env, medium: Medium): Promise<void> {
  const db = createDb(env.d1_db)
  const openai = await buildOpenAI(env)

  const seedNote = await pickSeedNote(db, medium)
  if (!seedNote) {
    console.log(`[cron:${medium}] No eligible seed notes found`)
    return
  }

  const clusterNotes = await findClusterNotes(env.vector_db, db, seedNote)

  // Load voice config + examples
  const [voiceConfig] = await db.select().from(schema.voiceConfigs)
    .where(eq(schema.voiceConfigs.medium, medium))
    .limit(1)

  const examples = await db.select({ content: schema.voiceExamples.content })
    .from(schema.voiceExamples)
    .where(eq(schema.voiceExamples.medium, medium))
    .limit(3)

  const generated = await generateContent(openai, medium, seedNote, clusterNotes, voiceConfig ?? null, examples)

  const generationId = makeId()
  await db.insert(schema.contentGenerations).values({
    id: generationId,
    seedNoteId: seedNote.id,
    clusterNoteIds: JSON.stringify(clusterNotes.map(n => n.id)),
    topicSummary: generated.topicSummary,
    status: 'Pending',
    generatedAt: isoNow(),
  })

  await db.insert(schema.contentPieces).values({
    id: makeId(),
    generationId,
    medium,
    body: generated.body,
    description: generated.description,
    generatedTags: JSON.stringify(generated.tags),
    status: 'Draft',
    createdAt: isoNow(),
  })

  // Mark seed as used
  await db.insert(schema.usedSeedNotes).values({ noteId: seedNote.id, usedAt: isoNow() })
    .onConflictDoNothing()

  console.log(`[cron:${medium}] Generated content from seed note "${seedNote.title}"`)
}
