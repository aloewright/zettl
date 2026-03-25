import type { Env } from '../types'

// ── Constants ────────────────────────────────────────────────────────────────

const ACCOUNT_ID = '85d376fc54617bcb57185547f08e528b'
const GATEWAY_ID = 'x'
const GATEWAY_BASE = `https://gateway.ai.cloudflare.com/v1/${ACCOUNT_ID}/${GATEWAY_ID}`

// ── Types ────────────────────────────────────────────────────────────────────

export interface TTSOptions {
  text: string
  voice?: string
  model?: string
  speed?: number
  language?: string
}

export interface STTOptions {
  audio: ArrayBuffer
  model?: string
  language?: string
}

export interface TranscriptionResult {
  text: string
  language?: string
  duration?: number
  segments?: { start: number; end: number; text: string }[]
}

// ── Helper: make gateway request ─────────────────────────────────────────────

async function gatewayFetch(
  env: Env,
  path: string,
  init: RequestInit,
): Promise<Response> {
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> ?? {}),
  }
  const cfToken = env.CF_AIG_TOKEN
  if (cfToken) {
    headers['cf-aig-authorization'] = `Bearer ${cfToken}`
  }

  return fetch(`${GATEWAY_BASE}${path}`, {
    ...init,
    headers,
  })
}

// ── Text-to-Speech ──────────────────────────────────────────────────────────

/**
 * Generate speech audio from text via AI Gateway audio_gen route.
 * Uses unified billing — gateway selects the provider.
 */
export async function textToSpeech(
  env: Env,
  opts: TTSOptions,
): Promise<ArrayBuffer> {
  const res = await gatewayFetch(env, '/compat/audio/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: `dynamic/audio_gen`,
      input: opts.text,
      voice: opts.voice ?? 'alloy',
      speed: opts.speed ?? 1.0,
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`AI Gateway [audio_gen] TTS ${res.status}: ${errText}`)
  }

  return res.arrayBuffer()
}

// ── Speech-to-Text ──────────────────────────────────────────────────────────

/**
 * Transcribe audio to text via AI Gateway stt_gen route.
 * Uses unified billing — gateway selects the provider.
 */
export async function speechToText(
  env: Env,
  opts: STTOptions,
): Promise<TranscriptionResult> {
  const res = await gatewayFetch(env, '/compat/audio/transcriptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: opts.audio,
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`AI Gateway [stt_gen] STT ${res.status}: ${errText}`)
  }

  const data = await res.json() as { text?: string; segments?: TranscriptionResult['segments'] }
  return { text: data.text ?? '', segments: data.segments }
}
