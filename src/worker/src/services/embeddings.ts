import type { Env } from '../types'
import { gatewayFetch } from './gateway'

// ── Embeddings via AI Gateway ───────────────────────────────────────────────
// Routes through AI Gateway "x" dynamic route `ai_embed` with unified billing.
// Model: pplx-embed-context-v1-4b (2056-dim output via Perplexity)
// Vectorize index must be created with --dimensions=2056 --metric=cosine.

export async function generateEmbeddingAI(
  env: Env,
  text: string,
): Promise<number[]> {
  const res = await gatewayFetch(env, '/compat/embeddings', {
    method: 'POST',
    body: JSON.stringify({
      model: 'dynamic/ai_embed',
      input: text,
    }),
  })

  const result = await res.json<{ data?: Array<{ embedding?: number[] }> }>()
  const embedding = result.data?.[0]?.embedding
  if (!embedding || embedding.length === 0) {
    throw new Error('AI Gateway returned no embedding for the given text')
  }
  return embedding
}
