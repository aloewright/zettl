import { neon } from '@neondatabase/serverless'
import type { EnrichQueueMessage, Env } from '../types'

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
  const sql = neon(await env.DATABASE_URL.get())
  const { noteId, url } = message.body

  await sql`
    UPDATE "Notes" SET "EnrichStatus" = 'Processing' WHERE "Id" = ${noteId}
  `

  try {
    const data = await fetchPageMetadata(url)
    const enrichmentJson = JSON.stringify(data)

    await sql`
      UPDATE "Notes"
      SET "EnrichmentJson"   = ${enrichmentJson},
          "EnrichStatus"     = 'Done',
          "EnrichRetryCount" = 0,
          "SourceTitle"      = COALESCE("SourceTitle", ${data.title ?? null}),
          "SourceAuthor"     = COALESCE("SourceAuthor", ${data.author ?? null})
      WHERE "Id" = ${noteId}
    `
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)

    await sql`
      UPDATE "Notes"
      SET "EnrichStatus"     = 'Failed',
          "EnrichRetryCount" = "EnrichRetryCount" + 1
      WHERE "Id" = ${noteId}
    `

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
