import { useEffect, useState } from 'react'
import { getUser, redirectToLogin } from '@/auth'

interface AuthGuardProps {
  children: React.ReactNode
}

// Auth is only active when Kinde is configured (Cloudflare Pages deployment).
// Docker Compose deployments skip auth when VITE_AUTH_DISABLED=true.
const authDisabled = import.meta.env.VITE_AUTH_DISABLED === 'true'

/**
 * Wraps the entire app. Calls /api/auth/me to verify the session cookie.
 * If unauthenticated, redirects to /api/auth/login (Kinde Hosted UI).
 *
 * When VITE_AUTH_DISABLED=true (Docker Compose), auth is skipped and
 * children are rendered immediately.
 *
 * The /callback route is rendered before this component (in the router),
 * so it is never blocked by the auth guard.
 */
export function AuthGuard({ children }: AuthGuardProps) {
  const [checked, setChecked] = useState(authDisabled)

  useEffect(() => {
    if (authDisabled) return

    getUser().then(user => {
      if (user) {
        setChecked(true)
      } else {
        redirectToLogin().catch(console.error)
      }
    })
  }, [])

  if (!checked) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-foreground" />
      </div>
    )
  }

  return <>{children}</>
}
