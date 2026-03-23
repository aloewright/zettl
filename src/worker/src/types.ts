import type { createDb, createSql } from './db/client'

export interface Env {
  // Secrets
  DATABASE_URL: string
  OPENAI_API_KEY: string
  KINDE_DOMAIN: string
  KINDE_AUDIENCE?: string
  CF_AI_GATEWAY_URL?: string
  CAPTURE_WEBHOOK_SECRET?: string
  TELEGRAM_BOT_TOKEN?: string
  BRAVE_API_KEY?: string
  // Queue bindings
  EMBED_QUEUE: Queue<EmbedQueueMessage>
  ENRICH_QUEUE: Queue<EnrichQueueMessage>
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
    sql: ReturnType<typeof createSql>
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
  // Simpler version that also produces 21 chars:
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
