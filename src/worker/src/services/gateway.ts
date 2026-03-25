/**
 * Centralized AI Gateway configuration.
 *
 * ALL AI calls go through AI Gateway "x" via the compat endpoint.
 * Uses workers-ai/ prefix for models (no API keys needed).
 *
 * When dynamic route API keys are fixed in the dashboard,
 * switch model names back to dynamic/text_gen, dynamic/ai_embed, etc.
 */

import type { Env } from '../types'

export const ACCOUNT_ID = '85d376fc54617bcb57185547f08e528b'
export const GATEWAY_ID = 'x'
export const GATEWAY_BASE = `https://gateway.ai.cloudflare.com/v1/${ACCOUNT_ID}/${GATEWAY_ID}`

/**
 * Build gateway auth headers.
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
 * POST to the compat endpoint and return the raw Response.
 */
export async function gatewayFetch(
  env: Env,
  path: string,
  body: unknown,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  const url = `${GATEWAY_BASE}/compat${path}`
  const headers = gatewayHeaders(env, extraHeaders)

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`AI Gateway ${path} ${res.status}: ${errText}`)
  }

  return res
}

/**
 * POST to compat endpoint, return parsed JSON.
 */
export async function gatewayJSON<T = unknown>(
  env: Env,
  path: string,
  body: unknown,
): Promise<T> {
  const res = await gatewayFetch(env, path, body)
  return res.json() as Promise<T>
}
