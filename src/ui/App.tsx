import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight, AudioLines, ChevronDown, ChevronRight, CircleHelp,
  LoaderCircle, Mic, MicOff, Minus, Square, Settings2, ShieldCheck, Sparkles,
  Volume2, VolumeX, X
} from 'lucide-react'
import type { ActionTrace, AssistantActivity, AssistantSettings, OllamaMessage, PendingApiAction, PendingChange } from '../shared'
import { apiTools, enabledTools } from './agent-tools'
import { ChatText, decodeForWhisper, plainTextForSpeech } from './formatting'
import { ActionTraceCard, ChangeCard, FloatingButton, SettingsPanel, SpeechBubble, assistantSystemPrompt } from './components'

type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string; change?: PendingChange; trace?: ActionTrace; apiAction?: PendingApiAction }

function ChatApp() {
  const [settings, setSettings] = useState<AssistantSettings | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [wakeHeard, setWakeHeard] = useState(false)
  const [voiceStatus, setVoiceStatus] = useState('')
  const [voiceError, setVoiceError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [error, setError] = useState('')
  const [modelReady, setModelReady] = useState<boolean | null>(null)
  const [busyChange, setBusyChange] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const pendingBubbleChangesRef = useRef<PendingChange[]>([])
  // Generation IDs invalidate callbacks from recordings stopped or replaced while async decoding is in flight.
  const activeRef = useRef(false)
  const discardClipRef = useRef(false)
  const recordingGenerationRef = useRef(0)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const speechChunksRef = useRef<Blob[]>([])
  const segmentTimerRef = useRef<number | undefined>(undefined)
  const silenceCheckRef = useRef<number | undefined>(undefined)
  const meterContextRef = useRef<AudioContext | null>(null)
  const meterAnalyserRef = useRef<AnalyserNode | null>(null)
  const meterSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const meterSamplesRef = useRef<Float32Array<ArrayBuffer> | null>(null)
  const segmentSpeechRef = useRef(false)
  const speechStartedAtRef = useRef(0)
  const silentSinceRef = useRef<number | null>(null)
  const wakeCommandPendingRef = useRef(false)
  const wakeCommandTimeoutRef = useRef<number | undefined>(undefined)
  const activeChatRequestRef = useRef<string | null>(null)
  const cancelledChatRequestsRef = useRef(new Set<string>())
  const speechBusyRef = useRef(false)
  const settingsRef = useRef<AssistantSettings | null>(settings)
  const sendRef = useRef<(text: string) => Promise<void>>(async () => {})
  const messageHistory = useRef<OllamaMessage[]>([{ role: 'system', content: '' }])
  settingsRef.current = settings

  useEffect(() => {
    if (typeof window.desktop !== 'object') {
      setError('The Nova desktop bridge is unavailable. Open the Electron app (not the Vite page in a browser), and restart it after closing any older Nova windows.')
      return
    }
    void window.desktop.getSettings().then((loaded) => {
      setSettings(loaded)
      messageHistory.current[0].content = assistantSystemPrompt(loaded)
      void window.desktop.listModels(loaded.ollamaUrl)
        .then((models) => setModelReady(models.includes(loaded.model) || models.some((model) => model.startsWith(`${loaded.model}:`))))
        .catch(() => setModelReady(false))
      void window.desktop.preloadSpeechModel()
        .then(() => setVoiceStatus((status) => status.startsWith('Preparing Whisper') || status.startsWith('Downloading Whisper model') ? '' : status))
        .catch((reason) => {
          setVoiceError(reason instanceof Error ? reason.message : 'Could not preload the local speech model.')
          setVoiceStatus((status) => status.startsWith('Preparing Whisper') || status.startsWith('Downloading Whisper model') ? '' : status)
        })
    }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load settings'))
  }, [])

  useEffect(() => window.desktop.onChangeResolved(({ id, action }) => {
    pendingBubbleChangesRef.current = pendingBubbleChangesRef.current.filter((change) => change.id !== id)
    setMessages((old) => old.map((message) => message.change?.id === id
      ? { ...message, content: action === 'approved'
        ? `Confirmed. ${message.change.operation} completed for ${message.change.path}.`
        : `Proposal denied. No changes were made to ${message.change.path}.`, change: undefined }
      : message))
  }), [])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages, busy])

  useEffect(() => {
    const activity: AssistantActivity = wakeHeard
      ? 'wake-heard'
      : transcribing
        ? 'recognizing'
      : busy
        ? 'thinking'
        : speaking
          ? 'speaking'
          : listening
            ? 'listening'
            : 'idle'
    window.desktop.publishAssistantActivity(activity)
  }, [busy, listening, speaking, transcribing, wakeHeard])

  const say = useCallback((text: string) => {
    if (!settings?.speakReplies || !('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    const speechText = plainTextForSpeech(text)
    if (!speechText) return
    const utterance = new SpeechSynthesisUtterance(speechText)
    utterance.rate = settings.speechRate
    utterance.onstart = () => setSpeaking(true)
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => setSpeaking(false)
    const voice = window.speechSynthesis.getVoices().find((item) => item.voiceURI === settings.speechVoice)
    if (voice) utterance.voice = voice
    window.speechSynthesis.speak(utterance)
  }, [settings?.speakReplies, settings?.speechRate, settings?.speechVoice])

  const interrupt = useCallback(() => {
    const requestId = activeChatRequestRef.current
    if (requestId) {
      cancelledChatRequestsRef.current.add(requestId)
      activeChatRequestRef.current = null
      window.desktop.cancelChat(requestId)
      setBusy(false)
    }
    window.speechSynthesis?.cancel()
    setSpeaking(false)
  }, [])

  const interruptSpeechForVoiceInput = useCallback(() => {
    if (!settingsRef.current?.interruptSpeechOnVoiceInput) return
    window.speechSynthesis?.cancel()
    setSpeaking(false)
  }, [])

  const send = useCallback(async (rawText: string) => {
    const text = rawText.trim()
    if (!text || !settings || busy) return
    const requestId = crypto.randomUUID()
    setWakeHeard(false)
    activeChatRequestRef.current = requestId
    const previousHistory = messageHistory.current
    setInput('')
    setError('')
    setBusy(true)
    setMessages((old) => [...old, { id: crypto.randomUUID(), role: 'user', content: text }])
    const history = [...messageHistory.current, { role: 'user' as const, content: text }]
    messageHistory.current = history
    try {
      const availableTools: object[] = enabledTools(settings)
      if (settings.apiAccessEnabled) availableTools.push(...apiTools(settings.apiIntegrations))
      let response = await window.desktop.chat(requestId, settings.ollamaUrl, settings.model, history, availableTools)
      if (cancelledChatRequestsRef.current.has(requestId)) return
      history.push(response)
      // Each model round may request tools; the turn cap prevents unbounded action loops.
      for (let turn = 0; response.tool_calls?.length && turn < 5; turn += 1) {
        for (const call of response.tool_calls) {
          if (cancelledChatRequestsRef.current.has(requestId)) return
          const traceId = crypto.randomUUID()
          const actionArguments = call.function.arguments ?? {}
          setMessages((old) => [...old, {
            id: traceId, role: 'assistant', content: '',
            trace: { name: call.function.name, arguments: actionArguments, status: 'running', result: '' }
          }])
          try {
            const outcome = await window.desktop.runTool(call.function.name, actionArguments)
            history.push({ role: 'tool', content: outcome.result })
            setMessages((old) => old.map((message) => message.id === traceId
              ? { ...message, trace: { ...message.trace!, status: outcome.apiAction ? 'pending' : 'succeeded', result: outcome.result }, apiAction: outcome.apiAction }
              : message))
            if (outcome.change) {
              pendingBubbleChangesRef.current = [...pendingBubbleChangesRef.current, outcome.change]
              setMessages((old) => [...old, { id: crypto.randomUUID(), role: 'assistant', content: 'I’ve prepared this file change for your review. The original is still untouched.', change: outcome.change }])
            }
            if (cancelledChatRequestsRef.current.has(requestId)) return
          } catch (reason) {
            const detail = reason instanceof Error ? reason.message : 'Action failed'
            setMessages((old) => old.map((message) => message.id === traceId
              ? { ...message, trace: { ...message.trace!, status: 'failed', result: detail } }
              : message))
            history.push({ role: 'tool', content: `Action failed: ${detail}` })
          }
        }
        if (cancelledChatRequestsRef.current.has(requestId)) return
        response = await window.desktop.chat(requestId, settings.ollamaUrl, settings.model, history, availableTools)
        if (cancelledChatRequestsRef.current.has(requestId)) return
        history.push(response)
      }
      if (cancelledChatRequestsRef.current.has(requestId)) return
      if (response.tool_calls?.length) throw new Error('The model reached the five-step action limit. Try breaking the request into smaller steps.')
      messageHistory.current = history
      const content = response.content || 'Done.'
      setMessages((old) => [...old, { id: crypto.randomUUID(), role: 'assistant', content }])
      window.desktop.publishBubble(content, pendingBubbleChangesRef.current)
      say(content)
    } catch (reason) {
      if (cancelledChatRequestsRef.current.has(requestId)) {
        messageHistory.current = previousHistory
        return
      }
      const detail = reason instanceof Error ? reason.message : 'Could not reach the model'
      setError(detail)
      setMessages((old) => [...old, { id: crypto.randomUUID(), role: 'assistant', content: `I couldn’t complete that: ${detail}` }])
    } finally {
      if (cancelledChatRequestsRef.current.has(requestId)) messageHistory.current = previousHistory
      cancelledChatRequestsRef.current.delete(requestId)
      if (activeChatRequestRef.current === requestId) {
        activeChatRequestRef.current = null
        setBusy(false)
      }
    }
  }, [busy, say, settings])
  sendRef.current = send

  const resolveApiAction = async (id: string, approve: boolean) => {
    const result = await window.desktop.resolveApiAction(id, approve)
    setMessages((old) => old.map((message) => message.apiAction?.id === id
      ? {
        ...message,
        apiAction: undefined,
        trace: { ...message.trace!, status: approve ? 'succeeded' : 'denied', result }
      }
      : message))
    return result
  }

  // Decoding/transcription may outlive a recording session; check its generation before acting on results.
  const transcribeClip = useCallback(async (blob: Blob, wakeMode: boolean, generation: number) => {
    if (discardClipRef.current || generation !== recordingGenerationRef.current || !blob.size) return
    if (speechBusyRef.current) {
      setVoiceError('Nova is still transcribing the previous recording. Please wait a moment.')
      return
    }
    speechBusyRef.current = true
    setTranscribing(true)
    setVoiceError('')
    setVoiceStatus('Preparing audio for local transcription…')
    try {
      const audio = await decodeForWhisper(blob)
      let peak = 0
      let energy = 0
      for (let i = 0; i < audio.length; i += 1) {
        const sample = Math.abs(audio[i])
        peak = Math.max(peak, sample)
        energy += sample * sample
      }
      const rms = Math.sqrt(energy / audio.length)
      if (peak < 0.008 || rms < 0.0015) {
        throw new Error('The recording is too quiet. Check the selected microphone and its input level in Windows Sound settings.')
      }
      setVoiceStatus('Recognizing speech locally…')
      const transcript = (await window.desktop.transcribeSpeech(audio, settingsRef.current?.speechLanguage || 'de-DE')).trim()
      if (discardClipRef.current || generation !== recordingGenerationRef.current) return
      if (!transcript) throw new Error('Whisper did not detect speech. Try speaking clearly and a little closer to the microphone.')
      if (wakeMode) {
        if (!activeRef.current) return
        const normalize = (text: string) => text.toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
        const phrase = normalize(settingsRef.current?.wakeWord || 'hey nova').split(' ')
        const words = transcript.trim().split(/\s+/)
        const wakeAt = words.findIndex((_word, index) => phrase.every((part, offset) => normalize(words[index + offset] ?? '') === part))
        if (wakeAt >= 0) {
          setWakeHeard(true)
          window.desktop.publishAssistantActivity('wake-heard')
          interruptSpeechForVoiceInput()
        }
        if (wakeCommandPendingRef.current) {
          wakeCommandPendingRef.current = false
          if (wakeCommandTimeoutRef.current !== undefined) window.clearTimeout(wakeCommandTimeoutRef.current)
          wakeCommandTimeoutRef.current = undefined
          const command = wakeAt >= 0
            ? words.slice(wakeAt + phrase.length).join(' ').trim()
            : transcript
          if (command) {
            if (wakeAt < 0) interruptSpeechForVoiceInput()
            void sendRef.current(command)
          }
          else setVoiceStatus('Wake phrase heard. What can I do for you?')
        } else if (wakeAt >= 0) {
          const command = words.slice(wakeAt + phrase.length).join(' ').replace(/^[^\p{L}\p{N}]+/u, '').trim()
          if (command) void sendRef.current(command)
          else {
            wakeCommandPendingRef.current = true
            wakeCommandTimeoutRef.current = window.setTimeout(() => {
              wakeCommandPendingRef.current = false
              wakeCommandTimeoutRef.current = undefined
              setWakeHeard(false)
              if (activeRef.current) setVoiceStatus(`Listening for “${settingsRef.current?.wakeWord || 'hey nova'}”…`)
            }, 12_000)
            setVoiceStatus('Wake phrase heard. Say your request…')
          }
        }
      } else {
        setInput(transcript)
        setVoiceStatus('')
        interruptSpeechForVoiceInput()
        void sendRef.current(transcript)
      }
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : 'Could not transcribe the recording.'
      const silence = detail.startsWith('The recording is too quiet') || detail.startsWith('Whisper did not detect speech')
      if (!discardClipRef.current && !(wakeMode && silence)) {
        setVoiceError(detail)
        if (wakeMode) activeRef.current = false
      }
    } finally {
      speechBusyRef.current = false
      setTranscribing(false)
      if (wakeMode && activeRef.current) {
        setVoiceStatus(wakeCommandPendingRef.current
          ? 'Wake phrase heard. Say your request…'
          : `Listening for “${settingsRef.current?.wakeWord || 'hey nova'}”…`)
      } else setVoiceStatus('')
    }
  }, [interruptSpeechForVoiceInput])

  // Wake mode reuses the same microphone stream in short segments to bound latency and memory use.
  const startSegment = useCallback((stream: MediaStream, wakeMode: boolean) => {
    const generation = recordingGenerationRef.current
    const recorderStartedAt = performance.now()
    speechChunksRef.current = []
    segmentSpeechRef.current = false
    speechStartedAtRef.current = 0
    silentSinceRef.current = null
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : ''
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
    mediaRecorderRef.current = recorder
    recorder.ondataavailable = (event) => {
      if (event.data.size) speechChunksRef.current.push(event.data)
    }
    recorder.onstop = () => {
      const ownsCurrentRecording = mediaRecorderRef.current === recorder
      if (ownsCurrentRecording) {
        mediaRecorderRef.current = null
        if (segmentTimerRef.current !== undefined) window.clearTimeout(segmentTimerRef.current)
        segmentTimerRef.current = undefined
        if (silenceCheckRef.current !== undefined) window.clearInterval(silenceCheckRef.current)
        silenceCheckRef.current = undefined
      }
      const clip = new Blob(speechChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
      speechChunksRef.current = []
      if (generation !== recordingGenerationRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        if (mediaStreamRef.current === stream) mediaStreamRef.current = null
        return
      }
      if (discardClipRef.current) {
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
        mediaStreamRef.current = null
        return
      }
      if (wakeMode && !segmentSpeechRef.current) {
        if (activeRef.current && mediaStreamRef.current === stream) startSegment(stream, true)
        return
      }
      void transcribeClip(clip, wakeMode, generation).finally(() => {
        if (generation !== recordingGenerationRef.current) return
        if (wakeMode && activeRef.current && mediaStreamRef.current) {
          startSegment(mediaStreamRef.current, true)
        } else {
          mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
          mediaStreamRef.current = null
          meterSourceRef.current?.disconnect()
          meterSourceRef.current = null
          meterAnalyserRef.current?.disconnect()
          meterAnalyserRef.current = null
          void meterContextRef.current?.close()
          meterContextRef.current = null
          meterSamplesRef.current = null
          setListening(false)
        }
      })
    }
    recorder.onerror = (event) => {
      setVoiceError(event.error.message || 'The microphone recording failed.')
      activeRef.current = false
      recorder.stop()
    }
    recorder.start()
    const analyser = meterAnalyserRef.current
    const samples = meterSamplesRef.current
    if (analyser && samples) {
      silenceCheckRef.current = window.setInterval(() => {
        if (recorder.state !== 'recording') return
        analyser.getFloatTimeDomainData(samples)
        let energy = 0
        for (let i = 0; i < samples.length; i += 1) energy += samples[i] * samples[i]
        const rms = Math.sqrt(energy / samples.length)
        const now = performance.now()
        if (!segmentSpeechRef.current) {
          if (rms > 0.012) {
            if (!speechStartedAtRef.current) speechStartedAtRef.current = now
            if (now - speechStartedAtRef.current >= 180) segmentSpeechRef.current = true
          } else speechStartedAtRef.current = 0
          if (wakeMode && now - recorderStartedAt >= 10_000 && !segmentSpeechRef.current) recorder.stop()
          return
        }
        if (rms > 0.006) silentSinceRef.current = null
        else if (silentSinceRef.current === null) silentSinceRef.current = now
        const silenceDuration = wakeMode ? 1_800 : 900
        if (silentSinceRef.current !== null && now - silentSinceRef.current >= silenceDuration && now - speechStartedAtRef.current >= 1_100) {
          setVoiceStatus(wakeMode ? 'Checking for the wake phrase…' : 'Speech ended. Transcribing locally…')
          recorder.stop()
        }
      }, 100)
    }
    segmentTimerRef.current = window.setTimeout(() => {
      if (recorder.state === 'recording') recorder.stop()
      if (!wakeMode) setVoiceStatus(segmentSpeechRef.current ? 'Maximum recording reached. Transcribing locally…' : 'No speech detected yet. Transcribing local audio…')
    }, wakeMode ? 30_000 : 120_000)
  }, [transcribeClip])

  const stopListening = useCallback((discard = false) => {
    activeRef.current = false
    discardClipRef.current = discard
    if (discard) {
      wakeCommandPendingRef.current = false
      setWakeHeard(false)
      if (wakeCommandTimeoutRef.current !== undefined) window.clearTimeout(wakeCommandTimeoutRef.current)
      wakeCommandTimeoutRef.current = undefined
    }
    if (discard) recordingGenerationRef.current += 1
    if (segmentTimerRef.current !== undefined) window.clearTimeout(segmentTimerRef.current)
    segmentTimerRef.current = undefined
    if (silenceCheckRef.current !== undefined) window.clearInterval(silenceCheckRef.current)
    silenceCheckRef.current = undefined
    const recorder = mediaRecorderRef.current
    if (recorder?.state === 'recording') recorder.stop()
    else {
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
      setListening(false)
    }
    if (discard || !recorder || recorder.state !== 'recording') {
      meterSourceRef.current?.disconnect()
      meterSourceRef.current = null
      meterAnalyserRef.current?.disconnect()
      meterAnalyserRef.current = null
      void meterContextRef.current?.close()
      meterContextRef.current = null
      meterSamplesRef.current = null
    }
    if (!discard && recorder) setVoiceStatus('Transcribing locally…')
    if (discard) setListening(false)
  }, [])

  const startListening = useCallback(async (wakeMode = false) => {
    stopListening(true)
    setWakeHeard(false)
    if (!wakeMode) interruptSpeechForVoiceInput()
    discardClipRef.current = false
    const generation = recordingGenerationRef.current
    setVoiceError('')
    setVoiceStatus(wakeMode ? 'Loading local speech recognition…' : 'Starting microphone…')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      if (generation !== recordingGenerationRef.current || discardClipRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      mediaStreamRef.current = stream
      const context = new AudioContext()
      const analyser = context.createAnalyser()
      analyser.fftSize = 2048
      const source = context.createMediaStreamSource(stream)
      source.connect(analyser)
      meterContextRef.current = context
      meterAnalyserRef.current = analyser
      meterSourceRef.current = source
      meterSamplesRef.current = new Float32Array(analyser.fftSize)
      await context.resume()
      if (generation !== recordingGenerationRef.current || discardClipRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        source.disconnect()
        analyser.disconnect()
        await context.close()
        return
      }
      activeRef.current = true
      setListening(true)
      setVoiceStatus(wakeMode ? `Listening for “${settingsRef.current?.wakeWord || 'hey nova'}”…` : 'Listening… I’ll transcribe when you pause.')
      startSegment(stream, wakeMode)
    } catch (reason) {
      setListening(false)
      activeRef.current = false
      setVoiceStatus('')
      setVoiceError(reason instanceof Error ? reason.message : 'Could not access the microphone.')
    }
  }, [interruptSpeechForVoiceInput, startSegment, stopListening])

  useEffect(() => {
    if (settings?.wakeWordEnabled) startListening(true)
    return () => {
      stopListening(true)
      window.speechSynthesis?.cancel()
    }
  }, [settings?.wakeWordEnabled, settings?.wakeWord, startListening, stopListening])

  useEffect(() => {
    const unsubscribeProgress = window.desktop.onSpeechProgress((progress) => {
      if (progress.status === 'progress' && typeof progress.progress === 'number') {
        const file = progress.file ? ` (${progress.file})` : ''
        setVoiceStatus(`Downloading Whisper model${file}… ${Math.round(progress.progress)}%`)
      } else if (progress.status === 'ready') {
        setVoiceStatus((status) => status.startsWith('Downloading Whisper model') || status.startsWith('Preparing Whisper') ? '' : status)
      } else if (progress.status === 'download') {
        setVoiceStatus('Downloading Whisper Small for local use…')
      } else if (progress.status === 'error') {
        setVoiceError(progress.message || 'Could not load the local speech model.')
        setVoiceStatus((status) => status.startsWith('Preparing Whisper') || status.startsWith('Downloading Whisper model') ? '' : status)
      }
    })
    return unsubscribeProgress
  }, [])

  const saveSettings = async (next: AssistantSettings, credentials: Record<string, string> = {}, clearCredentials: string[] = []) => {
    try {
      const saved = await window.desktop.saveSettings(next)
      setSettings(saved)
      for (const integrationId of clearCredentials) await window.desktop.clearApiCredential(integrationId)
      for (const [integrationId, token] of Object.entries(credentials)) {
        if (next.apiIntegrations.some((integration) => integration.id === integrationId && integration.requiresBearerToken) && token.trim()) {
          await window.desktop.setApiCredential(integrationId, token)
        }
      }
      messageHistory.current[0].content = assistantSystemPrompt(saved)
      setSettingsOpen(false)
      void window.desktop.listModels(saved.ollamaUrl).then((models) => setModelReady(models.includes(saved.model) || models.some((model) => model.startsWith(`${saved.model}:`)))).catch(() => setModelReady(false))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save settings')
      throw reason
    }
  }

  const toggleSpeech = async () => {
    if (!settings) return
    const previous = settings
    const next = { ...settings, speakReplies: !settings.speakReplies }
    setSettings(next)
    if (!next.speakReplies) {
      window.speechSynthesis?.cancel()
      setSpeaking(false)
    }
    try {
      setSettings(await window.desktop.saveSettings(next))
    } catch (reason) {
      setSettings(previous)
      setError(reason instanceof Error ? reason.message : 'Could not update speech output')
    }
  }

  const toggleWakeWord = async () => {
    if (!settings) return
    const previous = settings
    const next = { ...settings, wakeWordEnabled: !settings.wakeWordEnabled }
    setSettings(next)
    try {
      setSettings(await window.desktop.saveSettings(next))
    } catch (reason) {
      setSettings(previous)
      setError(reason instanceof Error ? reason.message : 'Could not update wake phrase listening')
    }
  }

  const updateProposal = async (change: PendingChange, content: string) => {
    try {
      await window.desktop.updateChange(change.id, content)
      change.after = content
      setMessages((old) => old.map((message) => message.change?.id === change.id
        ? { ...message, change: { ...message.change, after: content } }
        : message))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update the proposal')
      throw reason
    }
  }

  const approve = async (change: PendingChange, updatedContent?: string) => {
    setBusyChange(change.id)
    try {
      if (updatedContent !== undefined && updatedContent !== change.after) {
        await window.desktop.updateChange(change.id, updatedContent)
        change.after = updatedContent
      }

      await window.desktop.approveChange(change.id)
      setMessages((old) => old.map((message) => message.change?.id === change.id
        ? { ...message, content: `Confirmed. ${change.operation} completed for ${change.path}.`, change: undefined }
        : message))
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not apply the change') }
    finally { setBusyChange('') }
  }

  const discard = async (change: PendingChange) => {
    setBusyChange(change.id)
    try {
      await window.desktop.discardChange(change.id)
      setMessages((old) => old.map((message) => message.change?.id === change.id
        ? { ...message, content: `Proposal denied. No changes were made to ${change.path}.`, change: undefined }
        : message))
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not discard the change') }
    finally { setBusyChange('') }
  }

  if (typeof window.desktop !== 'object') return <div className="bridge-error">
    <div className="brand-icon"><Sparkles size={18} /></div>
    <h1>Nova needs its desktop bridge</h1>
    <p>{error || 'The app could not connect to Electron.'}</p>
    <small>Close older Nova windows, stop <code>npm run dev</code>, then start it again.</small>
  </div>
  if (!settings) return <div className="loading-screen"><Sparkles size={24} /><span>Starting Nova…</span></div>
  const pendingCount = messages.filter((message) => message.change).length
  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-icon"><Sparkles size={16} /></div><div className="brand-copy"><b>nova</b><span>LOCAL AI INTERFACE</span></div></div>
      <div className="topbar-status"><span className={`status-dot ${modelReady === false ? 'offline' : ''}`} />{modelReady === false ? 'Model offline' : settings.model}</div>
      <div className="window-actions"><button className="icon-button" onClick={() => setSettingsOpen(true)} title="Settings" aria-label="Settings"><Settings2 size={17} /></button><button className="icon-button window-hide" onClick={() => window.desktop.hideAssistant()} title="Hide Nova" aria-label="Hide Nova"><Minus size={17} /></button></div>
    </header>
    <main className="conversation" aria-label="Chat messages">
      {modelReady === false && <button className="connection-notice" onClick={() => setSettingsOpen(true)}><CircleHelp size={16} /><span><b>Can’t find your model.</b> Check Ollama and model settings.</span><ChevronRight size={16} /></button>}
      <div className="date-divider"><span>CHAT</span></div>
      {messages.map((message) => <div className={`message-row ${message.role}`} key={message.id}>
        {message.role === 'assistant' && <div className="avatar"><Sparkles size={13} /></div>}
        <div className="message-stack">
          {message.content && <div className="message-bubble"><ChatText>{message.content}</ChatText></div>}
          {message.trace && <ActionTraceCard trace={message.trace} apiAction={message.apiAction} onResolve={resolveApiAction} />}
          {message.change && <ChangeCard change={message.change} onApprove={(change, content) => void approve(change, content)} onUpdate={updateProposal} onDiscard={(change) => void discard(change)} busy={busyChange === message.change.id} />}
        </div>
      </div>)}
      {busy && <div className="message-row assistant"><div className="avatar"><Sparkles size={13} /></div><div className="message-bubble thinking"><span /><span /><span /></div></div>}
      {error && <div className="inline-error">{error}<button onClick={() => setError('')} aria-label="Dismiss error"><X size={14} /></button></div>}
      <div ref={bottomRef} />
    </main>
    {pendingCount > 0 && <div className="pending-summary"><ShieldCheck size={14} />{pendingCount} file {pendingCount === 1 ? 'change' : 'changes'} awaiting your approval</div>}
    <footer className="composer-area">
      {voiceStatus && <div className="voice-note voice-progress" role="status">{voiceStatus}</div>}
      {voiceError && <div className="voice-note">{voiceError}<button onClick={() => setVoiceError('')} aria-label="Dismiss"><X size={12} /></button></div>}
      <div className="composer">
        <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(input) }
        }} placeholder={listening ? 'Listening…' : 'Message Nova…'} rows={1} aria-label="Message Nova" />
        <div className="composer-actions">
          <div className="composer-tools">
            <button className={`icon-button wake-toggle ${settings.wakeWordEnabled ? 'is-enabled' : ''}`} onClick={() => void toggleWakeWord()} title={settings.wakeWordEnabled ? `Turn off wake phrase “${settings.wakeWord}”` : 'Turn on wake phrase listening'} aria-label={settings.wakeWordEnabled ? 'Turn off wake phrase listening' : 'Turn on wake phrase listening'} aria-pressed={settings.wakeWordEnabled}>
              <AudioLines size={15} />
            </button>
            <button className={`icon-button mic-button ${listening ? 'is-listening' : ''}`} onClick={() => listening ? stopListening() : startListening(false)} disabled={transcribing && !listening} title={listening ? 'Stop recording and transcribe' : transcribing ? 'Transcribing locally…' : 'Speak to Nova'} aria-label={listening ? 'Stop recording and transcribe' : transcribing ? 'Transcribing locally' : 'Speak to Nova'}>
              {listening ? <MicOff size={16} /> : <Mic size={16} />}
            </button>
            <button className={`icon-button speech-toggle ${settings.speakReplies ? '' : 'muted'}`} onClick={() => void toggleSpeech()} title={settings.speakReplies ? 'Turn voice replies off' : 'Turn voice replies on'} aria-label={settings.speakReplies ? 'Turn voice replies off' : 'Turn voice replies on'} aria-pressed={settings.speakReplies}>
              {settings.speakReplies ? <Volume2 size={15} /> : <VolumeX size={15} />}
            </button>
          </div>
          {busy || speaking
            ? <button className="send-button interrupt-button" onClick={interrupt} aria-label="Interrupt Nova" title="Interrupt Nova"><Square size={13} fill="currentColor" /></button>
            : <button className={`send-button ${input.trim() ? 'ready' : ''}`} onClick={() => void send(input)} disabled={!input.trim()} aria-label="Send message"><ArrowUpRight size={17} /></button>}
        </div>
      </div>
      <div className="composer-caption"><span><ShieldCheck size={11} /> Your conversations stay on this device</span>{settings.wakeWordEnabled && <span className="wake-status"><AudioLines size={12} /> “{settings.wakeWord}” active</span>}</div>
    </footer>
    <button className="expand-tab" onClick={() => window.desktop.hideAssistant()} title="Hide assistant"><ChevronDown size={12} /></button>
    {settingsOpen && <SettingsPanel settings={settings} onSave={saveSettings} onClose={() => setSettingsOpen(false)} />}
  </div>
}

export default function App() {
  useEffect(() => {
    let mounted = true
    const applyTheme = (settings: AssistantSettings) => {
      if (!mounted) return
      const root = document.documentElement
      root.dataset.themePreset = settings.themePreset
      root.style.setProperty('--accent-color', settings.accentColor)
      const color = settings.accentColor.slice(1)
      const channels = [0, 2, 4].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255)
      const luminance = channels
        .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
        .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0)
      root.style.setProperty('--accent-contrast', luminance > 0.45 ? '#151714' : '#f6f7f2')
    }
    const unsubscribe = window.desktop.onSettingsUpdated(applyTheme)
    void window.desktop.getSettings().then(applyTheme).catch((reason: unknown) => {
      console.error('Could not apply Nova appearance settings:', reason)
    })
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])
  const view = new URLSearchParams(window.location.search).get('view')
  if (view === 'floating') return <FloatingButton />
  if (view === 'bubble') return <SpeechBubble />
  return <ChatApp />
}
