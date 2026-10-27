import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, CalendarDays, Copy, Download, History as HistoryIcon, RefreshCw, Search, X, XCircle } from 'lucide-react'
import { api } from '../api'
import type { Session } from '../types'
import { Badge, EmptyState, ErrorBanner, LoadingCard, PageHead, botLabel, formatDate, formatDateTime, outcomeLabel, humanise, money, splitFlags } from '../ui'

const OUTCOME_OPTIONS = [
  'in_progress', 'proposed_settlement', 'full_repayment_commitment', 'authorized_settlement', 'follow_up_required',
  'dispute_or_hardship_referral', 'human_escalation', 'no_commitment', 'quote_interest', 'quote_accepted',
  'add_on_selected', 'callback_requested', 'not_converted',
]

function followUpStatus(session: Session) {
  if (!session.commitmentDate) return 'No commitment date'
  const due = new Date(`${session.commitmentDate}T12:00:00`)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  if (Number.isNaN(due.getTime())) return 'Recorded as text'
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000)
  if (days < 0) return `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`
  if (days === 0) return 'Due today'
  return `Scheduled in ${days} day${days === 1 ? '' : 's'}`
}

function transcriptText(session: Session) {
  return session.transcript.map(message => `${message.speaker === 'agent' ? 'AI ASSISTANT' : 'CUSTOMER'} — ${message.text}`).join('\n\n')
}

