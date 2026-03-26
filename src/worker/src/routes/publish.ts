/**
 * Publish routes — multi-channel publishing API.
 * POST /api/publish           — publish a content piece to one or more channels
 * GET  /api/publish/history/:pieceId — get publish history for a piece
 * GET  /api/publish/blog-posts — list blog posts
 * GET  /api/publish/blog-domains — get configured blog domains
 * PUT  /api/publish/blog-domains — update blog domains
 * DELETE /api/publish/blog-posts/:id — unpublish a blog post
 */
import { Hono } from 'hono'
import { eq, desc, and, sql } from 'drizzle-orm'
import type { HonoEnv } from '../types'
import { makeId, isoNow } from '../types'
import { contentPieces, blogPosts, publishLog, appSettings } from '../db/schema'
import {
  publishToChannels,
  getDefaultBlogDomain,
  getPublishHistory,
  type PublishChannel,
} from '../services/publish'

const router = new Hono<HonoEnv>()

const VALID_CHANNELS: PublishChannel[] = ['blog', 'linkedin', 'youtube', 'resend']

// Helper to get all configured blog domains
async function getBlogDomains(db: ReturnType<typeof import('../db/client').createDb>): Promise<Set<string>> {
  const row = await db.select().from(appSettings)
    .where(eq(appSettings.key, 'blog:domains'))
    .get()
  if (!row?.value) return new Set()
  try {
    const domains: string[] = JSON.parse(row.value)
    return new Set(domains.map(d => d.toLowerCase().trim()))
  } catch {
    return new Set([row.value.toLowerCase().trim()])
  }
}

// Normalize a domain: lowercase, trim, strip protocol/port
function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/:\d+$/, '')
}

// ── POST /api/publish — publish a piece to channels ──────────────────────────

router.post('/', async (c) => {
  const db = c.get('db')
  const body = await c.req.json<{
    pieceId: string
    channels: PublishChannel[]
    // Blog-specific
    domain?: string
    slug?: string
    // Resend-specific
    emailTo?: string
    emailFrom?: string
    emailSubject?: string
    // YouTube-specific
    videoUrl?: string
    videoDescription?: string
  }>()

  if (!body.pieceId) return c.json({ error: 'pieceId is required' }, 400)
  if (!Array.isArray(body.channels)) return c.json({ error: 'channels must be an array' }, 400)
  if (!body.channels.length) return c.json({ error: 'At least one channel is required' }, 400)

  // Check for duplicates
  if (body.channels.length !== new Set(body.channels).size) {
    return c.json({ error: 'channels must not contain duplicates' }, 400)
  }

  const invalid = body.channels.filter(ch => !VALID_CHANNELS.includes(ch))
  if (invalid.length) return c.json({ error: `Invalid channels: ${invalid.join(', ')}` }, 400)

  // Load the content piece
  const [piece] = await db.select().from(contentPieces)
    .where(eq(contentPieces.id, body.pieceId))
  if (!piece) return c.json({ error: 'Content piece not found' }, 404)

  // Resolve and validate blog domain
  let domain = body.domain
  if (body.channels.includes('blog')) {
    if (!domain) {
      domain = await getDefaultBlogDomain(db) ?? undefined
    }
    if (!domain) {
      return c.json({ error: 'No blog domain configured. Set one in Settings.' }, 422)
    }

    // Normalize and validate the domain
    const normalizedDomain = normalizeDomain(domain)
    const allowedDomains = await getBlogDomains(db)
    if (!allowedDomains.has(normalizedDomain)) {
      return c.json({ error: 'Domain is not a configured blog domain' }, 422)
    }
    domain = normalizedDomain
  }

  // Channel-specific required field validation
  if (body.channels.includes('resend') && !body.emailTo) {
    return c.json({ error: 'emailTo is required when publishing to resend' }, 422)
  }
  if (body.channels.includes('youtube') && !body.videoUrl) {
    return c.json({ error: 'videoUrl is required when publishing to youtube' }, 422)
  }
  // Parse tags
  let tags: string[] = []
  try { tags = JSON.parse(piece.generatedTags) } catch { /* empty */ }

  const results = await publishToChannels(db, body.channels, {
    pieceId: body.pieceId,
    title: (piece as unknown as Record<string, unknown>).title as string ?? piece.description ?? 'Untitled',
    body: piece.body,
    description: piece.description,
    tags,
    domain,
    slug: body.slug,
    emailTo: body.emailTo,
    emailFrom: body.emailFrom,
    emailSubject: body.emailSubject,
    videoUrl: body.videoUrl,
    videoDescription: body.videoDescription,
  })

  const allSuccess = results.every(r => r.success)
  return c.json({
    success: allSuccess,
    results,
  }, allSuccess ? 200 : 207)
})

