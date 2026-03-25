/**
 * Centralized AI Gateway configuration.
 *
 * ALL AI calls go through AI Gateway "x" using the Workers AI binding (env.AI).
 * The binding's gateway().run() method is pre-authenticated — no tokens needed.
 *
 * For streaming we still use fetch() to the compat endpoint. The CF_AIG_TOKEN
 * wrangler secret should be an AI Gateway authentication token (created from
 * the AI Gateway dashboard > Settings > Create authentication token).
 */

import type { Env } from '../types'

export const GATEWAY_ID = 'x'

/**
 * Execute a non-streaming AI Gateway request via the pre-authenticated binding.
 * This is the preferred method — no tokens or headers needed.
 */
export async function gatewayRun(
  env: Env,
  provider: string,
  endpoint: string,
  body: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): Promise<unknown> {
  const gateway = env.AI.gateway(GATEWAY_ID)
  const response = await gateway.run({
    provider,
    endpoint,
    headers: extraHeaders ?? {},
    query: body,
  })
  return response
}

/**
 * Build AI Gateway auth headers for fetch-based requests (streaming).
 * CF_AIG_TOKEN must be an AI Gateway authentication token, NOT a regular
 * Cloudflare API token. Create it from: AI Gateway > Settings > Create authentication token.
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
 * Get the AI Gateway base URL for fetch-based requests (streaming).
 */
export function getGatewayBaseUrl(): string {
  return 'https://gateway.ai.cloudflare.com/v1/85d376fc54617bcb57185547f08e528b/x'
}

/**
 * Make a fetch request to the AI Gateway compat endpoint.
 * Used for streaming and audio endpoints where we need the raw Response.
 */
export async function gatewayFetch(
  env: Env,
  path: string,
  init: RequestInit,
): Promise<Response> {
  const baseUrl = getGatewayBaseUrl()
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
