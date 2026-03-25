import type { Env } from '../types'
import { GATEWAY_BASE, gatewayHeaders, gatewayJSON, gatewayFetch } from './gateway'

// ── Model config ─────────────────────────────────────────────────────────────
// All LLM calls route through the gateway's Workers AI provider endpoint.
// This ensures gateway logging/analytics while using reliable Workers AI models.

const CHAT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
const RESEARCH_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Strip markdown code fences (```json ... ```) that LLMs sometimes wrap around JSON. */
export function stripCodeFences(text: string): string {
  const trimmed = text.trim()
  const match = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/)
  return match?.[1]?.trim() ?? trimmed
}

// ── Types ────────────────────────────────────────────────────────────────────

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

// ── Chat completion (non-streaming) ──────────────────────────────────────────

export async function chatCompletion(
  env: Env,
  opts: ChatCompletionOptions,
): Promise<string> {
  let messages = opts.messages.map(m => ({ role: m.role, content: m.content }))
  if (opts.responseFormat?.type === 'json_object') {
    const hasJsonHint = messages.some(m =>
      m.role === 'system' && m.content.toLowerCase().includes('json'),
    )
    if (!hasJsonHint) {
      messages = [
        { role: 'system' as const, content: 'Always respond with valid JSON.' },
        ...messages,
      ]
    }
  }

  const result = await gatewayJSON<{ choices?: Array<{ message?: { content?: string } }> }>(
    env,
    'workers-ai',
    '/v1/chat/completions',
    {
      model: CHAT_MODEL,
      messages,
      max_tokens: opts.maxTokens ?? 2000,
      temperature: opts.temperature ?? 0.7,
    },
  )

  const text = result?.choices?.[0]?.message?.content ?? ''
  if (!text) {
    throw new Error(`Empty chat response: ${JSON.stringify(result).slice(0, 300)}`)
  }
  return text
}

// ── Chat completion (SSE streaming) ──────────────────────────────────────────

export async function chatCompletionStream(
  env: Env,
  opts: ChatCompletionOptions,
): Promise<ReadableStream> {
  const messages = opts.messages.map(m => ({ role: m.role, content: m.content }))

  const res = await gatewayFetch(env, 'workers-ai', '/v1/chat/completions', {
    model: CHAT_MODEL,
    messages,
    max_tokens: opts.maxTokens ?? 2000,
    temperature: opts.temperature ?? 0.7,
    stream: true,
  })

  return res.body!
}

// ── Research completion ──────────────────────────────────────────────────────
// Uses the same Workers AI model for research (Perplexity compat endpoint
// returns empty bodies currently). Falls back to LLM-based research.

export async function researchCompletion(
  env: Env,
  opts: ChatCompletionOptions,
): Promise<{ text: string; citations: string[] }> {
  const messages = opts.messages.map(m => ({ role: m.role, content: m.content }))

  const result = await gatewayJSON<{
    choices?: Array<{ message?: { content?: string } }>
    citations?: string[]
  }>(env, 'workers-ai', '/v1/chat/completions', {
    model: RESEARCH_MODEL,
    messages,
    max_tokens: opts.maxTokens ?? 1500,
    temperature: opts.temperature ?? 0.3,
  })

  const text = result?.choices?.[0]?.message?.content ?? ''
  const citations = result?.citations ?? []
  return { text, citations }
}
