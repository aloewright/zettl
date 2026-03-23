import OpenAI from 'openai'
import type { Env } from '../types'

export async function buildOpenAI(env: Env): Promise<OpenAI> {
  const apiKey = await env.OPENAI_API_KEY.get()
  let baseURL: string | undefined
  if (env.CF_AI_GATEWAY_URL) {
    const gatewayUrl = await env.CF_AI_GATEWAY_URL.get().catch(() => '')
    if (gatewayUrl) baseURL = `${gatewayUrl.replace(/\/$/, '')}/openai/v1`
  }
  return new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) })
}

export async function generateEmbedding(
  openai: OpenAI,
  text: string,
  model = 'text-embedding-3-large',
): Promise<number[]> {
  const res = await openai.embeddings.create({ input: text, model })
  return res.data[0]?.embedding ?? []
}

/** Format a float[] as a PostgreSQL vector literal: '[0.1,0.2,...]' */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`
}
