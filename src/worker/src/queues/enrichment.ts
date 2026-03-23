import { eq } from 'drizzle-orm'
import type { EnrichQueueMessage, Env } from '../types'
import { createDb } from '../db/client'
import { notes } from '../db/schema'

interface EnrichmentData {
  title?: string
  description?: string
  author?: string
  siteName?: string
  publishedAt?: string
  imageUrl?: string
}

async function fetchPageMetadata(url: string): Promise<EnrichmentData> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'ZettlBot/1.0 (knowledge enrichment)' },
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) throw new Error(`HTTP ${res.status}`)

  const html = await res.text()
  const data: EnrichmentData = {}

  const meta = (name: string): string | undefined => {
    const patterns = [
      new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["']`, 'i'),
    ]
    for (const p of patterns) {
      const m = html.match(p)
      if (m?.[1]) return m[1]
    }
    return undefined
  }

  const title = meta('og:title') ?? meta('twitter:title')
  const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  data.title = title ?? titleTag?.[1]?.trim()
  data.description = meta('og:description') ?? meta('description') ?? meta('twitter:description')
  data.author = meta('author') ?? meta('article:author')
  data.siteName = meta('og:site_name')
  data.publishedAt = meta('article:published_time') ?? meta('og:updated_time')
  data.imageUrl = meta('og:image') ?? meta('twitter:image')

  return data
}

export async function handleEnrichMessage(
  message: Message<EnrichQueueMessage>,
  env: Env,
): Promise<void> {
  const db = createDb(env.d1_db)
  const { noteId, url } = message.body

  await db.update(notes)
    .set({ enrichStatus: 'Processing' })
    .where(eq(notes.id, noteId))

  try {
    const data = await fetchPageMetadata(url)
    const enrichmentJson = JSON.stringify(data)

    // Read current values so we can COALESCE (keep existing if already set)
    const [current] = await db.select({
      sourceTitle: notes.sourceTitle,
      sourceAuthor: notes.sourceAuthor,
    }).from(notes).where(eq(notes.id, noteId))

    await db.update(notes).set({
      enrichmentJson,
      enrichStatus: 'Done',
      enrichRetryCount: 0,
      sourceTitle: current?.sourceTitle ?? data.title ?? null,
      sourceAuthor: current?.sourceAuthor ?? data.author ?? null,
    }).where(eq(notes.id, noteId))

  } catch (err) {
    const [current] = await db.select({ enrichRetryCount: notes.enrichRetryCount })
      .from(notes).where(eq(notes.id, noteId)).catch(() => [])

    await db.update(notes).set({
      enrichStatus: 'Failed',
      enrichRetryCount: (current?.enrichRetryCount ?? 0) + 1,
    }).where(eq(notes.id, noteId))

    throw err
  }
}

export async function handleEnrichBatch(
  batch: MessageBatch<EnrichQueueMessage>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await handleEnrichMessage(message, env)
      message.ack()
    } catch {
      message.retry()
    }
  }
}
