/**
 * Multi-channel publishing service.
 * Publishes content pieces to: Cloudflare blog, LinkedIn, YouTube, Resend email.
 * Uses Composio MCP for external platforms.
 */
import { eq, and } from 'drizzle-orm'
import { blogPosts, publishLog, appSettings } from '../db/schema'
import { callMcpTool } from './mcp'
import { makeId, isoNow } from '../types'
import type { createDb } from '../db/client'
import { escapeHtml, markdownToHtml } from '../pages/blog'

type Db = ReturnType<typeof createDb>

export type PublishChannel = 'blog' | 'linkedin' | 'youtube' | 'resend'

export interface PublishRequest {
  pieceId: string
  title: string
  body: string
  description?: string | null
  tags?: string[]
  /** For blog channel */
  domain?: string
  slug?: string
  /** For resend channel */
  emailSubject?: string
  emailTo?: string
  emailFrom?: string
  /** For youtube channel */
  videoUrl?: string
  videoDescription?: string
}

export interface PublishResult {
  channel: PublishChannel
  success: boolean
  externalUrl?: string
  externalId?: string
  error?: string
}

// ── Slug generation ──────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

// Reserved slugs that cannot be used for blog posts
const RESERVED_SLUGS = new Set([
  'archive',
  'rss.xml',
  'rss',
  'sitemap.xml',
  'sitemap',
  'feed',
  'api',
  'admin',
  'index',
  'robots.txt',
])

// Validate a slug: no path segments, no dots (except if it's literally a reserved one), not reserved
function isValidSlug(slug: string): boolean {
  if (!slug || slug.includes('/') || slug.includes('\\')) return false
  // Allow reserved slugs to fail via the RESERVED_SLUGS check below
  if (slug.includes('.') && !RESERVED_SLUGS.has(slug)) return false
  if (RESERVED_SLUGS.has(slug)) return false
  return true
}

// ── Blog (Cloudflare D1) ─────────────────────────────────────────────────────

async function publishToBlog(db: Db, req: PublishRequest): Promise<PublishResult> {
  if (!req.domain) {
    return { channel: 'blog', success: false, error: 'No blog domain configured' }
  }

  // Normalize slug: always run through slugify
  let slug = req.slug ? slugify(req.slug) : slugify(req.title)
  if (!slug) slug = makeId()

  // Validate the slug
  if (!isValidSlug(slug)) {
    return { channel: 'blog', success: false, error: `Invalid slug: ${slug}` }
  }

  // Check for existing slug collision on this domain
  const existing = await db.select({ id: blogPosts.id })
    .from(blogPosts)
    .where(and(eq(blogPosts.slug, slug), eq(blogPosts.domain, req.domain)))
    .get()

  if (existing) {
    // Generate a unique slug by appending a suffix
    const suffix = makeId().slice(0, 8)
    slug = `${slug}-${suffix}`
  }

  const now = isoNow()
  const id = makeId()

  await db.insert(blogPosts).values({
    id,
    pieceId: req.pieceId,
    slug,
    title: req.title,
    body: req.body,
    description: req.description ?? null,
    tags: JSON.stringify(req.tags ?? []),
    domain: req.domain,
    status: 'published',
    publishedAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [blogPosts.domain, blogPosts.slug],
    set: {
      title: req.title,
      body: req.body,
      description: req.description ?? null,
      tags: JSON.stringify(req.tags ?? []),
      status: 'published',
      updatedAt: now,
    },
  })

  const externalUrl = `https://${req.domain}/${slug}`
  return { channel: 'blog', success: true, externalUrl, externalId: id }
}

// ── LinkedIn (via Composio MCP) ──────────────────────────────────────────────

