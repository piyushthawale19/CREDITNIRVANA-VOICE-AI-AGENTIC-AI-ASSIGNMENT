import { useEffect, useState } from 'react'
import type React from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import {
  Activity, ArrowRight, BarChart3, Bot as BotIcon, ChevronRight, Eye, EyeOff, FileText, History,
  LayoutDashboard, LogOut, Menu, PhoneCall, RefreshCw, Settings, ShieldCheck, X,
} from 'lucide-react'
import { api, setStoredToken } from './api'
import type { IntegrationStatus, User } from './types'
import { IntegrationPill, Logo } from './ui'
import Dashboard from './pages/Dashboard'
import Bots from './pages/Bots'
import BotConfig from './pages/BotConfig'
import Playground from './pages/Playground'
import PhoneCalls from './pages/PhoneCalls'
import HistoryPage from './pages/History'
import Analytics from './pages/Analytics'
import Documentation from './pages/Documentation'
import SettingsPage from './pages/Settings'

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)

  function validate() {
    const next: Record<string, string> = {}
    if (mode === 'register' && name.trim().length < 2) next.name = 'Enter your full name.'
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) next.email = 'Enter a valid email address.'
    if (password.length < (mode === 'register' ? 8 : 1)) next.password = mode === 'register' ? 'Password must be at least 8 characters.' : 'Enter your password.'
    setFieldErrors(next)
    return Object.keys(next).length === 0
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    if (!validate()) return
    setLoading(true)
    try {
      const data = await api<{ user: User; token?: string }>(`/api/auth/${mode}`, {
        method: 'POST',
        body: JSON.stringify(mode === 'login' ? { email: email.trim(), password } : { name: name.trim(), email: email.trim(), password }),
      })
      if (data.token) setStoredToken(data.token)
      onLogin(data.user)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to continue.')
    } finally {
      setLoading(false)
    }
  }

  function useDemo() {
    setMode('login')
    setEmail('demo@nirvana.local')
    setPassword('demo1234')
    setFieldErrors({})
    setError('')
  }

  return <div className="login-shell">
    <section className="login-art">
      <Logo />
      <div className="login-copy">
        <p className="eyebrow">Credit operations, with clarity</p>
        <h1>Make every customer conversation count.</h1>
        <p>Configure, test and review compliant voice agents for settlement and renewal workflows from one focused workspace. Built around two real Sarvam AI voice bots — not static screens.</p>
      </div>
      <div className="trust-row">
        <div className="trust-chip"><ShieldCheck size={15} /> Server-side keys</div>
        <div className="trust-chip"><Activity size={15} /> Measured outcomes</div>
      </div>
    </section>
    <section className="login-panel">
      <div className="login-box">
        <div className="login-box-head"><Logo /><span className="badge blue">Operator access</span></div>
        <h2>{mode === 'login' ? 'Welcome back' : 'Create workspace access'}</h2>
        <p>{mode === 'login' ? 'Sign in to your voice operations workspace.' : 'Create a local operator account for this evaluation.'}</p>
        {error && <div className="error">{error}</div>}
        <form onSubmit={submit} noValidate>
          {mode === 'register' && <div className="field">
            <label htmlFor="name">Full name</label>
            <input id="name" className="input" value={name} onChange={event => setName(event.target.value)} placeholder="Aarav Mehta" autoComplete="name" aria-invalid={Boolean(fieldErrors.name)} />
            {fieldErrors.name && <span className="field-error">{fieldErrors.name}</span>}
          </div>}
          <div className="field">
            <label htmlFor="email">Email address</label>
            <input id="email" className="input" type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@company.com" autoComplete="email" aria-invalid={Boolean(fieldErrors.email)} />
            {fieldErrors.email && <span className="field-error">{fieldErrors.email}</span>}
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <div className="password-wrap">
              <input id="password" className="input" type={show ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} placeholder={mode === 'register' ? 'At least 8 characters' : 'Your password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} aria-invalid={Boolean(fieldErrors.password)} />
              <button type="button" className="icon-btn" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
            </div>
            {fieldErrors.password && <span className="field-error">{fieldErrors.password}</span>}
          </div>
          <button className="btn primary wide" disabled={loading}>
            {loading ? <RefreshCw size={15} className="spin" /> : <ArrowRight size={15} />}
            {loading ? 'Checking access…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <div className="demo-note">
          <strong>Evaluation workspace</strong>
          <p>Seeded local operator: <b>demo@nirvana.local</b> / <b>demo1234</b>. This is not a real customer account.</p>
          {mode === 'login' && email === '' && <button type="button" className="btn small" onClick={useDemo}>Fill demo credentials</button>}
        </div>
        <button className="btn ghost wide" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); setFieldErrors({}) }}>
          {mode === 'login' ? 'Create a different account' : 'Back to sign in'}
        </button>
      </div>
    </section>
  </div>
}

