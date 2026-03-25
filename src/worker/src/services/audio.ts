import type { Env } from '../types'
import { AI_GATEWAY_OPTS } from './gateway'

// ── Types ────────────────────────────────────────────────────────────────────

export interface TTSOptions {
  text: string
  voice?: string
  speed?: number
}

export interface STTOptions {
  audio: ArrayBuffer
  language?: string
}

export interface TranscriptionResult {
  text: string
  language?: string
  duration?: number
  segments?: { start: number; end: number; text: string }[]
}

// ── Text-to-Speech via Workers AI (routed through AI Gateway) ────────────────

export async function textToSpeech(
  env: Env,
  opts: TTSOptions,
): Promise<ArrayBuffer> {
  const result = await env.AI.run(
    '@cf/myshell/melotts-v2' as any,
    { prompt: opts.text },
    AI_GATEWAY_OPTS,
  )
  return result as unknown as ArrayBuffer
}

// ── Speech-to-Text via Workers AI (routed through AI Gateway) ────────────────

export async function speechToText(
  env: Env,
  opts: STTOptions,
): Promise<TranscriptionResult> {
  const result = await env.AI.run(
    '@cf/openai/whisper' as any,
    { audio: [...new Uint8Array(opts.audio)] },
    AI_GATEWAY_OPTS,
  ) as { text?: string }
  return { text: result?.text ?? '' }
}
