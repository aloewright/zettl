import { Hono } from 'hono'
import type { HonoEnv } from '../types'
import { getOptionalSecret } from '../types'
import { ElevenLabsClient, DEFAULT_VOICE_ID } from '../services/elevenlabs'

const router = new Hono<HonoEnv>()

async function getClient(env: HonoEnv['Bindings']): Promise<ElevenLabsClient | null> {
  const apiKey = await getOptionalSecret(env.ELEVENLABS_API_KEY)
  if (!apiKey) return null
  return new ElevenLabsClient(apiKey)
}

// POST /api/tts — convert text to speech, returns mp3 audio
router.post('/', async (c) => {
  const client = await getClient(c.env)
  if (!client) return c.json({ error: 'ELEVENLABS_API_KEY not configured' }, 400)

  const body = await c.req.json<{
    text: string
    voiceId?: string
    stability?: number
    similarity_boost?: number
    style?: number
    speed?: number
  }>().catch(() => null)

  if (!body?.text) return c.json({ error: 'text is required' }, 400)

  const audio = await client.textToSpeech(
    body.text,
    body.voiceId ?? DEFAULT_VOICE_ID,
    {
      stability: body.stability,
      similarity_boost: body.similarity_boost,
      style: body.style,
      speed: body.speed,
    },
  )

  return new Response(audio, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-store',
    },
  })
})

// GET /api/tts/voices — list available voices
router.get('/voices', async (c) => {
  const client = await getClient(c.env)
  if (!client) return c.json({ error: 'ELEVENLABS_API_KEY not configured' }, 400)

  const voices = await client.listVoices()
  return c.json(voices)
})

export default router
