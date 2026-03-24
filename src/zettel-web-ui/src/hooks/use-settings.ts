import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSettings, getAvailableModels, updateModel } from '@/api/settings'

/**
 * Provide the React Query for fetching current model settings.
 *
 * @returns The query result for the model settings, including status flags and fetched data.
 */
export function useModelSettings() {
  return useQuery({
    queryKey: ['settings', 'model'],
    queryFn: getSettings,
  })
}

/**
 * Provides React Query state for fetching the list of available models.
 *
 * The query's data is treated as fresh for 10 minutes to reduce refetching.
 *
 * @returns The query result containing the available models data and status fields
 */
export function useAvailableModels() {
  return useQuery({
    queryKey: ['settings', 'models'],
    queryFn: getAvailableModels,
    // Cache for 10 minutes — server also caches, but this avoids re-fetching on tab switch
    staleTime: 10 * 60 * 1000,
  })
}

/**
 * Provides a mutation hook to update a provider's selected model.
 *
 * The mutation calls `updateModel(provider, model)` and, on success,
 * invalidates the `['settings', 'model']` query so updated settings are refetched.
 *
 * @returns A mutation object configured to accept an input `{ provider: string; model: string }`
 * and perform the update; on success the `['settings', 'model']` query is invalidated.
 */
export function useUpdateModel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ provider, model }: { provider: string; model: string }) =>
      updateModel(provider, model),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'model'] })
    },
  })
}
