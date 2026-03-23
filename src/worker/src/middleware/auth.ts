import { createMiddleware } from 'hono/factory'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { HonoEnv } from '../types'
import { createDb, createSql } from '../db/client'

/**
 * Injects db + sql into context. Must run before any route handler.
 */
export const dbMiddleware = createMiddleware<HonoEnv>(async (c, next) => {
  c.set('db', createDb(c.env.DATABASE_URL))
  c.set('sql', createSql(c.env.DATABASE_URL))
  await next()
})

/**
 * Validates the Kinde JWT from the Authorization header.
 * When KINDE_DOMAIN is not set the middleware is skipped (local dev / Docker).
 */
export const authMiddleware = createMiddleware<HonoEnv>(async (c, next) => {
  if (!c.env.KINDE_DOMAIN) {
    c.set('userId', 'anonymous')
    await next()
    return
  }

  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const token = authHeader.slice(7)

  try {
    const JWKS = createRemoteJWKSet(
      new URL(`${c.env.KINDE_DOMAIN}/.well-known/jwks`),
    )
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: c.env.KINDE_DOMAIN,
      ...(c.env.KINDE_AUDIENCE ? { audience: c.env.KINDE_AUDIENCE } : {}),
    })
    c.set('userId', (payload.sub as string) ?? 'unknown')
  } catch {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  await next()
})
