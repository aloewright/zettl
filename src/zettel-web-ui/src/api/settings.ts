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

/**
 * Retrieve the current model provider and model selection from server settings.
 *
 * @returns The `ModelSettings` object containing `provider` (`'openrouter' | 'google'`) and `model` (selected model name).
 */
export function getSettings(): Promise<ModelSettings> {
  return get<ModelSettings>('/api/settings')
}

/**
 * Update the configured model for a given provider.
 *
 * @param provider - The provider to update (`'openrouter'` or `'google'`)
 * @param model - The model identifier to set for the provider
 */
export function updateModel(provider: string, model: string): Promise<void> {
  return put<void>('/api/settings/model', { provider, model })
}

/**
 * Fetches lists of available models grouped by provider.
 *
 * @returns An object with `openRouter` and `google` arrays of `ModelInfo`, each entry describing an available model.
 */
export function getAvailableModels(): Promise<AvailableModels> {
  return get<AvailableModels>('/api/settings/models')
}
