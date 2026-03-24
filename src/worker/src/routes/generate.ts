import { Hono } from 'hono'
import type { HonoEnv } from '../types'
import { chatCompletionStream } from '../services/llm'

const router = new Hono<HonoEnv>()

// POST /api/generate/stream — SSE streaming completion
router.post('/stream', async (c) => {
  const body = await c.req.json<{
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
    maxTokens?: number
    temperature?: number
  }>()

  if (!body.messages?.length) {
    return c.json({ error: 'messages array required' }, 400)
  }

  const stream = await chatCompletionStream(c.env, {
    messages: body.messages,
    maxTokens: body.maxTokens,
    temperature: body.temperature,
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
})

export default router
