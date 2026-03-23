import { Hono } from 'hono'
import type { HonoEnv } from '../types'
import { DEFAULT_WEIGHTS } from '../types'
import { buildOpenAI } from '../services/embeddings'
import { fullTextSearch, semanticSearch, hybridSearch } from '../services/search'

const router = new Hono<HonoEnv>()

router.get('/', async (c) => {
  const rawSql = c.get('sql')
  const q = c.req.query('q') ?? ''
  const mode = c.req.query('mode') ?? 'hybrid'

  if (!q) return c.json([])

  const weights = {
    semanticWeight: parseFloat(c.req.query('semanticWeight') ?? String(DEFAULT_WEIGHTS.semanticWeight)),
    fullTextWeight: parseFloat(c.req.query('fullTextWeight') ?? String(DEFAULT_WEIGHTS.fullTextWeight)),
    minimumSimilarity: parseFloat(c.req.query('minimumSimilarity') ?? String(DEFAULT_WEIGHTS.minimumSimilarity)),
    minimumHybridScore: parseFloat(c.req.query('minimumHybridScore') ?? String(DEFAULT_WEIGHTS.minimumHybridScore)),
  }

  if (mode === 'fulltext') {
    const results = await fullTextSearch(rawSql, q)
    return c.json(results)
  }

  const openai = buildOpenAI(c.env)

  if (mode === 'semantic') {
    const results = await semanticSearch(rawSql, openai, q, weights)
    return c.json(results)
  }

  // hybrid (default)
  const results = await hybridSearch(rawSql, openai, q, weights)
  return c.json(results)
})

export default router
