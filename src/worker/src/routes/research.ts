import { Hono } from 'hono'
import type { Context } from 'hono'
import { eq, desc, and, sql, inArray } from 'drizzle-orm'
import type { HonoEnv, Env } from '../types'
import { makeId, isoNow } from '../types'
import { stripCodeFences } from '../services/llm'
import { researchAgendas, researchTasks, researchFindings, notes } from '../db/schema'
import { createDb } from '../db/client'
import { chatCompletion } from '../services/llm'
import { getOptionalSecret } from '../types'

const router = new Hono<HonoEnv>()

// ── Research execution ──────────────────────────────────────────────────────

// ── Perplexity via AI Gateway (research_gen route) ──────────────────────────

const ACCOUNT_ID = '85d376fc54617bcb57185547f08e528b'
const GATEWAY_ID = 'x'

async function perplexitySearch(
  env: Env,
  query: string,
  motivation: string,
): Promise<{ text: string; citations: string[] }> {
  const gatewayUrl = `https://gateway.ai.cloudflare.com/v1/${ACCOUNT_ID}/${GATEWAY_ID}/compat/chat/completions`

  const body = {
    model: 'dynamic/research_gen',
    messages: [
      {
        role: 'system',
        content: `You are a research assistant for a Zettelkasten knowledge base.
Search the web and produce 1-3 research findings for the given query.
Each finding should be a concise, factual knowledge note suitable for a personal knowledge base.

Return a JSON object with key "findings" containing an array. Each finding has:
- "title": a clear descriptive title
- "synthesis": a 2-4 paragraph synthesis in markdown
- "sourceUrl": the most relevant source URL you found
- "sourceType": "Web"

Always respond with valid JSON.`,
      },
      {
        role: 'user',
        content: `Research query: ${query}\nMotivation: ${motivation}`,
      },
    ],
    max_tokens: 1500,
    temperature: 0.3,
  }

  const cfToken = await getOptionalSecret(env.CF_AIG_TOKEN)

  const res = await fetch(gatewayUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cfToken ? { 'cf-aig-authorization': `Bearer ${cfToken}` } : {}),
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Perplexity via AI Gateway failed (${res.status}): ${errText}`)
  }

  const data = await res.json<{
    choices?: Array<{ message?: { content?: string } }>
    citations?: string[]
  }>()

  const text = data.choices?.[0]?.message?.content ?? ''
  const citations = data.citations ?? []
  return { text, citations }
}

async function executeTask(
  env: Env,
  db: ReturnType<typeof createDb>,
  task: { id: string; query: string; sourceType: string; motivation: string },
): Promise<void> {
  console.log(`[research] Executing task via Perplexity: ${task.query}`)

  const { text: raw, citations } = await perplexitySearch(env, task.query, task.motivation)

  let findings: Array<{ title: string; synthesis: string; sourceUrl: string; sourceType: string }>
  try {
    const parsed = JSON.parse(stripCodeFences(raw || '{}'))
    findings = parsed.findings ?? []
  } catch {
    // If Perplexity didn't return structured JSON, wrap the entire response as a single finding
    console.warn(`[research] Perplexity returned non-JSON for task ${task.id}, wrapping as single finding`)
    findings = [{
      title: task.query,
      synthesis: raw,
      sourceUrl: citations[0] ?? '',
      sourceType: 'Web',
    }]
  }

  // Enrich sourceUrls from Perplexity citations if the finding has no URL
  for (let i = 0; i < findings.length; i++) {
    const finding = findings[i]
    if (finding && !finding.sourceUrl && citations[i]) {
      finding.sourceUrl = citations[i]!
    }
  }

  for (const f of findings) {
    await db.insert(researchFindings).values({
      id: makeId(),
      taskId: task.id,
      title: f.title,
      synthesis: f.synthesis,
      sourceUrl: f.sourceUrl || '',
      sourceType: f.sourceType || 'Web',
      similarNoteIds: '[]',
      duplicateSimilarity: null,
      status: 'Pending',
      createdAt: isoNow(),
    })
  }

  await db.update(researchTasks).set({ status: 'Done' }).where(eq(researchTasks.id, task.id))
  console.log(`[research] Task "${task.query}" produced ${findings.length} findings via Perplexity`)
}

/** Execute all non-blocked Pending tasks for an approved agenda. */
async function executeAgenda(env: Env, agendaId: string): Promise<void> {
  const db = createDb(env.d1_db)

  const tasks = await db.select().from(researchTasks)
    .where(and(
      eq(researchTasks.agendaId, agendaId),
      eq(researchTasks.status, 'Pending'),
    ))

  console.log(`[research] Executing ${tasks.length} tasks for agenda ${agendaId}`)

  for (const task of tasks) {
    try {
      await executeTask(env, db, task)
    } catch (err) {
      console.error(`[research] Task ${task.id} failed:`, err)
      await db.update(researchTasks).set({ status: 'Failed' }).where(eq(researchTasks.id, task.id))
    }
  }

  await db.update(researchAgendas).set({ status: 'Done' }).where(eq(researchAgendas.id, agendaId))
  console.log(`[research] Agenda ${agendaId} execution complete`)
}

// ── Trigger (AI-driven research agenda generation) ─────────────────────────────

// POST /api/research/trigger — generate a research agenda from KB gaps
router.post('/trigger', async (c) => {
  const db = c.get('db')
  const body = await c.req.json<{ sourceNoteId?: string | null }>().catch(() => ({ sourceNoteId: null }))

  // Find notes to analyze for research gaps
  let contextNotes: { id: string; title: string; content: string }[]

  if (body.sourceNoteId) {
    contextNotes = await db.select({
      id: notes.id,
      title: notes.title,
      content: notes.content,
    }).from(notes).where(eq(notes.id, body.sourceNoteId))
  } else {
    // Pick random permanent notes for context
    contextNotes = await db.select({
      id: notes.id,
      title: notes.title,
      content: notes.content,
    }).from(notes)
      .where(eq(notes.status, 'Permanent'))
      .orderBy(sql`RANDOM()`)
      .limit(5)
  }

  if (!contextNotes.length) {
    return c.json({ error: 'No notes found to analyze for research gaps' }, 422)
  }

  const notesBlock = contextNotes
    .map(n => `### ${n.title}\n${n.content.slice(0, 500)}`)
    .join('\n\n')

  let raw: string
  try {
    raw = await chatCompletion(c.env, {
      messages: [
        {
          role: 'system',
          content: `You are a research assistant for a Zettelkasten knowledge base. Analyze the provided notes and identify knowledge gaps that could be filled through research.

Return a JSON object with key "tasks" containing an array of 3-5 research tasks. Each task should have:
- "query": a specific search query
- "sourceType": either "WebSearch" or "Arxiv"
- "motivation": why this research would be valuable
- "motivationNoteId": the ID of the note that inspired this task (from the provided notes)`,
        },
        {
          role: 'user',
          content: `Analyze these notes and suggest research tasks:\n\n${notesBlock}`,
        },
      ],
      responseFormat: { type: 'json_object' },
      maxTokens: 1000,
    })
  } catch (err) {
    console.error('[research] LLM call failed:', err)
    return c.json({ error: `Research generation failed: ${err instanceof Error ? err.message : String(err)}` }, 500)
  }

  let tasks: Array<{
    query: string
    sourceType: string
    motivation: string
    motivationNoteId?: string
  }>

  try {
    const parsed = JSON.parse(stripCodeFences(raw || '{}'))
    tasks = parsed.tasks ?? []
  } catch {
    tasks = []
  }

  if (!tasks.length) {
    return c.json({ error: 'Could not generate research tasks. Try again.' }, 422)
  }

  const agendaId = makeId()
  await db.insert(researchAgendas).values({
    id: agendaId,
    triggeredFromNoteId: body.sourceNoteId ?? null,
    status: 'Pending',
    createdAt: isoNow(),
  })

  const taskRows = tasks.map(t => ({
    id: makeId(),
    agendaId,
    query: t.query,
    sourceType: t.sourceType || 'WebSearch',
    motivation: t.motivation,
    motivationNoteId: t.motivationNoteId ?? null,
    status: 'Pending' as const,
  }))

  await db.insert(researchTasks).values(taskRows)

  const createdTasks = await db.select().from(researchTasks)
    .where(eq(researchTasks.agendaId, agendaId))

  const [agenda] = await db.select().from(researchAgendas)
    .where(eq(researchAgendas.id, agendaId))

  return c.json({ ...agenda, tasks: createdTasks }, 201)
})

