import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getComposioConfig,
  updateComposioConfig,
  getConnections,
  createAuthLink,
  disconnectService,
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

export function useComposioConnections() {
  return useQuery({
    queryKey: ['composio', 'connections'],
    queryFn: getConnections,
    staleTime: 30_000,
  })
}

export function useCreateAuthLink() {
  return useMutation({
    mutationFn: ({ service, callbackUrl }: { service: string; callbackUrl: string }) =>
      createAuthLink(service, callbackUrl),
  })
}

export function useDisconnectService() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (service: string) => disconnectService(service),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['composio', 'connections'] })
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
