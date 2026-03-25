import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Mic, MicOff, Paperclip, X, Loader2, Bot, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface AiChatProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AiChat({ open, onOpenChange }: AiChatProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [attachedFile, setAttachedFile] = useState<{ name: string; dataUrl: string } | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const handleSend = async () => {
    const trimmed = input.trim()
    if (!trimmed && !attachedFile) return
    if (isStreaming) return

    const userContent = attachedFile
      ? `[Attached: ${attachedFile.name}]\n\n${trimmed}`
      : trimmed

    const userMessage: Message = { role: 'user', content: userContent }
    const newMessages = [...messages, userMessage]
    setMessages(newMessages)
    setInput('')
    setAttachedFile(null)
    setIsStreaming(true)

    try {
      const systemMessage = {
        role: 'system' as const,
        content: 'You are a helpful AI assistant for a personal Zettelkasten knowledge management system. Help the user think through ideas, answer questions, and suggest connections between concepts. Keep responses concise and useful.',
      }

      const apiMessages = [
        systemMessage,
        ...newMessages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      ]

      const res = await fetch('/api/generate/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ messages: apiMessages, maxTokens: 1500, temperature: 0.7 }),
      })

      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      if (!res.body) throw new Error('No stream body')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let assistantContent = ''

      setMessages(prev => [...prev, { role: 'assistant', content: '' }])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)
          if (data === '[DONE]') continue

          try {
            const parsed = JSON.parse(data)
            const delta = parsed.choices?.[0]?.delta?.content
            if (delta) {
              assistantContent += delta
              setMessages(prev => {
                const updated = [...prev]
                updated[updated.length - 1] = { role: 'assistant', content: assistantContent }
                return updated
              })
            }
          } catch {
            // skip malformed chunks
          }
        }
      }
    } catch (err) {
      toast.error(`Chat failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
      setMessages(prev => prev.filter(m => m.content !== ''))
    } finally {
      setIsStreaming(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
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
          const formData = new FormData()
          formData.append('audio', audioBlob)
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
        </div>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => onOpenChange(false)}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3" style={{ maxHeight: '400px', minHeight: '200px' }}>
        {messages.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Ask anything about your knowledge base, brainstorm ideas, or get help thinking through concepts.
          </p>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`mb-3 flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted">
                <Bot className="h-3.5 w-3.5" />
              </div>
            )}
            <div
              className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                msg.role === 'user'
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-foreground'
              }`}
            >
              <p className="whitespace-pre-wrap">{msg.content || (isStreaming ? '...' : '')}</p>
            </div>
            {msg.role === 'user' && (
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground">
                <User className="h-3.5 w-3.5 text-background" />
              </div>
            )}
          </div>
        ))}
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
        <div className="flex items-end gap-2">
          <div className="flex gap-1">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              onChange={handleFileAttach}
              className="hidden"
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-muted-foreground"
              onClick={() => fileInputRef.current?.click()}
              title="Attach image or PDF"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={`h-8 w-8 p-0 ${isRecording ? 'text-red-500' : 'text-muted-foreground'}`}
              onClick={toggleRecording}
              title={isRecording ? 'Stop recording' : 'Voice input'}
            >
              {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </Button>
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
          <Button
            size="sm"
            className="h-8 w-8 p-0"
            onClick={handleSend}
            disabled={(!input.trim() && !attachedFile) || isStreaming}
          >
            {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  )
}
