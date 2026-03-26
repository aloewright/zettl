import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

describe('PWA Workbox config', () => {
  it('excludes API and health routes from SPA navigation fallback', () => {
    const configPath = path.resolve(process.cwd(), 'vite.config.ts')
    const config = readFileSync(configPath, 'utf8')

    expect(config).toContain('navigateFallbackDenylist')
    expect(config).toContain('/^\\/api\\//')
    expect(config).toContain('/^\\/health(?:\\/|$)/')
  })
})
