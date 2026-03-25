/**
 * Centralized AI Gateway configuration and fetch helper.
 *
 * ALL AI calls MUST go through AI Gateway "x" with unified billing.
 * Uses the Workers AI binding (env.AI) which is pre-authenticated —
 * no cf-aig-authorization header needed when using binding methods.
 *
 * For streaming/compat endpoints we use fetch to the gateway URL,
 * falling back to cf-aig-authorization + Authorization headers.
 *
 * Dynamic routes:
 *   text_gen      → /compat/chat/completions  (LLM chat/content generation)
 *   research_gen  → /compat/chat/completions  (Perplexity research)
 *   audio_gen     → /compat/audio/speech      (Text-to-speech)
 *   stt_gen       → /compat/audio/transcriptions (Speech-to-text)
 *   ai_embed      → /compat/embeddings        (Text embeddings, 2056-dim)
 */

import type { Env } from '../types'

export const GATEWAY_ID = 'x'

/**
 * Get the AI Gateway base URL using the AI binding.
 * Pre-authenticated when called from a Worker.
 */
export async function getGatewayUrl(env: Env): Promise<string> {
  try {
    const url = await env.AI.gateway(GATEWAY_ID).getUrl()
    return url
  } catch {
    // Fallback for local dev or if binding isn't available
    return 'https://gateway.ai.cloudflare.com/v1/85d376fc54617bcb57185547f08e528b/x'
  }
}

/**
 * Build standard AI Gateway request headers.
 * When using the AI binding's getUrl(), auth is handled by the binding.
 * We also send cf-aig-authorization + Authorization as belt-and-suspenders.
 */
export function gatewayHeaders(env: Env, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extra,
  }
  const cfToken = env.CF_AIG_TOKEN
  if (cfToken) {
    headers['cf-aig-authorization'] = `Bearer ${cfToken}`
    headers['Authorization'] = `Bearer ${cfToken}`
  }
  return headers
}

/**
 * Make a fetch request to the AI Gateway compat endpoint.
 * Uses the AI binding's getUrl() for pre-authenticated access.
 */
export async function gatewayFetch(
  env: Env,
  path: string,
  init: RequestInit,
): Promise<Response> {
  const baseUrl = await getGatewayUrl(env)
  const headers = gatewayHeaders(env, init.headers as Record<string, string> | undefined)

  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`AI Gateway ${path} ${res.status}: ${errText}`)
  }

  return res
}
