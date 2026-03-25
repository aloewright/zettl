import { createMiddleware } from 'hono/factory'
import { jwtVerify, createRemoteJWKSet } from 'jose'
import type { HonoEnv } from '../types'
import { createDb } from '../db/client'

const DEFAULT_CF_ACCESS_TEAM = 'worthy'
const CF_ACCESS_AUD = '7f0d66ab33bd01abc628ce0e605e5715b20c657c64797dd1acc8698306648438'

/**
 * Injects db into context from D1 binding. Must run before any route handler.
 */
export const dbMiddleware = createMiddleware<HonoEnv>(async (c, next) => {
  c.set('db', createDb(c.env.d1_db))
  await next()
})

/**
 * Validates the Cloudflare Access JWT from Cf-Access-Jwt-Assertion header.
 * Cloudflare Access gates all traffic — by the time a request reaches the worker
 * the user has already authenticated via Google OAuth. This middleware extracts
 * the identity from the signed JWT.
 */
export const authMiddleware = createMiddleware<HonoEnv>(async (c, next) => {
  const token = c.req.header('Cf-Access-Jwt-Assertion')

  // No CF Access header — running locally or Access not configured
  if (!token) {
    c.set('userId', 'anonymous')
    await next()
    return
  }

  try {
    const cfAccessTeam = c.env.CF_ACCESS_TEAM ?? DEFAULT_CF_ACCESS_TEAM
    const certsUrl = `https://${cfAccessTeam}.cloudflareaccess.com/cdn-cgi/access/certs`
    const JWKS = createRemoteJWKSet(new URL(certsUrl))
    const { payload } = await jwtVerify(token, JWKS, {
      audience: CF_ACCESS_AUD,
    })
    c.set('userId', (payload.email as string) ?? (payload.sub as string) ?? 'unknown')
  } catch {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  await next()
})
