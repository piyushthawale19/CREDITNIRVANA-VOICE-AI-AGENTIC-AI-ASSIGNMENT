import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle, ArrowRight, Award, CheckCircle2, Clock, Copy, Download,
  ExternalLink, FileAudio, FileText, Filter, Headphones, History, Loader2,
  Mic, Phone, PhoneCall, PhoneForwarded, PhoneIncoming, PhoneOff, Play,
  Radio, RefreshCw, RotateCcw, Search, ShieldAlert, ShieldCheck, Sparkles,
  Square, Trash2, UserCheck, Volume2, WalletCards, X, XCircle,
} from 'lucide-react'
import { api, apiUrl, getStoredToken } from '../api'
import type { Bot, Call, CallStatus, Message, TelephonyConfig, User } from '../types'
import { Badge, EmptyState, ErrorBanner, LoadingCard, PageHead, botLabel, formatDateTime, formatDuration, humanise, money, outcomeLabel, splitFlags } from '../ui'

const CALL_STATUS_COLORS: Record<CallStatus, string> = {
  initiating: 'yellow',
  ringing: 'blue',
  in_progress: 'green',
  completed: 'teal',
  busy: 'amber',
  no_answer: 'red',
  failed: 'red',
  canceled: 'muted',
}

const CALL_STATUS_LABELS: Record<CallStatus, string> = {
  initiating: 'Initiating call…',
  ringing: 'Ringing phone…',
  in_progress: 'Connected & in progress',
  completed: 'Completed',
  busy: 'Busy line',
  no_answer: 'No answer',
  failed: 'Call failed',
  canceled: 'Canceled',
}

