/**
 * GET /api/auth/kinde_callback
 * Exchanges the Kinde authorization code for tokens and sets a session cookie.
 *
 * Required Pages environment variables:
 *   KINDE_CLIENT_ID           — Kinde application client ID
 *   KINDE_CLIENT_SECRET       — Kinde application client secret
 *   KINDE_ISSUER_URL          — e.g. https://aftuh.kinde.com
 *   KINDE_POST_LOGIN_REDIRECT_URL — where to redirect after successful login
 */

interface Env {
  KINDE_CLIENT_ID: string
  KINDE_CLIENT_SECRET: string
  KINDE_ISSUER_URL: string
  KINDE_POST_LOGIN_REDIRECT_URL: string
}

function parseCookies(header: string): Record<string, string> {
  return Object.fromEntries(
    header.split(';').map(c => {
      const [k, ...v] = c.trim().split('=')
      return [k, decodeURIComponent(v.join('='))]
    })
  )
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const returnedState = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  if (error) {
    return new Response(`Auth error: ${error}`, { status: 400 })
  }

  if (!code) {
    return new Response('Missing authorization code', { status: 400 })
  }

  // Read PKCE verifier + state from cookie
  const cookieHeader = request.headers.get('Cookie') ?? ''
  const cookies = parseCookies(cookieHeader)
  const pkceCookie = cookies['kinde_pkce']

  if (!pkceCookie) {
    return new Response('PKCE cookie missing — restart login', { status: 400 })
  }

  const { verifier, state } = JSON.parse(pkceCookie) as { verifier: string; state: string }

  if (state !== returnedState) {
    return new Response('State mismatch — possible CSRF attack', { status: 400 })
  }

  const redirectUri = `${url.origin}/api/auth/kinde_callback`

  // Exchange code for tokens
  const tokenResponse = await fetch(`${env.KINDE_ISSUER_URL}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: env.KINDE_CLIENT_ID,
      client_secret: env.KINDE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      code,
      code_verifier: verifier,
    }),
  })

  if (!tokenResponse.ok) {
    const body = await tokenResponse.text().catch(() => 'unknown error')
    return new Response(`Token exchange failed: ${body}`, { status: 502 })
  }

  const tokens = await tokenResponse.json() as {
    access_token: string
    refresh_token?: string
    expires_in?: number
  }

  const isSecure = url.protocol === 'https:'
  const maxAge = tokens.expires_in ?? 3600

  // Store access token in httpOnly session cookie
  const sessionCookie = [
    `kinde_session=${encodeURIComponent(tokens.access_token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    ...(isSecure ? ['Secure'] : []),
  ].join('; ')

  // Clear the PKCE cookie
  const clearPkceCookie = [
    'kinde_pkce=',
    'Path=/api/auth',
    'HttpOnly',
    'Max-Age=0',
  ].join('; ')

  return new Response(null, {
    status: 302,
    headers: new Headers([
      ['Location', env.KINDE_POST_LOGIN_REDIRECT_URL],
      ['Set-Cookie', sessionCookie],
      ['Set-Cookie', clearPkceCookie],
    ]),
  })
}
