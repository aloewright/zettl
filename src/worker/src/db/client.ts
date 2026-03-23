import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema'

export type Db = ReturnType<typeof createDb>

export function createDb(databaseUrl: string) {
  const sql = neon(databaseUrl)
  return drizzle(sql, { schema })
}

/** Raw neon SQL client for vector queries that Drizzle can't express. */
export function createSql(databaseUrl: string) {
  return neon(databaseUrl)
}
