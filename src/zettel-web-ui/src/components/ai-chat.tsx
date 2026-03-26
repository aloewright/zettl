import { useRef, useEffect, useCallback, useState } from 'react'
import { useAgent } from 'agents/react'
import { useAgentChat } from '@cloudflare/ai-chat/react'
import type { UIMessage } from 'ai'
import { Send, Mic, MicOff, Paperclip, X, Bot, User, Plug, Square, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useComposioConfig } from '@/hooks/use-composio'
import { toast } from 'sonner'

interface AiChatProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function getMessageText(message: UIMessage): string {
  return message.parts
    .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
    .map(part => part.text)
    .join('')
}

export function AiChat({ open, onOpenChange }: AiChatProps) {
  const [input, setInput] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [attachedFile, setAttachedFile] = useState<{ name: string; dataUrl: string } | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])

  // Composio MCP config
  const { data: composioConfig } = useComposioConfig()

  // Connect to the ChatAgent Durable Object via WebSocket
  const agent = useAgent({
    agent: 'ChatAgent',
  })

  // AI chat hook — manages messages, streaming, tool calls over WebSocket
  const {
    messages,
    sendMessage,
    stop,
    status,
    clearHistory,
  } = useAgentChat({
    agent,
    onToolCall: async ({ toolCall, addToolOutput }) => {
      if (toolCall.toolName === 'getUserTimezone') {
        addToolOutput({
          toolCallId: toolCall.toolCallId,
          output: {
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            localTime: new Date().toLocaleTimeString(),
          },
        })
      }
    },
    onError: (error: Error) => {
      toast.error(`Chat failed: ${error.message}`)
    },
  })

  const isStreaming = status === 'streaming'

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const send = useCallback(() => {
    const text = input.trim()
    if (!text && !attachedFile) return
    if (isStreaming) return

    const content = attachedFile ? `[Attached: ${attachedFile.name}]\n\n${text}` : text
    setInput('')
    setAttachedFile(null)
    sendMessage({ role: 'user', parts: [{ type: 'text', text: content }] })
  }, [input, attachedFile, isStreaming, sendMessage])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const handleFileAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
      toast.error('Only images and PDFs are supported')
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      setAttachedFile({ name: file.name, dataUrl: reader.result as string })
    }
    reader.readAsDataURL(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const toggleRecording = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop()
      setIsRecording(false)
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })

        try {
          const res = await fetch('/api/stt', {
            method: 'POST',
            credentials: 'same-origin',
            body: audioBlob,
            headers: { 'Content-Type': 'audio/webm' },
          })
          if (!res.ok) throw new Error('Transcription failed')
          const data = await res.json() as { text?: string }
          if (data.text) {
            setInput(prev => prev + (prev ? ' ' : '') + data.text)
          }
        } catch {
          toast.error('Voice transcription failed')
        }
      }

      mediaRecorder.start()
      setIsRecording(true)
    } catch {
      toast.error('Microphone access denied')
    }
  }

  if (!open) return null

  return (
    <div className="fixed bottom-20 right-6 z-50 flex w-[380px] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl sm:w-[420px]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">AI Chat</span>
          {status === 'streaming' && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" onClick={clearHistory}>
            Clear
          </Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3" style={{ maxHeight: '400px', minHeight: '200px' }}>
        {messages.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Ask anything about your knowledge base, brainstorm ideas, or get help thinking through concepts.
          </p>
        )}
        {messages.map((msg: UIMessage, index: number) => {
          const text = getMessageText(msg)
          const isUser = msg.role === 'user'
          const isLastAssistant = msg.role === 'assistant' && index === messages.length - 1
          return (
            <div key={msg.id} className={`mb-3 flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
              {!isUser && (
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted">
                  <Bot className="h-3.5 w-3.5" />
                </div>
              )}
              <div
                className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                  isUser
                    ? 'bg-foreground text-background'
                    : 'bg-muted text-foreground'
                }`}
              >
                {/* Render tool invocations */}
                {msg.parts
                  .filter(p => p.type === 'tool-invocation')
                  .map((part, i) => (
                    <div key={i} className="mb-1 rounded bg-background/50 px-2 py-1 text-xs text-muted-foreground">
                      {'toolInvocation' in part && (
                        <span>Tool: {(part as unknown as { toolInvocation: { toolName: string } }).toolInvocation.toolName}</span>
                      )}
                    </div>
                  ))}
                <p className="whitespace-pre-wrap">
                  {text || (isStreaming && isLastAssistant ? '...' : '')}
                  {isLastAssistant && isStreaming && text && (
                    <span className="ml-0.5 inline-block h-[1em] w-0.5 animate-pulse bg-foreground align-text-bottom" />
                  )}
                </p>
              </div>
              {isUser && (
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground">
                  <User className="h-3.5 w-3.5 text-background" />
                </div>
              )}
            </div>
          )
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Attached file indicator */}
      {attachedFile && (
        <div className="mx-4 mb-2 flex items-center gap-2 rounded-md bg-muted px-3 py-1.5 text-xs">
          <Paperclip className="h-3 w-3 shrink-0" />
          <span className="truncate">{attachedFile.name}</span>
          <button onClick={() => setAttachedFile(null)} className="ml-auto shrink-0 text-muted-foreground hover:text-foreground">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Input area */}
      <div className="border-t border-border p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            send()
          }}
          className="flex items-end gap-2"
        >
          <div className="flex gap-1">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              onChange={handleFileAttach}
              className="hidden"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-muted-foreground"
              onClick={() => fileInputRef.current?.click()}
              title="Attach image or PDF"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={`h-8 w-8 p-0 ${isRecording ? 'text-red-500' : 'text-muted-foreground'}`}
              onClick={toggleRecording}
              title={isRecording ? 'Stop recording' : 'Voice input'}
            >
              {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </Button>
            {composioConfig?.enabled && (
              <span className="flex h-8 w-8 items-center justify-center text-green-500" title="MCP tools active">
                <Plug className="h-4 w-4" />
              </span>
            )}
          </div>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything..."
            rows={1}
            className="flex-1 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            style={{ maxHeight: '100px' }}
          />
          {isStreaming ? (
            <Button type="button" size="sm" className="h-8 w-8 p-0" variant="destructive" onClick={stop}>
              <Square className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="sm"
              className="h-8 w-8 p-0"
              disabled={!input.trim() && !attachedFile}
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </form>
      </div>
    </div>
  )
}
