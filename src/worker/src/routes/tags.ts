import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import type { HonoEnv } from '../types'
import { noteTags } from '../db/schema'

const router = new Hono<HonoEnv>()

router.get('/', async (c) => {
  const db = c.get('db')

  const rows = await db
    .select({
      tag: noteTags.tag,
      count: sql<number>`count(*)`,
    })
    .from(noteTags)
    .groupBy(noteTags.tag)
    .orderBy(sql`count(*) DESC`, noteTags.tag)

  return c.json(rows)
})

export default router