const primaryNav = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/bots', label: 'Voice bots', icon: BotIcon },
  { to: '/calls', label: 'Phone calls', icon: PhoneCall },
  { to: '/history', label: 'Conversation history', icon: History },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
]
const secondaryNav = [
  { to: '/documentation', label: 'Documentation', icon: FileText },
  { to: '/settings', label: 'Settings', icon: Settings },
]

function Shell({ user, onLogout }: { user: User; onLogout: () => void }) {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<IntegrationStatus | null>(null)
  const current = [...primaryNav, ...secondaryNav].find(item => item.to !== '/' && location.pathname.startsWith(item.to)) || primaryNav[0]

  useEffect(() => {
    api<IntegrationStatus>('/api/integrations/status').then(setStatus).catch(() => setStatus(null))
  }, [])

  useEffect(() => { setOpen(false) }, [location.pathname])

  const initials = user.name.split(' ').filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase()

  return <div className="app-shell">
    {open && <button className="scrim" aria-label="Close navigation" onClick={() => setOpen(false)} />}
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <div className="sidebar-head"><Logo /><button className="mobile-menu close" onClick={() => setOpen(false)} aria-label="Close navigation"><X size={18} /></button></div>
      <nav>
        <div className="nav-label">Workspace</div>
        {primaryNav.map(item => <Link key={item.to} to={item.to} className={`nav-item ${current.to === item.to ? 'active' : ''}`}><item.icon size={16} />{item.label}</Link>)}
        <div className="nav-label">Resources</div>
        {secondaryNav.map(item => <Link key={item.to} to={item.to} className={`nav-item ${current.to === item.to ? 'active' : ''}`}><item.icon size={16} />{item.label}</Link>)}
      </nav>
      <div className="sidebar-footer">
        <Link to="/settings" className="sidebar-user">
          <div className="avatar">{initials}</div>
          <div className="sidebar-user-text"><strong>{user.name}</strong><span>{user.email}</span></div>
        </Link>
        <button className="btn ghost full left" onClick={onLogout}><LogOut size={14} /> Sign out</button>
      </div>
    </aside>
    <main className="main">
      <header className="topbar">
        <div className="topbar-left">
          <button className="mobile-menu" onClick={() => setOpen(true)} aria-label="Open navigation"><Menu size={20} /></button>
          <div className="breadcrumb">Workspace <ChevronRight size={13} /> <strong>{current.label}</strong></div>
        </div>
        <div className="top-actions">
          <Link to="/settings" className="status-link"><IntegrationPill status={status} /></Link>
          <div className="avatar" title={user.email}>{initials}</div>
        </div>
      </header>
      <Routes>
        <Route path="/" element={<Dashboard user={user} status={status} />} />
        <Route path="/bots" element={<Bots />} />
        <Route path="/bots/:botId/configure" element={<BotConfig />} />
        <Route path="/bots/:botId/playground" element={<Playground status={status} />} />
        <Route path="/calls" element={<PhoneCalls user={user} />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/documentation" element={<Documentation />} />
        <Route path="/settings" element={<SettingsPage user={user} status={status} onLogout={onLogout} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </main>
  </div>
}


export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [checking, setChecking] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    api<{ user: User; token?: string }>('/api/auth/me')
      .then(data => {
        if (data.token) setStoredToken(data.token)
        setUser(data.user)
      })
      .catch(() => {
        setStoredToken(null)
        setUser(null)
      })
      .finally(() => setChecking(false))
  }, [])

  if (checking) return <div className="app-loading"><RefreshCw className="spin" size={22} /><span>Checking your session…</span></div>
  if (!user) return <Login onLogin={user => { setUser(user); navigate('/') }} />
  return <Shell user={user} onLogout={async () => {
    try { await api('/api/auth/logout', { method: 'POST' }) } catch { /* the cookie is cleared client-side regardless */ }
    setStoredToken(null)
    setUser(null)
    navigate('/')
  }} />
}
