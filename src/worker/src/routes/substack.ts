import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import puppeteer from '@cloudflare/puppeteer'
import type { HonoEnv } from '../types'
import { appSettings } from '../db/schema'

const router = new Hono<HonoEnv>()

// ── Helpers ──────────────────────────────────────────────────────────────────

function maskEmail(email: string): string {
  const parts = email.split('@')
  const local = parts[0] ?? ''
  const domain = parts[1]
  if (!domain) return '***'
  const visible = local.slice(0, 3)
  return `${visible}***@${domain}`
}

// ── GET /api/substack/config ─────────────────────────────────────────────────

router.get('/config', async (c) => {
  const db = c.get('db')

  const [emailRow, passwordRow, subdomainRow] = await Promise.all([
    db.select().from(appSettings).where(eq(appSettings.key, 'substack:email')).get(),
    db.select().from(appSettings).where(eq(appSettings.key, 'substack:password')).get(),
    db.select().from(appSettings).where(eq(appSettings.key, 'substack:subdomain')).get(),
  ])

  return c.json({
    email: emailRow?.value ? maskEmail(emailRow.value) : null,
    passwordSet: !!passwordRow?.value,
    subdomain: subdomainRow?.value ?? null,
  })
})

// ── PUT /api/substack/config ─────────────────────────────────────────────────

router.put('/config', async (c) => {
  const db = c.get('db')
  const body = await c.req.json<{ email?: string; password?: string; subdomain?: string }>()

  const upserts: Promise<unknown>[] = []

  if (body.email !== undefined) {
    upserts.push(
      db.insert(appSettings)
        .values({ key: 'substack:email', value: body.email })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: body.email } }),
    )
  }

  if (body.password !== undefined) {
    upserts.push(
      db.insert(appSettings)
        .values({ key: 'substack:password', value: body.password })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: body.password } }),
    )
  }

  if (body.subdomain !== undefined) {
    upserts.push(
      db.insert(appSettings)
        .values({ key: 'substack:subdomain', value: body.subdomain })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: body.subdomain } }),
    )
  }

  await Promise.all(upserts)

  return c.json({ success: true })
})

// ── POST /api/substack/publish ───────────────────────────────────────────────

router.post('/publish', async (c) => {
  const db = c.get('db')
  const body = await c.req.json<{ title: string; body: string; subtitle?: string }>().catch(() => null)

  if (!body?.title || !body?.body) {
    return c.json({ error: 'title and body are required' }, 400)
  }

  // Fetch stored credentials
  const [emailRow, passwordRow, subdomainRow] = await Promise.all([
    db.select().from(appSettings).where(eq(appSettings.key, 'substack:email')).get(),
    db.select().from(appSettings).where(eq(appSettings.key, 'substack:password')).get(),
    db.select().from(appSettings).where(eq(appSettings.key, 'substack:subdomain')).get(),
  ])

  const email = emailRow?.value
  const password = passwordRow?.value
  const subdomain = subdomainRow?.value

  if (!email || !password || !subdomain) {
    return c.json({ error: 'Substack credentials not configured. Set email, password, and subdomain first.' }, 422)
  }

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null

  try {
    browser = await puppeteer.launch(c.env.BROWSER)
    const page = await browser.newPage()

    // Navigate to the post editor
    await page.goto(`https://${subdomain}.substack.com/publish/post`, {
      waitUntil: 'networkidle0',
      timeout: 30_000,
    })

    // Check if we were redirected to a login page
    const currentUrl = page.url()
    if (currentUrl.includes('/sign-in') || currentUrl.includes('/login') || currentUrl.includes('/account/login')) {
      // Fill in email
      const emailInput = await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 10_000 })
      if (emailInput) {
        await emailInput.click({ clickCount: 3 })
        await emailInput.type(email)
      }

      // Fill in password
      const passwordInput = await page.waitForSelector('input[type="password"], input[name="password"]', { timeout: 10_000 })
      if (passwordInput) {
        await passwordInput.click({ clickCount: 3 })
        await passwordInput.type(password)
      }

      // Submit login form
      const submitBtn = await page.waitForSelector('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")', { timeout: 5_000 }).catch(() => null)
      if (submitBtn) {
        await submitBtn.click()
      } else {
        await page.keyboard.press('Enter')
      }

      // Wait for navigation after login
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30_000 })

      // Navigate to the editor if not already there
      if (!page.url().includes('/publish/post')) {
        await page.goto(`https://${subdomain}.substack.com/publish/post`, {
          waitUntil: 'networkidle0',
          timeout: 30_000,
        })
      }
    }

    // Wait for the editor to load — try multiple selectors
    const titleSelector = 'div[data-testid="editor-title"], textarea[placeholder*="Title"], div[role="textbox"][data-placeholder*="Title"]'
    await page.waitForSelector(titleSelector, { timeout: 30_000 })

    // Fill in the title
    const titleEl = await page.$(titleSelector)
    if (titleEl) {
      await titleEl.click()
      await titleEl.type(body.title)
    }

    // Fill in the subtitle if provided
    if (body.subtitle) {
      const subtitleSelector = 'div[data-testid="editor-subtitle"], textarea[placeholder*="subtitle"], input[placeholder*="subtitle"], div[role="textbox"][data-placeholder*="subtitle"]'
      const subtitleEl = await page.$(subtitleSelector).catch(() => null)
      if (subtitleEl) {
        await subtitleEl.click()
        await subtitleEl.type(body.subtitle)
      }
    }

    // Fill in the body content using the ProseMirror editor
    const bodySelector = 'div.ProseMirror, div[contenteditable="true"]'
    const bodyEl = await page.waitForSelector(bodySelector, { timeout: 15_000 })
    if (bodyEl) {
      await bodyEl.click()
      await bodyEl.type(body.body)
    }

    // Click Publish / Continue button
    const publishBtnSelector = 'button:has-text("Publish"), button:has-text("Continue"), button[data-testid="publish-button"]'
    const publishBtn = await page.waitForSelector(publishBtnSelector, { timeout: 15_000 })
    if (publishBtn) {
      await publishBtn.click()
    }

    // Handle the confirmation dialog — look for a second "Publish" or "Publish now" button
    const confirmSelector = 'button:has-text("Publish now"), button:has-text("Publish"), button[data-testid="confirm-publish"]'
    const confirmBtn = await page.waitForSelector(confirmSelector, { timeout: 15_000 }).catch(() => null)
    if (confirmBtn) {
      await confirmBtn.click()
    }

    // Wait for the post to be published and get the URL
    await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30_000 }).catch(() => null)
    const postUrl = page.url()

    await browser.close()
    browser = null

    return c.json({ success: true, url: postUrl })
  } catch (err) {
    console.error('[substack] Publish failed:', err)
    const message = err instanceof Error ? err.message : 'Unknown error during Substack publishing'
    return c.json({ error: message }, 500)
  } finally {
    if (browser) {
      await browser.close().catch(() => {})
    }
  }
})

export default router