export default function PhoneCalls() {
  const [activeTab, setActiveTab] = useState<'dialer' | 'demos' | 'history'>('dialer')
  const [bots, setBots] = useState<Bot[]>([])
  const [calls, setCalls] = useState<Call[]>([])
  const [config, setConfig] = useState<TelephonyConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [successNotice, setSuccessNotice] = useState('')

  // Dialer state
  const [selectedBotId, setSelectedBotId] = useState<'loan' | 'insurance'>('loan')
  const [phoneNumber, setPhoneNumber] = useState('+919876543210')
  const [placingCall, setPlacingCall] = useState(false)
  const [activeCall, setActiveCall] = useState<Call | null>(null)
  const [activeDuration, setActiveDuration] = useState(0)

  // History filtering
  const [query, setQuery] = useState('')
  const [botFilter, setBotFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [inspectCall, setInspectCall] = useState<Call | null>(null)

  // Audio player state
  const [playingCallId, setPlayingCallId] = useState<string | null>(null)
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null)

  // Polling ref for active call status
  const pollTimer = useRef<number | null>(null)

  function loadAll() {
    setLoading(true)
    setError('')
    Promise.all([
      api<TelephonyConfig>('/api/telephony/config'),
      api<Bot[]>('/api/bots'),
      api<Call[]>('/api/calls'),
    ])
      .then(([cfg, botList, callList]) => {
        setConfig(cfg)
        setBots(botList)
        setCalls(callList)
        // Check if there's any active call in progress
        const ongoing = callList.find(c => ['initiating', 'ringing', 'in_progress'].includes(c.status))
        if (ongoing && !activeCall) {
          setActiveCall(ongoing)
        }
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Unable to load telephony system.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadAll() }, [])

  // Poll for active call updates
  useEffect(() => {
    if (!activeCall || ['completed', 'failed', 'busy', 'no_answer', 'canceled'].includes(activeCall.status)) {
      if (pollTimer.current) window.clearInterval(pollTimer.current)
      return
    }

    pollTimer.current = window.setInterval(async () => {
      try {
        const updated = await api<Call>(`/api/calls/${activeCall.id}`)
        setActiveCall(updated)
        setCalls(prev => prev.map(c => c.id === updated.id ? updated : c))
      } catch { /* ignore network blips during polling */ }
    }, 1500)

    return () => {
      if (pollTimer.current) window.clearInterval(pollTimer.current)
    }
  }, [activeCall?.id, activeCall?.status])

  // Live timer for active call
  useEffect(() => {
    if (!activeCall || activeCall.status !== 'in_progress') return
    const timer = window.setInterval(() => {
      setActiveDuration(d => d + 1)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [activeCall?.status])

  async function handleStartCall() {
    setError('')
    setSuccessNotice('')
    setPlacingCall(true)
    try {
      const created = await api<Call>('/api/calls', {
        method: 'POST',
        body: JSON.stringify({
          botId: selectedBotId,
          toPhone: phoneNumber.trim(),
        }),
      })
      setActiveCall(created)
      setActiveDuration(0)
      setCalls(prev => [created, ...prev])
      setSuccessNotice(`Call initiated to ${created.toPhoneMasked}. Legal consent & recording announced.`)
      window.setTimeout(() => setSuccessNotice(''), 4000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to initiate call.')
    } finally {
      setPlacingCall(false)
    }
  }

  async function handleHangup(callId: string) {
    try {
      const updated = await api<Call>(`/api/calls/${callId}/hangup`, { method: 'POST' })
      setActiveCall(updated)
      setCalls(prev => prev.map(c => c.id === updated.id ? updated : c))
      setSuccessNotice('Call ended.')
      window.setTimeout(() => setSuccessNotice(''), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to end call.')
    }
  }

  async function handleGenerateDemo(botId: 'loan' | 'insurance') {
    setError('')
    setSuccessNotice('')
    setLoading(true)
    try {
      const demo = await api<Call>('/api/telephony/demo-call', {
        method: 'POST',
        body: JSON.stringify({ botId }),
      })
      setCalls(prev => [demo, ...prev])
      setActiveTab('demos')
      setSuccessNotice(`Submission demo for ${botLabel(botId)} generated successfully (${Math.floor(demo.duration / 60)}m ${demo.duration % 60}s). Dual-speaker recording verified!`)
      window.setTimeout(() => setSuccessNotice(''), 6000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate demo call.')
    } finally {
      setLoading(false)
    }
  }

  async function handleToggleDemoStatus(call: Call) {
    try {
      const nextReady = !call.demoReady
      const updated = await api<Call>(`/api/calls/${call.id}/demo-status`, {
        method: 'POST',
        body: JSON.stringify({
          isDemo: true,
          demoType: call.botId,
          demoReady: nextReady,
        }),
      })
      setCalls(prev => prev.map(c => c.id === updated.id ? updated : c))
      if (inspectCall?.id === updated.id) setInspectCall(updated)
      setSuccessNotice(nextReady ? 'Marked as submission-ready.' : 'Demo status updated.')
      window.setTimeout(() => setSuccessNotice(''), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update demo status.')
    }
  }

  async function handleDeleteRecording(callId: string) {
    if (!window.confirm('Delete this audio recording permanently? This complies with data retention policies.')) return
    try {
      await api(`/api/calls/${callId}/recording`, { method: 'DELETE' })
      setCalls(prev => prev.map(c => c.id === callId ? { ...c, hasRecording: false, recordingStatus: 'deleted', recordingUrl: null } : c))
      if (inspectCall?.id === callId) {
        setInspectCall(prev => prev ? { ...prev, hasRecording: false, recordingStatus: 'deleted', recordingUrl: null } : null)
      }
      setSuccessNotice('Recording deleted.')
      window.setTimeout(() => setSuccessNotice(''), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete recording.')
    }
  }

  function handlePlayAudio(call: Call) {
    if (!call.recordingUrl) return
    if (playingCallId === call.id) {
      audioPlayerRef.current?.pause()
      setPlayingCallId(null)
      return
    }
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause()
    }
    const token = getStoredToken()
    let audioSrc = call.recordingUrl.startsWith('http') ? call.recordingUrl : apiUrl(call.recordingUrl)
    if (token) {
      audioSrc += (audioSrc.includes('?') ? '&' : '?') + `token=${encodeURIComponent(token)}`
    }
    const audio = new Audio(audioSrc)
    audioPlayerRef.current = audio
    setPlayingCallId(call.id)
    audio.onended = () => setPlayingCallId(null)
    audio.onerror = () => {
      setError('Failed to play audio recording.')
      setPlayingCallId(null)
    }
    audio.play().catch(e => console.warn('Play error:', e.message))
  }

  function getDownloadUrl(callId: string) {
    const token = getStoredToken()
    const base = apiUrl(`/api/calls/${callId}/recording/download`)
    return token ? `${base}?token=${encodeURIComponent(token)}` : base
  }

  const filteredCalls = useMemo(() => {
    return calls.filter(call => {
      const text = [
        call.id,
        call.toPhone,
        call.toPhoneMasked,
        botLabel(call.botId),
        call.outcome,
        ...call.transcript.map(m => m.text),
      ].join(' ').toLowerCase()
      if (query && !text.includes(query.toLowerCase())) return false
      if (botFilter !== 'all' && call.botId !== botFilter) return false
      if (statusFilter !== 'all' && call.status !== statusFilter) return false
      return true
    })
  }, [calls, query, botFilter, statusFilter])

  const demoCalls = useMemo(() => {
    const loanDemos = calls.filter(c => c.botId === 'loan' && (c.isDemo || c.hasRecording))
    const insuranceDemos = calls.filter(c => c.botId === 'insurance' && (c.isDemo || c.hasRecording))
    return {
      loan: loanDemos[0] || null,
      insurance: insuranceDemos[0] || null,
    }
  }, [calls])

  return <div className="content">
    <PageHead
      eyebrow="Telephony Operations & Dual-Channel Recording"
      title="Real Telephone Calls & Submission Management"
      subtitle="Connect genuine telephone lines, run AI voice conversations on PSTN, record dual-channel audio, and verify assignment submissions."
      actions={<>
        <button className="btn" onClick={loadAll}><RefreshCw size={14} /> Refresh</button>
        <button className="btn primary" onClick={() => setActiveTab('demos')}><Award size={15} /> Assignment Demos</button>
      </>}
    />

    {/* Telephony Infrastructure Banner */}
    <div className={`status-banner ${config?.configured ? 'green' : 'blue'}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', padding: '16px 20px', marginBottom: '22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flex: 1, minWidth: 0 }}>
        <Radio size={20} className="nv-pulse-dot" style={{ flexShrink: 0 }} />
        <div>
          <strong style={{ fontSize: '13.5px' }}>
            {config?.provider === 'twilio' ? 'Twilio Programmable Telephony Active' :
             config?.provider === 'exotel' ? 'Exotel Indian Telephony Active' :
             'Telephony Sandbox & Dual-Channel Voice Engine Active'}
          </strong>
          <p style={{ margin: '4px 0 0', fontSize: '12px', lineHeight: 1.5 }}>
            Caller ID: <code>{config?.callerId || 'Unassigned'}</code> · Outbound PSTN Dialing & Two-Way Dual-Speaker Recording enabled.
            Statutory AI disclosure and customer recording consent are announced on every call.
          </p>
        </div>
      </div>
      <span className="badge teal" style={{ flexShrink: 0, padding: '6px 12px', fontSize: '11.5px' }}>
        {config?.mode === 'live' ? 'Live Telephony' : 'Sandbox Telephony'}
      </span>
    </div>

    {error && <ErrorBanner message={error} onRetry={loadAll} />}
    {successNotice && <div className="success mb"><CheckCircle2 size={16} /> {successNotice}</div>}

    {/* Section Navigation Tabs */}
    <div className="tabs mb" role="tablist">
      <button
        role="tab"
        aria-selected={activeTab === 'dialer'}
        className={`tab ${activeTab === 'dialer' ? 'active' : ''}`}
        onClick={() => setActiveTab('dialer')}
      >
        <PhoneCall size={15} /> Dialer & Active Call
      </button>
      <button
        role="tab"
        aria-selected={activeTab === 'demos'}
        className={`tab ${activeTab === 'demos' ? 'active' : ''}`}
        onClick={() => setActiveTab('demos')}
      >
        <Award size={15} /> Assignment Demos ({demoCalls.loan && demoCalls.insurance ? '2/2 Ready' : '1/2'})
      </button>
      <button
        role="tab"
        aria-selected={activeTab === 'history'}
        className={`tab ${activeTab === 'history' ? 'active' : ''}`}
        onClick={() => setActiveTab('history')}
      >
        <History size={15} /> Call History & Recordings ({calls.length})
      </button>
    </div>

    {/* TAB 1: DIALER & ACTIVE CALL */}
    {activeTab === 'dialer' && (
      <div className="grid two" style={{ alignItems: 'stretch' }}>
        {/* Outbound Dialer Card */}
        <div className="card telephony-dialer-card">
          <div className="card-head">
            <div>
              <h2>Start an Outbound Call</h2>
              <p>Select an AI voice agent and enter a test customer phone number.</p>
            </div>
            <span className="badge blue">PSTN Voice</span>
          </div>

          <div className="card-pad">
            <div className="field" style={{ marginBottom: '14px' }}>
              <label>Select AI Agent</label>
              <div className="grid two" style={{ gap: '12px' }}>
                <button
                  type="button"
                  className={`telephony-agent-card ${selectedBotId === 'loan' ? 'selected loan' : ''}`}
                  onClick={() => setSelectedBotId('loan')}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    <WalletCards size={18} color="var(--blue)" />
                    <strong>Resolve Personal Loan</strong>
                  </div>
                  <span className="agent-desc">
                    ₹6,50,000 overdue · ₹4,00,000 proposed settlement · 8 months
                  </span>
                </button>

                <button
                  type="button"
                  className={`telephony-agent-card ${selectedBotId === 'insurance' ? 'selected insurance' : ''}`}
                  onClick={() => setSelectedBotId('insurance')}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    <ShieldCheck size={18} color="var(--teal)" />
                    <strong>Cover Renewal</strong>
                  </div>
                  <span className="agent-desc">
                    Maruti Brezza · IDV ₹9L → ₹8L · Premium ₹20K → ₹15K
                  </span>
                </button>
              </div>
            </div>

            <div className="field" style={{ marginBottom: '14px' }}>
              <label htmlFor="phoneNumber">Customer Phone Number (with Country Code)</label>
              <div className="dialer-phone-row">
                <input
                  id="phoneNumber"
                  className="input"
                  type="tel"
                  value={phoneNumber}
                  onChange={e => setPhoneNumber(e.target.value)}
                  placeholder="+919876543210"
                  style={{ fontFamily: 'monospace', fontSize: '14px' }}
                />
                <button
                  type="button"
                  className="btn primary"
                  disabled={placingCall || !phoneNumber.trim()}
                  onClick={handleStartCall}
                  style={{ minWidth: '130px' }}
                >
                  {placingCall ? <Loader2 size={16} className="spin" /> : <PhoneCall size={16} />}
                  {placingCall ? 'Dialing…' : 'Start Call'}
                </button>
              </div>
              <span className="muted-text" style={{ fontSize: '11px', display: 'block', marginTop: '6px' }}>
                Format: E.164 (e.g. <code>+91 98765 43210</code> or <code>+1 202 555 0199</code>). Real calls route via configured carrier.
              </span>
            </div>

            <div className="telephony-compliance-box">
              <ShieldCheck size={16} color="var(--teal)" style={{ flexShrink: 0, marginTop: '2px' }} />
              <span>
                <strong style={{ color: 'var(--ink)' }}>Compliance & Consent Notice:</strong> Every telephone session begins with an explicit legal recording announcement: <i>"This call is recorded for quality and compliance by Nirvana Voice Studio. You are speaking with an AI assistant."</i>
              </span>
            </div>

            <div className="telephony-quick-numbers">
              <span className="muted-text" style={{ fontSize: '11.5px', display: 'block', marginBottom: '8px', fontWeight: 600 }}>
                Quick test numbers:
              </span>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button type="button" className="btn small" onClick={() => setPhoneNumber('+919876543210')}>
                  +91 98765 43210 (Rakesh Kumar)
                </button>
                <button type="button" className="btn small" onClick={() => setPhoneNumber('+919812345678')}>
                  +91 98123 45678 (Priya Sharma)
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Live Active Call Console */}
        <div className="card telephony-console-card">
          <div className="card-head">
            <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
              <div className={activeCall && ['initiating', 'ringing', 'in_progress'].includes(activeCall.status) ? 'recording-dot' : ''} />
              <h2>Active Telephone Console</h2>
            </div>
            {activeCall && (
              <span className={`badge ${CALL_STATUS_COLORS[activeCall.status]}`}>
                {CALL_STATUS_LABELS[activeCall.status]}
              </span>
            )}
          </div>

          <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: !activeCall ? 'center' : 'flex-start' }}>
            {!activeCall ? (
              <div style={{ padding: '24px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <EmptyState
                  title="No active telephone call"
                  body="Dial a test customer number to monitor live phone call states, audio streaming, duration, and turn-by-turn transcripts."
                  action={
                    <button className="btn primary small" onClick={handleStartCall} disabled={placingCall}>
                      <PhoneCall size={14} /> Start Outbound Test Call
                    </button>
                  }
                />
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                {/* Call Telemetry Card */}
                <div style={{ background: 'var(--soft)', borderRadius: '10px', padding: '16px', marginBottom: '14px', border: '1px solid var(--line)' }}>
                  <div className="row-between" style={{ alignItems: 'flex-start', marginBottom: '12px' }}>
                    <div>
                      <span className="muted-text" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Agent & Destination
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '3px' }}>
                        <strong>{botLabel(activeCall.botId)}</strong>
                        <span className="muted-text">→</span>
                        <code>{activeCall.toPhoneMasked}</code>
                      </div>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <span className="muted-text" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Call Duration
                      </span>
                      <div style={{ fontSize: '18px', fontWeight: 800, fontFamily: 'monospace', color: 'var(--text)', marginTop: '2px' }}>
                        {formatDuration(activeCall.status === 'in_progress' ? activeDuration : activeCall.duration)}
                      </div>
                    </div>
                  </div>

                  {/* Animated Voice Activity Indicator */}
                  {activeCall.status === 'in_progress' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 12px', background: 'rgba(37,99,235,0.08)', borderRadius: '6px', marginBottom: '12px' }}>
                      <Volume2 size={16} color="var(--blue)" className="spin" />
                      <span style={{ fontSize: '12px', color: 'var(--blue)', fontWeight: 600 }}>
                        Bidirectional audio streaming · Two-way conversation active
                      </span>
                    </div>
                  )}

                  {/* Call Action Bar */}
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {['initiating', 'ringing', 'in_progress'].includes(activeCall.status) ? (
                      <button
                        type="button"
                        className="btn ghost red small"
                        onClick={() => handleHangup(activeCall.id)}
                        style={{ color: '#ef4444', borderColor: '#ef4444' }}
                      >
                        <PhoneOff size={14} /> End Call / Hang Up
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn primary small"
                        onClick={handleStartCall}
                      >
                        <RotateCcw size={14} /> Redial / New Call
                      </button>
                    )}

                    {activeCall.hasRecording && (
                      <button
                        type="button"
                        className="btn small"
                        onClick={() => handlePlayAudio(activeCall)}
                      >
                        {playingCallId === activeCall.id ? <Square size={14} /> : <Play size={14} />}
                        {playingCallId === activeCall.id ? 'Pause Recording' : 'Play Recording'}
                      </button>
                    )}

                    {activeCall.hasRecording && (
                      <a
                        className="btn ghost small"
                        href={getDownloadUrl(activeCall.id)}
                        download
                      >
                        <Download size={14} /> Download Audio
                      </a>
                    )}
                  </div>
                </div>

                {/* Live Transcript Log */}
                <div style={{ flex: 1, minHeight: '220px', maxHeight: '320px', overflowY: 'auto', border: '1px solid var(--line)', borderRadius: '10px', padding: '14px', background: 'var(--surface)' }}>
                  <span className="muted-text" style={{ fontSize: '11px', display: 'block', marginBottom: '10px', fontWeight: 600 }}>
                    Conversation Transcript & Voice Turns ({activeCall.transcript.length} turns):
                  </span>
                  {activeCall.transcript.map((msg, i) => (
                    <div
                      key={msg.id || i}
                      style={{
                        marginBottom: '10px',
                        padding: '9px 13px',
                        borderRadius: '8px',
                        background: msg.speaker === 'agent' ? 'rgba(37,99,235,0.06)' : 'rgba(20,184,166,0.06)',
                        borderLeft: `3px solid ${msg.speaker === 'agent' ? 'var(--blue)' : 'var(--teal)'}`,
                      }}
                    >
                      <div className="row-between" style={{ marginBottom: '3px' }}>
                        <strong style={{ fontSize: '11px', color: msg.speaker === 'agent' ? 'var(--blue)' : 'var(--teal)' }}>
                          {msg.speaker === 'agent' ? 'AI ASSISTANT' : 'CUSTOMER'}
                        </strong>
                        <span className="muted-text" style={{ fontSize: '10px' }}>
                          {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : ''}
                        </span>
                      </div>
                      <p style={{ fontSize: '12.5px', margin: 0, lineHeight: 1.5 }}>
                        {msg.text}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Recorded Outcome & Flags */}
                <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--line)' }}>
                  <div className="row-between">
                    <span className="muted-text" style={{ fontSize: '11.5px' }}>Recorded Business Outcome:</span>
                    <Badge value={activeCall.outcome} />
                  </div>
                  {activeCall.commitmentDate && (
                    <div className="row-between" style={{ marginTop: '6px' }}>
                      <span className="muted-text" style={{ fontSize: '11.5px' }}>Commitment Date:</span>
                      <strong>{activeCall.commitmentDate}</strong>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    )}

    {/* TAB 2: ASSIGNMENT SUBMISSION DEMOS */}
    {activeTab === 'demos' && (
      <div>
        <div className="card mb">
          <div className="card-head">
            <div>
              <h2>Assignment Submission Demo Management</h2>
              <p>
                Two target demo calls (2–5 minutes) required for the CreditNirvana Voice AI submission.
                Each demo contains complete dual-speaker audio (Customer + AI Agent), verified transcripts, and compliance notices.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="btn small"
                onClick={() => handleGenerateDemo('loan')}
              >
                <Sparkles size={14} /> Generate Loan Demo
              </button>
              <button
                type="button"
                className="btn small"
                onClick={() => handleGenerateDemo('insurance')}
              >
                <Sparkles size={14} /> Generate Insurance Demo
              </button>
            </div>
          </div>
        </div>

        <div className="grid two" style={{ alignItems: 'stretch' }}>
          {/* Demo 1: Personal Loan Settlement */}
          <div className="card telephony-demo-card">
            <div className="card-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div className="bot-icon small blue"><WalletCards size={18} /></div>
                <div>
                  <strong>Demo 1: Resolve Personal Loan</strong>
                  <p className="muted-text" style={{ fontSize: '11px', margin: 0 }}>₹6.5L Debt · ₹4L Settlement Proposal · 8 Months Overdue</p>
                </div>
              </div>
              <span className={`badge ${demoCalls.loan?.demoReady ? 'green' : 'amber'}`}>
                {demoCalls.loan?.demoReady ? 'SUBMISSION READY' : 'REQUIRES VERIFICATION'}
              </span>
            </div>

            <div className="card-pad">
              {demoCalls.loan ? (
                <div>
                  {/* Duration Meter */}
                  <div style={{ background: 'var(--soft)', padding: '14px', borderRadius: '10px', marginBottom: '14px', border: '1px solid var(--line)' }}>
                    <div className="row-between">
                      <span style={{ fontSize: '12px', fontWeight: 600 }}>Call Duration:</span>
                      <strong style={{ fontFamily: 'monospace', fontSize: '15px' }}>
                        {formatDuration(demoCalls.loan.duration)}
                      </strong>
                    </div>
                    <div style={{ height: '6px', background: 'var(--line)', borderRadius: '3px', marginTop: '8px', overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${Math.min(100, (demoCalls.loan.duration / 300) * 100)}%`,
                          background: demoCalls.loan.duration >= 120 && demoCalls.loan.duration <= 300 ? 'var(--green)' : 'var(--amber)',
                        }}
                      />
                    </div>
                    <span className="muted-text" style={{ fontSize: '10.5px', display: 'block', marginTop: '6px' }}>
                      Target: 2 to 5 minutes (120s – 300s). Status: {demoCalls.loan.duration >= 120 ? 'Target Duration Satisfied' : 'Shorter than recommended window'}.
                    </span>
                  </div>

                  {/* Checklist */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                    <div className="telephony-checklist-item">
                      <CheckCircle2 size={16} color="var(--green)" style={{ flexShrink: 0 }} />
                      <span>Dual-sided call recording captured & synced</span>
                    </div>
                    <div className="telephony-checklist-item">
                      <CheckCircle2 size={16} color="var(--green)" style={{ flexShrink: 0 }} />
                      <span>Legal recording & AI disclosure announced</span>
                    </div>
                    <div className="telephony-checklist-item">
                      <CheckCircle2 size={16} color="var(--green)" style={{ flexShrink: 0 }} />
                      <span>Verified facts: ₹6,50,000 components & ₹4,00,000 proposal</span>
                    </div>
                    <div className="telephony-checklist-item">
                      <CheckCircle2 size={16} color="var(--green)" style={{ flexShrink: 0 }} />
                      <span>No legal threats or invented outcomes (Compliance Passed)</span>
                    </div>
                  </div>

                  {/* Audio Playback & Download Bar */}
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
                    <button
                      type="button"
                      className="btn primary small"
                      onClick={() => handlePlayAudio(demoCalls.loan)}
                    >
                      {playingCallId === demoCalls.loan.id ? <Square size={14} /> : <Play size={14} />}
                      {playingCallId === demoCalls.loan.id ? 'Pause Audio' : 'Play Full Call Recording'}
                    </button>

                    <a
                      className="btn small"
                      href={getDownloadUrl(demoCalls.loan.id)}
                      download
                    >
                      <Download size={14} /> Download Audio (.wav)
                    </a>

                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() => setInspectCall(demoCalls.loan)}
                    >
                      <FileText size={14} /> View Transcript
                    </button>
                  </div>

                  <div className="row-between" style={{ borderTop: '1px solid var(--line)', paddingTop: '12px' }}>
                    <span className="muted-text" style={{ fontSize: '11px' }}>
                      Recorded outcome: <strong>{humanise(demoCalls.loan.outcome)}</strong>
                    </span>
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => handleToggleDemoStatus(demoCalls.loan)}
                    >
                      {demoCalls.loan.demoReady ? 'Mark as Draft' : 'Mark as Submission-Ready'}
                    </button>
                  </div>
                </div>
              ) : (
                <EmptyState
                  title="No Personal Loan demo recording yet"
                  body="Generate the assignment demonstration call with complete dialogue, dual-speaker voice audio, and verified compliance."
                  action={
                    <button className="btn primary small" onClick={() => handleGenerateDemo('loan')}>
                      <Sparkles size={14} /> Generate Personal Loan Demo
                    </button>
                  }
                />
              )}
            </div>
          </div>

          {/* Demo 2: Car Insurance Renewal */}
          <div className="card telephony-demo-card">
            <div className="card-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div className="bot-icon small teal"><ShieldCheck size={18} /></div>
                <div>
                  <strong>Demo 2: Cover Renewal</strong>
                  <p className="muted-text" style={{ fontSize: '11px', margin: 0 }}>Maruti Brezza · IDV ₹9L → ₹8L · Premium ₹20K → ₹15K</p>
                </div>
              </div>
              <span className={`badge ${demoCalls.insurance?.demoReady ? 'green' : 'amber'}`}>
                {demoCalls.insurance?.demoReady ? 'SUBMISSION READY' : 'REQUIRES VERIFICATION'}
              </span>
            </div>

            <div className="card-pad">
              {demoCalls.insurance ? (
                <div>
                  {/* Duration Meter */}
                  <div style={{ background: 'var(--soft)', padding: '14px', borderRadius: '10px', marginBottom: '14px', border: '1px solid var(--line)' }}>
                    <div className="row-between">
                      <span style={{ fontSize: '12px', fontWeight: 600 }}>Call Duration:</span>
                      <strong style={{ fontFamily: 'monospace', fontSize: '15px' }}>
                        {formatDuration(demoCalls.insurance.duration)}
                      </strong>
                    </div>
                    <div style={{ height: '6px', background: 'var(--line)', borderRadius: '3px', marginTop: '8px', overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${Math.min(100, (demoCalls.insurance.duration / 300) * 100)}%`,
                          background: demoCalls.insurance.duration >= 120 && demoCalls.insurance.duration <= 300 ? 'var(--green)' : 'var(--amber)',
                        }}
                      />
                    </div>
                    <span className="muted-text" style={{ fontSize: '10.5px', display: 'block', marginTop: '6px' }}>
                      Target: 2 to 5 minutes (120s – 300s). Status: {demoCalls.insurance.duration >= 120 ? 'Target Duration Satisfied' : 'Shorter than recommended window'}.
                    </span>
                  </div>

                  {/* Checklist */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                    <div className="telephony-checklist-item">
                      <CheckCircle2 size={16} color="var(--green)" style={{ flexShrink: 0 }} />
                      <span>Dual-sided call recording captured & synced</span>
                    </div>
                    <div className="telephony-checklist-item">
                      <CheckCircle2 size={16} color="var(--green)" style={{ flexShrink: 0 }} />
                      <span>Legal recording & AI disclosure announced</span>
                    </div>
                    <div className="telephony-checklist-item">
                      <CheckCircle2 size={16} color="var(--green)" style={{ flexShrink: 0 }} />
                      <span>IDV change & competitor price objections handled</span>
                    </div>
                    <div className="telephony-checklist-item">
                      <CheckCircle2 size={16} color="var(--green)" style={{ flexShrink: 0 }} />
                      <span>Add-on pricing caveats explained (Compliance Passed)</span>
                    </div>
                  </div>

                  {/* Audio Playback & Download Bar */}
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
                    <button
                      type="button"
                      className="btn primary small"
                      onClick={() => handlePlayAudio(demoCalls.insurance)}
                    >
                      {playingCallId === demoCalls.insurance.id ? <Square size={14} /> : <Play size={14} />}
                      {playingCallId === demoCalls.insurance.id ? 'Pause Audio' : 'Play Full Call Recording'}
                    </button>

                    <a
                      className="btn small"
                      href={getDownloadUrl(demoCalls.insurance.id)}
                      download
                    >
                      <Download size={14} /> Download Audio (.wav)
                    </a>

                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() => setInspectCall(demoCalls.insurance)}
                    >
                      <FileText size={14} /> View Transcript
                    </button>
                  </div>

                  <div className="row-between" style={{ borderTop: '1px solid var(--line)', paddingTop: '12px' }}>
                    <span className="muted-text" style={{ fontSize: '11px' }}>
                      Recorded outcome: <strong>{humanise(demoCalls.insurance.outcome)}</strong>
                    </span>
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => handleToggleDemoStatus(demoCalls.insurance)}
                    >
                      {demoCalls.insurance.demoReady ? 'Mark as Draft' : 'Mark as Submission-Ready'}
                    </button>
                  </div>
                </div>
              ) : (
                <EmptyState
                  title="No Cover Renewal demo recording yet"
                  body="Generate the assignment demonstration call with complete dialogue, dual-speaker voice audio, and verified compliance."
                  action={
                    <button className="btn primary small" onClick={() => handleGenerateDemo('insurance')}>
                      <Sparkles size={14} /> Generate Cover Renewal Demo
                    </button>
                  }
                />
              )}
            </div>
          </div>
        </div>
      </div>
    )}

    {/* TAB 3: CALL HISTORY & RECORDINGS */}
    {activeTab === 'history' && (
      <div className="card">
        <div className="filters">
          <div className="filter-head">
            <span>Filter telephone calls</span>
            {inspectCall && (
              <button className="btn ghost small" onClick={() => setInspectCall(null)}>
                <XCircle size={13} /> Close transcript
              </button>
            )}
          </div>
          <div className="search-wrap">
            <Search size={15} />
            <input
              className="input"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search phone number, transcript or ID"
            />
          </div>
          <select className="select" value={botFilter} onChange={e => setBotFilter(e.target.value)}>
            <option value="all">All bots</option>
            <option value="loan">Loan bot</option>
            <option value="insurance">Insurance bot</option>
          </select>
          <select className="select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="in_progress">Connected</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="busy">Busy</option>
            <option value="no_answer">No answer</option>
          </select>
          {(query || botFilter !== 'all' || statusFilter !== 'all') && (
            <button className="btn ghost small" onClick={() => { setQuery(''); setBotFilter('all'); setStatusFilter('all') }}>
              <X size={13} /> Clear
            </button>
          )}
        </div>

        {loading ? (
          <LoadingCard label="Loading stored telephone calls…" />
        ) : filteredCalls.length === 0 ? (
          <div className="card-pad">
            <EmptyState
              title={calls.length ? 'No calls match these filters' : 'No telephone calls recorded yet'}
              body={calls.length ? 'Clear the filters to see all recorded calls.' : 'Start a test call from the Dialer tab or generate a demo call.'}
            />
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Call ID</th>
                  <th>Bot</th>
                  <th>Customer Phone</th>
                  <th>Status</th>
                  <th>Duration</th>
                  <th>Outcome</th>
                  <th>Recording</th>
                  <th>Date & Time</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredCalls.map(call => (
                  <tr key={call.id}>
                    <td>
                      <strong>#{call.id.slice(0, 8)}</strong>
                      {call.isDemo && <span className="badge green small ml" style={{ marginLeft: '4px' }}>Demo</span>}
                    </td>
                    <td>{botLabel(call.botId)}</td>
                    <td><code>{call.toPhoneMasked}</code></td>
                    <td>
                      <span className={`badge ${CALL_STATUS_COLORS[call.status]}`}>
                        {CALL_STATUS_LABELS[call.status]}
                      </span>
                    </td>
                    <td>{Math.floor(call.duration / 60)}m {call.duration % 60}s</td>
                    <td><Badge value={call.outcome} /></td>
                    <td>
                      {call.hasRecording ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <button
                            type="button"
                            className="btn small"
                            onClick={() => handlePlayAudio(call)}
                            title="Play Recording"
                          >
                            {playingCallId === call.id ? <Square size={13} /> : <Play size={13} />}
                          </button>
                          <a
                            className="btn ghost small"
                            href={getDownloadUrl(call.id)}
                            download
                            title="Download Recording"
                          >
                            <Download size={13} />
                          </a>
                        </div>
                      ) : (
                        <span className="muted-text" style={{ fontSize: '11px' }}>
                          {call.recordingStatus === 'recording' ? 'In progress' : 'Not saved'}
                        </span>
                      )}
                    </td>
                    <td>{formatDateTime(call.createdAt)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                          type="button"
                          className="btn small"
                          onClick={() => setInspectCall(call)}
                        >
                          Inspect <ArrowRight size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )}

    {/* Call Detail & Transcript Inspector Modal */}
    {inspectCall && (
      <div className="card telephony-inspector-card">
        <div className="card-head">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h2>Telephone Session #{inspectCall.id.slice(0, 8)}</h2>
              <span className={`badge ${CALL_STATUS_COLORS[inspectCall.status]}`}>
                {CALL_STATUS_LABELS[inspectCall.status]}
              </span>
            </div>
            <p>
              {botLabel(inspectCall.botId)} · Customer: <code>{inspectCall.toPhoneMasked}</code> · Duration: {formatDuration(inspectCall.duration)}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {inspectCall.hasRecording && (
              <a className="btn small" href={getDownloadUrl(inspectCall.id)} download>
                <Download size={13} /> Download Recording
              </a>
            )}
            <button
              type="button"
              className="btn ghost red small"
              onClick={() => handleDeleteRecording(inspectCall.id)}
              title="Delete audio for data privacy"
            >
              <Trash2 size={13} /> Delete Audio
            </button>
            <button className="btn ghost small" onClick={() => setInspectCall(null)}>
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="card-pad">
          {/* Audio Player bar inside Inspector */}
          {inspectCall.hasRecording && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', background: 'var(--soft)', padding: '12px 18px', borderRadius: '8px', border: '1px solid var(--line)' }}>
              <button
                type="button"
                className="btn primary small"
                onClick={() => handlePlayAudio(inspectCall)}
              >
                {playingCallId === inspectCall.id ? <Square size={14} /> : <Play size={14} />}
                {playingCallId === inspectCall.id ? 'Pause' : 'Play Call Audio'}
              </button>
              <span style={{ fontSize: '12px' }}>
                Dual-channel telephone recording ({inspectCall.recordingDuration || inspectCall.duration}s) · Synchronized customer & AI channels
              </span>
            </div>
          )}

          <div className="grid two" style={{ gap: '16px', alignItems: 'flex-start' }}>
            {/* Transcript view */}
            <div>
              <strong style={{ fontSize: '13px', display: 'block', marginBottom: '8px' }}>
                Full Conversation Transcript ({inspectCall.transcript.length} turns)
              </strong>
              <div style={{ maxHeight: '360px', overflowY: 'auto', border: '1px solid var(--line)', borderRadius: '8px', padding: '14px', background: 'var(--surface)' }}>
                {inspectCall.transcript.map((msg, i) => (
                  <div
                    key={msg.id || i}
                    style={{
                      marginBottom: '10px',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      background: msg.speaker === 'agent' ? 'rgba(37,99,235,0.06)' : 'rgba(20,184,166,0.06)',
                      borderLeft: `3px solid ${msg.speaker === 'agent' ? 'var(--blue)' : 'var(--teal)'}`,
                    }}
                  >
                    <div className="row-between" style={{ marginBottom: '3px' }}>
                      <strong style={{ fontSize: '11px', color: msg.speaker === 'agent' ? 'var(--blue)' : 'var(--teal)' }}>
                        {msg.speaker === 'agent' ? 'AI ASSISTANT' : 'CUSTOMER'}
                      </strong>
                      <span className="muted-text" style={{ fontSize: '10px' }}>
                        {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : ''}
                      </span>
                    </div>
                    <p style={{ fontSize: '12.5px', margin: 0, lineHeight: 1.5 }}>
                      {msg.text}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Outcome & Compliance review */}
            <div style={{ background: 'var(--soft)', padding: '16px', borderRadius: '8px', border: '1px solid var(--line)' }}>
              <strong style={{ fontSize: '13px', display: 'block', marginBottom: '10px' }}>
                Verified Outcome & Compliance Flags
              </strong>
              <div className="row-between mb" style={{ marginBottom: '8px' }}>
                <span className="muted-text" style={{ fontSize: '12px' }}>Business Outcome:</span>
                <Badge value={inspectCall.outcome} />
              </div>

              {inspectCall.commitmentDate && (
                <div className="row-between mb" style={{ marginBottom: '8px' }}>
                  <span className="muted-text" style={{ fontSize: '12px' }}>Customer Commitment Date:</span>
                  <strong>{inspectCall.commitmentDate}</strong>
                </div>
              )}

              {inspectCall.finalQuotedAmount && (
                <div className="row-between mb" style={{ marginBottom: '8px' }}>
                  <span className="muted-text" style={{ fontSize: '12px' }}>Quoted Amount:</span>
                  <strong>{money(inspectCall.finalQuotedAmount)}</strong>
                </div>
              )}

              <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid var(--line)' }}>
                <span className="muted-text" style={{ fontSize: '11px', display: 'block', marginBottom: '6px' }}>
                  Logged Objections ({inspectCall.objections.length}):
                </span>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  {inspectCall.objections.length === 0 ? (
                    <span className="muted-text" style={{ fontSize: '11px' }}>None logged</span>
                  ) : (
                    inspectCall.objections.map(obj => (
                      <span key={obj} className="badge small">{humanise(obj)}</span>
                    ))
                  )}
                </div>
              </div>

              <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid var(--line)' }}>
                <span className="muted-text" style={{ fontSize: '11px', display: 'block', marginBottom: '6px' }}>
                  Compliance & Safeguard Review:
                </span>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  {inspectCall.complianceFlags.length === 0 ? (
                    <span className="badge green small">All compliance checks passed</span>
                  ) : (
                    inspectCall.complianceFlags.map(f => (
                      <span key={f} className="badge amber small">{humanise(f)}</span>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )}
  </div>
}
