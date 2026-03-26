/**
 * Blog routes — serves published blog posts as HTML pages.
 * Used when the request hostname matches a configured blog domain.
 */
import { Hono } from 'hono'
import { eq, desc, and } from 'drizzle-orm'
import type { HonoEnv } from '../types'
import { blogPosts, appSettings } from '../db/schema'
import { dbMiddleware } from '../middleware/auth'
import {
  blogPostPage,
  blogListPage,
  blogArchivePage,
  blogNotFoundPage,
  blogRssFeed,
} from '../pages/blog'

const router = new Hono<HonoEnv>()

// Blog routes don't need JWT auth — they're public
router.use('*', dbMiddleware)

function parseTags(raw: string | null): string[] {
  if (!raw) return []
  try { return JSON.parse(raw) } catch { return [] }
}

// ── Home page — latest posts ─────────────────────────────────────────────────

router.get('/', async (c) => {
  const db = c.get('db')
  const domain = new URL(c.req.url).hostname

  const posts = await db.select().from(blogPosts)
    .where(and(eq(blogPosts.domain, domain), eq(blogPosts.status, 'published')))
    .orderBy(desc(blogPosts.publishedAt))
    .limit(20)

  const html = blogListPage(domain, posts.map(p => ({
    title: p.title,
    slug: p.slug,
    description: p.description,
    publishedAt: p.publishedAt,
    tags: parseTags(p.tags),
  })))

  return c.html(html)
})

// ── RSS feed ─────────────────────────────────────────────────────────────────

router.get('/rss.xml', async (c) => {
  const db = c.get('db')
  const domain = new URL(c.req.url).hostname

  const posts = await db.select().from(blogPosts)
    .where(and(eq(blogPosts.domain, domain), eq(blogPosts.status, 'published')))
    .orderBy(desc(blogPosts.publishedAt))
    .limit(20)

  const xml = blogRssFeed(domain, posts.map(p => ({
    title: p.title,
    slug: p.slug,
    description: p.description,
    publishedAt: p.publishedAt,
    tags: parseTags(p.tags),
  })))

  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  })
})

// ── Archive page ─────────────────────────────────────────────────────────────

router.get('/archive', async (c) => {
  const db = c.get('db')
  const domain = new URL(c.req.url).hostname

  const posts = await db.select().from(blogPosts)
    .where(and(eq(blogPosts.domain, domain), eq(blogPosts.status, 'published')))
    .orderBy(desc(blogPosts.publishedAt))

  const html = blogArchivePage(domain, posts.map(p => ({
    title: p.title,
    slug: p.slug,
    description: p.description,
    publishedAt: p.publishedAt,
    tags: parseTags(p.tags),
  })))

  return c.html(html)
})

// ── Individual post by slug ──────────────────────────────────────────────────

router.get('/:slug', async (c) => {
  const db = c.get('db')
  const domain = new URL(c.req.url).hostname
  const slug = c.req.param('slug')

  const [post] = await db.select().from(blogPosts)
    .where(and(eq(blogPosts.domain, domain), eq(blogPosts.slug, slug), eq(blogPosts.status, 'published')))

  if (!post) {
    return c.html(blogNotFoundPage(domain), 404)
  }

  const html = blogPostPage(domain, {
    title: post.title,
    body: post.body,
    description: post.description,
    tags: parseTags(post.tags),
    publishedAt: post.publishedAt,
    ogImage: post.ogImage,
    slug: post.slug,
  })

  return c.html(html, 200, {
    'Cache-Control': 'public, max-age=300',
  })
})

export default router

/**
 * Check if the incoming request is for a configured blog domain.
 * Returns true if the hostname is a configured blog domain, false otherwise.
 */
export async function isBlogDomain(hostname: string, db: ReturnType<typeof import('../db/client').createDb>): Promise<boolean> {
  // Check AppSettings for configured blog domains
  const row = await db.select().from(appSettings)
    .where(eq(appSettings.key, 'blog:domains'))
    .get()
  if (!row?.value) return false
  try {
    const domains: string[] = JSON.parse(row.value)
    return domains.some(d => d.toLowerCase() === hostname.toLowerCase())
  } catch {
    return row.value.toLowerCase() === hostname.toLowerCase()
  }
}
