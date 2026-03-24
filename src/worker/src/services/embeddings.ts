import type { Env } from '../types'

// ── Workers AI embeddings ────────────────────────────────────────────────────
// Uses @cf/baai/bge-large-en-v1.5 (1024-dim) via the ai_binding.
// When CF_AI_GATEWAY_URL is set, routes through AI Gateway for
// caching, rate-limit visibility, and cost tracking.

// Model: @cf/baai/bge-large-en-v1.5 — outputs 1024-dimensional vectors.
// Vectorize index must be created with --dimensions=1024 --metric=cosine.
export async function generateEmbeddingAI(
  env: Env,
  text: string,
): Promise<number[]> {
  const opts = workersAIGatewayOpts(env)
  const result = await env.ai_binding.run(
    '@cf/baai/bge-large-en-v1.5',
    { text: [text] },
    opts,
  ) as { data: number[][] }
  const embedding = result.data?.[0]
  if (!embedding || embedding.length === 0) {
    throw new Error('Workers AI returned no embedding for the given text')
  }
  return embedding
}

/** Parse the gateway ID from CF_AI_GATEWAY_URL for use with the Workers AI binding. */
function workersAIGatewayOpts(
  env: Env,
): { gateway?: { id: string } } {
  if (!env.CF_AI_GATEWAY_URL) return {}
  try {
    // URL format: https://gateway.ai.cloudflare.com/v1/{accountId}/{gatewayId}
    const parsed = new URL(env.CF_AI_GATEWAY_URL.trim())
    const segments = parsed.pathname.replace(/\/$/, '').split('/').filter(Boolean)
    // Expect: ["v1", accountId, gatewayId]
    const id = segments.length >= 3 ? segments[2] : undefined
    return id ? { gateway: { id } } : {}
  } catch {
    return {}
  }
}
