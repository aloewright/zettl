/**
 * Centralized AI Gateway configuration.
 *
 * ALL AI calls go through AI Gateway "x" with unified billing.
 * No provider API keys needed — Cloudflare bills the account directly.
 *
 * Dynamic routes: fetch() → /dynamic/{routeName}/... endpoint
 * Compat routes:  fetch() → /compat/... endpoint with provider/model in body
 * Embeddings/Audio: env.AI.run() with { gateway: { id: GATEWAY_ID } }
 *
 * Both approaches route through AI Gateway and use unified billing.
 */

import type { Env } from '../types'

export const ACCOUNT_ID = '85d376fc54617bcb57185547f08e528b'
export const GATEWAY_ID = 'x'
export const GATEWAY_BASE = `https://gateway.ai.cloudflare.com/v1/${ACCOUNT_ID}/${GATEWAY_ID}`

/** Options to pass to env.AI.run() to route through AI Gateway. */
export const AI_GATEWAY_OPTS = { gateway: { id: GATEWAY_ID } }

/**
 * Build gateway auth headers for fetch-based calls.
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
 * Build the gateway URL for a given model and path.
 * - Dynamic routes (model starts with "dynamic/"): /dynamic/{routeName}{path}
 * - Compat routes (provider/model format):         /compat{path}
 */
function buildGatewayUrl(model: string, path: string): string {
  if (!model || typeof model !== 'string') {
    throw new Error('AI Gateway: model is required in request body')
  }
  if (model.startsWith('dynamic/')) {
    const routeName = model.slice('dynamic/'.length)
    if (!routeName) {
      throw new Error('AI Gateway: dynamic route name is empty (model="dynamic/")')
    }
    return `${GATEWAY_BASE}/dynamic/${routeName}${path}`
  }
  return `${GATEWAY_BASE}/compat${path}`
}

/**
 * POST to the gateway and return the raw Response.
 * Automatically routes dynamic/ models to /dynamic/{route}/ endpoint
 * and other models to /compat/ endpoint.
 */
export async function gatewayFetch(
  env: Env,
  path: string,
  body: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  const model = (body.model as string) ?? ''
  const url = buildGatewayUrl(model, path)
  const headers = gatewayHeaders(env, extraHeaders)
  const isStreaming = body.stream === true

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text()
    console.error(`AI Gateway error: ${url} ${res.status}: ${errText}`)
    throw new Error(`AI Gateway request failed: ${res.status}`)
  }

  if (isStreaming && !res.body) {
    throw new Error('Expected streaming response but received non-streaming response from gateway')
  }

  return res
}

/**
 * POST to gateway, return parsed JSON.
 * Reads the full body as text first — dynamic routes may use chunked
 * transfer encoding that res.json() doesn't handle in all Workers runtimes.
 */
export async function gatewayJSON<T = unknown>(
  env: Env,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await gatewayFetch(env, path, body)
  const text = await res.text()
  if (!text) {
    throw new Error(`AI Gateway ${path}: empty response body (status ${res.status})`)
  }
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`AI Gateway ${path}: invalid JSON: ${text.slice(0, 300)}`)
  }
}
