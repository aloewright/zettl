import type { Env } from '../types'
import { getGatewayUrl, gatewayHeaders } from './gateway'

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

// ── AI Gateway helper ────────────────────────────────────────────────────────

async function gatewayChat(
  env: Env,
  route: string,
  messages: Array<{ role: string; content: string }>,
  opts: { maxTokens: number; temperature: number; stream?: boolean },
): Promise<Response> {
  const baseUrl = await getGatewayUrl(env)
  const res = await fetch(`${baseUrl}/compat/chat/completions`, {
    method: 'POST',
    headers: gatewayHeaders(env),
    body: JSON.stringify({
      model: `dynamic/${route}`,
      messages,
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
      ...(opts.stream ? { stream: true } : {}),
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`AI Gateway [${route}] ${res.status}: ${errText}`)
  }

  return res
}

// ── Chat completion (non-streaming) ──────────────────────────────────────────

export async function chatCompletion(
  env: Env,
  opts: ChatCompletionOptions,
): Promise<string> {
  // Add JSON hint if needed
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

  const res = await gatewayChat(env, 'text_gen', messages, {
    maxTokens: opts.maxTokens ?? 2000,
    temperature: opts.temperature ?? 0.7,
  })

  const data = await res.json<{ choices?: Array<{ message?: { content?: string } }> }>()
  const text = data.choices?.[0]?.message?.content ?? ''
  if (!text) throw new Error('Empty response from AI Gateway text_gen')
  return text
}

// ── Chat completion (SSE streaming) ──────────────────────────────────────────

export async function chatCompletionStream(
  env: Env,
  opts: ChatCompletionOptions,
): Promise<ReadableStream> {
  const messages = opts.messages.map(m => ({ role: m.role, content: m.content }))

  const res = await gatewayChat(env, 'text_gen', messages, {
    maxTokens: opts.maxTokens ?? 2000,
    temperature: opts.temperature ?? 0.7,
    stream: true,
  })

  return res.body!
}

// ── Research completion (via research_gen / Perplexity) ──────────────────────

export async function researchCompletion(
  env: Env,
  opts: ChatCompletionOptions,
): Promise<{ text: string; citations: string[] }> {
  const messages = opts.messages.map(m => ({ role: m.role, content: m.content }))

  const res = await gatewayChat(env, 'research_gen', messages, {
    maxTokens: opts.maxTokens ?? 1500,
    temperature: opts.temperature ?? 0.3,
  })

  const data = await res.json<{
    choices?: Array<{ message?: { content?: string } }>
    citations?: string[]
  }>()

  const text = data.choices?.[0]?.message?.content ?? ''
  const citations = data.citations ?? []
  return { text, citations }
}
