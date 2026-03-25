import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getComposioConfig,
  updateComposioConfig,
  listMcpTools,
  callMcpTool,
  connectApp,
} from '@/api/composio'

export function useComposioConfig() {
  return useQuery({
    queryKey: ['composio', 'config'],
    queryFn: getComposioConfig,
    staleTime: 5 * 60 * 1000,
  })
}

export function useUpdateComposioConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: updateComposioConfig,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['composio'] })
    },
  })
}

export function useMcpTools() {
  return useQuery({
    queryKey: ['composio', 'tools'],
    queryFn: listMcpTools,
    staleTime: 60_000,
  })
}

export function useCallMcpTool() {
  return useMutation({
    mutationFn: ({ name, args }: { name: string; args: Record<string, unknown> }) =>
      callMcpTool(name, args),
  })
}

export function useConnectApp() {
  return useMutation({
    mutationFn: (app: string) => connectApp(app),
  })
}
