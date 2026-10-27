import { useEffect, useState } from 'react'
import { Activity, Check, LogOut, RefreshCw, ShieldCheck, UserRound, Volume2 } from 'lucide-react'
import { api } from '../api'
import type { IntegrationStatus, User } from '../types'
import { PageHead } from '../ui'

type TestResult = { ok: boolean; mode: string; model?: string; latencyMs?: number; message?: string; reply?: string }

export default function SettingsPage({ user, status, onLogout }: { user: User; status: IntegrationStatus | null; onLogout: () => void }) {
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<TestResult | null>(null)
  const [autoplay, setAutoplay] = useState(() => localStorage.getItem('nirvana.autoplay') !== 'false')
  const [defaultMode, setDefaultMode] = useState(() => localStorage.getItem('nirvana.defaultMode') === 'voice' ? 'voice' : 'text')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    localStorage.setItem('nirvana.autoplay', String(autoplay))
  }, [autoplay])
  useEffect(() => {
    localStorage.setItem('nirvana.defaultMode', defaultMode)
  }, [defaultMode])

  function flash(message: string) {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 2500)
  }

  async function runTest() {
    setTesting(true); setTest(null)
    try {
      const result = await api<TestResult>('/api/integrations/test', { method: 'POST', body: JSON.stringify({}) })
      setTest(result)
    } catch (err) {
      setTest({ ok: false, mode: 'error', message: err instanceof Error ? err.message : 'Connection test failed.' })
    } finally {
      setTesting(false)
    }
  }

  return <div className="content">
    <PageHead eyebrow="Workspace settings" title="Keep the control plane transparent." subtitle="Account identity, real provider status and the preferences this browser actually applies." actions={<button className="btn danger" onClick={onLogout}><LogOut size={14} /> Sign out</button>} />
    {notice && <div className="success"><Check size={14} /> {notice}</div>}

    <div className="grid two">
      <div className="card">
        <div className="card-head"><div><h2>Profile</h2><p>Authenticated operator identity.</p></div><div className="avatar big">{user.name.split(' ').filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase()}</div></div>
        <div className="card-pad">
          <div className="settings-row"><div><h4>Name</h4><p>{user.name}</p></div><UserRound size={16} className="muted-text" /></div>
          <div className="settings-row"><div><h4>Email</h4><p>{user.email}</p></div><ShieldCheck size={16} className="green-icon" /></div>
          <div className="settings-row"><div><h4>Role</h4><p>{user.role}</p></div><span className="badge blue">Authenticated</span></div>
          <div className="settings-row"><div><h4>Session</h4><p>HTTP-only cookie · 2 hour expiry</p></div><span className="badge">JWT verified</span></div>
          <p className="field-hint">Profile editing is not enabled in this evaluation build; accounts are created through the sign-up form and stored server-side.</p>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div><h2>Integration status</h2><p>Derived from the running server, not hard-coded.</p></div><span className={`badge ${status?.configured ? 'green' : 'amber'}`}>{status?.configured ? 'Live adapter' : 'Demo mode'}</span></div>
        <div className="card-pad">
          <div className="settings-row"><div><h4>Provider</h4><p>Sarvam AI</p></div><Activity size={16} className="muted-text" /></div>
          <div className="settings-row"><div><h4>Conversation model</h4><p>{status?.chatModel || 'Unknown'}</p></div><span className="badge">{status?.configured ? 'Configured' : 'Credential required'}</span></div>
          <div className="settings-row"><div><h4>Speech-to-text</h4><p>{status?.sttModel || 'Unknown'}</p></div><span className="badge">{status?.configured ? 'Configured' : 'Credential required'}</span></div>
          <div className="settings-row"><div><h4>Text-to-speech</h4><p>{status?.ttsModel || 'Unknown'}</p></div><span className="badge">{status?.configured ? 'Configured' : 'Credential required'}</span></div>
          <div className="button-row mt-s">
            <button className="btn" onClick={runTest} disabled={testing}>{testing ? <RefreshCw size={14} className="spin" /> : <Activity size={14} />} {testing ? 'Testing Sarvam…' : 'Test Sarvam connection'}</button>
          </div>
          {test && <div className={`status-banner ${test.ok ? 'green' : 'amber'} inline`}>
            {test.ok ? <Check size={15} /> : <ShieldCheck size={15} />}
            <div><strong>{test.ok ? `Live: ${test.model} responded in ${test.latencyMs} ms` : 'No live connection established'}</strong><p>{test.ok ? `Reply: “${test.reply}”` : test.message || 'Provider unavailable.'}</p></div>
          </div>}
          <p className="field-hint">{status?.configured ? 'The test performs one small chat completion on the server. It consumes a negligible amount of quota.' : 'Add SARVAM_API_KEY to the server .env, restart the API, and reload this page. The test button confirms a real request works.'}</p>
        </div>
      </div>
    </div>

    <div className="card mt">
      <div className="card-head"><div><h2>Session preferences</h2><p>Stored in this browser only. They change real playground behaviour.</p></div><Volume2 size={16} className="muted-text" /><span className="badge blue">Browser only</span></div>
      <div className="card-pad">
        <label className="check-row"><input type="checkbox" checked={autoplay} onChange={event => { setAutoplay(event.target.checked); flash('Auto-play preference saved for this browser.') }} />
          <span><strong>Auto-play agent audio in voice sessions</strong><span className="field-hint">When off, voice replies are text-only and a Play reply button is shown.</span></span>
        </label>
        <label className="check-row"><input type="checkbox" checked readOnly />
          <span><strong>Store transcripts for authenticated review</strong><span className="field-hint">Required for conversation history and analytics; cannot be disabled in this build.</span></span>
        </label>
        <label className="check-row"><input type="checkbox" checked readOnly />
          <span><strong>Never count a verbal promise as a payment</strong><span className="field-hint">Enforced by the server outcome guard, not by a UI setting.</span></span>
        </label>
        <div className="form-row mt-s">
          <div className="field"><label htmlFor="default-mode">Default playground mode</label>
            <select id="default-mode" className="select" value={defaultMode} onChange={event => { setDefaultMode(event.target.value); flash('Default mode saved for this browser.') }}>
              <option value="text">Text test</option>
              <option value="voice">Sarvam voice test</option>
              <option value="phone">Real phone call</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  </div>
}

