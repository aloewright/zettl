import type { Env } from '../types'

// ── Embeddings via AI Gateway ───────────────────────────────────────────────
// Routes through AI Gateway "x" dynamic route `ai_embed` with unified billing.
// Model: pplx-embed-context-v1-4b (2056-dim output via Perplexity)
// Vectorize index must be created with --dimensions=2056 --metric=cosine.

const ACCOUNT_ID = '85d376fc54617bcb57185547f08e528b'
const GATEWAY_ID = 'x'

export async function generateEmbeddingAI(
  env: Env,
  text: string,
): Promise<number[]> {
  const gatewayUrl = `https://gateway.ai.cloudflare.com/v1/${ACCOUNT_ID}/${GATEWAY_ID}/compat/embeddings`
  const cfToken = env.CF_AIG_TOKEN

  const res = await fetch(gatewayUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cfToken ? { 'cf-aig-authorization': `Bearer ${cfToken}` } : {}),
    },
    body: JSON.stringify({
      model: 'dynamic/ai_embed',
      input: text,
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`AI Gateway [ai_embed] ${res.status}: ${errText}`)
  }

  const result = await res.json<{ data?: Array<{ embedding?: number[] }> }>()
  const embedding = result.data?.[0]?.embedding
  if (!embedding || embedding.length === 0) {
    throw new Error('AI Gateway returned no embedding for the given text')
  }
  return embedding
}
