import { Hono } from 'hono'
import type { HonoEnv } from '../types'
import { makeId } from '../types'

const router = new Hono<HonoEnv>()

const ALLOWED_TYPES: Record<string, string[]> = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
  video: ['video/mp4', 'video/webm', 'video/quicktime'],
  audio: ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/mp4'],
  file: ['application/pdf', 'text/plain', 'application/zip'],
}

const ALL_ALLOWED = Object.values(ALLOWED_TYPES).flat()
const MAX_SIZE = 50 * 1024 * 1024 // 50MB

function getMediaType(contentType: string): string {
  for (const [type, mimes] of Object.entries(ALLOWED_TYPES)) {
    if (mimes.includes(contentType)) return type
  }
  return 'file'
}

function getExtension(contentType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'audio/mpeg': 'mp3',
    'audio/ogg': 'ogg',
    'audio/wav': 'wav',
    'audio/webm': 'weba',
    'audio/mp4': 'm4a',
    'application/pdf': 'pdf',
    'text/plain': 'txt',
    'application/zip': 'zip',
  }
  return map[contentType] ?? 'bin'
}

// POST /api/upload — accepts multipart form data with a "file" field
router.post('/', async (c) => {
  const formData = await c.req.formData()
  const file = formData.get('file')

  if (!file || typeof file === 'string') {
    return c.json({ error: 'No file provided' }, 400)
  }

  const blob = file as unknown as { name: string; type: string; size: number; stream(): ReadableStream; arrayBuffer(): Promise<ArrayBuffer> }

  if (!ALL_ALLOWED.includes(blob.type)) {
    return c.json({ error: `Unsupported file type: ${blob.type}` }, 400)
  }

  if (blob.size > MAX_SIZE) {
    return c.json({ error: `File too large (max ${MAX_SIZE / 1024 / 1024}MB)` }, 400)
  }

  const mediaType = getMediaType(blob.type)
  const ext = getExtension(blob.type)
  const key = `${mediaType}/${makeId()}.${ext}`

  await c.env.MEDIA_BUCKET.put(key, blob.stream(), {
    httpMetadata: {
      contentType: blob.type,
    },
    customMetadata: {
      originalName: blob.name,
    },
  })

  // Serve via the worker itself at /media/<key>
  const url = `/media/${key}`

  return c.json({ url, key, contentType: blob.type, size: blob.size })
})

// GET /api/upload/files — list uploaded media from R2
router.get('/files', async (c) => {
  const type = c.req.query('type') // image | video | audio | file
  const prefix = type ? `${type}/` : undefined
  const cursor = c.req.query('cursor') || undefined

  const listed = await c.env.MEDIA_BUCKET.list({
    prefix,
    limit: 100,
    cursor,
  })

  const files = listed.objects.map((obj) => ({
    key: obj.key,
    url: `/media/${obj.key}`,
    contentType: obj.httpMetadata?.contentType ?? 'application/octet-stream',
    size: obj.size,
    uploaded: obj.uploaded.toISOString(),
    originalName: obj.customMetadata?.originalName ?? obj.key.split('/').pop() ?? obj.key,
    mediaType: obj.key.split('/')[0] ?? 'file',
  }))

  return c.json({
    files,
    cursor: listed.truncated ? listed.cursor : null,
  })
})

export default router
