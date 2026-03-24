import { eq } from 'drizzle-orm'
import type { Env } from '../types'
import { getOptionalSecret } from '../types'
import { createDb } from '../db/client'
import { appSettings } from '../db/schema'

// ── Types ────────────────────────────────────────────────────────────────────

export type LLMProvider = 'openrouter' | 'google' | 'workersai'

export interface LLMConfig {
  provider: LLMProvider
  model: string
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface ChatCompletionOptions {
  messages: ChatMessage[]
  maxTokens?: number
  temperature?: number
  responseFormat?: { type: 'json_object' | 'text' }
}

// ── Config resolution ────────────────────────────────────────────────────────

export async function getLLMConfig(env: Env): Promise<LLMConfig> {
  const db = createDb(env.d1_db)

  const [providerRow, modelRow] = await Promise.all([
    db.select().from(appSettings).where(eq(appSettings.key, 'llm:provider')).get(),
    db.select().from(appSettings).where(eq(appSettings.key, 'llm:model')).get(),
  ])

  const provider = (providerRow?.value as LLMProvider) ?? 'openrouter'
  const model = modelRow?.value ?? 'openai/gpt-4o'

  // If the configured provider needs an API key that's missing, fall back to Workers AI
  if (provider === 'openrouter') {
    const key = await getOptionalSecret(env.OPENROUTER_API_KEY)
    if (!key) {
      console.log('[llm] No OPENROUTER_API_KEY found, falling back to Workers AI')
      return { provider: 'workersai', model: '@cf/moonshotai/kimi-k2.5' }
    }
  } else if (provider === 'google') {
    const key = await getOptionalSecret(env.GOOGLE_API_KEY)
    if (!key) {
      console.log('[llm] No GOOGLE_API_KEY found, falling back to Workers AI')
      return { provider: 'workersai', model: '@cf/moonshotai/kimi-k2.5' }
    }
  }

  return { provider, model }
}

// ── Gateway URL builders ─────────────────────────────────────────────────────

async function getGatewayBase(env: Env): Promise<string | null> {
  const url = await getOptionalSecret(env.CF_AI_GATEWAY_URL)
  return url?.replace(/\/$/, '') ?? null
}

async function buildEndpoint(env: Env, provider: LLMProvider): Promise<{ url: string; apiKey: string }> {
  const gateway = await getGatewayBase(env)

  if (provider === 'google') {
    const apiKey = await getOptionalSecret(env.GOOGLE_API_KEY) ?? ''
    const url = gateway
      ? `${gateway}/google-ai-studio/v1beta/openai/chat/completions`
      : 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
    return { url, apiKey }
  }

  // openrouter (default for external providers)
  const apiKey = await getOptionalSecret(env.OPENROUTER_API_KEY) ?? ''
  const url = gateway
    ? `${gateway}/openrouter/chat/completions`
    : 'https://openrouter.ai/api/v1/chat/completions'
  return { url, apiKey }
}

/** Parse the gateway ID from CF_AI_GATEWAY_URL for use with the Workers AI binding. */
async function workersAIGatewayOpts(
  env: Env,
): Promise<{ gateway?: { id: string } }> {
  if (!env.CF_AI_GATEWAY_URL) return {}
  try {
    const raw = await env.CF_AI_GATEWAY_URL.get()
    const parsed = new URL(raw.trim())
    const segments = parsed.pathname.replace(/\/$/, '').split('/').filter(Boolean)
    const id = segments.length >= 3 ? segments[2] : undefined
    return id ? { gateway: { id } } : {}
  } catch {
    return {}
  }
}

// ── Workers AI chat completion ──────────────────────────────────────────────

async function workersAIChatCompletion(
  env: Env,
  model: string,
  opts: ChatCompletionOptions,
): Promise<string> {
  const gatewayOpts = await workersAIGatewayOpts(env)

  // Workers AI text generation expects messages in the same format
  const result = await env.ai_binding.run(
    model as Parameters<typeof env.ai_binding.run>[0],
    {
      messages: opts.messages.map(m => ({ role: m.role, content: m.content })),
      max_tokens: opts.maxTokens ?? 2000,
      temperature: opts.temperature ?? 0.7,
    },
    gatewayOpts,
  ) as { response?: string }

  return result.response ?? ''
}

async function workersAIChatCompletionStream(
  env: Env,
  model: string,
  opts: ChatCompletionOptions,
): Promise<ReadableStream> {
  const gatewayOpts = await workersAIGatewayOpts(env)

  const result = await env.ai_binding.run(
    model as Parameters<typeof env.ai_binding.run>[0],
    {
      messages: opts.messages.map(m => ({ role: m.role, content: m.content })),
      max_tokens: opts.maxTokens ?? 2000,
      temperature: opts.temperature ?? 0.7,
      stream: true,
    },
    gatewayOpts,
  )

  // Workers AI returns a ReadableStream when stream: true
  if (result instanceof ReadableStream) {
    return result
  }

  // Fallback: wrap non-streaming response in SSE format
  const text = typeof result === 'object' && result !== null && 'response' in result
    ? (result as { response: string }).response
    : String(result)

  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`))
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  })
}

// ── Chat completion (non-streaming) ──────────────────────────────────────────

export async function chatCompletion(
  env: Env,
  opts: ChatCompletionOptions,
  configOverride?: LLMConfig,
): Promise<string> {
  const config = configOverride ?? await getLLMConfig(env)

  // Use Workers AI directly (no external API key needed)
  if (config.provider === 'workersai') {
    return workersAIChatCompletion(env, config.model, opts)
  }

  const { url, apiKey } = await buildEndpoint(env, config.provider)

  if (!apiKey) {
    console.warn(`[llm] No API key for ${config.provider}, falling back to Workers AI`)
    return workersAIChatCompletion(env, '@cf/moonshotai/kimi-k2.5', opts)
  }

  const body: Record<string, unknown> = {
    model: config.model,
    messages: opts.messages,
    max_tokens: opts.maxTokens ?? 2000,
    temperature: opts.temperature ?? 0.7,
  }
  if (opts.responseFormat) {
    body.response_format = opts.responseFormat
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    // If external provider fails, try Workers AI as last resort
    console.warn(`[llm] ${config.provider}/${config.model} returned ${res.status}: ${errBody.slice(0, 200)}. Falling back to Workers AI.`)
    try {
      return await workersAIChatCompletion(env, '@cf/moonshotai/kimi-k2.5', opts)
    } catch (fallbackErr) {
      throw new Error(`LLM ${config.provider}/${config.model} returned ${res.status}: ${errBody.slice(0, 200)}`)
    }
  }

  const data = await res.json() as {
    choices?: { message?: { content?: string } }[]
  }
  return data.choices?.[0]?.message?.content ?? ''
}

// ── Chat completion (SSE streaming) ──────────────────────────────────────────

export async function chatCompletionStream(
  env: Env,
  opts: ChatCompletionOptions,
  configOverride?: LLMConfig,
): Promise<ReadableStream> {
  const config = configOverride ?? await getLLMConfig(env)

  // Use Workers AI directly
  if (config.provider === 'workersai') {
    return workersAIChatCompletionStream(env, config.model, opts)
  }

  const { url, apiKey } = await buildEndpoint(env, config.provider)

  if (!apiKey) {
    console.warn(`[llm] No API key for ${config.provider}, falling back to Workers AI stream`)
    return workersAIChatCompletionStream(env, '@cf/moonshotai/kimi-k2.5', opts)
  }

  const body: Record<string, unknown> = {
    model: config.model,
    messages: opts.messages,
    max_tokens: opts.maxTokens ?? 2000,
    temperature: opts.temperature ?? 0.7,
    stream: true,
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    console.warn(`[llm] Stream ${config.provider}/${config.model} returned ${res.status}. Falling back to Workers AI.`)
    try {
      return await workersAIChatCompletionStream(env, '@cf/moonshotai/kimi-k2.5', opts)
    } catch {
      throw new Error(`LLM stream ${config.provider}/${config.model} returned ${res.status}: ${errBody.slice(0, 200)}`)
    }
  }

  return res.body!
}
