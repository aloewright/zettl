/** Blog HTML templates — renders published blog posts for Cloudflare-hosted domains. */

interface BlogPostData {
  title: string
  body: string  // markdown (rendered to HTML by caller)
  description?: string | null
  tags: string[]
  publishedAt: string
  ogImage?: string | null
  slug: string
}

interface BlogListItem {
  title: string
  slug: string
  description?: string | null
  publishedAt: string
  tags: string[]
}

const BLOG_CSS = `
  :root {
    --bg: #fafaf9;
    --fg: #1c1917;
    --muted: #78716c;
    --border: #e7e5e4;
    --accent: #0c4a6e;
    --card: #ffffff;
    --code-bg: #f5f5f4;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0c0a09;
      --fg: #fafaf9;
      --muted: #a8a29e;
      --border: #292524;
      --accent: #7dd3fc;
      --card: #1c1917;
      --code-bg: #1c1917;
    }
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html { font-size: 18px; }
  body {
    font-family: 'Lora', Georgia, 'Times New Roman', serif;
    background: var(--bg);
    color: var(--fg);
    line-height: 1.7;
    -webkit-font-smoothing: antialiased;
  }
  .container { max-width: 680px; margin: 0 auto; padding: 2rem 1.5rem; }
  header { padding: 2rem 0 1.5rem; border-bottom: 1px solid var(--border); margin-bottom: 2rem; }
  header h1 a { color: var(--fg); text-decoration: none; font-size: 1.5rem; font-weight: 700; }
  header nav { margin-top: 0.5rem; }
  header nav a { color: var(--muted); text-decoration: none; font-size: 0.8rem; margin-right: 1rem; }
  header nav a:hover { color: var(--fg); }
  article { margin-bottom: 3rem; }
  article h1 { font-size: 2rem; font-weight: 700; line-height: 1.3; margin-bottom: 0.5rem; }
  article .meta { color: var(--muted); font-size: 0.78rem; margin-bottom: 1.5rem; font-family: system-ui, sans-serif; }
  article .meta .tag { display: inline-block; background: var(--code-bg); padding: 0.15em 0.5em; border-radius: 4px; margin-left: 0.25rem; }
  article .content { font-size: 1rem; }
  article .content h2 { font-size: 1.4rem; margin: 2rem 0 0.75rem; font-weight: 600; }
  article .content h3 { font-size: 1.15rem; margin: 1.5rem 0 0.5rem; font-weight: 600; }
  article .content p { margin-bottom: 1.25rem; }
  article .content ul, article .content ol { margin-bottom: 1.25rem; padding-left: 1.5rem; }
  article .content li { margin-bottom: 0.35rem; }
  article .content blockquote {
    border-left: 3px solid var(--accent);
    padding-left: 1rem;
    margin: 1.25rem 0;
    color: var(--muted);
    font-style: italic;
  }
  article .content code {
    background: var(--code-bg);
    padding: 0.15em 0.35em;
    border-radius: 3px;
    font-size: 0.88em;
    font-family: 'SF Mono', 'Fira Code', monospace;
  }
  article .content pre {
    background: var(--code-bg);
    padding: 1rem;
    border-radius: 6px;
    overflow-x: auto;
    margin-bottom: 1.25rem;
  }
  article .content pre code { background: none; padding: 0; }
  article .content a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
  article .content img { max-width: 100%; border-radius: 6px; margin: 1rem 0; }
  article .content hr { border: none; border-top: 1px solid var(--border); margin: 2rem 0; }
  .post-list { list-style: none; }
  .post-list li { padding: 1.25rem 0; border-bottom: 1px solid var(--border); }
  .post-list li:last-child { border-bottom: none; }
  .post-list a { color: var(--fg); text-decoration: none; }
  .post-list a:hover { color: var(--accent); }
  .post-list h2 { font-size: 1.25rem; font-weight: 600; margin-bottom: 0.25rem; }
  .post-list .excerpt { color: var(--muted); font-size: 0.85rem; line-height: 1.5; }
  .post-list .date { color: var(--muted); font-size: 0.75rem; font-family: system-ui, sans-serif; }
  footer { border-top: 1px solid var(--border); padding: 1.5rem 0; color: var(--muted); font-size: 0.75rem; font-family: system-ui, sans-serif; text-align: center; }
  .empty { text-align: center; padding: 4rem 0; color: var(--muted); }
  .back { display: inline-block; margin-bottom: 1.5rem; color: var(--muted); text-decoration: none; font-size: 0.8rem; font-family: system-ui, sans-serif; }
  .back:hover { color: var(--fg); }
`

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/** Strips unsafe URL schemes (javascript:, data:, vbscript:) from href/src values. */
function sanitizeUrl(url: string): string {
  const trimmed = url.trim()
  if (/^(?:javascript|data|vbscript):/i.test(trimmed)) return '#'
  return trimmed
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  } catch {
    return iso
  }
}

function isValidUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('/')
}

