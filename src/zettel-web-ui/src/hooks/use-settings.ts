import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSettings, getAvailableModels, updateModel } from '@/api/settings'

export function useModelSettings() {
  return useQuery({
    queryKey: ['settings', 'model'],
    queryFn: getSettings,
  })
}

export function useAvailableModels() {
  return useQuery({
    queryKey: ['settings', 'models'],
    queryFn: getAvailableModels,
    // Cache for 10 minutes — server also caches, but this avoids re-fetching on tab switch
    staleTime: 10 * 60 * 1000,
  })
}

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
