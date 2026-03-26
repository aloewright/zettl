import { get, put, post, del } from './client'

export type PublishChannel = 'blog' | 'linkedin' | 'youtube' | 'resend'

export interface PublishResult {
  channel: PublishChannel
  success: boolean
  externalUrl?: string
  externalId?: string
  error?: string
}

export interface PublishResponse {
  success: boolean
  results: PublishResult[]
}

export interface PublishRequest {
  pieceId: string
  channels: PublishChannel[]
  domain?: string
  slug?: string
  emailTo?: string
  emailFrom?: string
  emailSubject?: string
  videoUrl?: string
  videoDescription?: string
}

export interface PublishLogEntry {
  id: string
  pieceId: string
  channel: string
  status: string
  externalUrl: string | null
  externalId: string | null
  errorMessage: string | null
  publishedAt: string
}

export interface BlogPost {
  id: string
  pieceId: string | null
  slug: string
  title: string
  body: string
  description: string | null
  tags: string[]
  domain: string
  status: string
  publishedAt: string
  updatedAt: string
  ogImage: string | null
}

export interface PagedResponse<T> {
  items: T[]
  totalCount: number
}

// ── Publish ──────────────────────────────────────────────────────────────────

export function publishPiece(data: PublishRequest): Promise<PublishResponse> {
  return post<PublishResponse>('/api/publish', data)
}

// ── Publish history ──────────────────────────────────────────────────────────

export function getPublishHistory(pieceId: string): Promise<{ history: PublishLogEntry[] }> {
  return get<{ history: PublishLogEntry[] }>(`/api/publish/history/${encodeURIComponent(pieceId)}`)
}

// ── Blog posts ───────────────────────────────────────────────────────────────

export function listBlogPosts(params?: { domain?: string; skip?: number; take?: number }): Promise<PagedResponse<BlogPost>> {
  const qs = new URLSearchParams()
  if (params?.domain) qs.set('domain', params.domain)
  qs.set('skip', String(params?.skip ?? 0))
  qs.set('take', String(params?.take ?? 20))
  return get<PagedResponse<BlogPost>>(`/api/publish/blog-posts?${qs}`)
}

export function deleteBlogPost(id: string): Promise<void> {
  return del(`/api/publish/blog-posts/${encodeURIComponent(id)}`)
}

// ── Blog domains ─────────────────────────────────────────────────────────────

export function getBlogDomains(): Promise<{ domains: string[] }> {
  return get<{ domains: string[] }>('/api/publish/blog-domains')
}

export function updateBlogDomains(domains: string[]): Promise<{ domains: string[] }> {
  return put<{ domains: string[] }>('/api/publish/blog-domains', { domains })
}
