import { Hono } from 'hono'
import type { HonoEnv } from '../types'

const router = new Hono<HonoEnv>()

// ── GET /health — HTTP proxy to upstream voice service ──────────────────────

router.get('/health', async (c) => {
  const base = c.env.VOICE_SERVICE_URL
  if (!base) {
    return c.json({ error: 'Voice service not configured' }, 503)
  }

  try {
    const res = await fetch(new URL('/health', base).toString())
    return new Response(res.body, {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[voice-proxy] health check failed:', err)
    return c.json({ error: 'Voice service unreachable' }, 502)
  }
})

// ── GET /ws — WebSocket proxy to upstream voice service ─────────────────────

router.get('/ws', async (c) => {
  const base = c.env.VOICE_SERVICE_URL
  if (!base) {
    return c.json({ error: 'Voice service not configured' }, 503)
  }

  const upgrade = c.req.header('Upgrade')
  if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
    return c.text('Expected Upgrade: websocket', 426)
  }

  const upstream = new URL('/ws', base)
  // Switch to wss: if the upstream is https:
  if (upstream.protocol === 'https:') {
    upstream.protocol = 'wss:'
  } else {
    upstream.protocol = 'ws:'
  }

  // Forward the upgrade request to the upstream voice service.
  // The Workers runtime handles bidirectional WebSocket relay automatically.
  const resp = await fetch(upstream.toString(), {
    headers: c.req.raw.headers,
  })

  // The Workers runtime attaches the WebSocket to the response object
  return new Response(null, {
    status: resp.status,
    headers: resp.headers,
    webSocket: (resp as unknown as { webSocket: WebSocket }).webSocket,
  })
})

export default router
