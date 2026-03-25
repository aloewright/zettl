import type { Env } from '../types'
import { AI_GATEWAY_OPTS } from './gateway'

// ── Embeddings via Workers AI (routed through AI Gateway) ───────────────────
// Model: @cf/baai/bge-large-en-v1.5 → 1024 dimensions
// Vectorize index must be 1024 dims to match.
// Uses env.AI.run() with gateway option so it appears in AI Gateway logs
// and uses unified billing (no API keys needed).

const EMBED_MODEL = '@cf/baai/bge-large-en-v1.5' as const

export async function generateEmbeddingAI(
  env: Env,
  text: string,
): Promise<number[]> {
  const result = await env.AI.run(
    EMBED_MODEL,
    { text: [text] },
    AI_GATEWAY_OPTS,
  ) as { data?: number[][] }

  const embedding = result?.data?.[0]
  if (!embedding || embedding.length === 0) {
    throw new Error(`Workers AI ${EMBED_MODEL} returned no embedding`)
  }

  return embedding
}