// ── Agendas ────────────────────────────────────────────────────────────────────

router.get('/agendas', async (c) => {
  const db = c.get('db')
  const status = c.req.query('status')

  const rows = await db.select().from(researchAgendas)
    .where(status ? eq(researchAgendas.status, status) : undefined)
    .orderBy(desc(researchAgendas.createdAt))
    .limit(50)

  return c.json(rows)
})

router.get('/agendas/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')

  const [agenda] = await db.select().from(researchAgendas)
    .where(eq(researchAgendas.id, id))
  if (!agenda) return c.json({ error: 'Not found' }, 404)

  const tasks = await db.select().from(researchTasks)
    .where(eq(researchTasks.agendaId, id))

  return c.json({ ...agenda, tasks })
})

router.post('/agendas', async (c) => {
  const db = c.get('db')
  const body = await c.req.json<{
    triggeredFromNoteId?: string
    tasks: Array<{
      query: string
      sourceType: string
      motivation: string
      motivationNoteId?: string
    }>
  }>()

  if (!body.tasks?.length) return c.json({ error: 'tasks are required' }, 400)

  const agendaId = makeId()
  await db.insert(researchAgendas).values({
    id: agendaId,
    triggeredFromNoteId: body.triggeredFromNoteId ?? null,
    status: 'Pending',
    createdAt: isoNow(),
  })

  await db.insert(researchTasks).values(body.tasks.map(t => ({
    id: makeId(),
    agendaId,
    query: t.query,
    sourceType: t.sourceType,
    motivation: t.motivation,
    motivationNoteId: t.motivationNoteId ?? null,
    status: 'Pending',
  })))

  const [created] = await db.select().from(researchAgendas)
    .where(eq(researchAgendas.id, agendaId))
  const tasks = await db.select().from(researchTasks)
    .where(eq(researchTasks.agendaId, agendaId))

  return c.json({ ...created, tasks }, 201)
})

