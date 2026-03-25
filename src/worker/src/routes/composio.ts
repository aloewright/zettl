import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import type { HonoEnv } from '../types'
import { appSettings } from '../db/schema'

const router = new Hono<HonoEnv>()

// ── Composio config ──────────────────────────────────────────────────────────

const MCP_URL = 'https://connect.composio.dev/mcp'
const COMPOSIO_API_KEY = 'ck_E31ySYYQVEKY5hUVYrCP'
const COMPOSIO_API_BASE = 'https://backend.composio.dev/api/v3'

const MCP_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'x-consumer-api-key': COMPOSIO_API_KEY,
}

const API_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'x-api-key': COMPOSIO_API_KEY,
}

// ── Auth config IDs for each service ─────────────────────────────────────────

export const AUTH_CONFIGS: Record<string, { name: string; authConfigId: string; toolkit: string }> = {
  google: { name: 'Google', authConfigId: 'ac_kSOO9FldhVkB', toolkit: 'GOOGLE' },
  linkedin: { name: 'LinkedIn', authConfigId: 'ac_c26p9nmRQ849', toolkit: 'LINKEDIN' },
  resend: { name: 'Resend', authConfigId: 'ac_kSOO9FldhVkB', toolkit: 'RESEND' },
  youtube: { name: 'YouTube', authConfigId: 'ac_8j5-uDr3GbHv', toolkit: 'YOUTUBE' },
  github: { name: 'GitHub', authConfigId: 'ac_0qg3KQqWaAcK', toolkit: 'GITHUB' },
}

// ── Helpers ──────────────────────────────────────────────────────────────────

type Db = ReturnType<typeof import('../db/client').createDb>

async function getSetting(db: Db, key: string): Promise<string | undefined> {
  const row = await db.select().from(appSettings).where(eq(appSettings.key, key)).get()
  return row?.value
}

async function upsertSetting(db: Db, key: string, value: string) {
  await db.insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } })
}

let mcpRequestId = 0
function nextId() { return ++mcpRequestId }

/** Send a JSON-RPC request to the Composio MCP server. */
async function mcpCall(method: string, params?: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: MCP_HEADERS,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: nextId(),
      method,
      params: params ?? {},
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`MCP ${method} failed (${res.status}): ${text}`)
  }

  const data = await res.json<{ result?: unknown; error?: { message?: string } }>()
  if (data.error) {
    throw new Error(`MCP ${method} error: ${data.error.message ?? JSON.stringify(data.error)}`)
  }
  return data.result
}

// ── GET /config — enabled status ─────────────────────────────────────────────

router.get('/config', async (c) => {
  const db = c.get('db')
  const enabled = await getSetting(db, 'composio:enabled')
  return c.json({ enabled: enabled === 'true' })
})

// ── PUT /config — enable/disable ─────────────────────────────────────────────

router.put('/config', async (c) => {
  const db = c.get('db')
  const body = await c.req.json<{ enabled?: boolean }>()

  if (body.enabled !== undefined) {
    await upsertSetting(db, 'composio:enabled', String(body.enabled))
  }

  return c.json({ ok: true })
})

// ── GET /connections — check connection status for all services ──────────────

router.get('/connections', async (c) => {
  const userId = c.get('userId')

  try {
    // Check connections for all configured services in parallel
    const entries = Object.entries(AUTH_CONFIGS)
    const results = await Promise.allSettled(
      entries.map(async ([slug, config]) => {
        const url = new URL(`${COMPOSIO_API_BASE}/connected_accounts`)
        url.searchParams.set('user_ids', userId)
        url.searchParams.set('toolkit_slugs', config.toolkit)
        url.searchParams.set('statuses', 'ACTIVE')

        const res = await fetch(url.toString(), { headers: API_HEADERS })
        if (!res.ok) return { slug, connected: false }

        const data = await res.json<{ items?: Array<{ id: string; status: string }> }>()
        const items = data.items ?? []
        const active = items.length > 0
        return {
          slug,
          connected: active,
          connectedAccountId: active ? items[0]?.id : undefined,
        }
      }),
    )

    const connections: Record<string, { connected: boolean; connectedAccountId?: string }> = {}
    results.forEach((r, i) => {
      const entry = entries[i]
      if (!entry) return
      const slug = entry[0]
      if (r.status === 'fulfilled') {
        connections[slug] = { connected: r.value.connected, connectedAccountId: r.value.connectedAccountId }
      } else {
        connections[slug] = { connected: false }
      }
    })

    return c.json({ connections })
  } catch (err) {
    console.error('[composio] connections check failed:', err)
    return c.json({ connections: {} }, 500)
  }
})

