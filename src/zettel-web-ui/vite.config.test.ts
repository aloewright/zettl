import { describe, expect, it } from 'vitest'
import { pwaOptions } from './vite.config'
import viteConfig from './vite.config'

describe('vite.config.ts workbox config', () => {
  it('includes navigateFallbackDenylist', () => {
    const workbox = pwaOptions.workbox
    expect(workbox?.navigateFallbackDenylist).toBeDefined()
  })

  it('includes API route denylist pattern', () => {
    const workbox = pwaOptions.workbox
    const denylist = workbox?.navigateFallbackDenylist
    expect(denylist).toBeDefined()
    const patterns = Array.isArray(denylist) ? denylist : [denylist]
    const hasApiPattern = patterns.some((p: unknown) =>
      typeof p === 'string' || p instanceof RegExp
        ? String(p).includes('/api')
        : false,
    )
    expect(hasApiPattern).toBe(true)
  })

  it('includes health route denylist pattern', () => {
    const workbox = pwaOptions.workbox
    const denylist = workbox?.navigateFallbackDenylist
    expect(denylist).toBeDefined()
    const patterns = Array.isArray(denylist) ? denylist : [denylist]
    const hasHealthPattern = patterns.some((p: unknown) =>
      typeof p === 'string' || p instanceof RegExp
        ? String(p).includes('/health')
        : false,
    )
    expect(hasHealthPattern).toBe(true)
  })

  it('includes globPatterns for cacheable asset types', () => {
    const workbox = pwaOptions.workbox
    expect(workbox?.globPatterns).toBeDefined()
    const patterns = Array.isArray(workbox?.globPatterns)
      ? workbox.globPatterns
      : [workbox?.globPatterns]
    expect(patterns).toContain('**/*.{js,css,html,ico,png,svg,woff2}')
  })

  it('includes maximumFileSizeToCacheInBytes set to 3 MiB', () => {
    const workbox = pwaOptions.workbox
    expect(workbox?.maximumFileSizeToCacheInBytes).toBe(3 * 1024 * 1024)
  })

  it('workbox block contains only the expected keys', () => {
    const workbox = pwaOptions.workbox
    expect(workbox).toBeDefined()
    const keys = Object.keys(workbox!).sort()
    // We expect globPatterns, maximumFileSizeToCacheInBytes, and navigateFallbackDenylist
    expect(keys).toEqual([
      'globPatterns',
      'maximumFileSizeToCacheInBytes',
      'navigateFallbackDenylist',
    ].sort())
  })
})

describe('vite.config.ts PWA plugin config', () => {
  it('registers VitePWA plugin', () => {
    const plugins = Array.isArray(viteConfig.plugins)
      ? viteConfig.plugins
      : viteConfig.plugins
        ? [viteConfig.plugins]
        : []
    const hasPwaPlugin = plugins.some((plugin: unknown) => {
      return (
        plugin != null &&
        typeof plugin === 'object' &&
        'name' in plugin &&
        (plugin as { name?: unknown }).name === 'vite-plugin-pwa'
      )
    })
    expect(hasPwaPlugin).toBe(true)
  })

  it('uses autoUpdate registration type', () => {
    expect(pwaOptions.registerType).toBe('autoUpdate')
  })
})

describe('vite.config.ts dev server proxy config', () => {
  it('still proxies /api routes to the backend', () => {
    const server = viteConfig.server
    const proxy = server?.proxy
    expect(proxy?.['/api']).toBeDefined()
  })

  it('still proxies /health routes to the backend', () => {
    const server = viteConfig.server
    const proxy = server?.proxy
    expect(proxy?.['/health']).toBeDefined()
  })

  it('proxies /api and /health to the same backend target', () => {
    const server = viteConfig.server
    const proxy = server?.proxy
    const apiProxy = proxy?.['/api'] as any
    const healthProxy = proxy?.['/health'] as any
    expect(apiProxy).toBeDefined()
    expect(healthProxy).toBeDefined()
    expect(apiProxy.target).toBe(healthProxy.target)
  })
})
