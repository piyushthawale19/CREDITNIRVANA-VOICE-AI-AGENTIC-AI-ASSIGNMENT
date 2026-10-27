import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bot as BotIcon, CreditCard, FileText, Mic, Settings, ShieldCheck, Volume2, WalletCards } from 'lucide-react'
import { api } from '../api'
import type { Bot } from '../types'
import { ErrorBanner, LoadingCard, PageHead } from '../ui'

const facts: Record<string, string[]> = {
  loan: ['₹6,50,000 verified total', '₹4,00,000 settlement proposal', '8 months unpaid'],
  insurance: ['IDV ₹9,00,000 → ₹8,00,000', 'Premium ₹20,000 → ₹15,000', 'Maruti Brezza'],
}

const scenarioCopy: Record<string, string> = {
  loan: 'Verified dues ₹4,00,000 principal + ₹2,00,000 interest + ₹50,000 other charges. The bot verifies the customer first, separates hardship from postponement, and records a proposal — never an approval.',
  insurance: 'Explains the ₹1,00,000 IDV reduction and the ₹5,000 discount, compares coverage rather than price, and records consent before anything is treated as a renewal decision.',
}

export default function Bots() {
  const [bots, setBots] = useState<Bot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  function load() {
    setLoading(true)
    api<Bot[]>('/api/bots')
      .then(setBots)
      .catch(err => setError(err instanceof Error ? err.message : 'Unable to load bots.'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  return <div className="content">
    <PageHead eyebrow="Voice bots" title="Two focused agents. One control panel." subtitle="Configure conversation boundaries, challenge each agent with difficult objections, and inspect the exact outcome the server recorded." />
    {error && <ErrorBanner message={error} onRetry={load} />}
    <div className="grid two">
      {loading ? <><LoadingCard /></> : bots.map(bot => {
        const loan = bot.type === 'loan'
        return <div className="card bot-card" key={bot.id}>
          <div className={"bot-icon"}>{loan ? <WalletCards size={22} /> : <CreditCard size={22} />}</div>
          <div className="bot-card-top">
            <h3>{bot.name}</h3>
            <span className="badge green"><span className="dot live" /> Ready</span>
          </div>
          <p>{bot.description}</p>
          <p className="bot-scenario">{scenarioCopy[bot.id]}</p>
          <div className="tag-row">{facts[bot.id].map(tag => <span className={`tag ${loan ? 'blue' : 'teal'}`} key={tag}>{tag}</span>)}</div>
          <div className="bot-meta">
            <span><FileText size={13} /> Prompt v{bot.promptVersion}</span>
            <span><Volume2 size={13} /> {bot.config.speaker}</span>
            <span><BotIcon size={13} /> {bot.config.language}</span>
          </div>
          <div className="bot-actions">
            <Link className="btn" to={`/bots/${bot.id}/configure`}><Settings size={14} /> Configure</Link>
            <Link className="btn primary" to={`/bots/${bot.id}/playground`}><Mic size={14} /> Test bot</Link>
          </div>
        </div>
      })}
    </div>
    <div className="card card-pad mt">
      <div className="row-start">
        <ShieldCheck size={19} className="green-icon" />
        <div>
          <h2 className="section-title">Evaluation guardrails</h2>
          <p className="section-caption prose">The workspace separates proposed interest from authorised conversion. A verbal promise never becomes a payment, a quote acceptance never becomes an issued policy, and missing Sarvam credentials are shown as demo mode instead of being hidden behind a fake call.</p>
        </div>
      </div>
    </div>
  </div>
}