// Shared approve logic — blocks tasks, sets status, triggers execution
async function approveAgenda(c: Context<HonoEnv>, id: string) {
  const db = c.get('db')
  const body = await c.req.json<{ blockedTaskIds?: string[] }>().catch(() => ({ blockedTaskIds: [] }))

  const [existing] = await db.select().from(researchAgendas)
    .where(eq(researchAgendas.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  await db.update(researchAgendas).set({
    status: 'Approved',
    approvedAt: isoNow(),
  }).where(eq(researchAgendas.id, id))

  // Block specified tasks
  if (body.blockedTaskIds?.length) {
    for (const taskId of body.blockedTaskIds) {
      await db.update(researchTasks).set({
        status: 'Blocked',
        blockedAt: isoNow(),
      }).where(eq(researchTasks.id, taskId))
    }
  }

  // Fire-and-forget: execute approved tasks in the background
  c.executionCtx.waitUntil(executeAgenda(c.env, id))

  const [updated] = await db.select().from(researchAgendas)
    .where(eq(researchAgendas.id, id))
  return c.json(updated)
}

// POST /api/research/agendas/:id/approve
router.post('/agendas/:id/approve', async (c) => approveAgenda(c, c.req.param('id')))

// POST /api/research/agenda/:id/approve — singular alias for frontend compatibility
router.post('/agenda/:id/approve', async (c) => approveAgenda(c, c.req.param('id')))

router.delete('/agendas/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')
  const [existing] = await db.select({ id: researchAgendas.id }).from(researchAgendas)
    .where(eq(researchAgendas.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  await db.delete(researchTasks).where(eq(researchTasks.agendaId, id))
  await db.delete(researchAgendas).where(eq(researchAgendas.id, id))
  return c.json({ deleted: true })
})

// ── Tasks ──────────────────────────────────────────────────────────────────────

router.put('/tasks/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')
  const body = await c.req.json<{ status?: string; blockedAt?: string | null }>()

  const [existing] = await db.select().from(researchTasks)
    .where(eq(researchTasks.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  await db.update(researchTasks).set({
    status: body.status ?? existing.status,
    blockedAt: body.blockedAt !== undefined
      ? (body.blockedAt ?? null)
      : existing.blockedAt,
  }).where(eq(researchTasks.id, id))

  const [updated] = await db.select().from(researchTasks)
    .where(eq(researchTasks.id, id))
  return c.json(updated)
})

// ── Findings ───────────────────────────────────────────────────────────────────

// GET /api/research/findings — frontend expects a flat array (not paged)
router.get('/findings', async (c) => {
  const db = c.get('db')
  const status = c.req.query('status')

  const condition = status ? eq(researchFindings.status, status) : undefined

  const rows = await db.select().from(researchFindings)
    .where(condition)
    .orderBy(desc(researchFindings.createdAt))
    .limit(100)

  // Frontend expects a flat array
  return c.json(rows)
})

router.get('/findings/:id', async (c) => {
  const db = c.get('db')
  const [finding] = await db.select().from(researchFindings)
    .where(eq(researchFindings.id, c.req.param('id')))
  if (!finding) return c.json({ error: 'Not found' }, 404)
  return c.json(finding)
})

router.post('/findings', async (c) => {
  const db = c.get('db')
  const body = await c.req.json<{
    taskId: string
    title: string
    synthesis: string
    sourceUrl: string
    sourceType: string
    similarNoteIds?: string[]
    duplicateSimilarity?: number
  }>()

  if (!body.taskId || !body.title || !body.synthesis || !body.sourceUrl || !body.sourceType) {
    return c.json({ error: 'taskId, title, synthesis, sourceUrl, sourceType are required' }, 400)
  }

  const id = makeId()
  await db.insert(researchFindings).values({
    id,
    taskId: body.taskId,
    title: body.title,
    synthesis: body.synthesis,
    sourceUrl: body.sourceUrl,
    sourceType: body.sourceType,
    similarNoteIds: JSON.stringify(body.similarNoteIds ?? []),
    duplicateSimilarity: body.duplicateSimilarity ?? null,
    status: 'Pending',
    createdAt: isoNow(),
  })

  const [created] = await db.select().from(researchFindings)
    .where(eq(researchFindings.id, id))
  return c.json(created, 201)
})

router.post('/findings/:id/accept', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')

  const [finding] = await db.select().from(researchFindings)
    .where(eq(researchFindings.id, id))
  if (!finding) return c.json({ error: 'Not found' }, 404)

  // Create a fleeting note from the finding
  const noteId = makeId()
  const nowIso = new Date().toISOString()

  await db.insert(notes).values({
    id: noteId,
    title: finding.title,
    content: finding.synthesis,
    status: 'Fleeting',
    noteType: 'Regular',
    source: 'Research',
    sourceUrl: finding.sourceUrl,
    sourceType: finding.sourceType,
    createdAt: nowIso,
    updatedAt: nowIso,
    embedStatus: 'Pending',
  })

  await db.update(researchFindings).set({
    status: 'Accepted',
    acceptedFleetingNoteId: noteId,
    reviewedAt: nowIso,
  }).where(eq(researchFindings.id, id))

  // Return the created note (frontend expects a Note)
  const [note] = await db.select().from(notes).where(eq(notes.id, noteId))
  return c.json(note)
})

// POST /api/research/findings/:id/dismiss — alias for reject
router.post('/findings/:id/dismiss', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')

  const [existing] = await db.select({ id: researchFindings.id }).from(researchFindings)
    .where(eq(researchFindings.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  await db.update(researchFindings).set({
    status: 'Rejected',
    reviewedAt: isoNow(),
  }).where(eq(researchFindings.id, id))

  return c.json({ success: true })
})

// POST /api/research/findings/:id/reject — keep original route too
router.post('/findings/:id/reject', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')

  const [existing] = await db.select({ id: researchFindings.id }).from(researchFindings)
    .where(eq(researchFindings.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  await db.update(researchFindings).set({
    status: 'Rejected',
    reviewedAt: isoNow(),
  }).where(eq(researchFindings.id, id))

  const [updated] = await db.select().from(researchFindings)
    .where(eq(researchFindings.id, id))
  return c.json(updated)
})

export default router
