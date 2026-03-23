import { eq } from 'drizzle-orm'
import type { EmbedQueueMessage, Env } from '../types'
import { isoNow } from '../types'
import { createDb } from '../db/client'
import { notes } from '../db/schema'
import { buildOpenAI, generateEmbedding } from '../services/embeddings'

export async function handleEmbedMessage(
  message: Message<EmbedQueueMessage>,
  env: Env,
): Promise<void> {
  const db = createDb(env.d1_db)
  const { noteId } = message.body

  // Mark in-progress
  await db.update(notes)
    .set({ embedStatus: 'Processing' })
    .where(eq(notes.id, noteId))

  try {
    const [note] = await db.select({
      title: notes.title,
      content: notes.content,
    }).from(notes).where(eq(notes.id, noteId))

    if (!note) return // Note was deleted; just ack

    const openai = await buildOpenAI(env)
    const text = `${note.title}\n\n${note.content}`
    const embedding = await generateEmbedding(openai, text)

    // Upsert embedding into Vectorize
    await env.vector_db.upsert([{
      id: noteId,
      values: embedding,
      metadata: { noteId },
    }])

    // Update D1 note status
    await db.update(notes).set({
      embedStatus: 'Done',
      embedError: null,
      embedUpdatedAt: isoNow(),
      embeddingModel: 'text-embedding-3-large',
      embedRetryCount: 0,
    }).where(eq(notes.id, noteId))

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)

    const [current] = await db.select({ embedRetryCount: notes.embedRetryCount })
      .from(notes).where(eq(notes.id, noteId)).catch(() => [])

    await db.update(notes).set({
      embedStatus: 'Failed',
      embedError: errorMsg,
      embedRetryCount: (current?.embedRetryCount ?? 0) + 1,
      embedUpdatedAt: isoNow(),
    }).where(eq(notes.id, noteId))

    // Rethrow so the queue retries
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
