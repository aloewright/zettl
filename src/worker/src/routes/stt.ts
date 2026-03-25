import { Hono } from 'hono'
import type { HonoEnv } from '../types'
import { speechToText } from '../services/audio'

const router = new Hono<HonoEnv>()

// POST /api/stt — speech to text
router.post('/', async (c) => {
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

export default router