// ── POST /auth-link — generate an OAuth redirect URL for a service ───────────

router.post('/auth-link', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json<{ service: string; callbackUrl: string }>()

  if (!body.service) return c.json({ error: 'service is required' }, 400)

  const config = AUTH_CONFIGS[body.service]
  if (!config) return c.json({ error: `Unknown service: ${body.service}` }, 400)

  try {
    const res = await fetch(`${COMPOSIO_API_BASE}/connected_accounts/link`, {
      method: 'POST',
      headers: API_HEADERS,
      body: JSON.stringify({
        auth_config_id: config.authConfigId,
        user_id: userId,
        callback_url: body.callbackUrl,
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      console.error(`[composio] auth-link failed (${res.status}):`, text)
      return c.json({ error: `Failed to create auth link: ${res.status}` }, 500)
    }

    const data = await res.json<{ redirect_url?: string; url?: string }>()
    const redirectUrl = data.redirect_url || data.url

    if (!redirectUrl) {
      return c.json({ error: 'No redirect URL returned from Composio' }, 500)
    }

    return c.json({ redirectUrl })
  } catch (err) {
    console.error('[composio] auth-link error:', err)
    return c.json({ error: err instanceof Error ? err.message : 'Auth link failed' }, 500)
  }
})

// ── DELETE /connections/:service — disconnect a service ───────────────────────

router.delete('/connections/:service', async (c) => {
  const userId = c.get('userId')
  const service = c.req.param('service')

  const config = AUTH_CONFIGS[service]
  if (!config) return c.json({ error: `Unknown service: ${service}` }, 400)

  try {
    // First find the active connection
    const url = new URL(`${COMPOSIO_API_BASE}/connected_accounts`)
    url.searchParams.set('user_ids', userId)
    url.searchParams.set('toolkit_slugs', config.toolkit)
    url.searchParams.set('statuses', 'ACTIVE')

    const listRes = await fetch(url.toString(), { headers: API_HEADERS })
    if (!listRes.ok) return c.json({ error: 'Failed to find connection' }, 500)

    const listData = await listRes.json<{ items?: Array<{ id: string }> }>()
    if (!listData.items || listData.items.length === 0) {
      return c.json({ error: 'No active connection found' }, 404)
    }

    // Delete each active connection
    for (const account of listData.items) {
      await fetch(`${COMPOSIO_API_BASE}/connected_accounts/${account.id}`, {
        method: 'DELETE',
        headers: API_HEADERS,
      })
    }

    return c.json({ ok: true })
  } catch (err) {
    console.error('[composio] disconnect error:', err)
    return c.json({ error: err instanceof Error ? err.message : 'Disconnect failed' }, 500)
  }
})

// ── GET /tools — list available MCP tools ────────────────────────────────────

router.get('/tools', async (c) => {
  try {
    const result = await mcpCall('tools/list') as { tools?: Array<{ name: string; description?: string; inputSchema?: unknown }> }
    return c.json({ tools: result?.tools ?? [] })
  } catch (err) {
    console.error('[composio] tools/list failed:', err)
    return c.json({ error: err instanceof Error ? err.message : 'Failed to list tools' }, 500)
  }
})

// ── POST /tools/call — execute an MCP tool ───────────────────────────────────

router.post('/tools/call', async (c) => {
  const body = await c.req.json<{ name: string; arguments?: Record<string, unknown> }>()
  if (!body.name) return c.json({ error: 'name is required' }, 400)

  try {
    const result = await mcpCall('tools/call', {
      name: body.name,
      arguments: body.arguments ?? {},
    })
    return c.json({ result })
  } catch (err) {
    console.error(`[composio] tools/call ${body.name} failed:`, err)
    return c.json({ error: err instanceof Error ? err.message : 'Tool call failed' }, 500)
  }
})

// ── POST /connect — get a connect link for an app (legacy) ───────────────────

router.post('/connect', async (c) => {
  const body = await c.req.json<{ app: string; redirect_url?: string }>()
  if (!body.app) return c.json({ error: 'app is required' }, 400)

  try {
    const result = await mcpCall('tools/call', {
      name: 'COMPOSIO_MANAGE_CONNECTIONS',
      arguments: {
        action: 'initiate',
        app: body.app,
        redirect_url: body.redirect_url,
      },
    })
    return c.json({ result })
  } catch (err) {
    console.error('[composio] connect failed:', err)
    return c.json({ error: err instanceof Error ? err.message : 'Connect failed' }, 500)
  }
})

export default router
