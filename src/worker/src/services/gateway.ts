/**
 * Centralized AI Gateway configuration.
 *
 * ALL AI calls go through AI Gateway "x" for logging/analytics.
 * Uses the provider-specific Workers AI endpoint (not compat/dynamic
 * which currently returns empty bodies).
 *
 * Gateway URL pattern:
 *   {GATEWAY_BASE}/workers-ai/v1/chat/completions
 *   {GATEWAY_BASE}/workers-ai/v1/embeddings
 *
 * For research (Perplexity), uses the perplexity-ai provider endpoint.
 */

import type { Env } from '../types'

export const ACCOUNT_ID = '85d376fc54617bcb57185547f08e528b'
export const GATEWAY_ID = 'x'
export const GATEWAY_BASE = `https://gateway.ai.cloudflare.com/v1/${ACCOUNT_ID}/${GATEWAY_ID}`

/**
 * Build gateway auth headers.
 * cf-aig-authorization: Bearer <CF_AIG_TOKEN> for authentication.
 */
export function gatewayHeaders(env: Env, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  const cfToken = env.CF_AIG_TOKEN
  if (cfToken) {
    headers['cf-aig-authorization'] = `Bearer ${cfToken}`
  }
  if (extra) Object.assign(headers, extra)
  return headers
}

/**
 * Fetch-based gateway call through Workers AI provider endpoint.
 */
export async function gatewayFetch(
  env: Env,
  provider: string,
  path: string,
  body: unknown,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  const url = `${GATEWAY_BASE}/${provider}${path}`
  const headers = gatewayHeaders(env, extraHeaders)

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`AI Gateway [${provider}] ${path} ${res.status}: ${errText}`)
  }

  return res
}

/**
 * Gateway call returning parsed JSON via Workers AI provider.
 */
export async function gatewayJSON<T = unknown>(
  env: Env,
  provider: string,
  path: string,
  body: unknown,
): Promise<T> {
  const res = await gatewayFetch(env, provider, path, body)
  return res.json() as Promise<T>
}
