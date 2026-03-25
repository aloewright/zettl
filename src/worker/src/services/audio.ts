import type { Env } from '../types'

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

// ── Text-to-Speech via Workers AI ────────────────────────────────────────────

export async function textToSpeech(
  env: Env,
  opts: TTSOptions,
): Promise<ArrayBuffer> {
  // Use Workers AI directly for TTS — reliable, pre-authenticated
  const result = await env.AI.run('@cf/myshell/melotts-v2' as any, {
    prompt: opts.text,
  })
  return result as unknown as ArrayBuffer
}

// ── Speech-to-Text via Workers AI ────────────────────────────────────────────

export async function speechToText(
  env: Env,
  opts: STTOptions,
): Promise<TranscriptionResult> {
  const result = await env.AI.run('@cf/openai/whisper' as any, {
    audio: [...new Uint8Array(opts.audio)],
  }) as { text?: string }
  return { text: result?.text ?? '' }
}
