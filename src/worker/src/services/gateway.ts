/**
 * Centralized AI Gateway configuration.
 *
 * ALL AI calls go through AI Gateway "x" with unified billing.
 * No provider API keys needed — Cloudflare bills the account directly.
 *
 * Chat/LLM: fetch() → compat endpoint with workers-ai/ prefix
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

function extractModel(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const maybeModel = (body as { model?: unknown }).model
  return typeof maybeModel === 'string' ? maybeModel : undefined
}

/**
 * Cloudflare AI Gateway uses different paths for dynamic routes (fallback /
 * unified billing) vs compat endpoints. Route dynamic/<name> traffic to
 * /dynamic/<name>/{path}; everything else stays on /compat/{path}.
 */
function buildGatewayPath(path: string, body: unknown): string {
  const model = extractModel(body)
  const dynamicMatch = model?.match(/^(?:dynamic|ai-gateway)\/(.+)$/)
  if (dynamicMatch?.[1]) {
    const route = dynamicMatch[1]
    // Only allow simple, safe route names and encode before interpolating.
    if (!/^[A-Za-z0-9_-]+$/.test(route)) {
      return `/compat${path}`
    }
    return `/dynamic/${encodeURIComponent(route)}${path}`
  }
  return `/compat${path}`
}

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
 * POST to AI Gateway (routes dynamic/{route} or compat/{path}) and return the raw Response.
 */
export async function gatewayFetch(
  env: Env,
  path: string,
  body: unknown,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  const url = `${GATEWAY_BASE}${buildGatewayPath(path, body)}`
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
 * Reads the full body as text first — dynamic routes may use chunked
 * transfer encoding that res.json() doesn't handle in all Workers runtimes.
 */
export async function gatewayJSON<T = unknown>(
  env: Env,
  path: string,
  body: unknown,
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
