/**
 * GET /api/auth/me
 * Returns the decoded JWT payload (user info) from the session cookie,
 * or 401 if not authenticated.
 */

interface Env {}

function parseCookies(header: string): Record<string, string> {
  return Object.fromEntries(
    header.split(';').map(c => {
      const [k, ...v] = c.trim().split('=')
      return [k, decodeURIComponent(v.join('='))]
    })
  )
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const [, payload] = token.split('.')
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return null
  }
}

export const onRequestGet: PagesFunction<Env> = async ({ request }) => {
  const cookieHeader = request.headers.get('Cookie') ?? ''
  const cookies = parseCookies(cookieHeader)
  const token = cookies['kinde_session']

  if (!token) {
    return new Response(JSON.stringify({ authenticated: false }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const payload = decodeJwtPayload(token)
  if (!payload) {
    return new Response(JSON.stringify({ authenticated: false }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ authenticated: true, user: payload }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
