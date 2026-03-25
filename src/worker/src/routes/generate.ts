import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import type { HonoEnv } from '../types'
import { appSettings } from '../db/schema'
import type { createDb } from '../db/client'
import { GATEWAY_BASE, gatewayHeaders, gatewayJSON } from '../services/gateway'
import { listMcpTools, callMcpTool, mcpToolsToOpenAI } from '../services/mcp'

const router = new Hono<HonoEnv>()

const CHAT_MODEL = 'workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast'

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
  let openaiTools: ReturnType<typeof mcpToolsToOpenAI> | undefined
  if (composioEnabled) {
    try {
      const mcpTools = await listMcpTools()
      const userTools = mcpTools.filter(t => !META_TOOLS.has(t.name))
      if (userTools.length > 0) {
        openaiTools = mcpToolsToOpenAI(userTools)
      }
    } catch (err) {
      console.warn('[generate] Failed to fetch MCP tools:', err)
    }
  }

  const headers = gatewayHeaders(c.env)

  // If no tools, just stream directly
  if (!openaiTools?.length) {
    const res = await fetch(`${GATEWAY_BASE}/compat/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: CHAT_MODEL,
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

  // With tools: use non-streaming first call for tool decision
  // (Workers AI outputs tool calls as text in streaming mode)
  const firstResult = await gatewayJSON<{
    choices?: Array<{
      message?: {
        content?: string | null
        tool_calls?: Array<{
          id: string
          type: 'function'
          function: { name: string; arguments: string }
        }>
      }
      finish_reason?: string
    }>
  }>(c.env, '/chat/completions', {
    model: CHAT_MODEL,
    messages: body.messages,
    max_tokens: body.maxTokens ?? 2000,
    temperature: body.temperature ?? 0.7,
    tools: openaiTools,
  })

  const choice = firstResult?.choices?.[0]
  const assistantMsg = choice?.message
  const toolCalls = assistantMsg?.tool_calls

  // No tool calls — stream the text content as SSE
  if (!toolCalls?.length) {
    const content = assistantMsg?.content ?? ''
    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()
    const encoder = new TextEncoder()

    c.executionCtx.waitUntil((async () => {
      try {
        // Emit the content as a single SSE chunk
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
      const statusChunk = { choices: [{ index: 0, delta: { content: '_Running tools..._\n\n' } }] }
      await writer.write(encoder.encode(`data: ${JSON.stringify(statusChunk)}\n\n`))

      // Execute each tool call via MCP
      const toolResults: Array<{ role: 'tool'; tool_call_id: string; content: string }> = []
      for (const tc of toolCalls) {
        try {
          const args = JSON.parse(tc.function.arguments || '{}')
          const result = await callMcpTool(tc.function.name, args)
          toolResults.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: typeof result === 'string' ? result : JSON.stringify(result),
          })
        } catch (err) {
          toolResults.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: `Error: ${err instanceof Error ? err.message : 'Tool execution failed'}`,
          })
        }
      }

      // Second LLM call with tool results — stream the continuation
      const continuationMessages = [
        ...body.messages,
        {
          role: 'assistant' as const,
          content: assistantMsg?.content ?? null,
          tool_calls: toolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
        },
        ...toolResults,
      ]

      const contRes = await fetch(`${GATEWAY_BASE}/compat/chat/completions`, {
        method: 'POST',
        headers: gatewayHeaders(c.env),
        body: JSON.stringify({
          model: CHAT_MODEL,
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
