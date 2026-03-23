/**
 * Cloudflare Queue consumer — receives capture events and forwards them
 * to the backend's /api/capture webhook endpoints.
 *
 * Message format:
 *   { source: "email" | "telegram", payload: <original webhook body> }
 *
 * Bindings (configured in wrangler.jsonc):
 *   KV          — KVNamespace  (zettl_notes)  caching & session state
 *   d1_db       — D1Database   (zettel)        persistent structured storage
 *   vector_db   — VectorizeIndex (zettel-notes) semantic note search
 *   ai_binding  — Ai            general inference & embeddings
 *   ai_tts      — Ai            text-to-speech (bound online)
 *
 * Required secrets (wrangler secret put):
 *   BACKEND_URL    — e.g. https://api.yourdomain.com
 *   WEBHOOK_SECRET — matches Capture:WebhookSecret in appsettings.json
 */

interface Env {
  // Secrets
  BACKEND_URL: string
  WEBHOOK_SECRET: string

  // KV namespace — zettl_notes
  KV: KVNamespace

  // D1 database — zettel
  d1_db: D1Database

  // Vectorize index — zettel-notes
  vector_db: VectorizeIndex

  // Workers AI — general inference & embeddings
  ai_binding: Ai

  // Workers AI — text-to-speech (second AI binding configured via dashboard)
  ai_tts: Ai
}

interface CaptureMessage {
  source: 'email' | 'telegram'
  payload: unknown
}

export default {
  // ── Fetch handler — KV operations + health check ──────────────────────────
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    // Health / KV demo endpoint
    if (url.pathname === '/health') {
      // Write a key-value pair
      await env.KV.put('KEY', 'VALUE')

      // Read a key-value pair
      const value = await env.KV.get('KEY')

      // List all key-value pairs
      const allKeys = await env.KV.list()

      // Delete a key-value pair
      await env.KV.delete('KEY')

      return new Response(
        JSON.stringify({ value, allKeys }),
        { headers: { 'Content-Type': 'application/json' } },
      )
    }

    // TTS demo endpoint — POST { text: string } → audio/mpeg stream
    if (url.pathname === '/tts' && request.method === 'POST') {
      const { text } = await request.json<{ text: string }>()
      const audio = await env.ai_tts.run('@cf/meta/m2m100-1.2b', { text }) as ArrayBuffer
      return new Response(audio, { headers: { 'Content-Type': 'audio/mpeg' } })
    }

    return new Response('zettel-capture-queue worker', { status: 200 })
  },

  // ── Queue handler — forward captures, embed & store in D1/Vectorize ────────
  async queue(batch: MessageBatch<CaptureMessage>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      const { source, payload } = msg.body

      const endpoint = source === 'telegram'
        ? `${env.BACKEND_URL}/api/capture/telegram`
        : `${env.BACKEND_URL}/api/capture/email`

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }

      if (source === 'telegram') {
        headers['X-Telegram-Bot-Api-Secret-Token'] = env.WEBHOOK_SECRET
      } else {
        headers['X-Webhook-Secret'] = env.WEBHOOK_SECRET
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        console.error(`Failed to forward ${source} message to backend: ${response.status}`)
        msg.retry()
        continue
      }

      msg.ack()

      // ── Post-forward: persist to D1, embed & upsert into Vectorize ──────────
      try {
        const id = crypto.randomUUID()
        const rawText = typeof payload === 'object' && payload !== null
          ? JSON.stringify(payload)
          : String(payload)
        const now = new Date().toISOString()

        // Log capture event to D1 for audit history
        await env.d1_db
          .prepare('INSERT INTO capture_events (id, source, payload, captured_at) VALUES (?, ?, ?, ?)')
          .bind(id, source, rawText, now)
          .run()

        // Cache last-seen timestamp per source in KV
        await env.KV.put(`last_capture:${source}`, now)

        // Generate text embedding via Workers AI
        const embeddingResult = await env.ai_binding.run('@cf/baai/bge-base-en-v1.5', {
          text: [rawText],
        }) as { data: number[][] }

        const [vector] = embeddingResult.data

        // Upsert embedding into Vectorize for semantic note search
        await env.vector_db.upsert([
          {
            id,
            values: vector,
            metadata: { source, captured_at: now },
          },
        ])
      } catch (err) {
        // Non-fatal — message already acked, log and continue
        console.error('Post-forward processing error:', err)
      }
    }
  },
}
