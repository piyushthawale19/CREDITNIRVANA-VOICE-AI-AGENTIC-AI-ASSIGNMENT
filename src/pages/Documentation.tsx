import { useEffect, useState } from 'react'
import { Copy, FileText, ShieldCheck } from 'lucide-react'
import { api } from '../api'
import type { Bot, IntegrationStatus } from '../types'
import { ErrorBanner, LoadingCard, PageHead } from '../ui'

export default function Documentation() {
  const [bots, setBots] = useState<Bot[]>([])
  const [status, setStatus] = useState<IntegrationStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')

  useEffect(() => {
    Promise.all([api<Bot[]>('/api/bots'), api<IntegrationStatus>('/api/integrations/status').catch(() => null)])
      .then(([botData, statusData]) => { setBots(botData); setStatus(statusData) })
      .catch(err => setError(err instanceof Error ? err.message : 'Unable to load documentation data.'))
      .finally(() => setLoading(false))
  }, [])

  async function copyPrompt(bot: Bot) {
    try {
      await navigator.clipboard.writeText(bot.systemPrompt)
      setCopied(bot.id)
      window.setTimeout(() => setCopied(''), 2500)
    } catch {
      setError('Clipboard access was blocked. Select the prompt text and copy it manually, or use docs/system-prompts.md.')
    }
  }

  return <div className="content">
    <PageHead eyebrow="Documentation" title="Understand the system before you demo it." subtitle="Prompts, architecture, setup and honest limitations — in the same workspace an evaluator uses." />

    {error && <ErrorBanner message={error} />}
    {loading ? <LoadingCard label="Loading documentation…" /> : <>
      <div className="grid two">
        <div className="card card-pad">
          <h2 className="section-title">Architecture</h2>
          <p className="prose">Nirvana Voice Studio is a React + TypeScript control panel (Vite) backed by an Express API and SQLite. The browser never receives the Sarvam API key. The conversation engine runs server-side:</p>
          <ul className="doc-list">
            <li><strong>Turn engine:</strong> Sarvam chat completions (<code>{status?.chatModel || 'sarvam-105b'}</code>) with the editable prompt plus a machine-readable outcome contract.</li>
            <li><strong>Speech in:</strong> browser microphone → <code>POST /api/voice/transcribe</code> → Sarvam <code>{status?.sttModel || 'saaras:v4'}</code>.</li>
            <li><strong>Speech out:</strong> agent reply → <code>POST /api/voice/speak</code> → Sarvam <code>{status?.ttsModel || 'bulbul:v3'}</code>.</li>
            <li><strong>Persistence:</strong> users, bots, prompt versions and sessions in SQLite; sessions are scoped to the signed-in operator.</li>
            <li><strong>Safety net:</strong> a deterministic business-rule engine runs when credentials are missing or the provider fails, and every reply passes a compliance gate before it is stored.</li>
          </ul>
          <div className={`status-banner ${status?.configured ? 'green' : 'amber'}`}>
            <ShieldCheck size={16} />
            <div><strong>{status?.configured ? 'Live Sarvam mode' : 'Demo mode — no provider calls'}</strong><p>{status?.notes}</p></div>
          </div>
        </div>

        <div className="card card-pad">
          <h2 className="section-title">Local setup</h2>
          <p className="section-caption">The project runs a server API and a client app together. The client connects to the server the same way it connects in production; there is no separate fake mode.</p>
          <pre className="code-block">{`npm install
cp .env.example .env     # add SARVAM_API_KEY for live voice
npm run dev              # API :8787 + Vite :5173

Open http://localhost:5173
Demo login: demo@nirvana.local / demo1234`}</pre>
          <h3 className="sub-title">Environment variables</h3>
          <pre className="code-block">{`PORT=8787
JWT_SECRET=<long random secret>       # required in production
SARVAM_API_KEY=<server-side key>      # never exposed to the browser
SARVAM_CHAT_MODEL=sarvam-105b
SARVAM_STT_MODEL=saaras:v4
SARVAM_TTS_MODEL=bulbul:v3
DATABASE_PATH=./data/nirvana.sqlite
APP_ORIGIN=http://localhost:5173      # comma-separated allowed origins`}</pre>
          <p className="field-hint">Speech-to-text accepts up to 30 seconds of audio per REST request. Keys stay on the server; the playground reports provider failures instead of hiding them.</p>
          <p className="field-hint">Restart the server after changing environment variables. The integration status on the settings page is read from the running server, not from the file on disk.</p>
        </div>
      </div>

      <div className="grid two mt">
        <div className="card card-pad">
          <h2 className="section-title">Security model</h2>
          <ul className="doc-list">
            <li>Passwords are hashed with bcrypt at cost 12; no plaintext or client-side password handling.</li>
            <li>Two-hour JWTs in an <code>HttpOnly</code>, <code>SameSite=Lax</code> cookie (<code>Secure</code> in production). No tokens in localStorage.</li>
            <li>Login and voice endpoints are rate limited; auth errors are generic and timing-safe for unknown accounts.</li>
            <li>Origin checks on mutations, Helmet security headers, 256 KB JSON limit, 8 MB audio limit.</li>
            <li>Session reads and writes are filtered by <code>user_id</code>; prompt writes require authentication.</li>
            <li>Zod validates every request body; API keys are never returned by any endpoint.</li>
          </ul>
        </div>
        <div className="card card-pad">
          <h2 className="section-title">Testing</h2>
          <pre className="code-block">{`npm test        # node:test API + conversation suite
npm run lint    # TypeScript project check
npm run build   # production bundle`}</pre>
          <p className="field-hint">Run the build and lint commands before submitting. If something cannot be tested, document why instead of claiming a passing check.</p>
          <p className="prose">The suite covers login, invalid credentials, protected routes, cross-user session access, validation, prompt versioning, loan objections (hardship, dispute, lower offer, human request, credit reporting), insurance objections (IDV, competitor quote, add-ons, exclusions, consent), compliance guarding and the "no fake conversion" rules.</p>
          <h3 className="sub-title">Known limitations</h3>
          <ul className="doc-list">
            <li>Live voice needs a funded Sarvam key and quota; without it the UI states demo mode and disables the microphone.</li>
            <li>No phone/PSTN dialling. Test calls use the browser microphone; two test numbers must be supplied by the owner if outbound calling is added.</li>
            <li>No audio recordings are stored or claimed.</li>
            <li>Add-on pricing and final premiums must be confirmed by the insurer; the engine flags them instead of inventing a total.</li>
            <li>Settlement authorisation is a backend concern. The demo records authorisation as pending and never marks it approved.</li>
          </ul>
        </div>
      </div>

      <div className="card mt">
        <div className="card-head"><div><h2>System prompts</h2><p>The exact editable prompts stored in the database. Versioned on every save.</p></div><FileText size={16} className="muted-text" /></div>
        {bots.map(bot => <details key={bot.id} className="prompt-details" open={bot.id === 'loan'}>
          <summary><span>{bot.name} · v{bot.promptVersion}</span><span className="badge blue">{bot.systemPrompt.length.toLocaleString()} chars</span></summary>
          <div className="prompt-actions"><button className="btn small" onClick={() => copyPrompt(bot)}><Copy size={13} /> {copied === bot.id ? 'Copied' : 'Copy prompt'}</button><span className="muted-text">Also saved in docs/system-prompts.md</span></div>
          <pre className="code-block prompt">{bot.systemPrompt}</pre>
        </details>)}
      </div>

      <div className="card card-pad mt">
        <h2 className="section-title">Deliverables in this repository</h2>
        <ul className="doc-list">
          <li><code>README.md</code> — setup, environment, API overview and evaluation guide.</li>
          <li><code>docs/system-prompts.md</code> — both complete prompts plus design rationale.</li>
          <li><code>docs/design-and-objection-handling.md</code> — UI decisions and objection playbooks.</li>
          <li><code>docs/api.md</code> — endpoints, data models and security notes.</li>
          <li><code>docs/test-results.md</code> — commands run and actual outcomes.</li>
        </ul>
      </div>
    </>}
  </div>
}
