/**
 * GET /api/auth/logout
 * Redirects to Cloudflare Access logout URL.
 */
const CF_ACCESS_TEAM = 'worthy'

export const onRequestGet: PagesFunction = async () => {
  return Response.redirect(
    `https://${CF_ACCESS_TEAM}.cloudflareaccess.com/cdn-cgi/access/logout`,
    302,
  )
}
