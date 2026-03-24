import { eq } from 'drizzle-orm'
import type { Env } from '../types'
import { getOptionalSecret } from '../types'
import { createDb } from '../db/client'
import { appSettings } from '../db/schema'

// ── Types ────────────────────────────────────────────────────────────────────

export type LLMProvider = 'openrouter' | 'google'

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

  return {
    provider: (providerRow?.value as LLMProvider) ?? 'openrouter',
    model: modelRow?.value ?? 'openai/gpt-4o',
  }
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

  // openrouter (default)
  const apiKey = await getOptionalSecret(env.OPENROUTER_API_KEY) ?? ''
  const url = gateway
    ? `${gateway}/openrouter/chat/completions`
    : 'https://openrouter.ai/api/v1/chat/completions'
  return { url, apiKey }
}

// ── Chat completion (non-streaming) ──────────────────────────────────────────

export async function chatCompletion(
  env: Env,
  opts: ChatCompletionOptions,
  configOverride?: LLMConfig,
): Promise<string> {
  const config = configOverride ?? await getLLMConfig(env)
  const { url, apiKey } = await buildEndpoint(env, config.provider)

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
    throw new Error(`LLM ${config.provider}/${config.model} returned ${res.status}: ${errBody.slice(0, 200)}`)
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
  const { url, apiKey } = await buildEndpoint(env, config.provider)

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
    throw new Error(`LLM stream ${config.provider}/${config.model} returned ${res.status}: ${errBody.slice(0, 200)}`)
  }

  // Passthrough the SSE stream from the upstream provider
  return res.body!
}
