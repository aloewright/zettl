import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Compass, TrendingUp, Tag, Loader2, ExternalLink } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { get } from '@/api/client'

interface DiscoverResult {
  random?: Array<{ id: string; title: string; content: string }>
  orphans?: Array<{ id: string; title: string }>
  today?: Array<{ id: string; title: string }>
}

interface TagResult {
  tag: string
  count: number
}

interface ExploreModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ExploreModal({ open, onOpenChange }: ExploreModalProps) {
  const [tab, setTab] = useState<'trending' | 'tags' | 'discover'>('discover')

  const { data: discover, isLoading: discoverLoading } = useQuery({
    queryKey: ['explore', 'discover'],
    queryFn: () => get<DiscoverResult>('/api/discover'),
    enabled: open && tab === 'discover',
  })

  const { data: tags, isLoading: tagsLoading } = useQuery({
    queryKey: ['explore', 'tags'],
    queryFn: () => get<TagResult[]>('/api/tags'),
    enabled: open && tab === 'tags',
  })

  const { data: trending, isLoading: trendingLoading } = useQuery({
    queryKey: ['explore', 'trending'],
    queryFn: () => get<DiscoverResult>('/api/discover'),
    enabled: open && tab === 'trending',
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif">
            <Compass className="h-5 w-5" />
            Explore
          </DialogTitle>
          <DialogDescription>
            Discover connections, trending topics, and overlooked notes.
          </DialogDescription>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex gap-1 rounded-md border border-border bg-muted p-0.5">
          {([
            { key: 'discover', label: 'Discover', icon: Compass },
            { key: 'tags', label: 'Categories', icon: Tag },
            { key: 'trending', label: 'Trending', icon: TrendingUp },
          ] as const).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === key
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="max-h-[400px] overflow-y-auto">
          {tab === 'discover' && (
            <div className="space-y-4">
              {discoverLoading && (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}

              {discover?.random && discover.random.length > 0 && (
                <section>
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Random Notes</h3>
                  <div className="space-y-1.5">
                    {discover.random.map(note => (
                      <Link
                        key={note.id}
                        to={`/notes/${note.id}`}
                        onClick={() => onOpenChange(false)}
                        className="flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent"
                      >
                        <span className="flex-1 truncate">{note.title}</span>
                        <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                      </Link>
                    ))}
                  </div>
                </section>
              )}

              {discover?.orphans && discover.orphans.length > 0 && (
                <section>
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Orphan Notes</h3>
                  <p className="mb-2 text-xs text-muted-foreground">Notes with no links to other notes</p>
                  <div className="space-y-1.5">
                    {discover.orphans.slice(0, 5).map(note => (
                      <Link
                        key={note.id}
                        to={`/notes/${note.id}`}
                        onClick={() => onOpenChange(false)}
                        className="flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent"
                      >
                        <span className="flex-1 truncate">{note.title}</span>
                        <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                      </Link>
                    ))}
                  </div>
                </section>
              )}

              {discover?.today && discover.today.length > 0 && (
                <section>
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Created Today</h3>
                  <div className="space-y-1.5">
                    {discover.today.map(note => (
                      <Link
                        key={note.id}
                        to={`/notes/${note.id}`}
                        onClick={() => onOpenChange(false)}
                        className="flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent"
                      >
                        <span className="flex-1 truncate">{note.title}</span>
                        <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                      </Link>
                    ))}
                  </div>
                </section>
              )}

              {!discoverLoading && !discover?.random?.length && !discover?.orphans?.length && !discover?.today?.length && (
                <p className="py-8 text-center text-sm text-muted-foreground">No notes to discover yet.</p>
              )}
            </div>
          )}

          {tab === 'tags' && (
            <div>
              {tagsLoading && (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}
              {tags && tags.length > 0 && (
                <div className="flex flex-wrap gap-2 py-2">
                  {tags.map(t => (
                    <button
                      key={t.tag}
                      onClick={() => {
                        onOpenChange(false)
                        window.dispatchEvent(new CustomEvent('zettel:search-tag', { detail: t.tag }))
                      }}
                      className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs transition-colors hover:bg-accent"
                    >
                      <Tag className="h-3 w-3" />
                      {t.tag}
                      <span className="text-muted-foreground">({t.count})</span>
                    </button>
                  ))}
                </div>
              )}
              {!tagsLoading && (!tags || tags.length === 0) && (
                <p className="py-8 text-center text-sm text-muted-foreground">No tags yet.</p>
              )}
            </div>
          )}

          {tab === 'trending' && (
            <div className="space-y-4">
              {trendingLoading && (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}

              {trending?.random && trending.random.length > 0 && (
                <section>
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Suggested Topics</h3>
                  <p className="mb-2 text-xs text-muted-foreground">Notes from your knowledge base to revisit</p>
                  <div className="space-y-1.5">
                    {trending.random.map(note => (
                      <Link
                        key={note.id}
                        to={`/notes/${note.id}`}
                        onClick={() => onOpenChange(false)}
                        className="flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent"
                      >
                        <TrendingUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate">{note.title}</span>
                      </Link>
                    ))}
                  </div>
                </section>
              )}

              {!trendingLoading && !trending?.random?.length && (
                <p className="py-8 text-center text-sm text-muted-foreground">Add more notes to see trending topics.</p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
