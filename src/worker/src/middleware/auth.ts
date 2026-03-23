import { createMiddleware } from 'hono/factory'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { HonoEnv } from '../types'
import { createDb, createSql } from '../db/client'

/**
 * Injects db + sql into context. Must run before any route handler.
 */
export const dbMiddleware = createMiddleware<HonoEnv>(async (c, next) => {
  const dbUrl = await c.env.DATABASE_URL.get()
  c.set('db', createDb(dbUrl))
  c.set('sql', createSql(dbUrl))
  await next()
})

/**
 * Validates the Kinde JWT from the Authorization header.
 * When KINDE_DOMAIN is not set the middleware is skipped (local dev / Docker).
 */
export const authMiddleware = createMiddleware<HonoEnv>(async (c, next) => {
  // If KINDE_DOMAIN binding is absent, skip auth (local dev without Secrets Store)
  if (!c.env.KINDE_DOMAIN) {
    c.set('userId', 'anonymous')
    await next()
    return
  }

  let kindeDomain: string
  try {
    kindeDomain = await c.env.KINDE_DOMAIN.get()
  } catch {
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
    const kindeAudience = c.env.KINDE_AUDIENCE
      ? await c.env.KINDE_AUDIENCE.get().catch(() => undefined)
      : undefined

    const JWKS = createRemoteJWKSet(
      new URL(`${kindeDomain}/.well-known/jwks`),
    )
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: kindeDomain,
      ...(kindeAudience ? { audience: kindeAudience } : {}),
    })
    c.set('userId', (payload.sub as string) ?? 'unknown')
  } catch {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  await next()
})
