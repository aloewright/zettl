import {
  forwardRef,
  useRef,
  useEffect,
  useCallback,
  type HTMLAttributes,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/utils'
import { ArrowDown, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'

/* ── Conversation container ─────────────────────────────────────────────── */

interface ConversationProps extends HTMLAttributes<HTMLDivElement> {
  /** Auto-scroll to bottom when children change */
  autoScroll?: boolean
}

export const Conversation = forwardRef<HTMLDivElement, ConversationProps>(
  ({ autoScroll = true, className, children, ...props }, ref) => {
    const scrollRef = useRef<HTMLDivElement>(null)
    const endRef = useRef<HTMLDivElement>(null)

    const scrollToBottom = useCallback(() => {
      endRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [])

    useEffect(() => {
      if (autoScroll) scrollToBottom()
    })

    return (
      <div
        ref={ref}
        className={cn(
          'flex-1 overflow-y-auto px-4 py-3',
          className,
        )}
        style={{ maxHeight: '400px', minHeight: '200px' }}
        {...props}
      >
        <div ref={scrollRef}>
          {children}
        </div>
        <div ref={endRef} />
      </div>
    )
  },
)
Conversation.displayName = 'Conversation'

/* ── Empty state ────────────────────────────────────────────────────────── */

interface ConversationEmptyStateProps {
  title?: string
  description?: string
  icon?: ReactNode
}

export function ConversationEmptyState({
  title = 'AI Chat',
  description = 'Ask anything about your knowledge base, brainstorm ideas, or get help thinking through concepts.',
  icon,
}: ConversationEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      {icon ?? <Sparkles className="h-6 w-6 text-muted-foreground/50" />}
      {title && (
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
      )}
      {description && (
        <p className="max-w-[260px] text-xs text-muted-foreground/70">
          {description}
        </p>
      )}
    </div>
  )
}

/* ── Scroll-to-bottom button ────────────────────────────────────────────── */

interface ConversationScrollButtonProps {
  visible?: boolean
  onClick?: () => void
}

export function ConversationScrollButton({
  visible,
  onClick,
}: ConversationScrollButtonProps) {
  if (!visible) return null
  return (
    <Button
      variant="outline"
      size="sm"
      className="absolute bottom-2 left-1/2 -translate-x-1/2 gap-1 rounded-full shadow-md"
      onClick={onClick}
    >
      <ArrowDown className="h-3 w-3" />
      <span className="text-xs">New messages</span>
    </Button>
  )
}
