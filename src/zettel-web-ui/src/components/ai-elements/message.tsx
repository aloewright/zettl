import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'
import { Bot, User } from 'lucide-react'
import type { UIMessage } from 'ai'

/* ── Message container ──────────────────────────────────────────────────── */

interface MessageProps extends HTMLAttributes<HTMLDivElement> {
  role: 'user' | 'assistant'
}

export const Message = forwardRef<HTMLDivElement, MessageProps>(
  ({ role, className, children, ...props }, ref) => (
    <div
      ref={ref}
      data-role={role}
      className={cn(
        'mb-3 flex gap-2',
        role === 'user' ? 'justify-end' : 'justify-start',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  ),
)
Message.displayName = 'Message'

/* ── Avatar ─────────────────────────────────────────────────────────────── */

export function MessageAvatar({ role }: { role: 'user' | 'assistant' }) {
  if (role === 'assistant') {
    return (
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted">
        <Bot className="h-3.5 w-3.5" />
      </div>
    )
  }
  return (
    <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground">
      <User className="h-3.5 w-3.5 text-background" />
    </div>
  )
}

/* ── Content bubble ─────────────────────────────────────────────────────── */

interface MessageContentProps extends HTMLAttributes<HTMLDivElement> {
  role: 'user' | 'assistant'
}

export const MessageContent = forwardRef<HTMLDivElement, MessageContentProps>(
  ({ role, className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'max-w-[80%] rounded-lg px-3 py-2 text-sm',
        role === 'user'
          ? 'bg-foreground text-background'
          : 'bg-muted text-foreground',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  ),
)
MessageContent.displayName = 'MessageContent'

/* ── Tool invocation badge ──────────────────────────────────────────────── */

export function MessageToolBadge({ toolName }: { toolName: string }) {
  return (
    <div className="mb-1 rounded bg-background/50 px-2 py-1 text-xs text-muted-foreground">
      <span>Tool: {toolName}</span>
    </div>
  )
}

/* ── Streaming cursor ───────────────────────────────────────────────────── */

export function MessageStreamingCursor() {
  return (
    <span className="ml-0.5 inline-block h-[1em] w-0.5 animate-pulse bg-foreground align-text-bottom" />
  )
}

/* ── Render a full UIMessage ────────────────────────────────────────────── */

function getMessageText(message: UIMessage): string {
  return message.parts
    .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
    .map(part => part.text)
    .join('')
}

interface MessageItemProps {
  message: UIMessage
  isStreaming?: boolean
  isLast?: boolean
}

export function MessageItem({ message, isStreaming, isLast }: MessageItemProps) {
  const text = getMessageText(message)
  const isUser = message.role === 'user'
  const isLastAssistant = message.role === 'assistant' && isLast

  return (
    <Message role={isUser ? 'user' : 'assistant'}>
      {!isUser && <MessageAvatar role="assistant" />}
      <MessageContent role={isUser ? 'user' : 'assistant'}>
        {message.parts
          .filter(p => p.type === 'tool-invocation')
          .map((part, i) => {
            const toolName =
              'toolInvocation' in part
                ? (part as unknown as { toolInvocation: { toolName: string } }).toolInvocation.toolName
                : 'unknown'
            return <MessageToolBadge key={i} toolName={toolName} />
          })}
        <p className="whitespace-pre-wrap">
          {text || (isStreaming && isLastAssistant ? '...' : '')}
          {isLastAssistant && isStreaming && text && <MessageStreamingCursor />}
        </p>
      </MessageContent>
      {isUser && <MessageAvatar role="user" />}
    </Message>
  )
}
