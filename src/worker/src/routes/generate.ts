import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import type { HonoEnv } from '../types'
import { appSettings } from '../db/schema'
import type { createDb } from '../db/client'
import { GATEWAY_BASE, gatewayHeaders, AI_GATEWAY_OPTS } from '../services/gateway'
import { listMcpTools, callMcpTool, type McpTool } from '../services/mcp'

const router = new Hono<HonoEnv>()

const CHAT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
const COMPAT_MODEL = `workers-ai/${CHAT_MODEL}`

// Composio meta-tools that should NOT be exposed to the LLM
const META_TOOLS = new Set([
  'COMPOSIO_SEARCH_TOOLS',
  'COMPOSIO_MANAGE_CONNECTIONS',
  'COMPOSIO_WAIT_FOR_CONNECTIONS',
  'COMPOSIO_GET_TOOL_SCHEMAS',
  'COMPOSIO_MULTI_EXECUTE_TOOL',
  'COMPOSIO_REMOTE_BASH_TOOL',
  'COMPOSIO_REMOTE_WORKBENCH',
])

async function isComposioEnabled(db: ReturnType<typeof createDb>): Promise<boolean> {
  const row = await db.select().from(appSettings).where(eq(appSettings.key, 'composio:enabled')).get()
  return row?.value === 'true'
}

/** Convert MCP tools to Workers AI native tool format. */
function mcpToolsToWorkersAI(tools: McpTool[]): Array<{
  name: string
  description: string
  parameters: Record<string, unknown>
}> {
  return tools.map(t => ({
    name: t.name,
    description: t.description ?? '',
    parameters: t.inputSchema ?? { type: 'object', properties: {} },
  }))
}

// ── POST /api/generate/stream — SSE streaming with optional MCP tool calls ──

