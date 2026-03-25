import { get, put, post } from './client'

export interface ComposioConfig {
  enabled: boolean
}

export interface McpTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export function getComposioConfig(): Promise<ComposioConfig> {
  return get<ComposioConfig>('/api/composio/config')
}

export function updateComposioConfig(data: { enabled?: boolean }): Promise<void> {
  return put<void>('/api/composio/config', data)
}

export function listMcpTools(): Promise<{ tools: McpTool[] }> {
  return get<{ tools: McpTool[] }>('/api/composio/tools')
}

export function callMcpTool(name: string, args: Record<string, unknown>): Promise<{ result: unknown }> {
  return post<{ result: unknown }>('/api/composio/tools/call', { name, arguments: args })
}

export function connectApp(app: string): Promise<unknown> {
  return post<unknown>('/api/composio/connect', { app })
}
