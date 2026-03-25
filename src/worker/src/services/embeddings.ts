import type { Env } from '../types'
import { gatewayRun } from './gateway'

// ── Embeddings via AI Gateway (pre-authenticated binding) ───────────────────
// Model: pplx-embed-context-v1-4b (2056-dim output via Perplexity)
// Vectorize index must be created with --dimensions=2056 --metric=cosine.

export async function generateEmbeddingAI(
  env: Env,
  text: string,
): Promise<number[]> {
  const result = await gatewayRun(env, 'compat', 'embeddings', {
    model: 'dynamic/ai_embed',
    input: text,
  }) as { data?: Array<{ embedding?: number[] }> }

  const embedding = result?.data?.[0]?.embedding
  if (!embedding || embedding.length === 0) {
    throw new Error('AI Gateway returned no embedding for the given text')
  }
  return embedding
}
