/**
 * Kinde authentication module — server-side session via Cloudflare Pages Functions.
 *
 * Auth is handled by Pages Functions at /api/auth/*:
 *   GET /api/auth/login          → redirects to Kinde Hosted UI
 *   GET /api/auth/kinde_callback → exchanges code for tokens, sets httpOnly cookie
 *   GET /api/auth/logout         → clears cookie, redirects to Kinde logout
 *   GET /api/auth/me             → returns { authenticated, user } from session cookie
 *
 * The access token lives in an httpOnly cookie (kinde_session) set by the
 * Pages Function, so it is never accessible from JS. The backend receives it
 * automatically on every /api/* request via the Pages Function proxy, which
 * forwards the Authorization header extracted from the cookie.
 *
 * Environment variables (Cloudflare Pages dashboard):
 *   KINDE_CLIENT_ID              — Kinde Application Client ID
 *   KINDE_CLIENT_SECRET          — Kinde Application Client Secret
 *   KINDE_ISSUER_URL             — https://aftuh.kinde.com
 *   KINDE_POST_LOGIN_REDIRECT_URL  — https://postpilot.cc/dashboard
 *   KINDE_POST_LOGOUT_REDIRECT_URL — https://postpilot.cc
 */

export interface KindeUser {
  sub: string
  email?: string
  given_name?: string
  family_name?: string
  [key: string]: unknown
}

interface MeResponse {
  authenticated: boolean
  user?: KindeUser
}

let _cachedUser: KindeUser | null | undefined = undefined // undefined = not yet fetched

export async function getUser(): Promise<KindeUser | null> {
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

export async function redirectToLogin(): Promise<void> {
  window.location.href = '/api/auth/login'
}

/** Clears cached user and redirects to /api/auth/logout. */
export function logout(): void {
  _cachedUser = undefined
  window.location.href = '/api/auth/logout'
}

/** Returns a no-op token getter — the session cookie is sent automatically. */
export function getToken(): string | null {
  return null
}
