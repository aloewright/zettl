/**
 * Centralized AI Gateway configuration.
 *
 * ALL AI calls go through AI Gateway "x" with unified billing.
 * Auth: cf-aig-authorization header with the AI Gateway token
 * (created from dashboard > AI Gateway > Settings > Create authentication token).
 *
 * Dynamic routes:
 *   text_gen      → /compat/chat/completions
 *   research_gen  → /compat/chat/completions
 *   audio_gen     → /compat/audio/speech
 *   stt_gen       → /compat/audio/transcriptions
 *   ai_embed      → /compat/embeddings
 */

import type { Env } from '../types'

const ACCOUNT_ID = '85d376fc54617bcb57185547f08e528b'
const GATEWAY_ID = 'x'
export const GATEWAY_BASE = `https://gateway.ai.cloudflare.com/v1/${ACCOUNT_ID}/${GATEWAY_ID}`

/**
 * Build AI Gateway auth headers.
 * CF_AIG_TOKEN is an AI Gateway authentication token (cfut_... format).
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
