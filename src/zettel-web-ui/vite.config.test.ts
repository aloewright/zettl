import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const configPath = path.resolve(process.cwd(), 'vite.config.ts')
const config = readFileSync(configPath, 'utf8')

describe('vite.config.ts workbox config', () => {
  it('does not include navigateFallbackDenylist', () => {
    expect(config).not.toContain('navigateFallbackDenylist')
  })

  it('does not include API route denylist pattern', () => {
    expect(config).not.toContain('/^\\/api\\//')
  })

  it('does not include health route denylist pattern', () => {
    expect(config).not.toContain('/^\\/health(?:\\/|$)/')
  })

  it('includes globPatterns for cacheable asset types', () => {
    expect(config).toContain('globPatterns')
    expect(config).toContain('**/*.{js,css,html,ico,png,svg,woff2}')
  })

  it('includes maximumFileSizeToCacheInBytes set to 3 MiB', () => {
    expect(config).toContain('maximumFileSizeToCacheInBytes')
    expect(config).toContain('3 * 1024 * 1024')
  })

  it('workbox block contains only the expected keys', () => {
    const workboxStart = config.indexOf('workbox:')
    expect(workboxStart).toBeGreaterThan(-1)
    // Find the opening brace of the workbox object
    const braceOpen = config.indexOf('{', workboxStart)
    // Walk forward counting braces to find the matching closing brace
    let depth = 0
    let workboxEnd = -1
    for (let i = braceOpen; i < config.length; i++) {
      if (config[i] === '{') depth++
      else if (config[i] === '}') {
        depth--
        if (depth === 0) { workboxEnd = i; break }
      }
    }
    expect(workboxEnd).toBeGreaterThan(-1)
    const workboxBody = config.slice(braceOpen + 1, workboxEnd)
    expect(workboxBody).toContain('globPatterns')
    expect(workboxBody).toContain('maximumFileSizeToCacheInBytes')
    expect(workboxBody).not.toContain('navigateFallbackDenylist')
  })
})

describe('vite.config.ts PWA plugin config', () => {
  it('registers VitePWA plugin', () => {
    expect(config).toContain('VitePWA')
  })

  it('uses autoUpdate registration type', () => {
    expect(config).toContain("registerType: 'autoUpdate'")
  })
})

describe('vite.config.ts dev server proxy config', () => {
  it('still proxies /api routes to the backend', () => {
    expect(config).toContain("'/api'")
  })

  it('still proxies /health routes to the backend', () => {
    expect(config).toContain("'/health'")
  })

  it('proxies /api and /health to the same backend target', () => {
    const apiMatch = config.match(/['"]\/api['"]\s*:\s*\{[^}]*target\s*:\s*['"]([^'"]+)['"]/s)
    const healthMatch = config.match(/['"]\/health['"]\s*:\s*\{[^}]*target\s*:\s*['"]([^'"]+)['"]/s)
    expect(apiMatch).not.toBeNull()
    expect(healthMatch).not.toBeNull()
    expect(apiMatch![1]).toBe(healthMatch![1])
  })
})