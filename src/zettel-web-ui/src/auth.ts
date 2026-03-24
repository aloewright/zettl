/**
 * Cloudflare Access authentication module.
 *
 * Auth is handled by Cloudflare Access before the worker receives traffic.
 * The CF Access JWT is in the Cf-Access-Jwt-Assertion header and the
 * CF_Authorization cookie. The backend validates the JWT and returns
 * the user identity.
 *
 * Endpoints:
 *   GET /api/auth/me     → returns { authenticated, user } from CF Access JWT
 *   GET /api/auth/logout → redirects to CF Access logout URL
 */

export interface AccessUser {
  sub?: string
  email?: string
  name?: string
}

interface MeResponse {
  authenticated: boolean
  user?: AccessUser
}

let _cachedUser: AccessUser | null | undefined = undefined // undefined = not yet fetched

export async function getUser(): Promise<AccessUser | null> {
  if (_cachedUser !== undefined) return _cachedUser

  try {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' })
    if (!res.ok) {
      _cachedUser = null
      return null
    }
    const data = (await res.json()) as MeResponse
    _cachedUser = data.authenticated && data.user ? data.user : null
    return _cachedUser
  } catch {
    _cachedUser = null
    return null
  }
}

export function isAuthenticated(): boolean {
  return _cachedUser !== null && _cachedUser !== undefined
}

/** Clears cached user and redirects to CF Access logout. */
export function logout(): void {
  _cachedUser = undefined
  window.location.href = '/api/auth/logout'
}
