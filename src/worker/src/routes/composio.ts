import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import type { HonoEnv } from '../types'
import { appSettings } from '../db/schema'

const router = new Hono<HonoEnv>()

const COMPOSIO_BASE = 'https://api.composio.dev'
const USER_ID = 'zettel-user'

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getApiKey(db: ReturnType<typeof import('../db/client').createDb>): Promise<string | undefined> {
  const row = await db.select().from(appSettings).where(eq(appSettings.key, 'composio:apiKey')).get()
  return row?.value
}

async function getSetting(db: ReturnType<typeof import('../db/client').createDb>, key: string): Promise<string | undefined> {
  const row = await db.select().from(appSettings).where(eq(appSettings.key, key)).get()
  return row?.value
}

async function upsertSetting(db: ReturnType<typeof import('../db/client').createDb>, key: string, value: string) {
  await db.insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } })
}

function maskKey(key: string): string {
  if (key.length <= 8) return '****'
  return key.slice(0, 4) + '****' + key.slice(-4)
}

async function getMcpConfig(db: ReturnType<typeof import('../db/client').createDb>) {
  const [url, headers] = await Promise.all([
    getSetting(db, 'composio:mcpUrl'),
    getSetting(db, 'composio:mcpHeaders'),
  ])
  return { url, headers: headers ? JSON.parse(headers) : undefined }
}

// ── GET /config — get saved config (masked key + enabled status) ─────────

router.get('/config', async (c) => {
  const db = c.get('db')
  const [apiKey, enabled] = await Promise.all([
    getApiKey(db),
    getSetting(db, 'composio:enabled'),
  ])

  return c.json({
    hasApiKey: !!apiKey,
    apiKeyMasked: apiKey ? maskKey(apiKey) : null,
    enabled: enabled === 'true',
  })
})

// ── PUT /config — save API key, enable/disable ──────────────────────────

router.put('/config', async (c) => {
  const db = c.get('db')
  const body = await c.req.json<{ apiKey?: string; enabled?: boolean }>()

  if (body.apiKey !== undefined) {
    if (!body.apiKey) {
      return c.json({ error: 'apiKey must not be empty' }, 400)
    }
    await upsertSetting(db, 'composio:apiKey', body.apiKey)
  }

  if (body.enabled !== undefined) {
    await upsertSetting(db, 'composio:enabled', String(body.enabled))
  }

  return c.json({ ok: true })
})

// ── POST /session — create a Composio session, return MCP URL + headers ──

