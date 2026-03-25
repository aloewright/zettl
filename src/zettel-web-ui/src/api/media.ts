import { get } from './client'

export interface MediaFile {
  key: string
  url: string
  contentType: string
  size: number
  uploaded: string
  originalName: string
  mediaType: 'image' | 'video' | 'audio' | 'file'
}

interface MediaListResponse {
  files: MediaFile[]
  cursor: string | null
}

export async function listMedia(type?: string): Promise<MediaListResponse> {
  const params = type ? `?type=${type}` : ''
  return get<MediaListResponse>(`/api/upload/files${params}`)
}
