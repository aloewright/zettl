/**
 * GET /api/auth/logout
 * Redirects to Cloudflare Access logout URL on the current host.
 */
import { buildLogoutRedirect } from '../../../../shared/logout'

export const onRequestGet = async ({ request }: { request: Request }) => {
  return Response.redirect(buildLogoutRedirect(request.url), 302)
}
