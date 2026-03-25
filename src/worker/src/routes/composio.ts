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
  'Accept': 'application/json, text/event-stream',
  'x-consumer-api-key': MCP_API_KEY,
}

// ── Service definitions (toolkit slugs must match Composio exactly) ──────────

export const SERVICES: Record<string, { name: string; toolkit: string }> = {
  gmail:     { name: 'Google (Gmail)',  toolkit: 'gmail' },
  linkedin:  { name: 'LinkedIn',       toolkit: 'linkedin' },
  resend:    { name: 'Resend',         toolkit: 'resend' },
  youtube:   { name: 'YouTube',        toolkit: 'youtube' },
  github:    { name: 'GitHub',         toolkit: 'github' },
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

/** Parse SSE response from Composio MCP server. */
async function parseSseResponse(res: Response): Promise<unknown> {
  const text = await res.text()

  // SSE format: "event: message\ndata: {...}\n\n"
  // Extract JSON from the last "data: " line
  const lines = text.split('\n')
  let jsonData: string | null = null
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      jsonData = line.slice(6)
    }
  }

  if (!jsonData) {
    // Maybe it's plain JSON (fallback)
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(`MCP: No parseable response. Raw: ${text.slice(0, 200)}`)
    }
  }

  return JSON.parse(jsonData)
}

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

  const data = await parseSseResponse(res) as {
    result?: { content?: Array<{ text?: string }>; isError?: boolean }
    error?: { message?: string }
  }

  if (data.error) {
    throw new Error(`MCP ${method} error: ${data.error.message ?? JSON.stringify(data.error)}`)
  }

  // MCP tools/call wraps the result in content[].text as a JSON string
  if (data.result?.content?.[0]?.text) {
    try {
      return JSON.parse(data.result.content[0].text)
    } catch {
      return data.result.content[0].text
    }
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

interface ToolkitResult {
  toolkit: string
  status: string
  has_active_connection?: boolean
  connected_account_id?: string
  redirect_url?: string
  error_message?: string
  current_user_info?: Record<string, unknown>
}

interface ManageConnectionsResponse {
  successful: boolean
  data: {
    message: string
    results: Record<string, ToolkitResult>
  }
}

router.get('/connections', async (c) => {
  try {
    const toolkits = Object.values(SERVICES).map((s) => s.toolkit)

    const result = await mcpCall('tools/call', {
      name: 'COMPOSIO_MANAGE_CONNECTIONS',
      arguments: { toolkits },
    }) as ManageConnectionsResponse

    const connections: Record<string, {
      connected: boolean
      connectedAccountId?: string
      userName?: string
    }> = {}

    if (result?.data?.results) {
      // Map toolkit slugs back to our service keys
      for (const [serviceKey, serviceDef] of Object.entries(SERVICES)) {
        const tkResult = result.data.results[serviceDef.toolkit]
        if (tkResult) {
          const userInfo = tkResult.current_user_info
          let userName: string | undefined
          if (userInfo) {
            userName = (userInfo.name as string) ||
              (userInfo.login as string) ||
              (userInfo.email as string) ||
              (userInfo.given_name as string)
          }
          connections[serviceKey] = {
            connected: tkResult.status === 'active' && !!tkResult.has_active_connection,
            connectedAccountId: tkResult.connected_account_id,
            userName,
          }
        } else {
          connections[serviceKey] = { connected: false }
        }
      }
    }

    return c.json({ connections })
  } catch (err) {
    console.error('[composio] connections check failed:', err)
    return c.json({ connections: {}, error: err instanceof Error ? err.message : 'Unknown error' }, 500)
  }
})

// ── POST /auth-link — initiate OAuth for a service ───────────────────────────

router.post('/auth-link', async (c) => {
  const body = await c.req.json<{ service: string }>()
  if (!body.service) return c.json({ error: 'service is required' }, 400)

  const serviceDef = SERVICES[body.service]
  if (!serviceDef) return c.json({ error: `Unknown service: ${body.service}` }, 400)

  try {
    // Use reinitiate_all to force a new connection flow
    const result = await mcpCall('tools/call', {
      name: 'COMPOSIO_MANAGE_CONNECTIONS',
      arguments: {
        toolkits: [serviceDef.toolkit],
        reinitiate_all: true,
      },
    }) as ManageConnectionsResponse

    const tkResult = result?.data?.results?.[serviceDef.toolkit]

    if (!tkResult) {
      return c.json({ error: 'No result from Composio' }, 500)
    }

    if (tkResult.status === 'failed') {
      return c.json({ error: tkResult.error_message || 'Connection failed' }, 500)
    }

    if (tkResult.redirect_url) {
      return c.json({ redirectUrl: tkResult.redirect_url })
    }

    // Already active — return that info
    if (tkResult.status === 'active') {
      return c.json({ alreadyConnected: true, redirectUrl: null })
    }

    return c.json({ error: 'Unexpected response from Composio' }, 500)
  } catch (err) {
    console.error('[composio] auth-link error:', err)
    return c.json({ error: err instanceof Error ? err.message : 'Auth link failed' }, 500)
  }
})

// ── DELETE /connections/:service — disconnect a service ───────────────────────

router.delete('/connections/:service', async (c) => {
  const service = c.req.param('service')

  const serviceDef = SERVICES[service]
  if (!serviceDef) return c.json({ error: `Unknown service: ${service}` }, 400)

  // Note: Composio MCP doesn't have a direct disconnect tool.
  // We can reinitiate the connection which effectively invalidates the old one,
  // but there's no "delete" action. For now, return not implemented.
  return c.json({ error: 'Disconnect is not supported via MCP. Manage connections at composio.dev.' }, 501)
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
        toolkits: [body.app],
        reinitiate_all: true,
      },
    })
    return c.json({ result })
  } catch (err) {
    console.error('[composio] connect failed:', err)
    return c.json({ error: err instanceof Error ? err.message : 'Connect failed' }, 500)
  }
})

export default router