router.post('/session', async (c) => {
  const db = c.get('db')
  const apiKey = await getApiKey(db)
  if (!apiKey) return c.json({ error: 'Composio API key not configured' }, 400)

  const res = await fetch(`${COMPOSIO_BASE}/api/v1/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({ user_id: USER_ID }),
  })

  if (!res.ok) {
    const text = await res.text()
    return c.json({ error: `Composio session creation failed: ${text}` }, res.status as any)
  }

  const data = await res.json<{
    session_id: string
    mcp: { url: string; headers: Record<string, string> }
  }>()

  // Persist session info
  await Promise.all([
    upsertSetting(db, 'composio:sessionId', data.session_id),
    upsertSetting(db, 'composio:mcpUrl', data.mcp.url),
    upsertSetting(db, 'composio:mcpHeaders', JSON.stringify(data.mcp.headers)),
  ])

  return c.json({
    sessionId: data.session_id,
    mcp: data.mcp,
  })
})

// ── POST /tools/search — proxy COMPOSIO_SEARCH_TOOLS ────────────────────

router.post('/tools/search', async (c) => {
  const db = c.get('db')
  const mcp = await getMcpConfig(db)
  if (!mcp.url) return c.json({ error: 'No active Composio session. Create one first.' }, 400)

  const body = await c.req.json<{ query: string }>()
  if (!body.query) return c.json({ error: 'query is required' }, 400)

  const res = await fetch(mcp.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...mcp.headers },
    body: JSON.stringify({
      method: 'tools/call',
      params: {
        name: 'COMPOSIO_SEARCH_TOOLS',
        arguments: { query: body.query },
      },
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    return c.json({ error: `Tool search failed: ${text}` }, res.status as any)
  }

  const data = await res.json()
  return c.json(data)
})

// ── POST /tools/schema — proxy COMPOSIO_GET_TOOL_SCHEMAS ────────────────

router.post('/tools/schema', async (c) => {
  const db = c.get('db')
  const mcp = await getMcpConfig(db)
  if (!mcp.url) return c.json({ error: 'No active Composio session. Create one first.' }, 400)

  const body = await c.req.json<{ tools: string[] }>()
  if (!body.tools?.length) return c.json({ error: 'tools array is required' }, 400)

  const res = await fetch(mcp.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...mcp.headers },
    body: JSON.stringify({
      method: 'tools/call',
      params: {
        name: 'COMPOSIO_GET_TOOL_SCHEMAS',
        arguments: { tools: body.tools },
      },
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    return c.json({ error: `Get tool schemas failed: ${text}` }, res.status as any)
  }

  const data = await res.json()
  return c.json(data)
})

// ── POST /tools/execute — proxy COMPOSIO_MULTI_EXECUTE_TOOL ─────────────

router.post('/tools/execute', async (c) => {
  const db = c.get('db')
  const mcp = await getMcpConfig(db)
  if (!mcp.url) return c.json({ error: 'No active Composio session. Create one first.' }, 400)

  const body = await c.req.json<{ tool: string; arguments: Record<string, unknown> }>()
  if (!body.tool) return c.json({ error: 'tool is required' }, 400)

  const res = await fetch(mcp.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...mcp.headers },
    body: JSON.stringify({
      method: 'tools/call',
      params: {
        name: 'COMPOSIO_MULTI_EXECUTE_TOOL',
        arguments: { tool: body.tool, arguments: body.arguments ?? {} },
      },
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    return c.json({ error: `Tool execution failed: ${text}` }, res.status as any)
  }

  const data = await res.json()
  return c.json(data)
})

// ── POST /connect — proxy COMPOSIO_MANAGE_CONNECTIONS (get connect link) ─

router.post('/connect', async (c) => {
  const db = c.get('db')
  const mcp = await getMcpConfig(db)
  if (!mcp.url) return c.json({ error: 'No active Composio session. Create one first.' }, 400)

  const body = await c.req.json<{ app: string; redirect_url?: string }>()
  if (!body.app) return c.json({ error: 'app is required' }, 400)

  const res = await fetch(mcp.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...mcp.headers },
    body: JSON.stringify({
      method: 'tools/call',
      params: {
        name: 'COMPOSIO_MANAGE_CONNECTIONS',
        arguments: {
          action: 'initiate',
          app: body.app,
          redirect_url: body.redirect_url,
        },
      },
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    return c.json({ error: `Connect failed: ${text}` }, res.status as any)
  }

  const data = await res.json()
  return c.json(data)
})

// ── GET /connections — list active connections ───────────────────────────

router.get('/connections', async (c) => {
  const db = c.get('db')
  const apiKey = await getApiKey(db)
  if (!apiKey) return c.json({ error: 'Composio API key not configured' }, 400)

  const res = await fetch(`${COMPOSIO_BASE}/api/v1/connectedAccounts?user_uuid=${USER_ID}`, {
    headers: { 'x-api-key': apiKey },
  })

  if (!res.ok) {
    const text = await res.text()
    return c.json({ error: `Failed to list connections: ${text}` }, res.status as any)
  }

  const data = await res.json()
  return c.json(data)
})

// ── DELETE /connections/:id — disconnect a connection ────────────────────

router.delete('/connections/:id', async (c) => {
  const db = c.get('db')
  const apiKey = await getApiKey(db)
  if (!apiKey) return c.json({ error: 'Composio API key not configured' }, 400)

  const id = c.req.param('id')

  const res = await fetch(`${COMPOSIO_BASE}/api/v1/connectedAccounts/${id}`, {
    method: 'DELETE',
    headers: { 'x-api-key': apiKey },
  })

  if (!res.ok) {
    const text = await res.text()
    return c.json({ error: `Failed to disconnect: ${text}` }, res.status as any)
  }

  return c.json({ ok: true })
})

export default router
