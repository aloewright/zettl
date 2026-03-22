/**
 * GET /api/auth/login
 * Initiates Kinde PKCE auth flow — generates verifier/challenge, redirects to Kinde.
 *
 * Required Pages environment variables:
 *   KINDE_CLIENT_ID          — Kinde application client ID
 *   KINDE_ISSUER_URL         — e.g. https://aftuh.kinde.com
 *   KINDE_POST_LOGIN_REDIRECT_URL — where to send the user after login
 */

interface Env {
  KINDE_CLIENT_ID: string
  KINDE_ISSUER_URL: string
  KINDE_POST_LOGIN_REDIRECT_URL: string
}

function base64UrlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const challenge = base64UrlEncode(new Uint8Array(digest))
  return { verifier, challenge }
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { verifier, challenge } = await generatePKCE()
  const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)))

  const origin = new URL(request.url).origin
  const redirectUri = `${origin}/api/auth/kinde_callback`

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.KINDE_CLIENT_ID,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: 'openid profile email',
    state,
  })

  const authUrl = `${env.KINDE_ISSUER_URL}/oauth2/auth?${params}`

  // Store verifier + state in a short-lived cookie (5 min)
  const cookie = [
    `kinde_pkce=${encodeURIComponent(JSON.stringify({ verifier, state }))}`,
    'Path=/api/auth',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=300',
    ...(new URL(request.url).protocol === 'https:' ? ['Secure'] : []),
  ].join('; ')

  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl,
      'Set-Cookie': cookie,
    },
  })
}
