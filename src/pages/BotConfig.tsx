import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Check, History, Info, Mic, Plus, RotateCcw, Save, X } from 'lucide-react'
import { api } from '../api'
import type { Bot, BotConfig as Config, IntegrationStatus, PromptVersion } from '../types'
import { EmptyState, ErrorBanner, LoadingCard, PageHead, formatDateTime } from '../ui'

const LANGUAGES: Array<{ value: string; label: string }> = [
  { value: 'en-IN', label: 'English (India)' },
  { value: 'hi-IN', label: 'Hindi' },
  { value: 'bn-IN', label: 'Bengali' },
  { value: 'ta-IN', label: 'Tamil' },
  { value: 'te-IN', label: 'Telugu' },
  { value: 'mr-IN', label: 'Marathi' },
  { value: 'gu-IN', label: 'Gujarati' },
  { value: 'kn-IN', label: 'Kannada' },
  { value: 'ml-IN', label: 'Malayalam' },
  { value: 'pa-IN', label: 'Punjabi' },
  { value: 'od-IN', label: 'Odia' },
]

export default function BotConfig() {
  const { botId } = useParams<{ botId: string }>()
  const navigate = useNavigate()
  const [bot, setBot] = useState<Bot | null>(null)
  const [prompt, setPrompt] = useState('')
  const [config, setConfig] = useState<Config | null>(null)
  const [versions, setVersions] = useState<PromptVersion[]>([])
  const [status, setStatus] = useState<IntegrationStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)

  useEffect(() => {
    if (!botId) return
    setLoading(true)
    Promise.all([
      api<Bot>(`/api/bots/${botId}`),
      api<PromptVersion[]>(`/api/bots/${botId}/versions`).catch(() => []),
      api<IntegrationStatus>('/api/integrations/status').catch(() => null),
    ]).then(([botData, versionData, statusData]) => {
      setBot(botData); setPrompt(botData.systemPrompt); setConfig(botData.config); setVersions(versionData); setStatus(statusData)
    }).catch(err => setError(err instanceof Error ? err.message : 'Unable to load this bot.'))
      .finally(() => setLoading(false))
  }, [botId])

  function update<K extends keyof Config>(key: K, value: Config[K]) {
    setConfig(current => current ? { ...current, [key]: value } : current)
  }

  function validate() {
    if (prompt.trim().length < 200) return 'The system prompt must be at least 200 characters.'
    if (!config) return 'Configuration is missing.'
    if (config.opening.trim().length < 20) return 'The opening statement needs at least 20 characters.'
    if (config.fallback.trim().length < 20) return 'The fallback response needs at least 20 characters.'
    if (!config.objectives.length) return 'Add at least one conversation objective.'
    if (config.objectives.some(objective => objective.trim().length < 3)) return 'Every objective needs at least 3 characters.'
    if (config.objectionGuidelines.trim().length < 20) return 'Add short objection-handling guidance.'
    if (config.complianceNote.trim().length < 10) return 'Add a compliance instruction.'
    return ''
  }

  async function save() {
    if (!bot || !config) return
    const problem = validate()
    if (problem) { setError(problem); setNotice(''); return }
    setSaving(true); setError(''); setNotice('')
    try {
      const updated = await api<Bot>(`/api/bots/${bot.id}`, { method: 'PUT', body: JSON.stringify({ systemPrompt: prompt, config }) })
      setBot(updated); setPrompt(updated.systemPrompt); setConfig(updated.config)
      setVersions(await api<PromptVersion[]>(`/api/bots/${bot.id}/versions`))
      setNotice(`Saved as prompt version ${updated.promptVersion}. New test sessions will use it.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save the configuration.')
    } finally {
      setSaving(false)
    }
  }

  async function reset() {
    if (!bot) return
    setSaving(true); setError(''); setNotice(''); setConfirmReset(false)
    try {
      const updated = await api<Bot>(`/api/bots/${bot.id}/reset`, { method: 'POST', body: JSON.stringify({}) })
      setBot(updated); setPrompt(updated.systemPrompt); setConfig(updated.config)
      setVersions(await api<PromptVersion[]>(`/api/bots/${bot.id}/versions`))
      setNotice(`Restored the reviewed default prompt as version ${updated.promptVersion}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to restore the default prompt.')
    } finally {
      setSaving(false)
    }
  }

  function loadVersion(version: PromptVersion) {
    setPrompt(version.systemPrompt)
    setConfig(version.config)
    setNotice(`Version ${version.promptVersion} loaded into the editor. Save to publish it as a new version.`)
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (loading) return <div className="content"><LoadingCard label="Loading bot configuration…" /></div>
  if (!bot || !config) return <div className="content"><ErrorBanner message={error || 'Bot not found.'} /></div>

  return <div className="content">
    <PageHead
      eyebrow={`${bot.name} / configuration`}
      title="Shape the conversation, not just the prompt."
      subtitle="Every save creates a prompt version stored server-side. Keep facts, boundaries and outcome rules explicit so an evaluator can challenge the bot safely."
      actions={<><button className="btn" onClick={() => navigate(`/bots/${bot.id}/playground`)}><Mic size={15} /> Open playground</button><button className="btn primary" onClick={save} disabled={saving}><Save size={15} /> {saving ? 'Saving…' : 'Save configuration'}</button></>}
    />
    {notice && <div className="success"><Check size={14} /> {notice}</div>}
    <ErrorBanner message={error} />

    <div className="config-grid">
      <div className="card">
        <div className="card-head"><div><h2>System prompt</h2><p>The exact instructions sent to the conversation engine.</p></div><span className="badge blue">v{bot.promptVersion}</span></div>
        <div className="card-pad">
          <textarea className="textarea prompt-editor" value={prompt} onChange={event => setPrompt(event.target.value)} spellCheck={false} aria-label="System prompt" />
          <div className="editor-meta"><span>{prompt.length.toLocaleString()} characters</span><span>Server minimum 200 · {prompt.split('\n').filter(Boolean).length} lines</span></div>
          <p className="field-hint">Editing the prompt does not change the live version until you save. Saving always creates a new version in history.</p>
        </div>
      </div>

      <div className="config-side">
        <div className="card">
          <div className="card-head"><div><h2>Voice & language</h2><p>Applied to Sarvam text-to-speech when configured.</p></div><span className="badge blue">{config.language}</span></div>
          <div className="card-pad">
            <div className="form-row">
              <div className="field"><label htmlFor="language">Language</label>
                <select id="language" className="select" value={config.language} onChange={event => update('language', event.target.value)}>
                  {LANGUAGES.map(language => <option key={language.value} value={language.value}>{language.label}</option>)}
                </select>
              </div>
              <div className="field"><label htmlFor="speaker">Speaker</label>
                <select id="speaker" className="select" value={config.speaker} onChange={event => update('speaker', event.target.value)}>
                  {(status?.speakers || [config.speaker]).map(speaker => <option key={speaker} value={speaker}>{speaker}</option>)}
                </select>
              </div>
            </div>
            {!status?.configured && <p className="field-hint">Live audio stays disabled until SARVAM_API_KEY is set on the server; settings are still saved.</p>}
            <p className="field-hint">Voice and language are applied to Sarvam text-to-speech when configured. The tone selector changes the configured response style.</p>
            <div className="field"><label htmlFor="opening">Opening statement</label>
              <textarea id="opening" className="textarea short" value={config.opening} onChange={event => update('opening', event.target.value)} />
            </div>
            <div className="field"><label htmlFor="fallback">Fallback response</label>
              <textarea id="fallback" className="textarea short" value={config.fallback} onChange={event => update('fallback', event.target.value)} />
            </div>
            <div className="field"><label htmlFor="tone">Agent tone</label>
              <select id="tone" className="select" value={config.tone || 'firm'} onChange={event => update('tone', event.target.value)}>
                <option value="firm">Firm, direct, professional</option>
                <option value="consultative">Consultative</option>
                <option value="calm">Calm, composed, patient</option>
              </select>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><div><h2>Objectives</h2><p>What this agent should accomplish in a session.</p></div></div>
          <div className="card-pad">
            {config.objectives.map((objective, index) => <div className="objective-row" key={index}>
              <input className="input" value={objective} onChange={event => { const next = [...config.objectives]; next[index] = event.target.value; update('objectives', next) }} aria-label={`Objective ${index + 1}`} />
              <button className="btn ghost danger icon-only" onClick={() => update('objectives', config.objectives.filter((_, position) => position !== index))} aria-label="Remove objective"><X size={14} /></button>
            </div>)}
            <button className="btn small" onClick={() => update('objectives', [...config.objectives, 'New measurable objective'])}><Plus size={14} /> Add objective</button>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><div><h2>Objection guidance</h2><p>Short handling rules, not a full script.</p></div></div>
          <div className="card-pad">
            <div className="field"><label htmlFor="objections">Handling guidelines</label>
              <textarea id="objections" className="textarea short" value={config.objectionGuidelines} onChange={event => update('objectionGuidelines', event.target.value)} />
            </div>
            <div className="field"><label htmlFor="compliance">Compliance instruction</label>
              <textarea id="compliance" className="textarea short" value={config.complianceNote} onChange={event => update('complianceNote', event.target.value)} />
            </div>
          </div>
        </div>

        <div className="card card-pad">
          <h2 className="section-title">Danger zone</h2>
          <p className="section-caption">Restoring the reviewed default creates a new version; older versions stay in history.</p>
          {confirmReset
            ? <div className="confirm-box"><p>Replace the current prompt and settings with the reviewed default?</p>
              <div className="button-row"><button className="btn danger" onClick={reset} disabled={saving}><RotateCcw size={14} /> Yes, restore default</button><button className="btn ghost" onClick={() => setConfirmReset(false)}>Cancel</button></div>
            </div>
            : <button className="btn mt-s" onClick={() => setConfirmReset(true)}><RotateCcw size={14} /> Restore default prompt</button>}
        </div>
      </div>
    </div>

    <div className="card mt">
      <div className="card-head"><div><h2>Version history</h2><p>Latest 20 saved versions. Loading a version does not change the live prompt until you save.</p></div><History size={16} className="muted-text" /><span className="badge teal">{versions.length} stored</span></div>
      {versions.length === 0
        ? <EmptyState title="No versions stored" body="Save the prompt once to create the first version." />
        : <div className="table-wrap"><table className="table">
          <thead><tr><th>Version</th><th>Saved</th><th>Prompt</th><th>Speaker</th><th /></tr></thead>
          <tbody>{versions.map(version => <tr key={version.promptVersion}>
            <td><strong>v{version.promptVersion}</strong>{version.promptVersion === bot.promptVersion && <span className="badge green ml-s">Live</span>}</td>
            <td>{formatDateTime(version.createdAt)}</td>
            <td>{version.systemPrompt.length.toLocaleString()} chars</td>
            <td>{version.config.speaker}</td>
            <td><button className="btn small" onClick={() => loadVersion(version)}>Load</button></td>
          </tr>)}</tbody>
        </table></div>}
    </div>
  </div>
}
