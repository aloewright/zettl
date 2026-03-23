import OpenAI from 'openai'
import type { Env } from '../types'

export function buildOpenAI(env: Env): OpenAI {
  const baseURL = env.CF_AI_GATEWAY_URL
    ? `${env.CF_AI_GATEWAY_URL.replace(/\/$/, '')}/openai/v1`
    : undefined
  return new OpenAI({ apiKey: env.OPENAI_API_KEY, ...(baseURL ? { baseURL } : {}) })
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
