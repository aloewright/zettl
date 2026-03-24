import { Hono } from 'hono'
import type { HonoEnv } from '../types'
import { textToSpeech, speechToText } from '../services/audio'

const router = new Hono<HonoEnv>()

// POST /api/tts — convert text to speech, returns audio
router.post('/', async (c) => {
  const body = await c.req.json<{
    text: string
    voice?: string
    model?: string
    speed?: number
    language?: string
  }>().catch(() => null)

  if (!body?.text) return c.json({ error: 'text is required' }, 400)

  try {
    const audio = await textToSpeech(c.env, {
      text: body.text,
      voice: body.voice,
      model: body.model,
      speed: body.speed,
      language: body.language,
    })

    return new Response(audio, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[tts] Failed:', err)
    return c.json({ error: 'Text-to-speech generation failed' }, 500)
  }
})

// POST /api/tts/transcribe — speech to text
router.post('/transcribe', async (c) => {
  const contentType = c.req.header('content-type') ?? ''

  let audioBuffer: ArrayBuffer

  if (contentType.includes('application/json')) {
    // JSON body with base64 audio
    const body = await c.req.json<{ audio: string; language?: string }>()
    if (!body.audio) return c.json({ error: 'audio (base64) is required' }, 400)
    const binary = atob(body.audio)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    audioBuffer = bytes.buffer
  } else {
    // Raw audio binary
    audioBuffer = await c.req.arrayBuffer()
  }

  if (!audioBuffer.byteLength) return c.json({ error: 'No audio data provided' }, 400)

  try {
    const result = await speechToText(c.env, { audio: audioBuffer })
    return c.json(result)
  } catch (err) {
    console.error('[stt] Failed:', err)
    return c.json({ error: 'Speech-to-text transcription failed' }, 500)
  }
})

// GET /api/tts/voices — list available voices (placeholder)
router.get('/voices', async (c) => {
  // Return a default set of voices available through the gateway
  return c.json([
    { voice_id: 'alloy', name: 'Alloy', category: 'universal' },
    { voice_id: 'echo', name: 'Echo', category: 'universal' },
    { voice_id: 'fable', name: 'Fable', category: 'universal' },
    { voice_id: 'onyx', name: 'Onyx', category: 'universal' },
    { voice_id: 'nova', name: 'Nova', category: 'universal' },
    { voice_id: 'shimmer', name: 'Shimmer', category: 'universal' },
  ])
})

export default router
