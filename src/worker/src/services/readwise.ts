export interface ReadwiseHighlight {
  id?: number
  text: string
  title?: string
  author?: string
  source_url?: string
  source_type?: string
  category?: 'books' | 'articles' | 'tweets' | 'podcasts'
  note?: string
  highlighted_at?: string
  highlight_url?: string
}

export interface ReadwiseHighlightResult {
  id: number
  text: string
  note: string
  location: number
  location_type: string
  color: string
  created_at: string
  updated: string
  book_id: number
  tags: { id: number; name: string }[]
  readwise_url: string
  book_title?: string
  book_author?: string
}

export interface ReadwiseExportBook {
  user_book_id: number
  title: string
  author: string
  readable_title: string
  source: string
  cover_image_url: string
  unique_url: string
  category: string
  highlights: {
    id: number
    text: string
    note: string
    location: number
    location_type: string
    highlighted_at: string
    created_at: string
    updated: string
    url: string
    readwise_url: string
    tags: { id: number; name: string }[]
  }[]
}

const BASE_URL = 'https://readwise.io/api/v2'

export class ReadwiseClient {
  constructor(private readonly token: string) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Token ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') ?? '5')
      throw new Error(`Readwise rate limited — retry after ${retryAfter}s`)
    }
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Readwise API error ${res.status}: ${text}`)
    }

    if (res.status === 204) return undefined as T
    return res.json() as Promise<T>
  }

  async validateToken(): Promise<boolean> {
    try {
      await this.request<void>('GET', '/auth/')
      return true
    } catch {
      return false
    }
  }

  /** Push highlights to Readwise. Uses highlight_url for idempotent upserts. */
  async createHighlights(highlights: ReadwiseHighlight[]): Promise<void> {
    if (!highlights.length) return
    // Readwise accepts up to 2000 highlights per request; batch just in case
    for (let i = 0; i < highlights.length; i += 500) {
      const batch = highlights.slice(i, i + 500)
      await this.request<unknown>('POST', '/highlights/', { highlights: batch })
    }
  }

  /**
   * Export all highlights (or only those updated after `updatedAfter`).
   * Handles pagination automatically.
   */
  async exportHighlights(updatedAfter?: string): Promise<ReadwiseExportBook[]> {
    const books: ReadwiseExportBook[] = []
    let cursor: string | null = null

    do {
      const params = new URLSearchParams()
      if (updatedAfter) params.set('updatedAfter', updatedAfter)
      if (cursor) params.set('pageCursor', cursor)

      const data = await this.request<{
        results: ReadwiseExportBook[]
        nextPageCursor: string | null
      }>('GET', `/export/?${params}`)

      books.push(...data.results)
      cursor = data.nextPageCursor
    } while (cursor)

    return books
  }
}
