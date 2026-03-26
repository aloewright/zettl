import { describe, expect, it } from 'vitest'
import { buildLogoutRedirect } from '../../../../shared/logout'

describe('auth logout route', () => {
  it('returns logout URL on the current origin with returnTo param', () => {
    const url = buildLogoutRedirect('https://notes.example.com/api/auth/logout')
    expect(url).toBe('https://notes.example.com/cdn-cgi/access/logout?returnTo=https%3A%2F%2Fnotes.example.com')
  })

  it('ignores path/query when computing origin', () => {
    const url = buildLogoutRedirect('https://notes.example.com/api/auth/logout?foo=bar')
    expect(url).toBe('https://notes.example.com/cdn-cgi/access/logout?returnTo=https%3A%2F%2Fnotes.example.com')
  })
})
