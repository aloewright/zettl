import { useEffect } from 'react'
import { useNavigate } from 'react-router'

/**
 * Fallback callback route — auth is handled by Cloudflare Access.
 * If the browser lands here, simply redirect home.
 */
export function CallbackPage() {
  const navigate = useNavigate()

  useEffect(() => {
    navigate('/', { replace: true })
  }, [navigate])

  return (
    <div className="flex h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-foreground" />
    </div>
  )
}
