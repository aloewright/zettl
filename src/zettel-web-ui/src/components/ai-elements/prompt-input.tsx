import {
  forwardRef,
  useRef,
  type HTMLAttributes,
  type ChangeEvent,
  type KeyboardEvent,
  type FormEvent,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/utils'
import { Send, Square, Paperclip, Mic, MicOff, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

/* ── PromptInput form wrapper ───────────────────────────────────────────── */

interface PromptInputProps extends HTMLAttributes<HTMLFormElement> {
  onSubmit?: () => void
}

export const PromptInput = forwardRef<HTMLFormElement, PromptInputProps>(
  ({ onSubmit, className, children, ...props }, ref) => (
    <form
      ref={ref}
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        onSubmit?.()
      }}
      className={cn('border-t border-border p-3', className)}
      {...props}
    >
      <div className="flex items-end gap-2">{children}</div>
    </form>
  ),
)
PromptInput.displayName = 'PromptInput'

/* ── Textarea ───────────────────────────────────────────────────────────── */

interface PromptInputTextareaProps {
  value: string
  onChange: (value: string) => void
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  placeholder?: string
  autoFocus?: boolean
  className?: string
}

export const PromptInputTextarea = forwardRef<HTMLTextAreaElement, PromptInputTextareaProps>(
  ({ value, onChange, onKeyDown, placeholder = 'Ask anything...', autoFocus, className }, ref) => (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      rows={1}
      autoFocus={autoFocus}
      className={cn(
        'flex-1 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        className,
      )}
      style={{ maxHeight: '100px' }}
    />
  ),
)
PromptInputTextarea.displayName = 'PromptInputTextarea'

/* ── Tools strip (left side buttons) ────────────────────────────────────── */

export function PromptInputTools({ children }: { children: ReactNode }) {
  return <div className="flex gap-1">{children}</div>
}

/* ── Submit / Stop button ───────────────────────────────────────────────── */

interface PromptInputSubmitProps {
  status: 'ready' | 'streaming' | 'submitted'
  disabled?: boolean
  onStop?: () => void
}

export function PromptInputSubmit({ status, disabled, onStop }: PromptInputSubmitProps) {
  if (status === 'streaming') {
    return (
      <Button type="button" size="sm" className="h-8 w-8 p-0" variant="destructive" onClick={onStop}>
        <Square className="h-3.5 w-3.5" />
      </Button>
    )
  }

  if (status === 'submitted') {
    return (
      <Button type="button" size="sm" className="h-8 w-8 p-0" disabled>
        <Loader2 className="h-4 w-4 animate-spin" />
      </Button>
    )
  }

  return (
    <Button type="submit" size="sm" className="h-8 w-8 p-0" disabled={disabled}>
      <Send className="h-4 w-4" />
    </Button>
  )
}

/* ── Attach file button ─────────────────────────────────────────────────── */

interface PromptInputAttachProps {
  accept?: string
  onAttach: (file: File) => void
}

export function PromptInputAttach({ accept = 'image/*,application/pdf', onAttach }: PromptInputAttachProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onAttach(file)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <>
      <input ref={inputRef} type="file" accept={accept} onChange={handleChange} className="hidden" />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0 text-muted-foreground"
        onClick={() => inputRef.current?.click()}
        title="Attach image or PDF"
      >
        <Paperclip className="h-4 w-4" />
      </Button>
    </>
  )
}

/* ── Voice input button ─────────────────────────────────────────────────── */

interface PromptInputVoiceProps {
  isRecording: boolean
  onToggle: () => void
}

export function PromptInputVoice({ isRecording, onToggle }: PromptInputVoiceProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn('h-8 w-8 p-0', isRecording ? 'text-red-500' : 'text-muted-foreground')}
      onClick={onToggle}
      title={isRecording ? 'Stop recording' : 'Voice input'}
    >
      {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
    </Button>
  )
}

/* ── Attachment indicator ───────────────────────────────────────────────── */

interface PromptInputAttachmentProps {
  name: string
  onRemove: () => void
}

export function PromptInputAttachment({ name, onRemove }: PromptInputAttachmentProps) {
  return (
    <div className="mx-4 mb-2 flex items-center gap-2 rounded-md bg-muted px-3 py-1.5 text-xs">
      <Paperclip className="h-3 w-3 shrink-0" />
      <span className="truncate">{name}</span>
      <button
        onClick={onRemove}
        className="ml-auto shrink-0 text-muted-foreground hover:text-foreground"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}
