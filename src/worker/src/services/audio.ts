import type { Env } from '../types'
import { getOptionalSecret } from '../types'

// ── Constants ────────────────────────────────────────────────────────────────

const ACCOUNT_ID = '85d376fc54617bcb57185547f08e528b'
const GATEWAY_ID = 'x'
const GATEWAY_BASE = `https://gateway.ai.cloudflare.com/v1/${ACCOUNT_ID}/${GATEWAY_ID}`

// Workers AI models (always available, no API key needed)
const WORKERS_AI_TTS_MODEL = '@cf/deepgram/aura-2-en'
const WORKERS_AI_STT_MODEL = '@cf/openai/whisper'

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
  apiKey?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> ?? {}),
  }
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`
  }
  // Add CF_AIG_TOKEN for gateway auth
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
 * Generate speech audio from text.
 * Fallback chain:
 * 1. ElevenLabs via AI Gateway audio_gen route (stored API key)
 * 2. AI Gateway audio_gen with unified billing
 * 3. Workers AI @cf/deepgram/aura-2-en (always available)
 */
export async function textToSpeech(
  env: Env,
  opts: TTSOptions,
): Promise<ArrayBuffer> {
  const elevenLabsKey = await getOptionalSecret(env.ELEVENLABS_API_KEY)

  // 1. Try ElevenLabs with stored API key via gateway
  if (elevenLabsKey) {
    try {
      const res = await gatewayFetch(env, '/elevenlabs/v1/text-to-speech/' + (opts.voice ?? '21m00Tcm4TlvDq8ikWAM'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': elevenLabsKey,
        },
        body: JSON.stringify({
          text: opts.text,
          model_id: opts.model ?? 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0,
            use_speaker_boost: true,
            speed: opts.speed ?? 1.0,
          },
        }),
      })

      if (res.ok) {
        return res.arrayBuffer()
      }
      console.warn(`[audio] ElevenLabs TTS returned ${res.status}, trying unified billing`)
    } catch (err) {
      console.warn(`[audio] ElevenLabs TTS failed: ${err instanceof Error ? err.message : err}`)
    }
  }

  // 2. Try unified billing via audio_gen gateway route
  try {
    const res = await gatewayFetch(env, '/universal/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: opts.model ?? 'tts-1',
        input: opts.text,
        voice: opts.voice ?? 'alloy',
        speed: opts.speed ?? 1.0,
      }),
    })

    if (res.ok) {
      return res.arrayBuffer()
    }
    console.warn(`[audio] Unified billing TTS returned ${res.status}, falling back to Workers AI`)
  } catch (err) {
    console.warn(`[audio] Unified billing TTS failed: ${err instanceof Error ? err.message : err}`)
  }

  // 3. Last resort: Workers AI TTS
  console.log(`[audio] Falling back to Workers AI ${WORKERS_AI_TTS_MODEL}`)
  const result = await env.ai_binding.run(
    WORKERS_AI_TTS_MODEL as Parameters<typeof env.ai_binding.run>[0],
    { text: opts.text },
  )

  if (result instanceof ReadableStream) {
    const reader = result.getReader()
    const chunks: Uint8Array[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) chunks.push(value)
    }
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0)
    const merged = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.length
    }
    return merged.buffer
  }

  // If it returns an ArrayBuffer directly
  if (result instanceof ArrayBuffer) return result

  throw new Error('Workers AI TTS returned unexpected result type')
}

// ── Speech-to-Text ──────────────────────────────────────────────────────────

/**
 * Transcribe audio to text.
 * Fallback chain:
 * 1. Deepgram/provider via AI Gateway stt_gen route (stored API key)
 * 2. AI Gateway stt_gen with unified billing
 * 3. Workers AI @cf/openai/whisper (always available)
 */
export async function speechToText(
  env: Env,
  opts: STTOptions,
): Promise<TranscriptionResult> {
  // 1. Try via gateway with unified billing (stt_gen route handles provider selection)
  try {
    const res = await gatewayFetch(env, '/universal/audio/transcriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: opts.audio,
    })

    if (res.ok) {
      const data = await res.json() as { text?: string; segments?: TranscriptionResult['segments'] }
      return { text: data.text ?? '', segments: data.segments }
    }
    console.warn(`[audio] Gateway STT returned ${res.status}, falling back to Workers AI`)
  } catch (err) {
    console.warn(`[audio] Gateway STT failed: ${err instanceof Error ? err.message : err}`)
  }

  // 2. Last resort: Workers AI Whisper
  console.log(`[audio] Falling back to Workers AI ${WORKERS_AI_STT_MODEL}`)
  const result = await env.ai_binding.run(
    WORKERS_AI_STT_MODEL as Parameters<typeof env.ai_binding.run>[0],
    { audio: [...new Uint8Array(opts.audio)] },
  ) as { text?: string; segments?: TranscriptionResult['segments'] }

  return {
    text: result.text ?? '',
    segments: result.segments,
  }
}
