import OpenAI from 'openai'
import type { Env } from '../types'

// ── Workers AI embeddings ────────────────────────────────────────────────────
// Uses @cf/baai/bge-large-en-v1.5 (1024-dim) via the ai_binding.
// When CF_AI_GATEWAY_URL is set, routes through AI Gateway for
// caching, rate-limit visibility, and cost tracking.

export async function generateEmbeddingAI(
  env: Env,
  text: string,
): Promise<number[]> {
  const opts = await workersAIGatewayOpts(env)
  const result = await env.ai_binding.run(
    '@cf/baai/bge-large-en-v1.5',
    { text: [text] },
    opts,
  ) as { data: number[][] }
  return result.data?.[0] ?? []
}

/** Parse the gateway ID from CF_AI_GATEWAY_URL for use with the Workers AI binding. */
async function workersAIGatewayOpts(
  env: Env,
): Promise<{ gateway?: { id: string } }> {
  if (!env.CF_AI_GATEWAY_URL) return {}
  try {
    const url = await env.CF_AI_GATEWAY_URL.get()
    // URL format: https://gateway.ai.cloudflare.com/v1/{accountId}/{gatewayId}
    const id = url.trim().replace(/\/$/, '').split('/').pop()
    return id ? { gateway: { id } } : {}
  } catch {
    return {}
  }
}

// ── OpenAI client (LLM tasks only) ────────────────────────────────────────
// Used for content generation, summarize, split — tasks that need
// reliable structured JSON output. Routed through AI Gateway when set.

export async function buildOpenAI(env: Env): Promise<OpenAI> {
  const apiKey = await env.OPENAI_API_KEY.get()
  let baseURL: string | undefined
  if (env.CF_AI_GATEWAY_URL) {
    const gatewayUrl = await env.CF_AI_GATEWAY_URL.get().catch(() => '')
    if (gatewayUrl) baseURL = `${gatewayUrl.replace(/\/$/, '')}/openai/v1`
  }
  return new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) })
}