router.post('/stream', async (c) => {
  const body = await c.req.json<{
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
    maxTokens?: number
    temperature?: number
    useMcp?: boolean
  }>()

  if (!body.messages?.length) {
    return c.json({ error: 'messages array required' }, 400)
  }

  const db = c.get('db')
  const composioEnabled = body.useMcp !== false && await isComposioEnabled(db)

  // Fetch MCP tools if enabled (filter out meta-tools)
  let mcpTools: McpTool[] = []
  if (composioEnabled) {
    try {
      const allTools = await listMcpTools()
      mcpTools = allTools.filter(t => !META_TOOLS.has(t.name))
      console.log(`[generate] Composio enabled, ${mcpTools.length} tools available`)
    } catch (err) {
      console.warn('[generate] Failed to fetch MCP tools:', err)
    }
  }

  const headers = gatewayHeaders(c.env)

  // If no tools, just stream directly via compat endpoint
  if (!mcpTools.length) {
    const res = await fetch(`${GATEWAY_BASE}/compat/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: COMPAT_MODEL,
        messages: body.messages,
        max_tokens: body.maxTokens ?? 2000,
        temperature: body.temperature ?? 0.7,
        stream: true,
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      return c.json({ error: `AI ${res.status}: ${errText}` }, 502)
    }

    return new Response(res.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  }

  // With tools: use env.AI.run() for the first call (native tool calling support)
  // The compat endpoint doesn't reliably pass tools to Workers AI models.
  const workersAiTools = mcpToolsToWorkersAI(mcpTools)
  console.log(`[generate] Sending ${workersAiTools.length} tools to model via env.AI.run()`)

  let firstResult: { response?: string; tool_calls?: Array<{ name: string; arguments: Record<string, unknown> }> }
  try {
    firstResult = await c.env.AI.run(
      CHAT_MODEL,
      {
        messages: body.messages,
        max_tokens: body.maxTokens ?? 2000,
        temperature: body.temperature ?? 0.7,
        tools: workersAiTools as any,
      },
      AI_GATEWAY_OPTS,
    ) as typeof firstResult
  } catch (err) {
    console.error('[generate] AI.run with tools failed:', err)
    return c.json({ error: `AI tool call failed: ${err instanceof Error ? err.message : String(err)}` }, 502)
  }

  console.log(`[generate] AI response: tool_calls=${firstResult.tool_calls?.length ?? 0}, hasText=${!!firstResult.response}, response=${(firstResult.response ?? '').slice(0, 200)}`)

  // Workers AI may return tool calls in the structured field OR as JSON text in response
  let toolCalls = firstResult.tool_calls
  if (!toolCalls?.length && firstResult.response) {
    try {
      const parsed = JSON.parse(firstResult.response)
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].name) {
        toolCalls = parsed as typeof toolCalls
        console.log(`[generate] Parsed ${toolCalls!.length} tool calls from text response`)
      }
    } catch {
      // Not JSON tool calls, just a text response
    }
  }

  // No tool calls — stream the text content as SSE
  if (!toolCalls?.length) {
    const content = firstResult.response ?? ''
    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()
    const encoder = new TextEncoder()

    c.executionCtx.waitUntil((async () => {
      try {
        const chunk = {
          choices: [{
            index: 0,
            delta: { content },
            finish_reason: 'stop',
          }],
        }
        await writer.write(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
        await writer.write(encoder.encode('data: [DONE]\n\n'))
      } finally {
        await writer.close()
      }
    })())

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  }

  // Tool calls detected — execute them and stream continuation
  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()
  const encoder = new TextEncoder()

  c.executionCtx.waitUntil((async () => {
    try {
      // Notify user that tools are being executed
      const toolNames = toolCalls.map(tc => tc.name).join(', ')
      const statusChunk = { choices: [{ index: 0, delta: { content: `_Running tools: ${toolNames}..._\n\n` } }] }
      await writer.write(encoder.encode(`data: ${JSON.stringify(statusChunk)}\n\n`))

      // Execute each tool call via MCP
      const toolResultTexts: string[] = []
      for (const tc of toolCalls) {
        try {
          console.log(`[generate] Calling MCP tool: ${tc.name}`)
          const result = await callMcpTool(tc.name, tc.arguments ?? {})
          const text = typeof result === 'string' ? result : JSON.stringify(result)
          toolResultTexts.push(`Tool ${tc.name} result: ${text}`)
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : 'Tool execution failed'
          console.error(`[generate] Tool ${tc.name} failed:`, err)
          toolResultTexts.push(`Tool ${tc.name} error: ${errMsg}`)
        }
      }

      // Second LLM call with tool results — stream via compat endpoint
      const continuationMessages = [
        ...body.messages,
        {
          role: 'assistant' as const,
          content: `I called the following tools:\n${toolCalls.map(tc => `- ${tc.name}(${JSON.stringify(tc.arguments)})`).join('\n')}`,
        },
        {
          role: 'user' as const,
          content: `Here are the tool results:\n\n${toolResultTexts.join('\n\n')}\n\nPlease summarize the results and answer the original question.`,
        },
      ]

      const contRes = await fetch(`${GATEWAY_BASE}/compat/chat/completions`, {
        method: 'POST',
        headers: gatewayHeaders(c.env),
        body: JSON.stringify({
          model: COMPAT_MODEL,
          messages: continuationMessages,
          max_tokens: body.maxTokens ?? 2000,
          temperature: body.temperature ?? 0.7,
          stream: true,
        }),
      })

      if (contRes.ok && contRes.body) {
        const reader = contRes.body.getReader()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          await writer.write(value)
        }
      }
    } catch (err) {
      console.error('[generate] Tool execution error:', err)
      const errChunk = { choices: [{ index: 0, delta: { content: `\n\nError: ${err instanceof Error ? err.message : 'Unknown error'}` } }] }
      await writer.write(encoder.encode(`data: ${JSON.stringify(errChunk)}\n\n`))
      await writer.write(encoder.encode('data: [DONE]\n\n'))
    } finally {
      await writer.close()
    }
  })())

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
})

export default router
