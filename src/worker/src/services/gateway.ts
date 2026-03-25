/**
 * Centralized AI Gateway configuration and fetch helper.
 *
 * ALL AI calls MUST go through AI Gateway "x" with unified billing.
 * No direct model calls (no ai_binding.run(), no direct ElevenLabs/OpenRouter/etc API calls).
 *
 * Dynamic routes:
 *   text_gen      → /compat/chat/completions  (LLM chat/content generation)
 *   research_gen  → /compat/chat/completions  (Perplexity research)
 *   audio_gen     → /compat/audio/speech      (Text-to-speech)
 *   stt_gen       → /compat/audio/transcriptions (Speech-to-text)
 *   ai_embed      → /compat/embeddings        (Text embeddings, 2056-dim)
 */

import type { Env } from '../types'

export const ACCOUNT_ID = '85d376fc54617bcb57185547f08e528b'
export const GATEWAY_ID = 'x'
export const GATEWAY_BASE = `https://gateway.ai.cloudflare.com/v1/${ACCOUNT_ID}/${GATEWAY_ID}`

/**
 * Build standard AI Gateway request headers.
 * CF_AIG_TOKEN is a wrangler secret (plain string), used for unified billing.
 */
export function gatewayHeaders(env: Env, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extra,
  }
  const cfToken = env.CF_AIG_TOKEN
  if (cfToken) {
    headers['cf-aig-authorization'] = `Bearer ${cfToken}`
  }
  return headers
}

/**
 * Make a fetch request to the AI Gateway.
 * Handles auth headers automatically.
 */
export async function gatewayFetch(
  env: Env,
  path: string,
  init: RequestInit,
): Promise<Response> {
  const headers = gatewayHeaders(env, init.headers as Record<string, string> | undefined)

  const res = await fetch(`${GATEWAY_BASE}${path}`, {
    ...init,
    headers,
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`AI Gateway ${path} ${res.status}: ${errText}`)
  }

  return res
}
