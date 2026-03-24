import { eq } from 'drizzle-orm'
import { generateText, streamText } from 'ai'
import { createAiGateway } from 'ai-gateway-provider'
import { createUnified } from 'ai-gateway-provider/providers/unified'
import type { Env } from '../types'
import { getOptionalSecret } from '../types'
import { createDb } from '../db/client'
import { appSettings } from '../db/schema'

// ── Constants ────────────────────────────────────────────────────────────────

const ACCOUNT_ID = '85d376fc54617bcb57185547f08e528b'
const GATEWAY_ID = 'x'
const WORKERS_AI_MODEL = '@cf/moonshotai/kimi-k2.5'

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
      return { provider: 'workersai', model: WORKERS_AI_MODEL }
    }
  } else if (provider === 'google') {
    const key = await getOptionalSecret(env.GOOGLE_API_KEY)
    if (!key) {
      console.log('[llm] No GOOGLE_API_KEY found, falling back to Workers AI')
      return { provider: 'workersai', model: WORKERS_AI_MODEL }
    }
  }

  return { provider, model }
}

// ── Model builders ──────────────────────────────────────────────────────────

/**
 * Build a model that routes through the AI Gateway "text_gen" dynamic route.
 * Uses the stored provider API key for authentication.
 */
async function buildModelWithApiKey(env: Env, config: LLMConfig) {
  const apiKey = config.provider === 'openrouter'
    ? await getOptionalSecret(env.OPENROUTER_API_KEY)
    : config.provider === 'google'
      ? await getOptionalSecret(env.GOOGLE_API_KEY)
      : undefined

  const aigateway = createAiGateway({
    accountId: ACCOUNT_ID,
    gateway: GATEWAY_ID,
    apiKey: apiKey ?? undefined,
  })

  const unified = createUnified({
    apiKey: apiKey ?? undefined,
  })

  return aigateway(unified(config.model))
}

/**
 * Build a model that routes through the AI Gateway using unified billing.
 * No provider API key needed — Cloudflare bills directly via CF_AIG_TOKEN.
 */
async function buildModelUnifiedBilling(env: Env, model: string) {
  const cfToken = env.CF_AIG_TOKEN

  const aigateway = createAiGateway({
    accountId: ACCOUNT_ID,
    gateway: GATEWAY_ID,
    apiKey: cfToken ?? undefined,
  })

  const unified = createUnified({})

  return aigateway(unified(model))
}

// ── Chat completion (non-streaming) ──────────────────────────────────────────

export async function chatCompletion(
  env: Env,
  opts: ChatCompletionOptions,
  configOverride?: LLMConfig,
): Promise<string> {
  const config = configOverride ?? await getLLMConfig(env)
  const messages = opts.messages.map(m => ({ role: m.role, content: m.content }))
  const settings = {
    maxOutputTokens: opts.maxTokens ?? 2000,
    temperature: opts.temperature ?? 0.7,
  }

  // 1. Try with stored API key via text_gen route
  try {
    const model = await buildModelWithApiKey(env, config)
    const { text } = await generateText({ model, messages, ...settings })
    return text
  } catch (err) {
    console.warn(`[llm] ${config.provider}/${config.model} with API key failed: ${err instanceof Error ? err.message : err}`)
  }

  // 2. Fallback: unified billing (no provider API key needed)
  try {
    console.log(`[llm] Falling back to unified billing for ${config.model}`)
    const model = await buildModelUnifiedBilling(env, config.model)
    const { text } = await generateText({ model, messages, ...settings })
    return text
  } catch (err) {
    console.warn(`[llm] Unified billing for ${config.model} also failed: ${err instanceof Error ? err.message : err}`)
  }

  // 3. Last resort: Workers AI (always available, no API key needed)
  console.log(`[llm] Falling back to Workers AI ${WORKERS_AI_MODEL}`)
  const model = await buildModelUnifiedBilling(env, WORKERS_AI_MODEL)
  const { text } = await generateText({ model, messages, ...settings })
  return text
}

// ── Chat completion (SSE streaming) ──────────────────────────────────────────

export async function chatCompletionStream(
  env: Env,
  opts: ChatCompletionOptions,
  configOverride?: LLMConfig,
): Promise<ReadableStream> {
  const config = configOverride ?? await getLLMConfig(env)
  const messages = opts.messages.map(m => ({ role: m.role, content: m.content }))
  const settings = {
    maxOutputTokens: opts.maxTokens ?? 2000,
    temperature: opts.temperature ?? 0.7,
  }

  // 1. Try with stored API key via text_gen route
  try {
    const model = await buildModelWithApiKey(env, config)
    const result = streamText({ model, messages, ...settings })
    return result.textStream as unknown as ReadableStream
  } catch (err) {
    console.warn(`[llm] Stream ${config.provider}/${config.model} with API key failed: ${err instanceof Error ? err.message : err}`)
  }

  // 2. Fallback: unified billing
  try {
    console.log(`[llm] Stream falling back to unified billing for ${config.model}`)
    const model = await buildModelUnifiedBilling(env, config.model)
    const result = streamText({ model, messages, ...settings })
    return result.textStream as unknown as ReadableStream
  } catch (err) {
    console.warn(`[llm] Stream unified billing for ${config.model} also failed: ${err instanceof Error ? err.message : err}`)
  }

  // 3. Last resort: Workers AI
  console.log(`[llm] Stream falling back to Workers AI ${WORKERS_AI_MODEL}`)
  const model = await buildModelUnifiedBilling(env, WORKERS_AI_MODEL)
  const result = streamText({ model, messages, ...settings })
  return result.textStream as unknown as ReadableStream
}