async function publishToLinkedIn(req: PublishRequest): Promise<PublishResult> {
  try {
    // Use Composio's LinkedIn tool to create a post
    const result = await callMcpTool('LINKEDIN_CREATE_LINKED_IN_POST', {
      text: req.body,
    }) as { successful?: boolean; data?: { id?: string; url?: string } }

    const isSuccessful = result?.successful === true
    const externalUrl = result?.data?.url
    const externalId = result?.data?.id

    if (isSuccessful && (externalUrl || externalId)) {
      return {
        channel: 'linkedin',
        success: true,
        externalUrl,
        externalId,
      }
    }
    return {
      channel: 'linkedin',
      success: false,
      error: 'LinkedIn post creation returned unsuccessful or missing expected data',
    }
  } catch (err) {
    return { channel: 'linkedin', success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ── YouTube (via Composio MCP) ───────────────────────────────────────────────

async function publishToYouTube(req: PublishRequest): Promise<PublishResult> {
  try {
    // Upload or create a video on YouTube
    const result = await callMcpTool('YOUTUBE_UPLOAD_VIDEO', {
      title: req.title,
      description: req.videoDescription ?? req.description ?? req.body.slice(0, 500),
      tags: req.tags ?? [],
      video_url: req.videoUrl,
    }) as { successful?: boolean; data?: { id?: string; url?: string } }

    const isSuccessful = result?.successful === true
    const externalId = result?.data?.id
    const externalUrl = result?.data?.url ?? (externalId ? `https://youtube.com/watch?v=${externalId}` : undefined)

    if (isSuccessful && externalId) {
      return {
        channel: 'youtube',
        success: true,
        externalUrl,
        externalId,
      }
    }
    return {
      channel: 'youtube',
      success: false,
      error: 'YouTube upload returned unsuccessful or missing expected data',
    }
  } catch (err) {
    return { channel: 'youtube', success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ── Resend (via Composio MCP) ────────────────────────────────────────────────

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

async function publishToResend(req: PublishRequest): Promise<PublishResult> {
  try {
    const result = await callMcpTool('RESEND_SEND_EMAIL', {
      from: req.emailFrom ?? 'blog@thinkingfeeling.com',
      to: req.emailTo,
      subject: req.emailSubject ?? req.title,
      html: `<h1>${escapeHtml(req.title)}</h1>${escapeHtml(req.body).replace(/\n/g, '<br/>')}`,
    }) as { successful?: boolean; data?: { id?: string } }

    const isSuccessful = result?.successful === true
    const externalId = result?.data?.id

    if (isSuccessful && externalId) {
      return {
        channel: 'resend',
        success: true,
        externalId,
      }
    }
    return { channel: 'resend', success: false, error: 'Resend email returned unsuccessful or missing expected data' }
  } catch (err) {
    return { channel: 'resend', success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

export async function publishToChannel(
  db: Db,
  channel: PublishChannel,
  req: PublishRequest,
): Promise<PublishResult> {
  let result: PublishResult

  try {
    switch (channel) {
      case 'blog':
        result = await publishToBlog(db, req)
        break
      case 'linkedin':
        result = await publishToLinkedIn(req)
        break
      case 'youtube':
        result = await publishToYouTube(req)
        break
      case 'resend':
        result = await publishToResend(req)
        break
      default:
        result = { channel, success: false, error: `Unknown channel: ${channel}` }
    }
  } catch (err) {
    result = {
      channel,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }

  try {
    // Log the publish attempt
    await db.insert(publishLog).values({
      id: makeId(),
      pieceId: req.pieceId,
      channel,
      status: result.success ? 'success' : 'failed',
      externalUrl: result.externalUrl ?? null,
      externalId: result.externalId ?? null,
      errorMessage: result.error ?? null,
      publishedAt: isoNow(),
    })
  } catch {
    // emit telemetry if needed, but don't mask the publish result
  }

  return result
}

/** Publish to multiple channels at once. */
export async function publishToChannels(
  db: Db,
  channels: PublishChannel[],
  req: PublishRequest,
): Promise<PublishResult[]> {
  return Promise.all(channels.map(ch => publishToChannel(db, ch, req)))
}

/** Get the default blog domain from settings. */
export async function getDefaultBlogDomain(db: Db): Promise<string | null> {
  const row = await db.select().from(appSettings)
    .where(eq(appSettings.key, 'blog:domains'))
    .get()
  if (!row?.value) return null
  try {
    const domains: string[] = JSON.parse(row.value)
    return domains[0] ?? null
  } catch {
    return row.value || null
  }
}

/** Get publish history for a piece. */
export async function getPublishHistory(db: Db, pieceId: string) {
  return db.select().from(publishLog)
    .where(eq(publishLog.pieceId, pieceId))
    .orderBy(publishLog.publishedAt)
}