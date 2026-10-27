import type React from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import type { BotType, IntegrationStatus } from './types'

export const money = (value?: number | null) =>
  value == null ? '—' : `₹${new Intl.NumberFormat('en-IN').format(value)}`

export const botLabel = (type: BotType | string) => type === 'loan' ? 'Loan settlement' : 'Insurance renewal'

export const outcomeLabel: Record<string, string> = {
  in_progress: 'In progress',
  no_commitment: 'No commitment',
  follow_up_required: 'Follow-up required',
  proposed_settlement: 'Proposed settlement',
  authorized_settlement: 'Authorised settlement',
  human_escalation: 'Human escalation',
  dispute_or_hardship_referral: 'Hardship / dispute referral',
  full_repayment_commitment: 'Full repayment commitment',
  quote_interest: 'Renewal interest',
  quote_accepted: 'Quote accepted',
  add_on_selected: 'Add-on selected',
  callback_requested: 'Callback requested',
  not_converted: 'Not converted',
  renewal_completed: 'Renewal completed',
}

export const outcomeTone = (outcome: string): 'green' | 'blue' | 'amber' | 'red' | '' => {
  if (['full_repayment_commitment', 'proposed_settlement', 'authorized_settlement', 'quote_accepted', 'add_on_selected'].includes(outcome)) return 'green'
  if (['in_progress', 'quote_interest'].includes(outcome)) return 'blue'
  if (['follow_up_required', 'human_escalation', 'dispute_or_hardship_referral', 'callback_requested'].includes(outcome)) return 'amber'
  if (['no_commitment', 'not_converted'].includes(outcome)) return 'red'
  return ''
}

// SQLite stores UTC timestamps without a zone marker; dates from commitment fields are
// plain calendar dates. Parse both explicitly so the UI never shifts a day silently.
function parseTimestamp(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T12:00:00Z`)
  const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(value)
  return new Date(value.replace(' ', 'T') + (hasZone ? '' : 'Z'))
}

export function formatDate(value?: string | null) {
  if (!value) return '—'
  const date = parseTimestamp(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}

export function formatDateTime(value?: string | null) {
  if (!value) return '—'
  const date = parseTimestamp(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date)
}

// Hardship, documentation and pricing notices are review flags. Only hard rule
// breaches and unconfirmed authorisations count as compliance flags in analytics.
export function splitFlags(flags: string[]) {
  const compliance = flags.filter(flag => /^compliance_blocked|^authorisation_|^consent_not|^renewal_not_verified|^commitment_not_confirmed/.test(flag))
  return { compliance, review: flags.filter(flag => !compliance.includes(flag)) }
}

export function formatDuration(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function humanise(value: string) {
  return value.replaceAll('_', ' ').replace(/^./, char => char.toUpperCase())
}

export function Logo() {
  return <div className="brand"><div className="brand-mark nv-mark">N</div><div><strong>Nirvana</strong><small>VOICE STUDIO</small></div></div>
}

export function PageHead({ eyebrow, title, subtitle, actions }: { eyebrow: string; title: string; subtitle?: string; actions?: React.ReactNode }) {
  return <div className="page-head"><div><p className="eyebrow">{eyebrow}</p><h1 className="page-title">{title}</h1>{subtitle && <p className="page-subtitle">{subtitle}</p>}</div>{actions && <div className="page-actions">{actions}</div>}</div>
}

export function Badge({ value, tone }: { value: string; tone?: string }) {
  const resolved = tone ?? outcomeTone(value)
  return <span className={`badge ${resolved}`}>{outcomeLabel[value] || humanise(value)}</span>
}

export function LoadingCard({ label = 'Loading workspace data…' }: { label?: string }) {
  return <div className="card empty"><RefreshCw className="spin" size={20} /><p>{label}</p></div>
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return <div className="empty"><div className="empty-icon"><AlertTriangle size={18} /></div><h3>{title}</h3><p>{body}</p>{action}</div>
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  if (!message) return null
  return <div className="error banner"><AlertTriangle size={14} /><span>{message}</span>{onRetry && <button className="btn ghost small" onClick={onRetry}><RefreshCw size={12} /> Retry</button>}</div>
}

export function IntegrationPill({ status }: { status: IntegrationStatus | null }) {
  if (!status) return <div className="status-pill"><span className="dot" /> Checking Sarvam…</div>
  return <div className={`status-pill ${status.configured ? 'live' : ''}`} title={status.notes}>
    <span className={`dot ${status.configured ? 'live' : ''}`} />
    Sarvam {status.configured ? 'live' : 'demo mode'}
    <span className="muted-text">{status.configured ? status.chatModel : 'text only'}</span>
  </div>
}

export function Stat({ label, value, note, icon, tone = 'blue' }: { label: string; value: string | number; note: string; icon: React.ReactNode; tone?: 'blue' | 'teal' | 'green' | 'amber' | 'red' }) {
  return <div className="card kpi"><div className="kpi-top"><span className="kpi-label">{label}</span><div className={`kpi-icon ${tone}`}>{icon}</div></div><div className="kpi-value">{value}</div><div className="kpi-note">{note}</div></div>
}

export function Skeleton({ width = '100%', height = 14, rounded = true }: { width?: string | number; height?: string | number; rounded?: boolean }) {
  const h = typeof height === 'number' ? height : height
  return <div className={`nv-skeleton ${rounded ? 'nv-skeleton--rounded' : ''}`} style={{ width: typeof width === 'number' ? width + 'px' : width, height: typeof h === 'number' ? h + 'px' : h }} />
}

export function Spinner({ size = 20 }: { size?: number }) {
  return <RefreshCw className="spin" size={size} />
}

export function Tag({ children, tone }: { children: React.ReactNode; tone?: 'blue' | 'teal' | 'amber' | 'neutral' }) {
  return <span className={`tag ${tone == null ? 'neutral' : tone}`}>{children}</span>
}
