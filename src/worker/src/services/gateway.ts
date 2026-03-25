/**
 * Centralized AI Gateway configuration.
 *
 * ALL AI calls go through AI Gateway "x" with unified billing.
 * No provider API keys needed — Cloudflare bills the account directly.
 *
 * Chat/LLM: fetch() → /compat/... endpoint with model: "dynamic/{routeName}" in body
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
 * Construct headers for requests sent through the Cloudflare AI Gateway.
 *
 * @param extra - Additional headers to merge into the resulting header map; values in `extra` override defaults.
 * @returns A map of headers containing `Content-Type: application/json` and, when `env.CF_AIG_TOKEN` is present, `cf-aig-authorization: Bearer <token>`.
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
 * Build the compat endpoint URL.
 *
 * All fetch-based AI calls use the compat endpoint. Dynamic routes are selected
 * by setting `model: "dynamic/{routeName}"` in the request body — the gateway
 * parses that field and routes to the configured provider/model automatically.
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
  }
  return `${GATEWAY_BASE}/compat${path}`
}

/**
 * Send a POST request to the Cloudflare AI Gateway compat endpoint and return the raw Response.
 *
 * All requests go to `/compat{path}`. Dynamic routes are selected via the `model` field
 * in the body (e.g., `model: "dynamic/text_gen"`) — the gateway handles routing internally.
 *
 * @param env - Worker environment bindings used to build headers and gateway URL
 * @param path - Path suffix to append to the selected gateway endpoint
 * @param body - JSON-serializable request body; if `body.model` is a string it controls routing
 * @param extraHeaders - Additional headers to merge with the default gateway headers
 * @returns The fetch `Response` returned by the gateway
 * @throws Error if the gateway responds with a non-OK status; the error message includes the full URL, HTTP status, and response text
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
 * Send a POST to the AI gateway and parse the full response body as JSON.
 *
 * @param path - Gateway path suffix (appended to the computed gateway base URL)
 * @param body - Request payload; if `body.model` is a string starting with `"dynamic/"` the request is routed to the dynamic route for that model, otherwise it is routed to the compat endpoint
 * @returns The parsed JSON response as type `T`
 * @throws Error if the response body is empty or if the response is not valid JSON
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
