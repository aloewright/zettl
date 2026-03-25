import type { Env } from '../types'
import { gatewayFetch } from './gateway'

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

// ── Text-to-Speech (uses fetch — needs raw audio response) ──────────────────

export async function textToSpeech(
  env: Env,
  opts: TTSOptions,
): Promise<ArrayBuffer> {
  const res = await gatewayFetch(env, '/compat/audio/speech', {
    method: 'POST',
    body: JSON.stringify({
      model: 'dynamic/audio_gen',
      input: opts.text,
      voice: opts.voice ?? 'alloy',
      speed: opts.speed ?? 1.0,
    }),
  })

  return res.arrayBuffer()
}

// ── Speech-to-Text (uses fetch — sends raw audio binary) ────────────────────

export async function speechToText(
  env: Env,
  opts: STTOptions,
): Promise<TranscriptionResult> {
  const res = await gatewayFetch(env, '/compat/audio/transcriptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: opts.audio,
  })

  const data = await res.json() as { text?: string; segments?: TranscriptionResult['segments'] }
  return { text: data.text ?? '', segments: data.segments }
}
