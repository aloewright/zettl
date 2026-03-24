import { get, put } from './client'

export interface ModelSettings {
  provider: 'openrouter' | 'google'
  model: string
}

export interface ModelInfo {
  id: string
  name: string
  contextLength: number | null
}

export interface AvailableModels {
  openRouter: ModelInfo[]
  google: ModelInfo[]
}

export function getSettings(): Promise<ModelSettings> {
  return get<ModelSettings>('/api/settings')
}

export function updateModel(provider: string, model: string): Promise<void> {
  return put<void>('/api/settings/model', { provider, model })
}

export function getAvailableModels(): Promise<AvailableModels> {
  return get<AvailableModels>('/api/settings/models')
}
