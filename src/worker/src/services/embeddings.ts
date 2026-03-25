import type { Env } from '../types'
import { gatewayFetch } from './gateway'

// ── Embeddings via AI Gateway ───────────────────────────────────────────────
// Routes through dynamic route `ai_embed` with unified billing.
// Vectorize index: --dimensions=1536 --metric=cosine
// (Cloudflare Vectorize max is 1536; embeddings are truncated if needed)

const EMBED_DIMENSIONS = 1536

export async function generateEmbeddingAI(
  env: Env,
  text: string,
): Promise<number[]> {
  const res = await gatewayFetch(env, '/compat/embeddings', {
    method: 'POST',
    body: JSON.stringify({
      model: 'dynamic/ai_embed',
      input: text,
      dimensions: EMBED_DIMENSIONS,
    }),
  })

  const result = await res.json<{ data?: Array<{ embedding?: number[] }> }>()
  const embedding = result.data?.[0]?.embedding
  if (!embedding || embedding.length === 0) {
    throw new Error('AI Gateway returned no embedding for the given text')
  }

  // Truncate to Vectorize max if the model returns more dimensions
  if (embedding.length > EMBED_DIMENSIONS) {
    return embedding.slice(0, EMBED_DIMENSIONS)
  }

  return embedding
}
