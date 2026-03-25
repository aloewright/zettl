import { ApiError } from './client'

interface UploadResult {
  url: string
  key: string
  contentType: string
  size: number
}

export async function uploadFile(file: File): Promise<string> {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch('/api/upload', {
    method: 'POST',
    credentials: 'same-origin',
    body: formData,
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new ApiError(response.status, response.statusText, body || undefined)
  }

  const result: UploadResult = await response.json()
  return result.url
}
