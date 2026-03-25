import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import type { HonoEnv } from '../types'
import { appSettings } from '../db/schema'
import type { createDb } from '../db/client'
import { getGatewayBaseUrl, gatewayHeaders } from '../services/gateway'
import { listMcpTools, callMcpTool, mcpToolsToOpenAI } from '../services/mcp'

const router = new Hono<HonoEnv>()

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

  // Fetch MCP tools if enabled
  let openaiTools: ReturnType<typeof mcpToolsToOpenAI> | undefined
  if (composioEnabled) {
    try {
      const mcpTools = await listMcpTools()
      if (mcpTools.length > 0) {
        openaiTools = mcpToolsToOpenAI(mcpTools)
      }
    } catch (err) {
      console.warn('[generate] Failed to fetch MCP tools, proceeding without:', err)
    }
  }

  const gatewayUrl = getGatewayBaseUrl()
  const headers = gatewayHeaders(c.env)

  // First request: stream with tools
  const firstBody: Record<string, unknown> = {
    model: 'dynamic/text_gen',
    messages: body.messages,
    max_tokens: body.maxTokens ?? 2000,
    temperature: body.temperature ?? 0.7,
    stream: true,
  }
  if (openaiTools?.length) {
    firstBody.tools = openaiTools
  }

  const firstRes = await fetch(`${gatewayUrl}/compat/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(firstBody),
  })

  if (!firstRes.ok) {
    const errText = await firstRes.text()
    return c.json({ error: `AI Gateway text_gen ${firstRes.status}: ${errText}` }, 502)
  }

  // If no MCP tools, just pass through the stream directly
  if (!openaiTools?.length) {
    return new Response(firstRes.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  }

  // With MCP tools: read the stream, detect tool_calls, execute them, then continue
  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()
  const encoder = new TextEncoder()

  c.executionCtx.waitUntil((async () => {
    try {
      const reader = firstRes.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let toolCalls: Array<{ id: string; function: { name: string; arguments: string } }> = []
      let collectingToolCalls = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') continue

          try {
            const parsed = JSON.parse(data)
            const choice = parsed.choices?.[0]
            const delta = choice?.delta

            // Check for tool calls in the delta
            if (delta?.tool_calls) {
              collectingToolCalls = true
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0
                if (!toolCalls[idx]) {
                  toolCalls[idx] = { id: tc.id ?? '', function: { name: '', arguments: '' } }
                }
                if (tc.id) toolCalls[idx].id = tc.id
                if (tc.function?.name) toolCalls[idx].function.name += tc.function.name
                if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments
              }
              continue
            }

            // If we have content, forward it
            if (delta?.content) {
              await writer.write(encoder.encode(line + '\n\n'))
            }

            // If finish_reason is 'tool_calls', process them
            if (choice?.finish_reason === 'tool_calls' && toolCalls.length > 0) {
              const toolMsg = `data: ${JSON.stringify({ choices: [{ delta: { content: '\n\n_Executing tools..._\n\n' } }] })}\n\n`
              await writer.write(encoder.encode(toolMsg))

              // Execute each tool call via MCP
              const toolResults: Array<{ role: 'tool'; tool_call_id: string; content: string }> = []
              for (const tc of toolCalls) {
                if (!tc) continue
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
                  content: null as unknown as string,
                  tool_calls: toolCalls.map(tc => ({
                    id: tc.id,
                    type: 'function' as const,
                    function: { name: tc.function.name, arguments: tc.function.arguments },
                  })),
                },
                ...toolResults,
              ]

              const contRes = await fetch(`${gatewayUrl}/compat/chat/completions`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                  model: 'dynamic/text_gen',
                  messages: continuationMessages,
                  max_tokens: body.maxTokens ?? 2000,
                  temperature: body.temperature ?? 0.7,
                  stream: true,
                }),
              })

              if (contRes.ok && contRes.body) {
                const contReader = contRes.body.getReader()
                while (true) {
                  const { done: d, value: v } = await contReader.read()
                  if (d) break
                  await writer.write(v)
                }
              }

              toolCalls = []
              collectingToolCalls = false
              continue
            }
          } catch {
            if (!collectingToolCalls) {
              await writer.write(encoder.encode(line + '\n\n'))
            }
          }
        }
      }

      await writer.write(encoder.encode('data: [DONE]\n\n'))
    } catch (err) {
      console.error('[generate] Stream processing error:', err)
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
