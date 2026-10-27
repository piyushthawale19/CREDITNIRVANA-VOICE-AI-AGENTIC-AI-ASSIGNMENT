import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { BarChart3, CheckCircle2, ClipboardList, ShieldCheck, Target, Users } from 'lucide-react'
import { api } from '../api'
import type { Session } from '../types'
import { EmptyState, ErrorBanner, LoadingCard, PageHead, Stat, formatDate, humanise, splitFlags } from '../ui'

const LOAN_COMMITMENTS = ['proposed_settlement', 'full_repayment_commitment', 'authorized_settlement']
const RENEWAL_CONVERSIONS = ['quote_accepted', 'renewal_completed']

const pct = (part: number, total: number) => total ? `${Math.round((part / total) * 100)}%` : '—'

export default function Analytics() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  function load() {
    setLoading(true); setError('')
    api<Session[]>('/api/sessions')
      .then(setSessions)
      .catch(err => setError(err instanceof Error ? err.message : 'Unable to load analytics.'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const data = useMemo(() => {
    const loan = sessions.filter(session => session.botId === 'loan')
    const insurance = sessions.filter(session => session.botId === 'insurance')
    const completed = sessions.filter(session => session.completedAt)
    const commitments = loan.filter(session => LOAN_COMMITMENTS.includes(session.outcome))
    const renewals = insurance.filter(session => RENEWAL_CONVERSIONS.includes(session.outcome))
    const addOns = insurance.filter(session => session.selectedAddOns.length > 0)
    const objections = new Map<string, number>()
    for (const session of sessions) for (const objection of session.objections) objections.set(objection, (objections.get(objection) || 0) + 1)
    const flags = new Map<string, number>()
    let complianceTotal = 0
    for (const session of sessions) {
      complianceTotal += splitFlags(session.complianceFlags).compliance.length
      for (const flag of session.complianceFlags) flags.set(flag, (flags.get(flag) || 0) + 1)
    }
    const sorted = [...sessions].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    const chart = [
      { name: 'Loan', sessions: loan.length, committed: commitments.length },
      { name: 'Insurance', sessions: insurance.length, committed: renewals.length },
    ]
    return {
      loan, insurance, completed, commitments, renewals, addOns, chart, complianceTotal,
      objectionRows: [...objections.entries()].sort((a, b) => b[1] - a[1]),
      flagRows: [...flags.entries()].sort((a, b) => b[1] - a[1]),
      first: sorted[0]?.createdAt, last: sorted[sorted.length - 1]?.createdAt,
    }
  }, [sessions])

  return <div className="content">
    <PageHead eyebrow="Analytics" title="Measure the behaviour, not the theatre." subtitle="Every figure below is computed from stored test sessions. A zero is more useful than an invented success rate." />

    <div className="status-banner blue">
      <BarChart3 size={17} />
      <div>
        <strong>Measurement scope</strong>
        <p>{sessions.length} stored session{sessions.length === 1 ? '' : 's'} · {data.completed.length} completed · window {data.first ? `${formatDate(data.first)} – ${formatDate(data.last)}` : 'empty'} · demo/simulated and live-engine sessions are both included and labelled in history. No sample data is seeded.</p>
      </div>
      <button className="btn small" onClick={load}>Refresh</button>
    </div>

    {error && <ErrorBanner message={error} onRetry={load} />}

    {loading ? <LoadingCard label="Computing metrics…" /> : sessions.length === 0
      ? <div className="card"><EmptyState title="No measurable sessions yet" body="Complete at least one test session. Metrics are derived from stored transcripts and outcomes only." /></div>
      : <>
        <div className="grid kpis">
          <Stat label="Conversation completion" value={pct(data.completed.length, sessions.length)} note={`${data.completed.length} of ${sessions.length} sessions completed`} icon={<CheckCircle2 size={16} />} />
          <Stat label="Loan commitment rate" value={pct(data.commitments.length, data.loan.length)} note={`${data.commitments.length} of ${data.loan.length} loan sessions`} icon={<Target size={16} />} tone="green" />
          <Stat label="Renewal conversion rate" value={pct(data.renewals.length, data.insurance.length)} note={`${data.renewals.length} of ${data.insurance.length} insurance sessions`} icon={<ClipboardList size={16} />} tone="teal" />
          <Stat label="Add-on acceptance" value={pct(data.addOns.length, data.insurance.length)} note={`${data.addOns.length} insurance sessions with an add-on · ${data.complianceTotal} compliance flags`} icon={<ShieldCheck size={16} />} tone="amber" />
        </div>

        <div className="grid two">
          <div className="card">
            <div className="card-head"><div><h2>Sessions by bot</h2><p>Positive outcomes are measured signals, not guaranteed sales.</p></div></div>
            <div className="chart-box">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.chart} margin={{ top: 10, right: 12, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="sessions" name="Sessions" fill="#93c5fd" radius={[5, 5, 0, 0]} />
                  <Bar dataKey="committed" name="Positive outcome" fill="#0f766e" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><div><h2>Rate definitions</h2><p>Reproducible from stored session data.</p></div></div>
            <div className="card-pad">
              <div className="settings-row"><div><h4>Loan commitment</h4><p>Settlement proposal, full-repayment commitment or authorised settlement ÷ loan sessions.</p></div><span className="badge blue">n = {data.loan.length}</span></div>
              <div className="settings-row"><div><h4>Renewal conversion</h4><p>Quote accepted (explicit consent) or verified renewal ÷ insurance sessions.</p></div><span className="badge blue">n = {data.insurance.length}</span></div>
              <div className="settings-row"><div><h4>Add-on acceptance</h4><p>Insurance sessions with at least one classified add-on ÷ insurance sessions.</p></div><span className="badge blue">n = {data.insurance.length}</span></div>
              <div className="settings-row"><div><h4>Completion</h4><p>Sessions explicitly completed and saved ÷ all sessions.</p></div><span className="badge blue">n = {sessions.length}</span></div>
            </div>
          </div>
        </div>

        <div className="grid two mt">
          <div className="card">
            <div className="card-head"><div><h2>Common objections</h2><p>Classified by the conversation engine, across {sessions.length} sessions.</p></div></div>
            {data.objectionRows.length === 0
              ? <EmptyState title="No objections classified" body="Challenge a bot with a hardship, price or documentation objection to populate this table." />
              : <div className="table-wrap"><table className="table"><thead><tr><th>Objection</th><th>Count</th><th>Share</th></tr></thead>
                <tbody>{data.objectionRows.map(([objection, count]) => <tr key={objection}><td>{humanise(objection)}</td><td>{count}</td><td>{pct(count, sessions.length)}</td></tr>)}</tbody>
              </table></div>}
          </div>

          <div className="card">
            <div className="card-head"><div><h2>Compliance & review flags</h2><p>Red rows are hard compliance or authorisation flags. Amber rows are workflow reviews.</p></div></div>
            {data.flagRows.length === 0
              ? <EmptyState title="No flags raised" body="Flags appear when a claim needs review — for example an unverified approval, a hardship referral or policy wording that must be confirmed." />
              : <div className="table-wrap"><table className="table"><thead><tr><th>Flag</th><th>Type</th><th>Sessions</th></tr></thead>
                <tbody>{data.flagRows.map(([flag, count]) => {
                  const hard = /^compliance_blocked|^authorisation_|^consent_not|^renewal_not_verified|^commitment_not_confirmed/.test(flag)
                  return <tr key={flag}><td>{humanise(flag)}</td><td><span className={`badge ${hard ? 'red' : 'amber'}`}>{hard ? 'Compliance' : 'Review'}</span></td><td>{count}</td></tr>
                })}</tbody>
              </table></div>}
          </div>
        </div>

        <div className="card card-pad mt">
          <div className="row-start"><Users size={18} className="muted-text" /><div>
            <h2 className="section-title">How to read this</h2>
            <p className="section-caption prose">Sample sizes are deliberately shown next to each rate. A single test call can produce a 100% conversion rate and mean nothing. Rates describe this workspace’s stored test sessions only — not production performance, revenue or credit outcomes.</p>
          </div></div>
        </div>
      </>}
  </div>
}
