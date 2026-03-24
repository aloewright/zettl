import OpenAI from 'openai'
import type { Env } from '../types'

// ── Workers AI embeddings ────────────────────────────────────────────────────
// Uses @cf/baai/bge-large-en-v1.5 (1024-dim) via the ai_binding.
// When CF_AI_GATEWAY_URL is set, routes through AI Gateway for
/**
 * Generate an embedding vector for the given text using the Workers AI binding model.
 *
 * @param env - Worker environment containing `ai_binding` and optional `CF_AI_GATEWAY_URL` used to route the request
 * @param text - Input text to embed
 * @returns The first embedding vector returned by the model, or an empty array if no embedding is available
 */

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

/**
 * Extract the Workers AI gateway ID from env.CF_AI_GATEWAY_URL.
 *
 * If the URL is present and a trailing segment can be parsed as the gateway ID,
 * returns an object of the form `{ gateway: { id } }`; otherwise returns an empty object.
 *
 * @returns `{ gateway: { id: string } }` when an ID is found, otherwise `{}`.
 */
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
/**
 * Constructs an OpenAI client using the environment's API key and optional Workers AI Gateway routing.
 *
 * @param env - Environment bindings; reads `OPENAI_API_KEY` and, when present, `CF_AI_GATEWAY_URL` to derive a gateway-backed OpenAI base URL.
 * @returns An `OpenAI` client configured with the retrieved API key and `baseURL` pointing to `<gateway>/openai/v1` when `CF_AI_GATEWAY_URL` is set and valid.

export async function buildOpenAI(env: Env): Promise<OpenAI> {
  const apiKey = await env.OPENAI_API_KEY.get()
  let baseURL: string | undefined
  if (env.CF_AI_GATEWAY_URL) {
    const gatewayUrl = await env.CF_AI_GATEWAY_URL.get().catch(() => '')
    if (gatewayUrl) baseURL = `${gatewayUrl.replace(/\/$/, '')}/openai/v1`
  }
  return new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) })
}
