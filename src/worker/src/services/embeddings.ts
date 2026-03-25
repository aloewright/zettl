import type { Env } from '../types'

// ── Embeddings via Workers AI (through AI Gateway) ──────────────────────────
// Uses env.AI binding directly — most reliable, pre-authenticated.
// Model: @cf/baai/bge-large-en-v1.5 → 1024 dimensions
// Vectorize index must be 1024 dims.

const EMBED_MODEL = '@cf/baai/bge-large-en-v1.5'

export async function generateEmbeddingAI(
  env: Env,
  text: string,
): Promise<number[]> {
  // Use env.AI directly — pre-authenticated, routes through gateway via [ai] binding
  const result = await env.AI.run(EMBED_MODEL, {
    text: [text],
  }) as { data?: number[][] }

  const embedding = result?.data?.[0]
  if (!embedding || embedding.length === 0) {
    throw new Error(`Workers AI ${EMBED_MODEL} returned no embedding`)
  }

  return embedding
}
