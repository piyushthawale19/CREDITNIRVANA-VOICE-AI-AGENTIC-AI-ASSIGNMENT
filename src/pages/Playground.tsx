import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowRight, Check, CreditCard, Headphones, Loader2, Mic, Pause, PhoneCall, PhoneOff, Radio, RefreshCw, RotateCcw, Send,
  Settings, ShieldAlert, Square, Volume2, WalletCards,
} from 'lucide-react'
import { api, apiUrl, getStoredToken } from '../api'
import type { Bot, Call, IntegrationStatus, Message, RespondResult, Session } from '../types'
import { Badge, ErrorBanner, LoadingCard, PageHead, botLabel, formatDate, formatDateTime, formatDuration, money, splitFlags } from '../ui'

type Phase = 'idle' | 'connecting' | 'listening' | 'processing' | 'speaking' | 'error'
type Mode = 'text' | 'voice' | 'phone'

const phaseCopy: Record<Phase, string> = {
  idle: 'Idle',
  connecting: 'Connecting…',
  listening: 'Listening',
  processing: 'Processing response…',
  speaking: 'Agent speaking',
  error: 'Error',
}

export default function Playground({ status: initialStatus }: { status: IntegrationStatus | null }) {
  const [liveStatus, setLiveStatus] = useState<IntegrationStatus | null>(initialStatus)
  const status = liveStatus || initialStatus
  const { botId } = useParams<{ botId: string }>()
  const [bot, setBot] = useState<Bot | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [mode, setMode] = useState<Mode>(() => localStorage.getItem('nirvana.defaultMode') === 'voice' ? 'voice' : 'text')
  const [phase, setPhase] = useState<Phase>('idle')
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const [voiceNote, setVoiceNote] = useState('')
  const [recording, setRecording] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [duration, setDuration] = useState(0)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [completing, setCompleting] = useState(false)

  // Real phone call testing state
  const [phoneInput, setPhoneInput] = useState('+919876543210')
  const [phoneCalling, setPhoneCalling] = useState(false)
  const [activePhoneCall, setActivePhoneCall] = useState<Call | null>(null)

  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioUrl = useRef<string | null>(null)
  const transcriptEnd = useRef<HTMLDivElement>(null)
  const startedRef = useRef<number | null>(null)
  const autoplay = useRef(localStorage.getItem('nirvana.autoplay') !== 'false')

  useEffect(() => {
    api<IntegrationStatus>('/api/integrations/status').then(setLiveStatus).catch(() => {})
  }, [])

  useEffect(() => {
    if (!botId) return
    setLoading(true)
    api<Bot>(`/api/bots/${botId}`).then(setBot).catch(err => setError(err instanceof Error ? err.message : 'Unable to load bot.')).finally(() => setLoading(false))
  }, [botId])

  useEffect(() => {
    if (!startedAt) return
    const timer = window.setInterval(() => setDuration(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [startedAt])

  useEffect(() => { transcriptEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [session?.transcript.length, phase])

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach(track => track.stop())
    audioRef.current?.pause()
    if (audioUrl.current) URL.revokeObjectURL(audioUrl.current)
  }, [])

  const voiceAvailable = Boolean(status?.configured)
  const loan = bot?.type === 'loan'
  const completed = Boolean(session?.completedAt)
  const flags = splitFlags(session?.complianceFlags || [])

  async function startSession(nextMode: Mode) {
    if (nextMode === 'voice' && !voiceAvailable) {
      setError('Live voice needs SARVAM_API_KEY on the server. Use text mode, or configure the key and reload.')
      return
    }
    setError(''); setVoiceNote(''); setPhase('connecting')
    try {
      const created = await api<Session>('/api/sessions', { method: 'POST', body: JSON.stringify({ botId, mode: nextMode }) })
      setSession(created); setMode(nextMode); setDuration(0)
      const now = Date.now(); setStartedAt(now); startedRef.current = now
      setPhase(nextMode === 'voice' ? 'listening' : 'idle')
      if (nextMode === 'voice') setVoiceNote('Microphone ready. Hold the mic button, speak, then stop to transcribe with Sarvam.')
    } catch (err) {
      setPhase('error')
      setError(err instanceof Error ? err.message : 'Unable to start a session.')
    }
  }

  function switchMode(nextMode: Mode) {
    setError('')
    setMode(nextMode)
    localStorage.setItem('nirvana.defaultMode', nextMode)
    if (session) {
      setSession(prev => prev ? { ...prev, mode: nextMode } : null)
      if (nextMode === 'voice') {
        if (!voiceAvailable) {
          setError('Live voice needs SARVAM_API_KEY on the server. Configure the key in .env to enable Sarvam voice.')
        } else {
          if (phase === 'idle') setPhase('listening')
          setVoiceNote('Switched to Sarvam voice mode. Tap the mic button to speak.')
        }
      } else {
        stopPlayback()
        if (recording) stopRecording()
        if (phase === 'listening' || phase === 'speaking') setPhase('idle')
        setVoiceNote('')
      }
    }
  }

  function stopPlayback() {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0 }
    if (audioUrl.current) { URL.revokeObjectURL(audioUrl.current); audioUrl.current = null }
  }

  async function speak(text: string) {
    if (!voiceAvailable || !bot) return
    setPhase('speaking')
    try {
      const token = getStoredToken()
      const response = await fetch(apiUrl('/api/voice/speak'), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ text, languageCode: bot.config.language, speaker: bot.config.speaker }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || `Sarvam text-to-speech failed (${response.status}).`)
      }
      const blob = await response.blob()
      stopPlayback()
      const url = URL.createObjectURL(blob)
      audioUrl.current = url
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onended = () => { setPhase('listening'); setVoiceNote('Reply finished. Your turn — hold the mic or type.') }
      await audio.play()
    } catch (err) {
      setPhase('listening')
      setError(err instanceof Error ? err.message : 'Audio playback failed. The text reply is preserved.')
    }
  }

  async function send(text = input) {
    if (!session || !text.trim() || sending || completed) return
    setSending(true); setError(''); setInput(''); setPhase('processing')
    try {
      const result = await api<RespondResult>(`/api/sessions/${session.id}/respond`, { method: 'POST', body: JSON.stringify({ text: text.trim() }) })
      setSession(result.session)
      if (mode === 'voice' && voiceAvailable && autoplay.current) await speak(result.reply)
      else setPhase(mode === 'voice' ? 'listening' : 'idle')
    } catch (err) {
      setPhase('error')
      setError(err instanceof Error ? err.message : 'Unable to send the message.')
    } finally {
      setSending(false)
    }
  }

  async function beginRecording() {
    if (recording) return
    if (!voiceAvailable) { setError('Speech-to-text is unavailable without SARVAM_API_KEY. Type the customer reply instead.'); return }
    if (!session) await startSession('voice')
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : ''
      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunks.current = []
      mediaRecorder.ondataavailable = event => { if (event.data.size > 0) chunks.current.push(event.data) }
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop())
        streamRef.current = null
        const cleanMime = (mediaRecorder.mimeType || 'audio/webm').split(';')[0].trim() || 'audio/webm'
        const blob = new Blob(chunks.current, { type: cleanMime })
        if (!blob.size) { setPhase('listening'); setError('No audio was captured. Try again.'); return }
        setPhase('processing')
        setVoiceNote('Transcribing with Sarvam…')
        try {
          const token = getStoredToken()
          const response = await fetch(apiUrl('/api/voice/transcribe'), {
            method: 'POST',
            credentials: 'include',
            headers: {
              'content-type': cleanMime,
              'x-filename': 'voice.webm',
              'x-language': bot?.config.language || 'en-IN',
              ...(token ? { authorization: `Bearer ${token}` } : {})
            },
            body: blob,
          })
          const data = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(data.error || `Transcription failed (${response.status}).`)
          setInput(data.transcript || '')
          setVoiceNote(`Transcribed (${data.languageCode || 'auto'}). Review the text, then send.`)
          setPhase('listening')
        } catch (err) {
          setPhase('error')
          setError(err instanceof Error ? err.message : 'Transcription failed. Type the reply instead.')
        }
      }
      mediaRecorder.start()
      recorder.current = mediaRecorder
      setRecording(true)
      setPhase('listening')
      setVoiceNote('Listening — recording locally in your browser. Stop to transcribe.')
    } catch {
      setPhase('error')
      setError('Microphone permission was denied. Allow access in the browser or use text mode to continue.')
    }
  }

  function stopRecording() {
    recorder.current?.stop()
    recorder.current = null
    setRecording(false)
  }

  function resetSession() {
    stopPlayback()
    stopRecording()
    setSession(null); setDuration(0); setStartedAt(null); startedRef.current = null
    setInput(''); setError(''); setVoiceNote(''); setPhase('idle')
  }

  async function complete() {
    if (!session || completing) return
    setCompleting(true)
    try {
      const seconds = startedRef.current ? Math.floor((Date.now() - startedRef.current) / 1000) : duration
      const updated = await api<Session>(`/api/sessions/${session.id}/complete`, { method: 'POST', body: JSON.stringify({ duration: seconds }) })
      setSession(updated)
      stopPlayback(); stopRecording()
      setPhase('idle')
      setVoiceNote('Session completed and saved to conversation history.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to complete the session.')
    } finally {
      setCompleting(false)
    }
  }

  if (loading) return <div className="content"><LoadingCard label="Loading playground…" /></div>
  if (!bot) return <div className="content"><ErrorBanner message={error || 'Bot not found.'} /></div>

  return <div className="content">
    <PageHead
      eyebrow="Voice playground"
      title={bot.name}
      subtitle={`${botLabel(bot.type)} · Prompt v${bot.promptVersion} · ${bot.config.language} · ${bot.config.speaker}`}
      actions={<><Link className="btn" to={`/bots/${bot.id}/configure`}><Settings size={15} /> Configure bot</Link><Link className="btn ghost" to="/history">History</Link></>}
    />

    {!voiceAvailable && <div className="status-banner amber">
      <ShieldAlert size={17} />
      <div><strong>Live Sarvam voice is not configured</strong><p>Turns are handled by the deterministic business-rule engine and are labelled “text simulation”. Add SARVAM_API_KEY to the server .env and restart the API to enable real Sarvam chat, speech-to-text and text-to-speech.</p></div>
    </div>}
    {error && <ErrorBanner message={error} />}

    <div className="tabs" role="tablist" aria-label="Test mode">
      <button
        type="button"
        id="tab-text"
        role="tab"
        aria-selected={mode === 'text'}
        className={`tab ${mode === 'text' ? 'active' : ''}`}
        onClick={() => switchMode('text')}
      >
        <Send size={14} /> Text test
      </button>
      <button
        type="button"
        id="tab-voice"
        role="tab"
        aria-selected={mode === 'voice'}
        className={`tab ${mode === 'voice' ? 'active' : ''}`}
        onClick={() => switchMode('voice')}
      >
        <Mic size={14} /> Sarvam voice test {!voiceAvailable && <span className="tab-lock">unavailable</span>}
      </button>
      <button
        type="button"
        id="tab-phone"
        role="tab"
        aria-selected={mode === 'phone'}
        className={`tab ${mode === 'phone' ? 'active' : ''}`}
        onClick={() => switchMode('phone')}
      >
        <PhoneCall size={14} /> Real phone call
      </button>
    </div>

    {mode === 'phone' ? (
      <div className="card play-card" style={{ padding: '24px' }}>
        <div className="card-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div className="bot-icon small blue"><PhoneCall size={18} /></div>
            <div>
              <h2>Real Telephone Calling Mode</h2>
              <p>Connect this agent ({bot.name}) directly to a customer's phone line over PSTN with dual-channel recording.</p>
            </div>
          </div>
          <Link className="btn small" to="/calls">Open Telephony Workspace <ArrowRight size={13} /></Link>
        </div>

        {!activePhoneCall ? (
          <div className="empty grow" style={{ maxWidth: '480px', margin: '20px auto', textAlign: 'center' }}>
            <div className="empty-icon"><PhoneCall size={24} /></div>
            <h3>Dial a customer telephone number</h3>
            <p>
              Initiate an outbound phone call. The customer's mobile device will ring, announce statutory recording consent, and run two-way dialogue using this bot's saved prompt.
            </p>

            <div style={{ width: '100%', marginTop: '16px', textAlign: 'left' }}>
              <label htmlFor="pgPhone" style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                Customer Phone Number (E.164 with Country Code)
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  id="pgPhone"
                  className="input"
                  type="tel"
                  value={phoneInput}
                  onChange={e => setPhoneInput(e.target.value)}
                  placeholder="+919876543210"
                  style={{ fontFamily: 'monospace' }}
                />
                <button
                  type="button"
                  className="btn primary"
                  disabled={phoneCalling || !phoneInput.trim()}
                  onClick={async () => {
                    setError('')
                    setPhoneCalling(true)
                    try {
                      const call = await api<Call>('/api/calls', {
                        method: 'POST',
                        body: JSON.stringify({ botId: bot.id, toPhone: phoneInput.trim() }),
                      })
                      setActivePhoneCall(call)
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Failed to place call.')
                    } finally {
                      setPhoneCalling(false)
                    }
                  }}
                  style={{ minWidth: '130px' }}
                >
                  {phoneCalling ? <Loader2 size={15} className="spin" /> : <PhoneCall size={15} />}
                  {phoneCalling ? 'Dialing…' : 'Dial Call'}
                </button>
              </div>
              <span className="muted-text" style={{ fontSize: '11px', display: 'block', marginTop: '6px' }}>
                Test with <code>+919876543210</code> or your verified number. Full dual-channel recording is captured automatically.
              </span>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ background: 'var(--soft)', padding: '16px', borderRadius: '8px', marginBottom: '16px' }}>
              <div className="row-between">
                <div>
                  <span className="muted-text" style={{ fontSize: '11px' }}>Destination Phone</span>
                  <div style={{ fontSize: '15px', fontWeight: 700, fontFamily: 'monospace' }}>{activePhoneCall.toPhoneMasked}</div>
                </div>
                <div>
                  <span className="muted-text" style={{ fontSize: '11px' }}>Call Status</span>
                  <div><span className="badge blue">{activePhoneCall.status}</span></div>
                </div>
                <div>
                  <span className="muted-text" style={{ fontSize: '11px' }}>Recording</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span className="recording-dot" /> <span style={{ fontSize: '12px' }}>Dual-Channel Active</span>
                  </div>
                </div>
                <div>
                  <button
                    type="button"
                    className="btn ghost red small"
                    onClick={async () => {
                      if (!activePhoneCall) return
                      const updated = await api<Call>(`/api/calls/${activePhoneCall.id}/hangup`, { method: 'POST' })
                      setActivePhoneCall(updated)
                    }}
                  >
                    <PhoneOff size={14} /> Hang Up
                  </button>
                </div>
              </div>
            </div>

            <span className="muted-text" style={{ fontSize: '12px', display: 'block', marginBottom: '8px' }}>
              Telephone Conversation Turns ({activePhoneCall.transcript.length}):
            </span>
            <div style={{ maxHeight: '280px', overflowY: 'auto', border: '1px solid var(--line)', borderRadius: '8px', padding: '12px' }}>
              {activePhoneCall.transcript.map(msg => (
                <div key={msg.id} style={{ marginBottom: '8px', padding: '8px', background: 'var(--soft)', borderRadius: '6px' }}>
                  <strong style={{ fontSize: '11px', color: msg.speaker === 'agent' ? 'var(--blue)' : 'var(--teal)' }}>
                    {msg.speaker === 'agent' ? 'AI ASSISTANT' : 'CUSTOMER'}
                  </strong>
                  <p style={{ margin: '3px 0 0', fontSize: '12.5px' }}>{msg.text}</p>
                </div>
              ))}
            </div>

            <div className="row-between mt" style={{ marginTop: '14px' }}>
              <button
                type="button"
                className="btn small"
                onClick={() => setActivePhoneCall(null)}
              >
                Start Another Call
              </button>
              <Link className="btn primary small" to="/calls">
                Open in Full Phone Console & Review Recording <ArrowRight size={13} />
              </Link>
            </div>
          </div>
        )}
      </div>
    ) : (
    <div className="playground">
      <div className="card play-card">
        <div className="session-head">
          <div className="session-bot"><span className={loan ? 'blue' : 'teal'}>{loan ? <WalletCards size={17} /> : <CreditCard size={17} />}</span><div><strong>{bot.name}</strong><small>{session ? `${botLabel(bot.type)} · ${session.id.slice(0, 8)}` : 'No session started'}</small></div></div>
          <div className={`agent-state ${phase}`}><span className="dot" />{phaseCopy[phase]}</div>
        </div>

        {!session
          ? <div className="empty grow">
            <div className="empty-icon"><Headphones size={22} /></div>
            <h3>Start a controlled test session</h3>
            <p>
              {mode === 'voice'
                ? 'Voice mode selected: record short speech in your browser, transcribe with Sarvam, and hear agent replies spoken via Sarvam text-to-speech.'
                : 'Text simulation selected: test conversation flows, compliance boundaries, and objection handling immediately by typing.'}
            </p>
            <div className="button-row center">
              <button
                type="button"
                id="btn-start-text"
                className={`btn ${mode === 'text' ? 'primary' : ''}`}
                onClick={() => startSession('text')}
                disabled={phase === 'connecting'}
              >
                <Send size={14} /> Start text test
              </button>
              <button
                type="button"
                id="btn-start-voice"
                className={`btn ${mode === 'voice' ? 'primary' : ''}`}
                onClick={() => startSession('voice')}
                disabled={!voiceAvailable || phase === 'connecting'}
                title={voiceAvailable ? 'Start a real Sarvam voice session' : 'Requires SARVAM_API_KEY'}
              >
                <Mic size={14} /> Start voice test
              </button>
            </div>
            {!voiceAvailable && <p className="field-hint">Voice start stays disabled until the server has Sarvam credentials. Nothing is faked.</p>}
          </div>
          : <>

            <div className="transcript" aria-live="polite">
              {session.transcript.map(message => <Bubble key={message.id} message={message} botName={bot.name} />)}
              {phase === 'processing' && <div className="message agent"><div className="message-mark">N</div><div className="bubble typing"><Loader2 size={14} className="spin" /> Thinking…</div></div>}
              {phase === 'speaking' && <div className="voice-indicator"><Volume2 size={14} /> Agent speaking via Sarvam</div>}
              <div ref={transcriptEnd} />
            </div>
            {(voiceNote || recording) && <div className="voice-note">{recording ? <span className="recording-dot" /> : <Volume2 size={13} />}{recording ? 'Recording… tap stop to transcribe' : voiceNote}</div>}
            <div className="composer">
              {mode === 'voice' && <button className={`btn ${recording ? 'danger' : ''}`} onClick={recording ? stopRecording : beginRecording} disabled={!voiceAvailable || phase === 'speaking' || completed} aria-label={recording ? 'Stop recording' : 'Start recording'}>{recording ? <Square size={15} /> : <Mic size={15} />}{recording ? 'Stop' : 'Speak'}</button>}
              <input className="input" value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send() } }} placeholder={completed ? 'This session is completed. Reset to start again.' : mode === 'voice' ? 'Transcribed customer speech appears here — or type an objection…' : 'Type the customer’s reply or objection…'} disabled={completed} aria-label="Customer message" />
              <button className="btn primary" onClick={() => send()} disabled={sending || !input.trim() || completed} aria-label="Send message">{sending ? <RefreshCw size={14} className="spin" /> : <Send size={14} />}</button>
              {phase === 'speaking' && <button className="btn" onClick={stopPlayback} aria-label="Stop audio"><Pause size={14} /></button>}
            </div>
          </>}
      </div>

      <div className="config-side">
        <div className="card">
          <div className="card-head"><div><h2>Session control</h2><p>State is derived from server responses.</p></div><span className={`badge ${completed ? 'green' : session ? 'blue' : ''}`}>{completed ? 'Completed' : session ? 'Live' : 'Not started'}</span></div>
          <div className="side-list">
            <div className="mini-stat"><span>Duration</span><strong>{formatDuration(duration)}</strong></div>
            <div className="mini-stat"><span>Mode</span><strong>{session ? session.mode : '—'}</strong></div>
            <div className="mini-stat"><span>Engine</span><strong>{session ? (session.engine === 'sarvam-llm' ? 'Sarvam LLM' : session.engine === 'pending' ? 'Awaiting first turn' : 'Deterministic') : '—'}</strong></div>
            <div className="mini-stat"><span>Outcome</span><strong>{session ? <Badge value={session.outcome} /> : '—'}</strong></div>
            <div className="mini-stat"><span>Compliance flags</span><strong>{flags.compliance.length}</strong></div>
            <div className="mini-stat"><span>Review flags</span><strong>{flags.review.length}</strong></div>
            {voiceAvailable && session && <button className="btn full mt-s" onClick={() => { const last = [...session.transcript].reverse().find(message => message.speaker === 'agent'); if (last) speak(last.text) }} disabled={phase === 'speaking'}><Volume2 size={14} /> Replay last reply</button>}
            {session && <div className="button-row stretch">
              <button className="btn" onClick={resetSession}><RotateCcw size={14} /> Reset</button>
              <button className="btn primary" onClick={complete} disabled={completing || completed}><Check size={14} /> {completed ? 'Saved' : completing ? 'Saving…' : 'Complete & save'}</button>
            </div>}
          </div>
        </div>

        {session && <div className="card">
          <div className="card-head"><div><h2>Recorded outcome</h2><p>Server-side, not inferred from the transcript.</p></div></div>
          <div className="side-list">
            <div className="mini-stat"><span>Outcome</span><strong><Badge value={session.outcome} /></strong></div>
            <div className="mini-stat"><span>Commitment date</span><strong>{session.commitmentDate ? formatDate(session.commitmentDate) : 'Not captured'}</strong></div>
            <div className="mini-stat"><span>Add-ons</span><strong>{session.selectedAddOns.length ? session.selectedAddOns.join(', ') : 'None'}</strong></div>
            <div className="mini-stat"><span>Quoted amount</span><strong>{session.finalQuotedAmount ? money(session.finalQuotedAmount) : 'Not confirmed'}</strong></div>
            <div className="mini-stat"><span>Objections</span><strong className="wrap">{session.objections.length ? session.objections.join(', ') : 'None logged'}</strong></div>
            <div className="mini-stat"><span>Saved</span><strong>{session.completedAt ? formatDateTime(session.completedAt) : 'Not completed'}</strong></div>
            {session.complianceFlags.length > 0 && <div className="flag-list">
              {flags.compliance.map(flag => <span className="badge red" key={flag}>{flag.replaceAll('_', ' ')}</span>)}
              {flags.review.map(flag => <span className="badge amber" key={flag}>{flag.replaceAll('_', ' ')}</span>)}
            </div>}
          </div>
        </div>}

        <div className="card">
          <div className="card-head"><div><h2>Known scenario</h2><p>Facts the agent may use.</p></div></div>
          <div className="side-list">
            {loan ? <>
              <div className="mini-stat"><span>Outstanding</span><strong>{money(650000)}</strong></div>
              <div className="mini-stat"><span>Principal / interest</span><strong>{money(400000)} / {money(200000)}</strong></div>
              <div className="mini-stat"><span>Other charges</span><strong>{money(50000)}</strong></div>
              <div className="mini-stat"><span>Settlement proposal</span><strong>{money(400000)}</strong></div>
              <div className="mini-stat"><span>Unpaid period</span><strong>8 months</strong></div>
            </> : <>
              <div className="mini-stat"><span>Vehicle</span><strong>Maruti Brezza</strong></div>
              <div className="mini-stat"><span>IDV</span><strong>{money(900000)} → {money(800000)}</strong></div>
              <div className="mini-stat"><span>Premium</span><strong>{money(20000)} → {money(15000)}</strong></div>
              <div className="mini-stat"><span>Discount</span><strong>{money(5000)}</strong></div>
            </>}
          </div>
        </div>

        <div className="status-banner neutral">
          <ShieldAlert size={16} />
          <div><strong>No recording is created.</strong><p>Audio is transcribed in the browser session and not stored. “Complete & save” stores the transcript, outcome, objections, add-ons and flags only.</p></div>
        </div>
      </div>
    </div>
    )}
  </div>
}


function Bubble({ message, botName }: { message: Message; botName: string }) {
  const agent = message.speaker === 'agent'
  return <div className={`message ${agent ? 'agent' : 'customer'}`}>
    <div className="message-mark">{agent ? 'N' : 'C'}</div>
    <div className="message-body">
      <div className="bubble">{message.text}</div>
      <span className="message-time">{agent ? `${botName} · AI assistant` : 'Customer'} · {formatDateTime(message.timestamp)}{message.engine === 'deterministic' ? ' · simulation' : message.engine === 'sarvam-llm' ? ' · Sarvam LLM' : ''}</span>
    </div>
  </div>
}
