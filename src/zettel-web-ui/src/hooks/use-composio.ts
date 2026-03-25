import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getComposioConfig,
  updateComposioConfig,
  getComposioConnections,
  getConnectLink,
  deleteComposioConnection,
  searchComposioTools,
  executeComposioTool,
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

export function useComposioConnections() {
  return useQuery({
    queryKey: ['composio', 'connections'],
    queryFn: getComposioConnections,
    staleTime: 30_000,
  })
}

export function useConnectToolkit() {
  return useMutation({
    mutationFn: (toolkit: string) => getConnectLink(toolkit),
  })
}

export function useDisconnectToolkit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteComposioConnection,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['composio', 'connections'] })
    },
  })
}

export function useSearchTools() {
  return useMutation({
    mutationFn: (query: string) => searchComposioTools(query),
  })
}

export function useExecuteTool() {
  return useMutation({
    mutationFn: ({ tool, params }: { tool: string; params: Record<string, unknown> }) =>
      executeComposioTool(tool, params),
  })
}
