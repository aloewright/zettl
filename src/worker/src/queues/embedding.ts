import { neon } from '@neondatabase/serverless'
import type { EmbedQueueMessage, Env } from '../types'
import { buildOpenAI, generateEmbedding, toVectorLiteral } from '../services/embeddings'

export async function handleEmbedMessage(
  message: Message<EmbedQueueMessage>,
  env: Env,
): Promise<void> {
  const sql = neon(env.DATABASE_URL)
  const { noteId } = message.body

  // Mark in-progress
  await sql`
    UPDATE "Notes"
    SET "EmbedStatus" = 'Processing'
    WHERE "Id" = ${noteId}
  `

  try {
    const [note] = await sql`
      SELECT "Title", "Content" FROM "Notes" WHERE "Id" = ${noteId}
    ` as { Title: string; Content: string }[]

    if (!note) {
      // Note was deleted; just ack
      return
    }

    const openai = buildOpenAI(env)
    const text = `${note.Title}\n\n${note.Content}`
    const embedding = await generateEmbedding(openai, text)
    const vec = toVectorLiteral(embedding)

    await sql`
      UPDATE "Notes"
      SET "Embedding"        = ${vec}::real[],
          "EmbedStatus"      = 'Done',
          "EmbedError"       = NULL,
          "EmbedUpdatedAt"   = now(),
          "EmbeddingModel"   = 'text-embedding-3-large',
          "EmbedRetryCount"  = 0
      WHERE "Id" = ${noteId}
    `
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)

    await sql`
      UPDATE "Notes"
      SET "EmbedStatus"      = 'Failed',
          "EmbedError"       = ${errorMsg},
          "EmbedRetryCount"  = "EmbedRetryCount" + 1,
          "EmbedUpdatedAt"   = now()
      WHERE "Id" = ${noteId}
    `

    // Rethrow so the queue retries (up to queue max retries)
    throw err
  }
}

export async function handleEmbedBatch(
  batch: MessageBatch<EmbedQueueMessage>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await handleEmbedMessage(message, env)
      message.ack()
    } catch {
      message.retry()
    }
  }
}
