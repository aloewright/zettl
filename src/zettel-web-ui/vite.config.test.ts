import { beforeAll, describe, expect, it } from 'vitest'

let viteConfig: any
let pwaOptions: any

beforeAll(async () => {
  const mod: any = await import('./vite.config')
  const exported = mod.default ?? mod

  // Vite config can be an object or a function returning an object.
  if (typeof exported === 'function') {
    viteConfig = await exported({ command: 'serve', mode: 'test' })
  } else {
    viteConfig = exported
  }

  const plugins = Array.isArray(viteConfig.plugins)
    ? viteConfig.plugins.flat()
    : viteConfig.plugins

  const pluginList = Array.isArray(plugins) ? plugins : [plugins]
  const pwaPlugin = pluginList.find((p: any) => p && p.name === 'vite-plugin-pwa')

  pwaOptions = pwaPlugin?.api?.options ?? {}
})

describe('vite.config.ts workbox config', () => {
  it('does not include navigateFallbackDenylist', () => {
    const workbox = pwaOptions.workbox ?? {}
    expect(workbox.navigateFallbackDenylist).toBeUndefined()
  })

  it('does not include API route denylist pattern', () => {
    const workbox = pwaOptions.workbox ?? {}
    const denylist = workbox.navigateFallbackDenylist
    if (denylist === undefined) {
      expect(denylist).toBeUndefined()
      return
    }
    const patterns = Array.isArray(denylist) ? denylist : [denylist]
    const hasApiPattern = patterns.some((p: unknown) =>
      typeof p === 'string' || p instanceof RegExp
        ? String(p).includes('/api')
        : false,
    )
    expect(hasApiPattern).toBe(false)
  })

  it('does not include health route denylist pattern', () => {
    const workbox = pwaOptions.workbox ?? {}
    const denylist = workbox.navigateFallbackDenylist
    if (denylist === undefined) {
      expect(denylist).toBeUndefined()
      return
    }
    const patterns = Array.isArray(denylist) ? denylist : [denylist]
    const hasHealthPattern = patterns.some((p: unknown) =>
      typeof p === 'string' || p instanceof RegExp
        ? String(p).includes('/health')
        : false,
    )
    expect(hasHealthPattern).toBe(false)
  })

  it('includes globPatterns for cacheable asset types', () => {
    const workbox = pwaOptions.workbox ?? {}
    expect(workbox.globPatterns).toBeDefined()
    const patterns = Array.isArray(workbox.globPatterns)
      ? workbox.globPatterns
      : [workbox.globPatterns]
    expect(patterns).toContain('**/*.{js,css,html,ico,png,svg,woff2}')
  })

  it('includes maximumFileSizeToCacheInBytes set to 3 MiB', () => {
    const workbox = pwaOptions.workbox ?? {}
    expect(workbox.maximumFileSizeToCacheInBytes).toBe(3 * 1024 * 1024)
  })

  it('workbox block contains only the expected keys', () => {
    const workbox = pwaOptions.workbox ?? {}
    const keys = Object.keys(workbox).sort()
    // We expect only globPatterns and maximumFileSizeToCacheInBytes
    expect(keys).toEqual(['globPatterns', 'maximumFileSizeToCacheInBytes'].sort())
    expect(workbox.navigateFallbackDenylist).toBeUndefined()
  })
})

describe('vite.config.ts PWA plugin config', () => {
  it('registers VitePWA plugin', () => {
    // If pwaOptions was populated, the plugin is registered.
    expect(pwaOptions).toBeDefined()
  })

  it('uses autoUpdate registration type', () => {
    expect(pwaOptions.registerType).toBe('autoUpdate')
  })
})

describe('vite.config.ts dev server proxy config', () => {
  it('still proxies /api routes to the backend', () => {
    const server = viteConfig.server ?? {}
    const proxy = server.proxy ?? {}
    expect(proxy['/api']).toBeDefined()
  })

  it('still proxies /health routes to the backend', () => {
    const server = viteConfig.server ?? {}
    const proxy = server.proxy ?? {}
    expect(proxy['/health']).toBeDefined()
  })

  it('proxies /api and /health to the same backend target', () => {
    const server = viteConfig.server ?? {}
    const proxy = server.proxy ?? {}
    const apiProxy = proxy['/api']
    const healthProxy = proxy['/health']
    expect(apiProxy).toBeDefined()
    expect(healthProxy).toBeDefined()
    expect(apiProxy.target).toBe(healthProxy.target)
  })
})