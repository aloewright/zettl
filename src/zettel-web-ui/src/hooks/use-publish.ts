import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  publishPiece,
  getPublishHistory,
  listBlogPosts,
  deleteBlogPost,
  getBlogDomains,
  updateBlogDomains,
  type PublishRequest,
} from '@/api/publish'

export function usePublish() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: PublishRequest) => publishPiece(data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['publish-history', vars.pieceId] })
      qc.invalidateQueries({ queryKey: ['blog-posts'] })
    },
  })
}

export function usePublishHistory(pieceId: string | undefined) {
  return useQuery({
    queryKey: ['publish-history', pieceId],
    queryFn: () => getPublishHistory(pieceId!),
    enabled: !!pieceId,
    staleTime: 30_000,
  })
}

export function useBlogPosts(params?: { domain?: string; skip?: number; take?: number }) {
  return useQuery({
    queryKey: ['blog-posts', params],
    queryFn: () => listBlogPosts(params),
    staleTime: 30_000,
  })
}

export function useDeleteBlogPost() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteBlogPost,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['blog-posts'] }),
  })
}

export function useBlogDomains() {
  return useQuery({
    queryKey: ['blog-domains'],
    queryFn: getBlogDomains,
    staleTime: 5 * 60 * 1000,
  })
}

export function useUpdateBlogDomains() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: updateBlogDomains,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['blog-domains'] }),
  })
}
