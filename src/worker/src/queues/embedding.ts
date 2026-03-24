import { eq } from 'drizzle-orm'
import type { EmbedQueueMessage, Env } from '../types'
import { isoNow } from '../types'
import { createDb } from '../db/client'
import { notes } from '../db/schema'
import { generateEmbeddingAI } from '../services/embeddings'

/**
 * Process a single embedding queue message for a note: compute its text embedding, upsert it into the vector store, and update the note's embedding status in the database.
 *
 * On success the note's embed status is set to "Done" and embedding metadata is written to the vector DB. If the note no longer exists the function returns without further action. On failure the note's embed status and retry count are updated and the original error is rethrown to allow the queue to retry.
 *
 * @param message - Queue message whose body contains `noteId` identifying the note to embed
 * @param env - Runtime environment providing `d1_db` (D1) and `vector_db` (vector store) used for updates and upserts
 */
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

    const text = `${note.title}\n\n${note.content}`
    const embedding = await generateEmbeddingAI(env, text)

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
