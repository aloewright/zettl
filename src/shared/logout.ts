/**
 * Build the Cloudflare Access logout URL for the current host.
 * Uses the request origin so the CF_Authorization cookie on that host is cleared,
 * and includes a returnTo parameter to redirect back after logout.
 */
export function buildLogoutRedirect(requestUrl: string): string {
  const origin = new URL(requestUrl).origin
  const returnTo = encodeURIComponent(origin)
  return `${origin}/cdn-cgi/access/logout?returnTo=${returnTo}`
}
