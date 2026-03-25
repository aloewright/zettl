import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Image, Film, Music, FileText, HardDrive, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { listMedia, type MediaFile } from '@/api/media'

const FILTERS = [
  { key: undefined, label: 'All', icon: HardDrive },
  { key: 'image', label: 'Images', icon: Image },
  { key: 'video', label: 'Videos', icon: Film },
  { key: 'audio', label: 'Audio', icon: Music },
  { key: 'file', label: 'Files', icon: FileText },
] as const

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function MediaCard({ file }: { file: MediaFile }) {
  if (file.mediaType === 'image') {
    return (
      <a href={file.url} target="_blank" rel="noopener noreferrer" className="group block overflow-hidden rounded-lg border border-border bg-card">
        <div className="aspect-square overflow-hidden bg-muted">
          <img src={file.url} alt={file.originalName} className="h-full w-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
        </div>
        <div className="p-2">
          <p className="truncate text-xs font-medium">{file.originalName}</p>
          <p className="text-xs text-muted-foreground">{formatSize(file.size)}</p>
        </div>
      </a>
    )
  }

  if (file.mediaType === 'video') {
    return (
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="aspect-video overflow-hidden bg-muted">
          <video src={file.url} controls preload="metadata" className="h-full w-full object-cover" />
        </div>
        <div className="p-2">
          <p className="truncate text-xs font-medium">{file.originalName}</p>
          <p className="text-xs text-muted-foreground">{formatSize(file.size)}</p>
        </div>
      </div>
    )
  }

  if (file.mediaType === 'audio') {
    return (
      <div className="overflow-hidden rounded-lg border border-border bg-card p-3">
        <div className="mb-2 flex items-center gap-2">
          <Music className="h-5 w-5 shrink-0 text-muted-foreground" />
          <p className="truncate text-sm font-medium">{file.originalName}</p>
        </div>
        <audio src={file.url} controls preload="metadata" className="w-full" />
        <p className="mt-1 text-xs text-muted-foreground">{formatSize(file.size)}</p>
      </div>
    )
  }

  // file type
  return (
    <a href={file.url} target="_blank" rel="noopener noreferrer" className="group flex items-center gap-3 overflow-hidden rounded-lg border border-border bg-card p-3 transition-colors hover:bg-accent">
      <FileText className="h-8 w-8 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium group-hover:underline">{file.originalName}</p>
        <p className="text-xs text-muted-foreground">{formatSize(file.size)} &middot; {file.contentType}</p>
      </div>
    </a>
  )
}

export function DrivePage() {
  const [activeFilter, setActiveFilter] = useState<string | undefined>(undefined)

  const { data, isLoading, error } = useQuery({
    queryKey: ['media', activeFilter],
    queryFn: () => listMedia(activeFilter),
  })

  const files = data?.files ?? []

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="mb-4 font-serif text-2xl font-semibold tracking-tight">Drive</h1>

      {/* Filter toggles */}
      <div className="mb-6 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const Icon = f.icon
          const isActive = activeFilter === f.key
          return (
            <Button
              key={f.label}
              variant={isActive ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveFilter(f.key)}
              className="gap-1.5"
            >
              <Icon className="h-4 w-4" />
              {f.label}
            </Button>
          )
        })}
      </div>

      {/* Content */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {error && (
        <p className="py-8 text-center text-sm text-destructive">
          Failed to load media: {error instanceof Error ? error.message : 'Unknown error'}
        </p>
      )}

      {!isLoading && !error && files.length === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No files uploaded yet. Upload files through the note editor.
        </p>
      )}

      {!isLoading && files.length > 0 && (
        <>
          {/* Images + Videos in grid, Audio + Files in list */}
          {(activeFilter === undefined || activeFilter === 'image') && files.some(f => f.mediaType === 'image') && (
            <section className="mb-6">
              {activeFilter === undefined && <h2 className="mb-3 text-sm font-medium text-muted-foreground">Images</h2>}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {files.filter(f => f.mediaType === 'image').map(f => <MediaCard key={f.key} file={f} />)}
              </div>
            </section>
          )}

          {(activeFilter === undefined || activeFilter === 'video') && files.some(f => f.mediaType === 'video') && (
            <section className="mb-6">
              {activeFilter === undefined && <h2 className="mb-3 text-sm font-medium text-muted-foreground">Videos</h2>}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {files.filter(f => f.mediaType === 'video').map(f => <MediaCard key={f.key} file={f} />)}
              </div>
            </section>
          )}

          {(activeFilter === undefined || activeFilter === 'audio') && files.some(f => f.mediaType === 'audio') && (
            <section className="mb-6">
              {activeFilter === undefined && <h2 className="mb-3 text-sm font-medium text-muted-foreground">Audio</h2>}
              <div className="grid grid-cols-1 gap-3">
                {files.filter(f => f.mediaType === 'audio').map(f => <MediaCard key={f.key} file={f} />)}
              </div>
            </section>
          )}

          {(activeFilter === undefined || activeFilter === 'file') && files.some(f => f.mediaType === 'file') && (
            <section className="mb-6">
              {activeFilter === undefined && <h2 className="mb-3 text-sm font-medium text-muted-foreground">Files</h2>}
              <div className="grid grid-cols-1 gap-3">
                {files.filter(f => f.mediaType === 'file').map(f => <MediaCard key={f.key} file={f} />)}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
