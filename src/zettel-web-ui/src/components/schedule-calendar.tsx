import { useState, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, FileText, MessageSquare, X, GripVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import * as contentApi from '@/api/content'
import type { ContentPiece } from '@/api/types'

// ── Date helpers ────────────────────────────────────────────────────────────

function startOfWeek(date: Date): Date {
  const d = new Date(date)
  d.setDate(d.getDate() - d.getDay())
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]!
}

function formatDayLabel(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

function isToday(date: Date): boolean {
  return isSameDay(date, new Date())
}

// ── Types ───────────────────────────────────────────────────────────────────

interface ScheduleCalendarProps {
  approvedPieces: ContentPiece[]
}

// ── Component ───────────────────────────────────────────────────────────────

export function ScheduleCalendar({ approvedPieces }: ScheduleCalendarProps) {
  const queryClient = useQueryClient()
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [dragPieceId, setDragPieceId] = useState<string | null>(null)
  const [dragOverDate, setDragOverDate] = useState<string | null>(null)

  // Get scheduled pieces
  const { data: scheduledPieces = [] } = useQuery({
    queryKey: ['scheduled-pieces'],
    queryFn: contentApi.getScheduledPieces,
  })

  const scheduleMutation = useMutation({
    mutationFn: ({ id, date }: { id: string; date: string | null }) =>
      contentApi.schedulePiece(id, date),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduled-pieces'] })
      queryClient.invalidateQueries({ queryKey: ['generations'] })
      toast.success('Post scheduled')
    },
    onError: () => toast.error('Failed to schedule post'),
  })

  const unscheduleMutation = useMutation({
    mutationFn: (id: string) => contentApi.schedulePiece(id, null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduled-pieces'] })
      queryClient.invalidateQueries({ queryKey: ['generations'] })
      toast.success('Post unscheduled')
    },
    onError: () => toast.error('Failed to unschedule'),
  })

  // Week days
  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  }, [weekStart])

  // Pieces scheduled per day
  const piecesByDate = useMemo(() => {
    const map = new Map<string, ContentPiece[]>()
    for (const piece of scheduledPieces) {
      if (piece.scheduledAt) {
        const dateKey = piece.scheduledAt.split('T')[0]!
        const list = map.get(dateKey) ?? []
        list.push(piece)
        map.set(dateKey, list)
      }
    }
    return map
  }, [scheduledPieces])

  // Unscheduled approved pieces
  const unscheduled = useMemo(() => {
    const scheduledIds = new Set(scheduledPieces.map(p => p.id))
    return approvedPieces.filter(p => !scheduledIds.has(p.id) && !p.scheduledAt)
  }, [approvedPieces, scheduledPieces])

  // Drag handlers
  const handleDragStart = useCallback((e: React.DragEvent, pieceId: string) => {
    setDragPieceId(pieceId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', pieceId)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, dateKey: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverDate(dateKey)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragOverDate(null)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent, dateKey: string) => {
    e.preventDefault()
    setDragOverDate(null)
    const pieceId = e.dataTransfer.getData('text/plain') || dragPieceId
    if (pieceId) {
      scheduleMutation.mutate({ id: pieceId, date: `${dateKey}T09:00:00.000Z` })
    }
    setDragPieceId(null)
  }, [dragPieceId, scheduleMutation])

  const handleDragEnd = useCallback(() => {
    setDragPieceId(null)
    setDragOverDate(null)
  }, [])

  return (
    <div className="mt-6 space-y-4">
      {/* Calendar header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Schedule
        </h3>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => setWeekStart(addDays(weekStart, -7))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setWeekStart(startOfWeek(new Date()))}
          >
            Today
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => setWeekStart(addDays(weekStart, 7))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Week grid */}
      <div className="grid grid-cols-7 gap-1">
        {weekDays.map(day => {
          const dateKey = formatDate(day)
          const dayPieces = piecesByDate.get(dateKey) ?? []
          const isDragOver = dragOverDate === dateKey
          const today = isToday(day)

          return (
            <div
              key={dateKey}
              className={`min-h-[100px] rounded-lg border p-2 transition-colors ${
                today ? 'border-foreground/30 bg-foreground/5' : 'border-border/50'
              } ${isDragOver ? 'border-blue-500 bg-blue-500/10' : ''}`}
              onDragOver={(e) => handleDragOver(e, dateKey)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, dateKey)}
            >
              <div className={`mb-1 text-[10px] font-medium ${today ? 'text-foreground' : 'text-muted-foreground'}`}>
                {formatDayLabel(day)}
              </div>
              <div className="space-y-1">
                {dayPieces.map(piece => (
                  <div
                    key={piece.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, piece.id)}
                    onDragEnd={handleDragEnd}
                    className="group flex items-start gap-1 rounded bg-foreground/10 p-1.5 text-[10px] leading-tight cursor-grab active:cursor-grabbing"
                  >
                    {piece.medium === 'blog' ? (
                      <FileText className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                    ) : (
                      <MessageSquare className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                    )}
                    <span className="flex-1 truncate">{piece.title || piece.medium}</span>
                    <button
                      onClick={() => unscheduleMutation.mutate(piece.id)}
                      className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Unscheduled pieces (drag source) */}
      {unscheduled.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-medium text-muted-foreground">
            Drag to schedule ({unscheduled.length})
          </h4>
          <div className="flex flex-wrap gap-2">
            {unscheduled.map(piece => (
              <div
                key={piece.id}
                draggable
                onDragStart={(e) => handleDragStart(e, piece.id)}
                onDragEnd={handleDragEnd}
                className={`flex items-center gap-1.5 rounded-md border border-border/50 bg-card px-2.5 py-1.5 text-xs cursor-grab active:cursor-grabbing transition-opacity ${
                  dragPieceId === piece.id ? 'opacity-40' : ''
                }`}
              >
                <GripVertical className="h-3 w-3 text-muted-foreground/50" />
                {piece.medium === 'blog' ? (
                  <FileText className="h-3 w-3 text-muted-foreground" />
                ) : (
                  <MessageSquare className="h-3 w-3 text-muted-foreground" />
                )}
                <span className="max-w-[150px] truncate">{piece.title || piece.medium}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
