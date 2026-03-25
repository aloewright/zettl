import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { HonoEnv, Env, EmbedQueueMessage, EnrichQueueMessage } from './types'
import { dbMiddleware, authMiddleware } from './middleware/auth'
import notesRouter from './routes/notes'
import searchRouter from './routes/search'
import captureRouter from './routes/capture'
import contentRouter from './routes/content'
import graphRouter from './routes/graph'
import kbHealthRouter from './routes/kb-health'
import tagsRouter from './routes/tags'
import voiceRouter from './routes/voice'
import researchRouter from './routes/research'
import importExportRouter from './routes/import-export'
import readwiseRouter from './routes/readwise'
import ttsRouter from './routes/tts'
import sttRouter from './routes/stt'
import settingsRouter from './routes/settings'
import generateRouter from './routes/generate'
import uploadRouter from './routes/upload'
import composioRouter from './routes/composio'
import authRouter from './routes/auth'
import { handleEmbedBatch } from './queues/embedding'
import { handleEnrichBatch } from './queues/enrichment'
import { runContentCron } from './cron/content'

const app = new Hono<HonoEnv>()

// ── Global middleware ──────────────────────────────────────────────────────────

app.use('*', cors({
  origin: (origin) => origin ?? '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}))

app.use('/api/*', dbMiddleware)

// Auth endpoints handle their own JWT verification
app.route('/api/auth', authRouter)

// Capture endpoints use webhook secret auth, not JWT — skip authMiddleware
app.use('/api/capture/*', async (c, next) => next())
// All other /api routes require JWT
app.use('/api/*', async (c, next) => {
  // Skip auth for capture and auth routes (handled inside their routers)
  if (c.req.path.startsWith('/api/capture/') || c.req.path.startsWith('/api/auth/')) return next()
  return authMiddleware(c, next)
})

// ── Routes ─────────────────────────────────────────────────────────────────────

app.route('/api/notes', notesRouter)
app.route('/api/search', searchRouter)
app.route('/api/capture', captureRouter)
app.route('/api/content', contentRouter)
app.route('/api/graph', graphRouter)
app.route('/api/kb-health', kbHealthRouter)
app.route('/api/tags', tagsRouter)
app.route('/api/voice', voiceRouter)
app.route('/api/research', researchRouter)
app.route('/api/export', importExportRouter)
app.route('/api/import', importExportRouter)
app.route('/api/readwise', readwiseRouter)
app.route('/api/tts', ttsRouter)
app.route('/api/stt', sttRouter)
app.route('/api/settings', settingsRouter)
app.route('/api/generate', generateRouter)
app.route('/api/upload', uploadRouter)
app.route('/api/composio', composioRouter)

// ── Media serving (R2) ───────────────────────────────────────────────────────

app.get('/media/*', async (c) => {
  const key = c.req.path.slice('/media/'.length)
  if (!key) return c.json({ error: 'Not found' }, 404)

  const object = await c.env.MEDIA_BUCKET.get(key)
  if (!object) return c.json({ error: 'Not found' }, 404)

  const headers = new Headers()
  headers.set('Content-Type', object.httpMetadata?.contentType ?? 'application/octet-stream')
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')

  return new Response(object.body, { headers })
})

// /api/discover — alias for /api/notes/discover
app.get('/api/discover', async (c) => {
  // Forward to notes discover endpoint
  const url = new URL(c.req.url)
  url.pathname = '/api/notes/discover'
  return app.fetch(new Request(url.toString(), c.req.raw), c.env, c.executionCtx)
})

// ── Health ─────────────────────────────────────────────────────────────────────

app.get('/health', (c) => c.json({ status: 'ok', ts: new Date().toISOString() }))

// ── SPA fallback ────────────────────────────────────────────────────────────
// Any non-API route that wasn't matched by static assets → serve index.html

app.get('*', async (c) => {
  const url = new URL(c.req.url)
  url.pathname = '/index.html'
  return c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw))
})

// ── Queue consumer ─────────────────────────────────────────────────────────────

async function queue(
  batch: MessageBatch<EmbedQueueMessage | EnrichQueueMessage>,
  env: Env,
): Promise<void> {
  if (batch.queue === 'zettel-embeddings') {
    await handleEmbedBatch(batch as MessageBatch<EmbedQueueMessage>, env)
  } else if (batch.queue === 'zettel-enrichment') {
    await handleEnrichBatch(batch as MessageBatch<EnrichQueueMessage>, env)
  }
}

// ── Cron handler ───────────────────────────────────────────────────────────────

async function scheduled(
  event: ScheduledEvent,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  const cron = event.cron

  if (cron === '0 9 * * MON') {
    // Monday 9am — generate blog post
    ctx.waitUntil(runContentCron(env, 'Blog'))
  } else if (cron === '0 9 * * *') {
    // Daily 9am — generate social post
    ctx.waitUntil(runContentCron(env, 'Social'))
  }
}

export default {
  fetch: app.fetch,
  queue,
  scheduled,
}
