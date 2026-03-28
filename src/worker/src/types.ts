import type { createDb } from './db/client'

export interface Env {
  // Cloudflare D1 database binding
  d1_db: D1Database
  // Cloudflare Vectorize index binding
  vector_db: VectorizeIndex
  CF_AI_GATEWAY_URL?: string  // plain env var (informational)
  CF_ACCESS_TEAM?: string     // Cloudflare Access team domain
  CF_AIG_TOKEN?: string       // AI Gateway auth token (wrangler secret, fallback for fetch)
  VOICE_SERVICE_URL?: string  // URL of the voice service (e.g. https://voice.example.com)
  // AI binding — pre-authenticated, no cf-aig-authorization header needed
  AI: Ai
  // Durable Object binding for ChatAgent
  ChatAgent: DurableObjectNamespace
  CAPTURE_WEBHOOK_SECRET?: SecretsStoreSecret // optional binding
  TELEGRAM_BOT_TOKEN?: SecretsStoreSecret     // optional binding
  BRAVE_API_KEY?: SecretsStoreSecret          // optional binding
  READWISE_ACCESS_TOKEN?: SecretsStoreSecret  // optional binding
  // Browser Rendering binding
  BROWSER: Fetcher
  // R2 media bucket
  MEDIA_BUCKET: R2Bucket
  // Queue bindings
  EMBED_QUEUE: Queue<EmbedQueueMessage>
  ENRICH_QUEUE: Queue<EnrichQueueMessage>
  // Static assets binding
  ASSETS: Fetcher
}

/** Resolve an optional SecretsStoreSecret, returning undefined if unbound or missing. */
export async function getOptionalSecret(
  binding: SecretsStoreSecret | string | undefined,
): Promise<string | undefined> {
  if (!binding) return undefined
  if (typeof binding === 'string') return binding
  try { return await binding.get() } catch { return undefined }
}

export interface EmbedQueueMessage {
  noteId: string
}

export interface EnrichQueueMessage {
  noteId: string
  url: string
}

export interface HonoEnv {
  Bindings: Env
  Variables: {
    db: ReturnType<typeof createDb>
    userId: string
  }
}

export interface PagedResult<T> {
  items: T[]
  totalCount: number
}

export interface SearchResult {
  noteId: string
  title: string
  snippet: string
  rank: number
}

export interface SearchWeights {
  semanticWeight: number
  fullTextWeight: number
  minimumSimilarity: number
  minimumHybridScore: number
}

export const DEFAULT_WEIGHTS: SearchWeights = {
  semanticWeight: 0.7,
  fullTextWeight: 0.3,
  minimumSimilarity: 0.5,
  minimumHybridScore: 0.1,
}

/** 21-char timestamp-based ID matching the C# implementation. */
export function newId(): string {
  const ts = Date.now().toString().padStart(13, '0')
  const rand = Math.floor(Math.random() * 9000 + 1000).toString()
  return ts + rand.slice(0, 8 - (ts.length - 13))
}

export function makeId(): string {
  const now = new Date()
  const ts = now.getFullYear().toString()
    + (now.getMonth() + 1).toString().padStart(2, '0')
    + now.getDate().toString().padStart(2, '0')
    + now.getHours().toString().padStart(2, '0')
    + now.getMinutes().toString().padStart(2, '0')
    + now.getSeconds().toString().padStart(2, '0')
    + now.getMilliseconds().toString().padStart(3, '0')
  const rand = Math.floor(Math.random() * 9000 + 1000).toString()
  return ts + rand // 17 + 4 = 21 chars
}

/** ISO-8601 datetime string for D1 (SQLite stores dates as text). */
export function isoNow(): string {
  return new Date().toISOString()
}

export function json<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function notFound(msg = 'Not found'): Response {
  return json({ error: msg }, 404)
}

export function badRequest(msg: string): Response {
  return json({ error: msg }, 400)
}
