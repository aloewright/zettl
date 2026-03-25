import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSubstackConfig, updateSubstackConfig, publishToSubstack } from '@/api/substack'

export function useSubstackConfig() {
  return useQuery({
    queryKey: ['substack', 'config'],
    queryFn: getSubstackConfig,
    staleTime: 5 * 60 * 1000,
  })
}

export function useUpdateSubstackConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: updateSubstackConfig,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['substack', 'config'] }),
  })
}

export function usePublishToSubstack() {
  return useMutation({
    mutationFn: publishToSubstack,
  })
}
