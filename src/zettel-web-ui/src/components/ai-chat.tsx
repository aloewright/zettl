import { useRef, useEffect, useCallback, useState } from 'react'
import { useAgent } from 'agents/react'
import { useAgentChat } from '@cloudflare/ai-chat/react'
import type { UIMessage } from 'ai'
import { Bot, X, Plug, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Conversation,
  ConversationEmptyState,
  MessageItem,
  PromptInput,
  PromptInputTextarea,
  PromptInputTools,
  PromptInputSubmit,
  PromptInputAttach,
  PromptInputVoice,
  PromptInputAttachment,
} from '@/components/ai-elements'
import { useComposioConfig } from '@/hooks/use-composio'
import { toast } from 'sonner'

interface AiChatProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AiChat({ open, onOpenChange }: AiChatProps) {
  const [input, setInput] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [attachedFile, setAttachedFile] = useState<{ name: string; dataUrl: string } | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
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

  const handleFileAttach = (file: File) => {
    if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
      toast.error('Only images and PDFs are supported')
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      setAttachedFile({ name: file.name, dataUrl: reader.result as string })
    }
    reader.readAsDataURL(file)
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
      <Conversation>
        {messages.length === 0 && <ConversationEmptyState />}
        {messages.map((msg: UIMessage, index: number) => (
          <MessageItem
            key={msg.id}
            message={msg}
            isStreaming={isStreaming}
            isLast={index === messages.length - 1}
          />
        ))}
      </Conversation>

      {/* Attached file indicator */}
      {attachedFile && (
        <PromptInputAttachment
          name={attachedFile.name}
          onRemove={() => setAttachedFile(null)}
        />
      )}

      {/* Input area */}
      <PromptInput onSubmit={send}>
        <PromptInputTools>
          <PromptInputAttach onAttach={handleFileAttach} />
          <PromptInputVoice isRecording={isRecording} onToggle={toggleRecording} />
          {composioConfig?.enabled && (
            <span className="flex h-8 w-8 items-center justify-center text-green-500" title="MCP tools active">
              <Plug className="h-4 w-4" />
            </span>
          )}
        </PromptInputTools>
        <PromptInputTextarea
          ref={inputRef}
          value={input}
          onChange={setInput}
          onKeyDown={handleKeyDown}
        />
        <PromptInputSubmit
          status={isStreaming ? 'streaming' : 'ready'}
          disabled={!input.trim() && !attachedFile}
          onStop={stop}
        />
      </PromptInput>
    </div>
  )
}
