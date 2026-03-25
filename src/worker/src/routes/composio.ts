import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import type { HonoEnv } from '../types'
import { appSettings } from '../db/schema'

const router = new Hono<HonoEnv>()

// ── Composio MCP remote server config ────────────────────────────────────────

const MCP_URL = 'https://connect.composio.dev/mcp'
const MCP_API_KEY = 'ck_E31ySYYQVEKY5hUVYrCP'

const MCP_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'x-consumer-api-key': MCP_API_KEY,
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

// ── POST /connect — get a connect link for an app ────────────────────────────

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