// ── GET /api/publish/history/:pieceId — publish history ─────────────────────

router.get('/history/:pieceId', async (c) => {
  const db = c.get('db')
  const pieceId = c.req.param('pieceId')

  const history = await getPublishHistory(db, pieceId)
  return c.json({ history })
})

// ── GET /api/publish/blog-posts — list blog posts ────────────────────────────

router.get('/blog-posts', async (c) => {
  const db = c.get('db')
  const { domain, skip, take } = c.req.query()
  const offset = Math.max(0, parseInt(skip ?? '0'))
  const size = Math.min(100, Math.max(1, parseInt(take ?? '20')))

  const condition = domain ? eq(blogPosts.domain, domain) : undefined

  const [rows, countRows] = await Promise.all([
    db.select().from(blogPosts)
      .where(condition)
      .orderBy(desc(blogPosts.publishedAt))
      .limit(size).offset(offset),
    db.select({ count: sql<number>`count(*)` })
      .from(blogPosts).where(condition),
  ])

  return c.json({
    items: rows.map(r => ({
      ...r,
      tags: (() => { try { return JSON.parse(r.tags) } catch { return [] } })(),
    })),
    totalCount: countRows[0]?.count ?? 0,
  })
})

// ── DELETE /api/publish/blog-posts/:id — unpublish ───────────────────────────

router.delete('/blog-posts/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')

  const [existing] = await db.select({ id: blogPosts.id })
    .from(blogPosts).where(eq(blogPosts.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  await db.update(blogPosts).set({ status: 'archived', updatedAt: isoNow() })
    .where(eq(blogPosts.id, id))

  return c.json({ success: true })
})

// ── GET /api/publish/blog-domains — configured domains ───────────────────────

router.get('/blog-domains', async (c) => {
  const db = c.get('db')
  const row = await db.select().from(appSettings)
    .where(eq(appSettings.key, 'blog:domains'))
    .get()

  let domains: string[] = []
  if (row?.value) {
    try { domains = JSON.parse(row.value) } catch { domains = [row.value] }
  }

  return c.json({ domains })
})

// ── PUT /api/publish/blog-domains — update domains ───────────────────────────

router.put('/blog-domains', async (c) => {
  const db = c.get('db')
  const body = await c.req.json<{ domains: string[] }>()

  if (!Array.isArray(body.domains)) {
    return c.json({ error: 'domains must be an array of strings' }, 400)
  }

  // Validate each entry is a string and a bare hostname (no scheme or path)
  const hostnamePattern = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i
  for (const d of body.domains) {
    if (typeof d !== 'string') {
      return c.json({ error: 'domains must be an array of hostnames' }, 400)
    }
    const trimmed = d.trim()
    // Check for scheme or path
    if (trimmed.includes('://') || trimmed.includes('/')) {
      return c.json({ error: 'domains must be an array of hostnames' }, 400)
    }
    // Validate hostname format
    if (!hostnamePattern.test(trimmed)) {
      return c.json({ error: 'domains must be an array of hostnames' }, 400)
    }
  }

  // Normalize domains — lowercase, trim whitespace
  const normalized = body.domains
    .map(d => d.trim().toLowerCase())
    .filter(Boolean)

  await db.insert(appSettings)
    .values({ key: 'blog:domains', value: JSON.stringify(normalized) })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify(normalized) } })

  return c.json({ domains: normalized })
})

export default router