import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, ArrowRight, CreditCard, History, PhoneCall, Plus, ShieldCheck, Sparkles, Target, WalletCards } from 'lucide-react'
import { api } from '../api'
import type { Bot, Call, IntegrationStatus, Session, User } from '../types'
import { Badge, EmptyState, ErrorBanner, LoadingCard, PageHead, Stat, botLabel, formatDateTime, money } from '../ui'

const positiveOutcomes = ['authorized_settlement', 'quote_accepted', 'full_repayment_commitment']

export default function Dashboard({ user, status }: { user: User; status: IntegrationStatus | null }) {
  const [bots, setBots] = useState<Bot[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [calls, setCalls] = useState<Call[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  function load() {
    setLoading(true)
    setError('')
    Promise.all([
      api<Bot[]>('/api/bots'),
      api<Session[]>('/api/sessions'),
      api<Call[]>('/api/calls').catch(() => []),
    ])
      .then(([botData, sessionData, callData]) => {
        setBots(botData)
        setSessions(sessionData)
        setCalls(callData)
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Unable to load the workspace.'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const metrics = useMemo(() => {
    const loan = sessions.filter(session => session.botId === 'loan')
    const insurance = sessions.filter(session => session.botId === 'insurance')
    const converted = sessions.filter(session => positiveOutcomes.includes(session.outcome))
    const commitments = sessions.filter(session => session.commitmentDate || ['proposed_settlement', 'full_repayment_commitment', 'quote_accepted'].includes(session.outcome))
    const completed = sessions.filter(session => session.completedAt)
    const lastAmount = sessions.find(session => session.finalQuotedAmount)?.finalQuotedAmount
    const recordedCalls = calls.filter(c => c.hasRecording)
    return { loan, insurance, converted, commitments, completed, lastAmount, recordedCalls }
  }, [sessions, calls])

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return <div className="content">
    <PageHead
      eyebrow="Operator overview"
      title={`${greeting}, ${user.name.split(' ')[0]}.`}
      subtitle="Bot readiness, real session volume and the measurable next step recorded for each conversation."
      actions={<>
        <Link className="btn" to="/calls"><PhoneCall size={15} /> Phone calls ({calls.length})</Link>
        <Link className="btn" to="/history"><History size={15} /> Review sessions</Link>
        <Link className="btn primary" to="/bots"><Plus size={15} /> New test session</Link>
      </>}
    />

    <div className={`status-banner ${status?.configured ? 'green' : 'blue'}`}>
      <Sparkles size={17} />
      <div>
        <strong>{status?.configured ? 'Sarvam AI is live on the server' : 'Text simulation is active — Sarvam credentials missing'}</strong>
        <p>{status?.configured
          ? `Chat (${status.chatModel}), speech-to-text (${status.sttModel}) and text-to-speech (${status.ttsModel}) are enabled. Voice turns are real Sarvam requests.`
          : 'Conversations run on the labelled deterministic engine and microphone controls stay disabled. Add SARVAM_API_KEY to the server .env to enable real chat, STT and TTS. No voice call is claimed in this mode.'}</p>
      </div>
      <Link className="btn small" to="/settings">Integration status</Link>
    </div>

    {error && <ErrorBanner message={error} onRetry={load} />}

    {loading ? <div className="grid four"><LoadingCard /><LoadingCard /><LoadingCard /><LoadingCard /></div> : <>
      <div className="grid kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <Stat label="Total test sessions" value={sessions.length} note={`${metrics.completed.length} completed`} icon={<Activity size={16} />} />
        <Stat label="Phone calls placed" value={calls.length} note={`${metrics.recordedCalls.length} with dual-channel recording`} icon={<PhoneCall size={16} />} tone="blue" />
        <Stat label="Loan conversations" value={metrics.loan.length} note={`${metrics.loan.filter(s => s.outcome === 'proposed_settlement').length} settlement proposals`} icon={<WalletCards size={16} />} />
        <Stat label="Renewal conversations" value={metrics.insurance.length} note={`${metrics.insurance.filter(s => s.outcome === 'quote_accepted' || s.outcome === 'add_on_selected').length} quote decisions`} icon={<CreditCard size={16} />} tone="teal" />
      </div>


      <div className="grid two">
        <div className="card">
          <div className="card-head"><div><h2>Active voice bots</h2><p>Editable prompts, versioned server-side.</p></div><Link className="btn ghost small" to="/bots">View all <ArrowRight size={13} /></Link></div>
          <div className="bot-mini-list">
            {bots.map(bot => {
              const loan = bot.type === 'loan'
              return <div key={bot.id} className="bot-mini">
                <div className={`bot-icon small ${loan ? 'blue' : 'teal'}`}>{loan ? <WalletCards size={17} /> : <CreditCard size={17} />}</div>
                <div className="bot-mini-copy">
                  <strong>{bot.name}</strong>
                  <span>{bot.description}</span>
                  <span className="muted-text">Prompt v{bot.promptVersion} · {bot.config.speaker} · {bot.config.language}</span>
                </div>
                <Link className="btn small" to={`/bots/${bot.id}/playground`}>Test</Link>
              </div>
            })}
          </div>
          <div className="card-note"><ShieldCheck size={14} /> Proposed settlements and quote interest are never counted as completed payments or issued policies.</div>
        </div>

        <div className="card">
          <div className="card-head"><div><h2>Recent sessions</h2><p>Stored conversations only — no sample analytics.</p></div><Link className="btn ghost small" to="/history">Open history <ArrowRight size={13} /></Link></div>
          {sessions.length === 0
            ? <EmptyState title="No sessions yet" body="Start a text test to create the first measurable conversation." action={<Link className="btn primary small" to="/bots">Open voice bots</Link>} />
            : <div className="table-wrap"><table className="table">
              <thead><tr><th>Bot</th><th>Outcome</th><th>Depth</th><th>Created</th></tr></thead>
              <tbody>{sessions.slice(0, 6).map(session => <tr key={session.id}>
                <td><strong>{botLabel(session.botId)}</strong><br /><span className="muted-text">{session.engine === 'sarvam-llm' ? 'Sarvam LLM' : 'Text simulation'}</span></td>
                <td><Badge value={session.outcome} /></td>
                <td>{session.transcript.length} msgs</td>
                <td>{formatDateTime(session.createdAt)}</td>
              </tr>)}</tbody>
            </table></div>}
        </div>
      </div>

      <div className="card card-pad mt">
        <div className="row-between">
          <div><h2 className="section-title">Commitment snapshot</h2><p className="section-caption">Commitment dates are customer-supplied. The highest recorded quote is {money(metrics.lastAmount)}.</p></div>
          <span className="badge">{metrics.commitments.length} commitment signal{metrics.commitments.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </>}
  </div>
}
