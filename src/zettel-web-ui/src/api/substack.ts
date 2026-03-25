import { get, put, post } from './client'

export interface SubstackConfig {
  email: string | null
  passwordSet: boolean
  subdomain: string | null
}

export function getSubstackConfig(): Promise<SubstackConfig> {
  return get<SubstackConfig>('/api/substack/config')
}

export function updateSubstackConfig(data: { email?: string; password?: string; subdomain?: string }): Promise<void> {
  return put<void>('/api/substack/config', data)
}

export interface SubstackPublishResult {
  success: boolean
  url?: string
  error?: string
}

export function publishToSubstack(data: { title: string; body: string; subtitle?: string }): Promise<SubstackPublishResult> {
  return post<SubstackPublishResult>('/api/substack/publish', data)
}
