/**
 * GET /api/auth/logout
 * Redirects to Cloudflare Access logout URL.
 */
interface Env {
  CF_ACCESS_TEAM?: string
}

const DEFAULT_CF_ACCESS_TEAM = 'worthy'

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const cfAccessTeam = env.CF_ACCESS_TEAM ?? DEFAULT_CF_ACCESS_TEAM
  return Response.redirect(
    `https://${cfAccessTeam}.cloudflareaccess.com/cdn-cgi/access/logout`,
    302,
  )
}
