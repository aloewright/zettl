import { Hono } from 'hono'
import type { HonoEnv } from '../types'
import { textToSpeech, speechToText } from '../services/audio'

const router = new Hono<HonoEnv>()

// POST /api/tts — convert text to speech, returns audio
router.post('/', async (c) => {
  const body = await c.req.json<{
    text: string
    voice?: string
    speed?: number
  }>().catch(() => null)

  if (!body?.text) return c.json({ error: 'text is required' }, 400)

  try {
    const audio = await textToSpeech(c.env, {
      text: body.text,
      voice: body.voice,
      speed: body.speed,
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