/** Minimal markdown → HTML (handles common patterns, no external deps). */
export function markdownToHtml(md: string): string {
  let html = md
  // Code blocks (fenced)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) =>
    `<pre><code class="language-${lang}">${escapeHtml(code.trimEnd())}</code></pre>`)
  // Inline code
  html = html.replace(/`([^`]+)`/g, (_m, code) => `<code>${escapeHtml(code)}</code>`)
  // Headings
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')
  // Bold & italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
  // Links & images
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, url) =>
    isValidUrl(url) ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" />` : '')
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, url) =>
    isValidUrl(url) ? `<a href="${escapeHtml(url)}">${text}</a>` : text)
  // Blockquotes
  html = html.replace(/^> (.+)$/gm, '<blockquote><p>$1</p></blockquote>')
  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr />')
  // Unordered lists
  html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>')
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>')
  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
  // Paragraphs — wrap lines not already wrapped in block elements
  const lines = html.split('\n')
  const result: string[] = []
  let inParagraph = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (inParagraph) { result.push('</p>'); inParagraph = false }
      continue
    }
    const isBlock = /^(?:<(h[1-6]|pre|ul|ol|li|blockquote|hr|img)|\x02CB)/.test(trimmed)
    if (isBlock) {
      if (inParagraph) { result.push('</p>'); inParagraph = false }
      result.push(trimmed)
    } else {
      if (!inParagraph) { result.push('<p>'); inParagraph = true }
      result.push(trimmed)
    }
  }
  if (inParagraph) result.push('</p>')
  html = result.join('\n')

  // Step 4: Restore extracted code blocks.
  const placeholderRe = new RegExp(`${PLACEHOLDER_PREFIX}(\\d+)${PLACEHOLDER_SUFFIX}`, 'g')
  html = html.replace(placeholderRe, (_, i) => codeBlocks[parseInt(i, 10)] ?? '')

  return html
}

function layout(domain: string, title: string, content: string, meta?: { description?: string; ogImage?: string; url?: string }) {
  const desc = meta?.description ? escapeHtml(meta.description) : `Blog at ${domain}`
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} — ${escapeHtml(domain)}</title>
  <meta name="description" content="${desc}" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${desc}" />
  <meta property="og:type" content="article" />
  ${meta?.ogImage ? `<meta property="og:image" content="${escapeHtml(meta.ogImage)}" />` : ''}
  ${meta?.url ? `<link rel="canonical" href="${escapeHtml(meta.url)}" />` : ''}
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;0,700;1,400&display=swap" rel="stylesheet" />
  <style>${BLOG_CSS}</style>
</head>
<body>
  <div class="container">
    <header>
      <h1><a href="/">${escapeHtml(domain)}</a></h1>
      <nav>
        <a href="/">Home</a>
        <a href="/archive">Archive</a>
      </nav>
    </header>
    ${content}
    <footer>&copy; ${new Date().getFullYear()} ${escapeHtml(domain)}</footer>
  </div>
</body>
</html>`
}

export function blogPostPage(domain: string, post: BlogPostData): string {
  const tagsHtml = post.tags.length
    ? post.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join(' ')
    : ''
  const bodyHtml = markdownToHtml(post.body)
  const content = `
    <a href="/" class="back">&larr; Back</a>
    <article>
      <h1>${escapeHtml(post.title)}</h1>
      <div class="meta">
        ${formatDate(post.publishedAt)}${tagsHtml ? ` &middot; ${tagsHtml}` : ''}
      </div>
      <div class="content">${bodyHtml}</div>
    </article>`
  return layout(domain, post.title, content, {
    description: post.description ?? undefined,
    ogImage: post.ogImage ?? undefined,
    url: `https://${domain}/${post.slug}`,
  })
}

export function blogListPage(domain: string, posts: BlogListItem[]): string {
  if (!posts.length) {
    return layout(domain, 'Home', '<div class="empty"><p>No posts yet.</p></div>')
  }
  const listItems = posts.map(p => `
    <li>
      <a href="/${escapeHtml(p.slug)}">
        <h2>${escapeHtml(p.title)}</h2>
        ${p.description ? `<p class="excerpt">${escapeHtml(p.description)}</p>` : ''}
        <span class="date">${formatDate(p.publishedAt)}</span>
      </a>
    </li>`).join('')
  return layout(domain, 'Home', `<ul class="post-list">${listItems}</ul>`)
}

export function blogArchivePage(domain: string, posts: BlogListItem[]): string {
  if (!posts.length) {
    return layout(domain, 'Archive', '<div class="empty"><p>No posts yet.</p></div>')
  }
  const listItems = posts.map(p => `
    <li>
      <a href="/${escapeHtml(p.slug)}">
        <h2>${escapeHtml(p.title)}</h2>
        <span class="date">${formatDate(p.publishedAt)}</span>
      </a>
    </li>`).join('')
  return layout(domain, 'Archive', `<h2 style="margin-bottom:1rem">Archive</h2><ul class="post-list">${listItems}</ul>`)
}

export function blogNotFoundPage(domain: string): string {
  return layout(domain, 'Not Found', `
    <div class="empty">
      <h2>404 — Not Found</h2>
      <p style="margin-top:0.5rem"><a href="/" style="color:var(--accent)">Back to home</a></p>
    </div>`)
}

/** RSS feed for the blog. */
export function blogRssFeed(domain: string, posts: BlogListItem[]): string {
  const items = posts.slice(0, 20).map(p => {
    const escapedSlug = escapeHtml(p.slug)
    return `
    <item>
      <title>${escapeHtml(p.title)}</title>
      <link>https://${escapeHtml(domain)}/${escapedSlug}</link>
      <description>${escapeHtml(p.description ?? '')}</description>
      <pubDate>${new Date(p.publishedAt).toUTCString()}</pubDate>
      <guid>https://${escapeHtml(domain)}/${escapedSlug}</guid>
    </item>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeHtml(domain)}</title>
    <link>https://${escapeHtml(domain)}</link>
    <description>Blog at ${escapeHtml(domain)}</description>
    <atom:link href="https://${escapeHtml(domain)}/rss.xml" rel="self" type="application/rss+xml"/>
    ${items}
  </channel>
</rss>`
}