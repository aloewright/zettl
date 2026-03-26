import { Hono } from 'hono'
import { streamText, convertToModelMessages } from 'ai'
import { createWorkersAI } from 'workers-ai-provider'
import {
  injectDocumentStateMessages,
  toolDefinitionsToToolSet,
} from '@blocknote/xl-ai/server'
import type { HonoEnv } from '../types'

const router = new Hono<HonoEnv>()

/**
 * POST /api/ai/chat
 *
 * Server-side endpoint for BlockNote's in-editor AI features.
 * Receives messages from the AIExtension's DefaultChatTransport,
 * injects document state, and streams back tool calls to manipulate the editor.
 */
router.post('/', async (c) => {
  const body = await c.req.json() as {
    messages: Parameters<typeof injectDocumentStateMessages>[0]
    toolDefinitions?: Record<string, { description?: string; inputSchema: unknown; outputSchema: unknown }>
  }

  const workersai = createWorkersAI({ binding: c.env.AI })

  // Inject document state into the message history so the model understands the current editor content
  const messagesWithState = injectDocumentStateMessages(body.messages)

  // Convert BlockNote's tool definitions to AI SDK ToolSet
  const tools = body.toolDefinitions
    ? toolDefinitionsToToolSet(body.toolDefinitions as Parameters<typeof toolDefinitionsToToolSet>[0])
    : {}

  const result = streamText({
    model: workersai('@cf/moonshotai/kimi-k2.5'),
    messages: await convertToModelMessages(messagesWithState),
    tools,
  })

  return result.toUIMessageStreamResponse()
})

export default router
