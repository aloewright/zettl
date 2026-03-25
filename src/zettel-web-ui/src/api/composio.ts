import { get, put, post, del } from './client'

export interface ComposioConfig {
  enabled: boolean
  apiKeySet: boolean
  apiKeyMasked?: string
}

export interface ComposioSession {
  sessionId: string
  mcpUrl: string
}

export interface ComposioTool {
  name: string
  description: string
  toolkit: string
}

export interface ComposioConnection {
  id: string
  toolkit: string
  status: string
  createdAt?: string
}

export interface ConnectLink {
  url: string
  toolkit: string
}

export function getComposioConfig(): Promise<ComposioConfig> {
  return get<ComposioConfig>('/api/composio/config')
}

export function updateComposioConfig(data: { apiKey?: string; enabled?: boolean }): Promise<ComposioConfig> {
  return put<ComposioConfig>('/api/composio/config', data)
}

export function createComposioSession(): Promise<ComposioSession> {
  return post<ComposioSession>('/api/composio/session')
}

export function searchComposioTools(query: string): Promise<{ tools: ComposioTool[] }> {
  return post<{ tools: ComposioTool[] }>('/api/composio/tools/search', { query })
}

export function executeComposioTool(toolName: string, params: Record<string, unknown>): Promise<unknown> {
  return post<unknown>('/api/composio/tools/execute', { tool: toolName, params })
}

export function getConnectLink(toolkit: string): Promise<ConnectLink> {
  return post<ConnectLink>('/api/composio/connect', { toolkit })
}

export function getComposioConnections(): Promise<ComposioConnection[]> {
  return get<ComposioConnection[]>('/api/composio/connections')
}

export function deleteComposioConnection(id: string): Promise<void> {
  return del(`/api/composio/connections/${id}`)
}
