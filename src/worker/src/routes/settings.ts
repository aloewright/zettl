import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import type { HonoEnv } from '../types'
import { appSettings } from '../db/schema'
import type { LLMProvider } from '../services/llm'

const router = new Hono<HonoEnv>()

// GET /api/settings — current LLM provider + model
router.get('/', async (c) => {
  const db = c.get('db')

  const [providerRow, modelRow] = await Promise.all([
    db.select().from(appSettings).where(eq(appSettings.key, 'llm:provider')).get(),
    db.select().from(appSettings).where(eq(appSettings.key, 'llm:model')).get(),
  ])

  return c.json({
    provider: providerRow?.value ?? 'openrouter',
    model: modelRow?.value ?? 'openai/gpt-4o',
  })
})

// PUT /api/settings/model — update provider + model
router.put('/model', async (c) => {
  const db = c.get('db')
  const body = await c.req.json<{ provider: string; model: string }>()

  if (!body.provider || !body.model) {
    return c.json({ error: 'provider and model required' }, 400)
  }

  const validProviders: LLMProvider[] = ['openrouter', 'google']
  if (!validProviders.includes(body.provider as LLMProvider)) {
    return c.json({ error: `Invalid provider. Must be one of: ${validProviders.join(', ')}` }, 400)
  }

  await db.insert(appSettings)
    .values({ key: 'llm:provider', value: body.provider })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: body.provider } })

  await db.insert(appSettings)
    .values({ key: 'llm:model', value: body.model })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: body.model } })

  return c.json({ provider: body.provider, model: body.model })
})

// GET /api/settings/models — curated list of available models
router.get('/models', async (c) => {
  return c.json({
    openRouter: [
      { id: 'openai/gpt-4o', name: 'GPT-4o', contextLength: 128000 },
      { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', contextLength: 128000 },
      { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', contextLength: 200000 },
      { id: 'anthropic/claude-haiku-4', name: 'Claude Haiku 4', contextLength: 200000 },
      { id: 'google/gemini-2.5-flash-preview', name: 'Gemini 2.5 Flash', contextLength: 1000000 },
      { id: 'meta-llama/llama-4-maverick', name: 'Llama 4 Maverick', contextLength: 1000000 },
    ],
    google: [
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextLength: 1000000 },
      { id: 'gemini-2.5-pro-preview-05-06', name: 'Gemini 2.5 Pro', contextLength: 1000000 },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', contextLength: 1000000 },
    ],
  })
})

export default router
