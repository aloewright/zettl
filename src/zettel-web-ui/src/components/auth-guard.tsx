interface AuthGuardProps {
  children: React.ReactNode
}

/**
 * Auth is now handled by Cloudflare Access before the page loads.
 * This component is a passthrough — kept for compatibility with the router.
 */
export function AuthGuard({ children }: AuthGuardProps) {
  return <>{children}</>
}
