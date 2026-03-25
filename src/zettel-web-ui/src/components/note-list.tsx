import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { ArrowUpDown, Tag, X, Loader2 } from 'lucide-react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { NoteListItem } from './note-list-item'
import { NoteEmpty } from './note-empty'
import { Skeleton } from '@/components/ui/skeleton'
import { listNotes } from '@/api/notes'
import type { Note, NoteType } from '@/api/types'

type SortOption = 'updated' | 'created' | 'title'

const PAGE_SIZE = 50

const sortLabels: Record<SortOption, string> = {
  updated: 'Recently updated',
  created: 'Recently created',
  title: 'Title',
}

type TypeFilter = NoteType | undefined

const typeFilters: { label: string; value: TypeFilter }[] = [
  { label: 'All', value: undefined },
  { label: 'Regular', value: 'Regular' },
  { label: 'Structure', value: 'Structure' },
  { label: 'Source', value: 'Source' },
]

function sortNotes(notes: Note[], sort: SortOption): Note[] {
  return [...notes].sort((a, b) => {
    switch (sort) {
      case 'updated':
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      case 'created':
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      case 'title':
        return a.title.localeCompare(b.title)
    }
  })
}

export function NoteList() {
  const [sort, setSort] = useState<SortOption>('updated')
  const [tagFilter, setTagFilter] = useState<string | undefined>(undefined)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(undefined)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: ['notes', { tag: tagFilter, noteType: typeFilter }],
    queryFn: ({ pageParam = 0 }) => listNotes(pageParam, PAGE_SIZE, tagFilter, typeFilter),
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.items.length, 0)
      return loaded < lastPage.totalCount ? loaded : undefined
    },
    initialPageParam: 0,
  })

  // Intersection observer for infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage()
        }
      },
      { rootMargin: '200px' },
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const allNotes = useMemo(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data],
  )

  const totalCount = data?.pages[0]?.totalCount ?? 0

  const sorted = useMemo(
    () => sortNotes(allNotes, sort),
    [allNotes, sort],
  )

  const handleTagClick = useCallback((tag: string) => {
    setTagFilter(tag)
  }, [])

  function clearTagFilter() {
    setTagFilter(undefined)
  }

  function handleTypeFilter(value: TypeFilter) {
    setTypeFilter(value)
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-2 px-3 py-4">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-full" />
          </div>
        ))}
      </div>
    )
  }

  if (allNotes.length === 0 && !tagFilter && !typeFilter) {
    return <NoteEmpty />
  }

  const hasActiveFilter = !!tagFilter || !!typeFilter

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1">
        {typeFilters.map((f) => (
          <Button
            key={f.label}
            variant={typeFilter === f.value ? 'secondary' : 'ghost'}
            size="xs"
            onClick={() => handleTypeFilter(f.value)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground">
            {totalCount} {totalCount === 1 ? 'note' : 'notes'}
          </p>
          {tagFilter && (
            <Badge
              variant="outline"
              className="gap-1 text-xs font-normal cursor-pointer"
              onClick={clearTagFilter}
            >
              <Tag className="h-3 w-3" />
              #{tagFilter}
              <X className="h-3 w-3" />
            </Badge>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-muted-foreground">
              <ArrowUpDown className="h-3 w-3" />
              {sortLabels[sort]}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup value={sort} onValueChange={(v) => setSort(v as SortOption)}>
              {(Object.keys(sortLabels) as SortOption[]).map((key) => (
                <DropdownMenuRadioItem key={key} value={key}>
                  {sortLabels[key]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {allNotes.length === 0 && hasActiveFilter ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Tag className="h-8 w-8 text-muted-foreground/40" />
          <p className="mt-3 text-sm text-muted-foreground">
            {tagFilter
              ? <>No notes tagged with &ldquo;{tagFilter}&rdquo;</>
              : <>No {typeFilter?.toLowerCase()} notes found</>
            }
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => {
              clearTagFilter()
              setTypeFilter(undefined)
            }}
          >
            Clear filters
          </Button>
        </div>
      ) : (
        <div className="divide-y divide-border/50">
          {sorted.map((note) => (
            <NoteListItem
              key={note.id}
              note={note}
              onTagClick={handleTagClick}
            />
          ))}

          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} className="h-px" />

          {isFetchingNextPage && (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
