import { get, put, post, del } from './client'

export interface ComposioConfig {
  enabled: boolean
}

export interface McpTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export interface ConnectionStatus {
  connected: boolean
  connectedAccountId?: string
}

export interface ConnectionsResponse {
  connections: Record<string, ConnectionStatus>
}

export interface AuthLinkResponse {
  redirectUrl: string
}

// ── Service definitions ──────────────────────────────────────────────────────

export interface ServiceDefinition {
  slug: string
  name: string
  description: string
}

export const COMPOSIO_SERVICES: ServiceDefinition[] = [
  { slug: 'google', name: 'Google', description: 'Gmail, Drive, Calendar' },
  { slug: 'linkedin', name: 'LinkedIn', description: 'Posts, connections' },
  { slug: 'resend', name: 'Resend', description: 'Transactional email' },
  { slug: 'youtube', name: 'YouTube', description: 'Videos, channels' },
  { slug: 'github', name: 'GitHub', description: 'Repos, issues, PRs' },
]

// ── Config ───────────────────────────────────────────────────────────────────

export function getComposioConfig(): Promise<ComposioConfig> {
  return get<ComposioConfig>('/api/composio/config')
}

export function updateComposioConfig(data: { enabled?: boolean }): Promise<void> {
  return put<void>('/api/composio/config', data)
}

// ── Connections ──────────────────────────────────────────────────────────────

export function getConnections(): Promise<ConnectionsResponse> {
  return get<ConnectionsResponse>('/api/composio/connections')
}

export function createAuthLink(service: string, callbackUrl: string): Promise<AuthLinkResponse> {
  return post<AuthLinkResponse>('/api/composio/auth-link', { service, callbackUrl })
}

export function disconnectService(service: string): Promise<void> {
  return del(`/api/composio/connections/${service}`)
}

// ── MCP Tools ────────────────────────────────────────────────────────────────

export function listMcpTools(): Promise<{ tools: McpTool[] }> {
  return get<{ tools: McpTool[] }>('/api/composio/tools')
}

export function callMcpTool(name: string, args: Record<string, unknown>): Promise<{ result: unknown }> {
  return post<{ result: unknown }>('/api/composio/tools/call', { name, arguments: args })
}

export function connectApp(app: string): Promise<unknown> {
  return post<unknown>('/api/composio/connect', { app })
}
