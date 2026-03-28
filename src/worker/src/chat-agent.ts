import { createWorkersAI } from 'workers-ai-provider'
import { AIChatAgent } from '@cloudflare/ai-chat'
import type { OnChatMessageOptions } from '@cloudflare/ai-chat'
import { streamText, convertToModelMessages, pruneMessages, tool } from 'ai'
import { z } from 'zod'
import type { Env } from './types'

/**
 * Chat Agent backed by Cloudflare Durable Objects + SQLite.
 *
 * Uses the @cloudflare/ai-chat SDK for:
 * - Persistent message storage (survives page reload / hibernation)
 * - WebSocket-based streaming (resumable)
 * - Built-in tool calling and approval flows
 */
export class ChatAgent extends AIChatAgent<Env> {
  maxPersistedMessages = 200

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const workersai = createWorkersAI({ binding: this.env.AI })

    const result = streamText({
      abortSignal: options?.abortSignal,
      model: workersai('@cf/meta/llama-3.2-11b-vision-instruct'),
      system:
        'You are a helpful AI assistant for a personal Zettelkasten knowledge management system called Zettl. ' +
        'Help the user think through ideas, answer questions, and suggest connections between concepts. ' +
        'Keep responses concise and useful.',
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: 'before-last-2-messages',
        reasoning: 'before-last-message',
      }),
      tools: {
        getWeather: tool({
          description: 'Get the current weather for a city',
          inputSchema: z.object({
            city: z.string().describe('City name'),
          }),
          execute: async ({ city }) => {
            const conditions = ['sunny', 'cloudy', 'rainy', 'snowy']
            const temp = Math.floor(Math.random() * 30) + 5
            return {
              city,
              temperature: temp,
              condition: conditions[Math.floor(Math.random() * conditions.length)],
              unit: 'celsius',
            }
          },
        }),
        getUserTimezone: tool({
          description:
            "Get the user's timezone from their browser. Use this when you need to know the user's local time.",
          inputSchema: z.object({}),
          // No execute — client-side tool handled via onToolCall
        }),
      },
    })

    return result.toUIMessageStreamResponse()
  }
}
