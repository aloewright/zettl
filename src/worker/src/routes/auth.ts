import { Hono } from 'hono'
import { jwtVerify, createRemoteJWKSet } from 'jose'
import type { HonoEnv } from '../types'
import { loginPage } from '../pages/login'
import { blockPage } from '../pages/block'

const CF_ACCESS_TEAM = 'worthy'
const CF_ACCESS_CERTS_URL = `https://${CF_ACCESS_TEAM}.cloudflareaccess.com/cdn-cgi/access/certs`
const CF_ACCESS_AUD = '7f0d66ab33bd01abc628ce0e605e5715b20c657c64797dd1acc8698306648438'

const router = new Hono<HonoEnv>()

// GET /api/auth/me — return the authenticated user's identity from CF Access JWT
router.get('/me', async (c) => {
  const token =
    c.req.header('Cf-Access-Jwt-Assertion') ??
    getCookie(c.req.raw, 'CF_Authorization')

  if (!token) {
    return c.json({ authenticated: false })
  }

  try {
    const JWKS = createRemoteJWKSet(new URL(CF_ACCESS_CERTS_URL))
    const { payload } = await jwtVerify(token, JWKS, {
      audience: CF_ACCESS_AUD,
    })

    return c.json({
      authenticated: true,
      user: {
        email: payload.email as string | undefined,
        sub: payload.sub as string | undefined,
        name: (payload.email as string)?.split('@')[0] ?? 'User',
      },
    })
  } catch {
    return c.json({ authenticated: false })
  }
})

// GET /api/auth/logout — redirect to CF Access logout URL
router.get('/logout', (c) => {
  return c.redirect(`https://${CF_ACCESS_TEAM}.cloudflareaccess.com/cdn-cgi/access/logout`)
})

// GET /api/auth/login — custom login page matching app theme
router.get('/login', (c) => {
  const callbackUrl = c.req.query('redirect') ?? new URL(c.req.url).origin
  return c.html(loginPage(CF_ACCESS_TEAM, callbackUrl))
})

// GET /api/auth/block — custom access-denied page matching app theme
router.get('/block', (c) => {
  return c.html(blockPage(CF_ACCESS_TEAM))
})

/** Extract a cookie value from a raw Request. */
function getCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get('Cookie')
  if (!header) return undefined
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return match?.[1]
}

export default router