export default function HistoryPage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [query, setQuery] = useState('')
  const [bot, setBot] = useState('all')
  const [outcome, setOutcome] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [selected, setSelected] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  function load() {
    setLoading(true); setError('')
    api<Session[]>('/api/sessions')
      .then(setSessions)
      .catch(err => setError(err instanceof Error ? err.message : 'Unable to load sessions.'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const filtered = useMemo(() => sessions.filter(session => {
    const haystack = [
      session.id, botLabel(session.botId), session.outcome, session.mode,
      session.commitmentDate || '', ...session.transcript.map(message => message.text),
    ].join(' ').toLowerCase()
    if (query && !haystack.includes(query.toLowerCase())) return false
    if (bot !== 'all' && session.botId !== bot) return false
    if (outcome !== 'all' && session.outcome !== outcome) return false
    const created = session.createdAt.slice(0, 10)
    if (from && created < from) return false
    if (to && created > to) return false
    return true
  }), [sessions, query, bot, outcome, from, to])

  function exportSession(session: Session) {
    const body = [
      'Nirvana Voice Studio — conversation export',
      `Session: ${session.id}`,
      `Bot: ${botLabel(session.botId)}`,
      `Mode: ${session.mode} (${session.engine === 'sarvam-llm' ? 'Sarvam LLM' : 'deterministic engine'})`,
      `Outcome: ${humanise(session.outcome)}`,
      `Commitment date: ${session.commitmentDate || 'none recorded'}`,
      `Add-ons: ${session.selectedAddOns.join(', ') || 'none'}`,
      `Quoted amount: ${session.finalQuotedAmount ? money(session.finalQuotedAmount) : 'not confirmed'}`,
      `Objections: ${session.objections.join(', ') || 'none logged'}`,
      `Compliance flags: ${session.complianceFlags.join(', ') || 'none'}`,
      `Created: ${formatDateTime(session.createdAt)}`,
      `Duration: ${session.duration}s`,
      '',
      'This export contains a test conversation. It is not proof of payment, settlement approval or an issued policy.',
      '',
      transcriptText(session),
    ].join('\n')
    const blob = new Blob([body], { type: 'text/plain;charset=utf-8' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `nirvana-session-${session.id.slice(0, 8)}.txt`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  async function copyTranscript(session: Session) {
    try {
      await navigator.clipboard.writeText(transcriptText(session))
      setNotice('Transcript copied to the clipboard.')
      window.setTimeout(() => setNotice(''), 2500)
    } catch {
      setError('Clipboard access was blocked by the browser. Use Export transcript instead.')
    }
  }

  const activeFilters = query || bot !== 'all' || outcome !== 'all' || from || to

  return <div className="content">
    <PageHead eyebrow="Conversation history" title="Review what was actually said." subtitle="Search stored transcripts, inspect objection handling, and keep proposed interest separate from an authorised business outcome." actions={<button className="btn" onClick={load}><RefreshCw size={14} /> Refresh</button>} />

    {error && <ErrorBanner message={error} onRetry={load} />}
    {notice && <div className="success">{notice}</div>}

    <div className="card">
      <div className="filters">
        <div className="filter-head"><span>Filter sessions</span><button className="btn ghost small" onClick={() => setSelected(null)} aria-label="Close session detail"><XCircle size={13} /> Close detail</button></div>
        <div className="search-wrap"><Search size={15} /><input className="input" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search transcripts, outcomes or session id" aria-label="Search sessions" /></div>
        <select className="select" value={bot} onChange={event => setBot(event.target.value)} aria-label="Filter by bot">
          <option value="all">All bots</option><option value="loan">Loan bot</option><option value="insurance">Insurance bot</option>
        </select>
        <select className="select" value={outcome} onChange={event => setOutcome(event.target.value)} aria-label="Filter by outcome">
          <option value="all">All outcomes</option>{OUTCOME_OPTIONS.map(value => <option key={value} value={value}>{outcomeLabel[value] || humanise(value)}</option>)}
        </select>
        <label className="date-filter"><CalendarDays size={14} /><input className="input" type="date" value={from} onChange={event => setFrom(event.target.value)} aria-label="From date" /></label>
        <label className="date-filter"><span className="muted-text">to</span><input className="input" type="date" value={to} onChange={event => setTo(event.target.value)} aria-label="To date" /></label>
        {activeFilters && <button className="btn ghost small" onClick={() => { setQuery(''); setBot('all'); setOutcome('all'); setFrom(''); setTo('') }}><X size={13} /> Clear</button>}
      </div>

      {loading
        ? <LoadingCard label="Loading stored sessions…" />
        : filtered.length === 0
          ? <EmptyState title={sessions.length ? 'No sessions match these filters' : 'No sessions yet'} body={sessions.length ? 'Clear the filters or widen the date range to see more conversations.' : 'Start a test from a voice bot page. The transcript and recorded outcome appear here as soon as the first turn is stored.'} />
          : <div className="table-wrap"><table className="table">
            <thead><tr><th>Session</th><th>Bot</th><th>Mode</th><th>Outcome</th><th>Commitment</th><th>Created</th><th /></tr></thead>
            <tbody>{filtered.map(session => <tr key={session.id}>
              <td><strong>#{session.id.slice(0, 8)}</strong><br /><span className="muted-text">{session.transcript.length} messages · {Math.round(session.duration / 60)}m {session.duration % 60}s</span></td>
              <td>{botLabel(session.botId)}</td>
              <td>{session.mode === 'voice' ? 'Voice' : 'Text'}</td>
              <td><Badge value={session.outcome} /></td>
              <td>{session.commitmentDate ? formatDate(session.commitmentDate) : '—'}</td>
              <td>{formatDateTime(session.createdAt)}</td>
              <td><button className="btn small" onClick={() => setSelected(session)}>Inspect <ArrowRight size={13} /></button></td>
            </tr>)}</tbody>
          </table></div>}
      {!loading && <div className="table-footer"><HistoryIcon size={13} /> {filtered.length} of {sessions.length} stored sessions · measurement window: all time</div>}
    </div>        {selected && <div className="card mt" id="session-detail">
      <div className="card-head">
        <div><h2>Session #{selected.id.slice(0, 8)}</h2><p>{botLabel(selected.botId)} · {formatDateTime(selected.createdAt)} · {selected.engine === 'sarvam-llm' ? 'Sarvam LLM turn engine' : selected.engine === 'deterministic' ? 'Deterministic engine' : 'No turns yet'}</p></div>
        <div className="button-row"><button className="btn small" onClick={() => copyTranscript(selected)}><Copy size={13} /> Copy</button><button className="btn small" onClick={() => exportSession(selected)}><Download size={13} /> Export transcript</button><button className="btn ghost icon-only" onClick={() => setSelected(null)} aria-label="Close session"><X size={15} /></button></div>
      </div>
      <div className="card-pad">
        <div className="grid three detail-grid">
          <div><span className="label-note">Outcome</span><div className="mt-xs"><Badge value={selected.outcome} /></div></div>
          <div><span className="label-note">Commitment / follow-up</span><strong className="block mt-xs">{selected.commitmentDate ? `${formatDate(selected.commitmentDate)} · ${followUpStatus(selected)}` : 'Not recorded'}</strong></div>
          <div><span className="label-note">Final quoted amount</span><strong className="block mt-xs">{selected.finalQuotedAmount ? money(selected.finalQuotedAmount) : 'Not confirmed'}</strong></div>
          <div><span className="label-note">Add-ons selected</span><strong className="block mt-xs">{selected.selectedAddOns.length ? selected.selectedAddOns.join(', ') : 'None'}</strong></div>
          <div><span className="label-note">Session state</span><strong className="block mt-xs">{selected.completedAt ? `Completed ${formatDateTime(selected.completedAt)}` : 'Not completed'}</strong></div>
          <div><span className="label-note">Compliance flags</span><strong className="block mt-xs">{splitFlags(selected.complianceFlags).compliance.join(', ') || 'None'}</strong></div>
          <div><span className="label-note">Review flags</span><strong className="block mt-xs">{splitFlags(selected.complianceFlags).review.join(', ') || 'None'}</strong></div>
        </div>

        <div className="objection-block">
          <span className="label-note">Objections raised (classified server-side)</span>
          <div className="tag-row mt-xs">{selected.objections.length ? selected.objections.map(objection => <span className="tag amber" key={objection}>{humanise(objection)}</span>) : <span className="muted-text">No objections were classified in this conversation.</span>}</div>
          <p className="field-hint">The response to each objection is visible in the transcript below. Outcomes are stored by the server and are not inferred from the text here.</p>
        </div>

        <div className="history-transcript">
          {selected.transcript.map(message => <div className={`history-message ${message.speaker}`} key={message.id}>
            <strong>{message.speaker === 'agent' ? 'AI assistant' : 'Customer'}<span className="muted-text"> · {formatDateTime(message.timestamp)}</span></strong>
            <p>{message.text}</p>
          </div>)}
        </div>          <p className="field-hint">Test conversation. Not evidence of payment, settlement approval, or an issued policy. No audio recording exists for this session.</p>
        <button className="btn small mt-s" onClick={() => setSelected(null)}><ArrowRight size={13} /> Close session</button>
      </div>
    </div>}
  </div>
}
