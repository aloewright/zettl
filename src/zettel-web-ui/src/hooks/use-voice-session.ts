import { useCallback, useEffect, useRef, useState } from 'react'

export type VoiceState =
  | 'checking'   // initial health check in-flight
  | 'unavailable'
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'error'

export interface Citation {
  id: string
  title: string
}

export interface TranscriptEntry {
  role: 'user' | 'assistant'
  text: string
}

export interface UseVoiceSessionReturn {
  state: VoiceState
  citations: Citation[]
  transcript: TranscriptEntry[]
  errorMessage: string | null
  connect: () => void
  disconnect: () => void
}

// In dev: set VITE_VOICE_SERVICE_URL=http://localhost:8000 in .env.local
// In production (traefik): leave unset — defaults to same-origin /voice-service routing
const VOICE_SERVICE_BASE =
  (import.meta.env.VITE_VOICE_SERVICE_URL as string | undefined) ?? ''

function healthUrl(): string {
  return VOICE_SERVICE_BASE ? `${VOICE_SERVICE_BASE}/health` : '/voice-service/health'
}

function wsUrl(): string {
  if (VOICE_SERVICE_BASE) {
    return VOICE_SERVICE_BASE.replace(/^http/, 'ws') + '/ws'
  }
  // Same-origin relative WebSocket (works through traefik /voice-service proxy)
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/voice-service/ws`
}

export function useVoiceSession(): UseVoiceSessionReturn {
  const [state, setState] = useState<VoiceState>('checking')
  const [citations, setCitations] = useState<Citation[]>([])
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const stateRef = useRef<VoiceState>(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  // Refs for cleanup — we don't want stale closures triggering re-renders
  const wsRef = useRef<WebSocket | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const animFrameRef = useRef<number | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)

  // Tracks the end time of the last scheduled audio buffer so frames
  // are chained sequentially rather than all playing at currentTime
  const nextPlayTimeRef = useRef(0)

  // VAD state tracked via refs (not state) to avoid re-render noise
  const isSpeakingRef = useRef(false)
  const speechStartRef = useRef<number>(0)
  const silenceStartRef = useRef<number>(0)

  // ── Health check on mount ─────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false

    async function checkHealth() {
      try {
        const res = await fetch(healthUrl())
        if (!cancelled) {
          setState(res.ok ? 'idle' : 'unavailable')
        }
      } catch {
        if (!cancelled) setState('unavailable')
      }
    }

    checkHealth()

    return () => {
      cancelled = true
    }
  }, [])

  // ── Cleanup helper ────────────────────────────────────────────────────────

  const cleanup = useCallback(() => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = null
    }

    if (processorRef.current) {
      processorRef.current.disconnect()
      processorRef.current = null
    }

    if (analyserRef.current) {
      analyserRef.current.disconnect()
      analyserRef.current = null
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }

    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    if (audioCtxRef.current) {
      audioCtxRef.current.close()
      audioCtxRef.current = null
    }

    isSpeakingRef.current = false
    nextPlayTimeRef.current = 0
  }, [])

  // ── Unmount cleanup ───────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      cleanup()
    }
  }, [cleanup])

  // ── Audio playback ────────────────────────────────────────────────────────

  const playPcmFrame = useCallback((data: ArrayBuffer) => {
    const ctx = audioCtxRef.current
    if (!ctx) return

    const int16 = new Int16Array(data)
    const float32 = new Float32Array(int16.length)
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768
    }

    const buffer = ctx.createBuffer(1, float32.length, 16000)
    buffer.copyToChannel(float32, 0)

    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    // Chain buffers sequentially: start each frame after the previous one ends
    const startTime = Math.max(ctx.currentTime, nextPlayTimeRef.current)
    source.start(startTime)
    nextPlayTimeRef.current = startTime + buffer.duration
  }, [])

  // ── Connect ───────────────────────────────────────────────────────────────

  const connect = useCallback(async () => {
    // Prevent double-connect race: if already in an active session, ignore the call
    if (stateRef.current === 'listening' || stateRef.current === 'thinking' || stateRef.current === 'speaking') return

    // Re-check health if currently unavailable (Retry button path)
    if (stateRef.current === 'unavailable' || stateRef.current === 'error') {
      try {
        const res = await fetch(healthUrl())
        if (!res.ok) {
          setState('unavailable')
          return
        }
      } catch {
        setState('unavailable')
        return
      }
    }

    cleanup()
    setState('connecting')
    setErrorMessage(null)
    setCitations([])
    setTranscript([])

    // Open AudioContext
    const audioCtx = new AudioContext()
    audioCtxRef.current = audioCtx

    // Request microphone
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      setState('error')
      setErrorMessage('Microphone access denied.')
      audioCtx.close()
      audioCtxRef.current = null
      return
    }
    streamRef.current = stream

    // Open WebSocket
    const ws = new WebSocket(wsUrl())
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws

    ws.onopen = () => {
      setState('listening')
    }

    ws.onclose = () => {
      // Only transition to idle if we were in an active state (not already in error/unavailable)
      setState((prev) =>
        prev === 'listening' || prev === 'thinking' || prev === 'speaking' ? 'idle' : prev,
      )
      cleanup()
    }

    ws.onerror = () => {
      setState('error')
      setErrorMessage('WebSocket connection error.')
      cleanup()
    }

    ws.onmessage = (evt) => {
      if (evt.data instanceof ArrayBuffer) {
        playPcmFrame(evt.data)
        return
      }

      // Text JSON events
      try {
        const msg = JSON.parse(evt.data as string) as {
          type: string
          state?: string
          notes?: Citation[]
          role?: 'user' | 'assistant'
          text?: string
          message?: string
        }

        switch (msg.type) {
          case 'status':
            if (
              msg.state === 'listening' ||
              msg.state === 'thinking' ||
              msg.state === 'speaking'
            ) {
              setState(msg.state)
            }
            break
          case 'citations':
            if (msg.notes) {
              // Append new citations — the Python service deduplicates by ID server-side,
              // but each emission is only the new batch, so we accumulate on the client
              setCitations((prev) => [...prev, ...msg.notes!])
            }
            break
          case 'transcript':
            if (msg.role && msg.text) {
              setTranscript((prev) => [...prev, { role: msg.role!, text: msg.text! }])
            }
            break
          case 'error':
            setState('error')
            setErrorMessage(msg.message ?? 'Unknown error from voice service.')
            break
        }
      } catch {
        // Non-JSON text frame — ignore
      }
    }

    // ── VAD + microphone capture ───────────────────────────────────────────

    const source = audioCtx.createMediaStreamSource(stream)
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 512
    analyserRef.current = analyser
    source.connect(analyser)

    const browserSampleRate = audioCtx.sampleRate
    const TARGET_RATE = 16000
    const BUFFER_SIZE = 4096

    if (typeof audioCtx.createScriptProcessor !== 'function') {
      setState('error')
      setErrorMessage('Your browser does not support the required audio API. Please use a recent version of Chrome or Firefox.')
      streamRef.current?.getTracks().forEach(t => t.stop())
      audioCtx.close()
      audioCtxRef.current = null
      streamRef.current = null
      wsRef.current?.close()
      return
    }
    // TODO: migrate to AudioWorkletNode — ScriptProcessorNode is deprecated (https://developer.mozilla.org/en-US/docs/Web/API/ScriptProcessorNode)

    const processor = audioCtx.createScriptProcessor(BUFFER_SIZE, 1, 1)
    processorRef.current = processor
    source.connect(processor)
    // ScriptProcessorNode requires a destination connection to fire onaudioprocess,
    // but we must not output the raw mic to speakers. Route through a muted gain node.
    const silentSink = audioCtx.createGain()
    silentSink.gain.value = 0
    processor.connect(silentSink)
    silentSink.connect(audioCtx.destination)

    processor.onaudioprocess = (e) => {
      if (!isSpeakingRef.current) return
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return

      const inputData = e.inputBuffer.getChannelData(0)

      // Simple downsampling: average groups of samples
      const ratio = browserSampleRate / TARGET_RATE
      const outputLength = Math.floor(inputData.length / ratio)
      const downsampled = new Float32Array(outputLength)

      for (let i = 0; i < outputLength; i++) {
        const start = Math.floor(i * ratio)
        const end = Math.floor((i + 1) * ratio)
        let sum = 0
        for (let j = start; j < end; j++) {
          sum += inputData[j]
        }
        downsampled[i] = sum / (end - start)
      }

      // Convert to Int16
      const int16 = new Int16Array(outputLength)
      for (let i = 0; i < outputLength; i++) {
        const clamped = Math.max(-1, Math.min(1, downsampled[i]))
        int16[i] = clamped * 32767
      }

      wsRef.current.send(int16.buffer)
    }

    // VAD poll loop
    const freqData = new Uint8Array(analyser.frequencyBinCount)
    const VAD_THRESHOLD = 20 / 255
    const SPEECH_ONSET_MS = 150
    const SILENCE_TRAIL_MS = 800

    function vadLoop() {
      analyser.getByteFrequencyData(freqData)

      // RMS
      let sumSq = 0
      for (let i = 0; i < freqData.length; i++) {
        const norm = freqData[i] / 255
        sumSq += norm * norm
      }
      const rms = Math.sqrt(sumSq / freqData.length)

      const now = performance.now()

      if (rms > VAD_THRESHOLD) {
        if (!isSpeakingRef.current) {
          if (speechStartRef.current === 0) {
            speechStartRef.current = now
          } else if (now - speechStartRef.current >= SPEECH_ONSET_MS) {
            isSpeakingRef.current = true
            silenceStartRef.current = 0
          }
        } else {
          // Reset silence timer while still talking
          silenceStartRef.current = 0
        }
      } else {
        // Below threshold
        speechStartRef.current = 0
        if (isSpeakingRef.current) {
          if (silenceStartRef.current === 0) {
            silenceStartRef.current = now
          } else if (now - silenceStartRef.current >= SILENCE_TRAIL_MS) {
            isSpeakingRef.current = false
            silenceStartRef.current = 0
          }
        }
      }

      animFrameRef.current = requestAnimationFrame(vadLoop)
    }

    animFrameRef.current = requestAnimationFrame(vadLoop)
  }, [cleanup, playPcmFrame])

  // ── Disconnect ────────────────────────────────────────────────────────────

  const disconnect = useCallback(() => {
    cleanup()
    setState('idle')
  }, [cleanup])

  return {
    state,
    citations,
    transcript,
    errorMessage,
    connect,
    disconnect,
  }
}
