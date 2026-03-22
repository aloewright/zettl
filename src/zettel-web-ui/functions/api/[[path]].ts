/**
 * Cloudflare Pages Function — proxy /api/* to the backend.
 * Extracts the Kinde session cookie and forwards it as an Authorization header.
 *
 * Required Pages environment variable:
 *   BACKEND_URL — base URL of the backend, e.g. https://api.yourdomain.com
 *                 (no trailing slash)
 */

interface Env {
  BACKEND_URL: string
}

function parseCookies(header: string): Record<string, string> {
  return Object.fromEntries(
    header.split(';').map(c => {
      const [k, ...v] = c.trim().split('=')
      return [k.trim(), decodeURIComponent(v.join('='))]
    })
  )
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context

  if (!env.BACKEND_URL) {
    return new Response('BACKEND_URL environment variable is not set', { status: 502 })
  }

  // Skip proxy for auth routes — those are handled by sibling Pages Functions
  const pathParts = (params['path'] as string[])
  if (pathParts[0] === 'auth') {
    return new Response('Not found', { status: 404 })
  }

  const path = pathParts.join('/')
  const url = new URL(request.url)
  const target = `${env.BACKEND_URL}/api/${path}${url.search}`

  // Forward headers, replacing Cookie with Authorization Bearer
  const headers = new Headers(request.headers)
  const cookieHeader = request.headers.get('Cookie') ?? ''
  const cookies = parseCookies(cookieHeader)

  if (cookies['kinde_session']) {
    headers.set('Authorization', `Bearer ${cookies['kinde_session']}`)
  }
  // Don't forward cookies to the backend
  headers.delete('Cookie')

  const proxyRequest = new Request(target, {
    method: request.method,
    headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    redirect: 'follow',
  })

  return fetch(proxyRequest)
}
