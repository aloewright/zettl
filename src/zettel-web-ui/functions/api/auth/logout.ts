/**
 * GET /api/auth/logout
 * Clears the session cookie and redirects to Kinde logout.
 *
 * Required Pages environment variables:
 *   KINDE_CLIENT_ID              — Kinde application client ID
 *   KINDE_ISSUER_URL             — e.g. https://aftuh.kinde.com
 *   KINDE_POST_LOGOUT_REDIRECT_URL — where to send the user after logout
 */

interface Env {
  KINDE_CLIENT_ID: string
  KINDE_ISSUER_URL: string
  KINDE_POST_LOGOUT_REDIRECT_URL: string
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const params = new URLSearchParams({
    client_id: env.KINDE_CLIENT_ID,
    redirect: env.KINDE_POST_LOGOUT_REDIRECT_URL,
  })

  const isSecure = new URL(request.url).protocol === 'https:'

  const clearSessionCookie = [
    'kinde_session=',
    'Path=/',
    'HttpOnly',
    'Max-Age=0',
    ...(isSecure ? ['Secure'] : []),
  ].join('; ')

  return new Response(null, {
    status: 302,
    headers: {
      Location: `${env.KINDE_ISSUER_URL}/logout?${params}`,
      'Set-Cookie': clearSessionCookie,
    },
  })
}
