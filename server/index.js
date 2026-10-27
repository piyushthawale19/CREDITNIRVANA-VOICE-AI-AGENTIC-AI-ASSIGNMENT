import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import {
  db, publicUser, getBot, mapBot, mapSession, mapVersion, mapCall, createCall, updateCall,
  getCall, getCallById, getCallByProviderId, listCalls, deleteCallRecording, setDemoStatus,
  RECORDINGS_DIR, resolveRecordingPath, DEFAULT_PROMPTS, DEFAULT_CONFIG, BOT_META
} from './db.js'
import { respond } from './agent.js'
import { sarvamStatus, synthesize, transcribeAudio, testConnection } from './sarvam.js'
import { getTelephonyConfig, startPhoneCall, terminateCall, generateAssignmentDemo, buildTwiml } from './telephony.js'

const app = express()
const port = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 8787
const isProduction = process.env.NODE_ENV === 'production'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.join(__dirname, '..')

// A missing secret must never fall back to a hard-coded value that would let anyone
// mint tokens. Development gets an ephemeral secret; production refuses to boot.
if (isProduction && !process.env.JWT_SECRET) {
  console.error('JWT_SECRET must be set in production. Refusing to start.')
  process.exit(1)
}
const secret = process.env.JWT_SECRET || crypto.randomBytes(48).toString('hex')
if (!process.env.JWT_SECRET) console.warn('JWT_SECRET is not set; using an ephemeral development secret.')

const allowedOrigins = (process.env.APP_ORIGIN || 'http://localhost:5173,http://localhost:4173,http://localhost:8787')
  .split(',').map(origin => origin.trim()).filter(Boolean)

function isOriginAllowed(origin) {
  if (!origin) return true
  if (allowedOrigins.includes(origin)) return true
  try {
    const { hostname } = new URL(origin)
    if (hostname.endsWith('.vercel.app') || hostname === 'localhost' || hostname === '127.0.0.1') return true
  } catch {}
  return false
}

app.disable('x-powered-by')
app.use(helmet({ crossOriginResourcePolicy: false }))
app.use(cors({
  origin: (origin, callback) => {
    callback(null, isOriginAllowed(origin))
  },
  credentials: true
}))
app.use(express.json({ limit: '256kb' }))
app.use(express.urlencoded({ extended: true, limit: '256kb' }))

app.use((req, _res, next) => {
  const raw = req.headers.cookie || ''
  req.cookies = Object.fromEntries(raw.split(';').filter(Boolean).map(value => {
    const [key, ...rest] = value.trim().split('=')
    try { return [key, decodeURIComponent(rest.join('='))] } catch { return [key, ''] }
  }))

  next()
})

// Browsers always send Origin on cross-site mutations.
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
  if (req.path.startsWith('/telephony/webhook')) return next()
  const origin = req.headers.origin
  if (origin && !isOriginAllowed(origin)) return res.status(403).json({ error: 'Origin not allowed.' })
  next()
})

const apiLimiter = rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: true, legacyHeaders: false })
const authLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Try again in a few minutes.' } })
const voiceLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Voice rate limit reached. Wait a minute and retry.' } })
app.use('/api', apiLimiter)

const callLimiter = rateLimit({ windowMs: 60_000, limit: 15, standardHeaders: true, legacyHeaders: false, message: { error: 'Call rate limit reached. Please wait a minute before starting another call.' } })

function tokenFor(user) { return jwt.sign({ sub: user.id, role: user.role }, secret, { expiresIn: '2h' }) }
function setAuth(res, user) {
  res.cookie('nirvana_token', tokenFor(user), {
    httpOnly: true,
    sameSite: isProduction ? 'none' : 'lax',
    secure: isProduction,
    maxAge: 2 * 60 * 60 * 1000,
    path: '/'
  })
}
function auth(req, res, next) {
  try {
    const bearer = (req.headers.authorization || '').startsWith('Bearer ') ? req.headers.authorization.slice(7) : null
    const queryToken = typeof req.query?.token === 'string' ? req.query.token : null
    const token = req.cookies?.nirvana_token || bearer || queryToken
    if (!token) return res.status(401).json({ error: 'Authentication required.' })
    const payload = jwt.verify(token, secret)
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub)
    if (!user) return res.status(401).json({ error: 'Authentication required.' })
    req.user = user
    next()
  } catch {
    return res.status(401).json({ error: 'Authentication required.' })
  }
}

const emailSchema = z.string().trim().toLowerCase().email().max(160)
const passwordSchema = z.string().min(8, 'Password must be at least 8 characters.').max(128)

const configSchema = z.object({
  language: z.enum(['en-IN', 'hi-IN', 'bn-IN', 'ta-IN', 'te-IN', 'mr-IN', 'gu-IN', 'kn-IN', 'ml-IN', 'pa-IN', 'od-IN']),
  speaker: z.string().min(2).max(40),
  opening: z.string().min(20).max(600),
  fallback: z.string().min(20).max(600),
  objectives: z.array(z.string().min(3).max(160)).min(1).max(8),
  objectionGuidelines: z.string().min(20).max(1200),
  complianceNote: z.string().min(10).max(1200),
})

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'nirvana-voice-studio', now: new Date().toISOString() }))
app.get('/api/integrations/status', auth, (_req, res) => res.json(sarvamStatus()))
app.post('/api/integrations/test', auth, voiceLimiter, async (_req, res) => {
  const result = await testConnection()
  res.status(result.ok ? 200 : 503).json(result)
})

app.post('/api/auth/register', authLimiter, async (req, res) => {
  const parsed = z.object({ name: z.string().trim().min(2).max(80), email: emailSchema, password: passwordSchema }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Enter a name, valid email and a password of at least 8 characters.' })
  try {
    const hash = await bcrypt.hash(parsed.data.password, 12)
    const result = db.prepare('INSERT INTO users (name,email,password_hash) VALUES (?,?,?)').run(parsed.data.name, parsed.data.email, hash)
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid)
    setAuth(res, user)
    const token = tokenFor(user)
    return res.status(201).json({ user: publicUser(user), token })
  } catch {
    return res.status(409).json({ error: 'That email is already registered.' })
  }
})

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const parsed = z.object({ email: emailSchema, password: z.string().min(1).max(128) }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email and password.' })
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(parsed.data.email)
  // Compare against a dummy hash when the account is unknown so timing does not reveal it.
  const hash = user?.password_hash || '$2b$12$C6UzMDM.H6dfI/f/IKcEeO5.b2QJ0o8v3n9Xg6Q2aJ0k8Q5b2n5Xu'
  const matches = await bcrypt.compare(parsed.data.password, hash)
  if (!user || !matches) return res.status(401).json({ error: 'Invalid email or password.' })
  setAuth(res, user)
  const token = tokenFor(user)
  res.json({ user: publicUser(user), token })
})

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('nirvana_token', { path: '/', httpOnly: true, sameSite: isProduction ? 'none' : 'lax', secure: isProduction })
  res.json({ ok: true })
})
app.get('/api/auth/me', auth, (req, res) => res.json({ user: publicUser(req.user), token: tokenFor(req.user) }))

app.get('/api/bots', auth, (_req, res) => res.json(db.prepare('SELECT * FROM bots ORDER BY id').all().map(mapBot)))
app.get('/api/bots/:id', auth, (req, res) => {
  const bot = mapBot(getBot(req.params.id))
  return bot ? res.json(bot) : res.status(404).json({ error: 'Bot not found.' })
})

app.put('/api/bots/:id', auth, (req, res) => {
  const parsed = z.object({ systemPrompt: z.string().min(200).max(20_000), config: configSchema }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Prompt and configuration are required.' })
  const bot = getBot(req.params.id)
  if (!bot) return res.status(404).json({ error: 'Bot not found.' })
  if (!sarvamStatus().speakers.includes(parsed.data.config.speaker)) {
    return res.status(400).json({ error: 'Choose a speaker supported by Sarvam text-to-speech.' })
  }
  const nextVersion = bot.prompt_version + 1
  const save = db.transaction(() => {
    db.prepare('UPDATE bots SET system_prompt = ?, config_json = ?, prompt_version = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(parsed.data.systemPrompt, JSON.stringify(parsed.data.config), nextVersion, bot.id)
    db.prepare('INSERT INTO bot_prompt_versions (bot_id,prompt_version,system_prompt,config_json,created_by) VALUES (?,?,?,?,?)')
      .run(bot.id, nextVersion, parsed.data.systemPrompt, JSON.stringify(parsed.data.config), req.user.id)
  })
  save()
  res.json(mapBot(getBot(bot.id)))
})

app.get('/api/bots/:id/versions', auth, (req, res) => {
  if (!getBot(req.params.id)) return res.status(404).json({ error: 'Bot not found.' })
  const rows = db.prepare('SELECT * FROM bot_prompt_versions WHERE bot_id = ? ORDER BY prompt_version DESC LIMIT 20').all(req.params.id)
  res.json(rows.map(mapVersion))
})

app.post('/api/bots/:id/reset', auth, (req, res) => {
  const bot = getBot(req.params.id)
  if (!bot || !DEFAULT_PROMPTS[bot.id]) return res.status(404).json({ error: 'Bot not found.' })
  const nextVersion = bot.prompt_version + 1
  const prompt = DEFAULT_PROMPTS[bot.id]
  const config = DEFAULT_CONFIG[bot.id]
  const restore = db.transaction(() => {
    db.prepare('UPDATE bots SET system_prompt = ?, config_json = ?, prompt_version = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(prompt, JSON.stringify(config), nextVersion, bot.id)
    db.prepare('INSERT INTO bot_prompt_versions (bot_id,prompt_version,system_prompt,config_json,created_by) VALUES (?,?,?,?,?)')
      .run(bot.id, nextVersion, prompt, JSON.stringify(config), req.user.id)
  })
  restore()
  res.json(mapBot(getBot(bot.id)))
})

function ownedSession(id, userId) {
  return db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?').get(id, userId)
}

app.post('/api/sessions', auth, (req, res) => {
  const parsed = z.object({ botId: z.enum(Object.keys(BOT_META)), mode: z.enum(['voice', 'text']).default('text') }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Select a valid bot and mode.' })
  const bot = getBot(parsed.data.botId)
  const id = crypto.randomUUID()
  const opening = JSON.parse(bot.config_json).opening
  const transcript = [{ id: crypto.randomUUID(), speaker: 'agent', text: opening, timestamp: new Date().toISOString() }]
  db.prepare('INSERT INTO sessions (id,user_id,bot_id,scenario_type,transcript_json,outcome,mode,engine) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, req.user.id, bot.id, bot.type, JSON.stringify(transcript), 'in_progress', parsed.data.mode === 'voice' ? 'voice' : 'text-simulated', 'pending')
  res.status(201).json(mapSession(ownedSession(id, req.user.id)))
})

app.post('/api/sessions/:id/respond', auth, async (req, res) => {
  const parsed = z.object({ text: z.string().trim().min(1).max(2000) }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Enter a customer message of 1–2000 characters.' })
  const row = ownedSession(req.params.id, req.user.id)
  if (!row) return res.status(404).json({ error: 'Session not found.' })
  if (row.completed_at) return res.status(409).json({ error: 'This session is completed. Start a new one to continue testing.' })
  const transcript = JSON.parse(row.transcript_json)
  if (transcript.length >= 60) return res.status(409).json({ error: 'Turn limit reached. Complete the session and start a new one.' })
  const bot = getBot(row.bot_id)

  let result
  try {
    result = await respond({ botType: row.bot_id, bot, input: parsed.data.text, transcript })
  } catch (error) {
    console.error('Conversation engine error:', error.message)
    return res.status(502).json({ error: 'The conversation engine did not respond. Try again or switch to text simulation.' })
  }

  const customerMessage = { id: crypto.randomUUID(), speaker: 'customer', text: parsed.data.text, timestamp: new Date().toISOString() }
  const agentMessage = { id: crypto.randomUUID(), speaker: 'agent', text: result.reply, timestamp: new Date().toISOString(), engine: result.engine }
  transcript.push(customerMessage, agentMessage)

  const existingObjections = JSON.parse(row.objections_json)
  const existingAddOns = JSON.parse(row.selected_add_ons_json)
  const objections = [...new Set([...existingObjections, ...result.objections])]
  const addOns = [...new Set([...existingAddOns, ...result.selectedAddOns])]
  const flags = [...new Set([...JSON.parse(row.compliance_flags_json), ...result.complianceFlags])]

  db.prepare(`UPDATE sessions SET transcript_json = ?, outcome = ?, objections_json = ?, commitment_date = COALESCE(?, commitment_date),
    selected_add_ons_json = ?, final_quoted_amount = COALESCE(?, final_quoted_amount), compliance_flags_json = ?, engine = ? WHERE id = ?`)
    .run(JSON.stringify(transcript), result.outcome, JSON.stringify(objections), result.commitmentDate, JSON.stringify(addOns),
      result.finalQuotedAmount, JSON.stringify(flags), result.engine, row.id)

  res.json({ ...result, transcript, session: mapSession(ownedSession(row.id, req.user.id)) })
})

app.post('/api/sessions/:id/complete', auth, (req, res) => {
  const row = ownedSession(req.params.id, req.user.id)
  if (!row) return res.status(404).json({ error: 'Session not found.' })
  const duration = z.number().int().min(0).max(86_400).safeParse(req.body?.duration)
  db.prepare('UPDATE sessions SET completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP), duration = MAX(duration, ?) WHERE id = ?')
    .run(duration.success ? duration.data : 0, row.id)
  res.json(mapSession(ownedSession(row.id, req.user.id)))
})

app.get('/api/sessions', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC, rowid DESC').all(req.user.id)
  res.json(rows.map(mapSession))
})
app.get('/api/sessions/:id', auth, (req, res) => {
  const row = ownedSession(req.params.id, req.user.id)
  return row ? res.json(mapSession(row)) : res.status(404).json({ error: 'Session not found.' })
})

app.post('/api/voice/speak', auth, voiceLimiter, async (req, res) => {
  const parsed = z.object({
    text: z.string().min(1).max(2500),
    languageCode: z.string().min(2).max(12).default('en-IN'),
    speaker: z.string().min(2).max(40).default('simran'),
  }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Text, language and speaker are required.' })
  try {
    const audio = await synthesize(parsed.data.text, parsed.data)
    res.set('content-type', audio.contentType).set('cache-control', 'no-store').send(audio.audio)
  } catch (error) {
    res.status(503).json({ error: error.message })
  }
})

app.post('/api/voice/transcribe', auth, voiceLimiter, express.raw({ type: () => true, limit: '8mb' }), async (req, res) => {
  if (!req.body?.length) return res.status(400).json({ error: 'No audio was uploaded.' })
  const language = typeof req.headers['x-language'] === 'string' ? req.headers['x-language'] : 'en-IN'
  try {
    const data = await transcribeAudio(req.body, req.headers['x-filename'], req.headers['content-type'], language)
    res.json(data)
  } catch (error) {
    res.status(503).json({ error: error.message })
  }
})

// Telephony & Real Phone Calling API
app.get('/api/telephony/config', auth, (_req, res) => res.json(getTelephonyConfig()))

app.post('/api/calls', auth, callLimiter, async (req, res) => {
  const parsed = z.object({
    botId: z.enum(['loan', 'insurance']),
    toPhone: z.string().min(8).max(25),
    isDemo: z.boolean().optional(),
    demoType: z.enum(['loan', 'insurance']).optional(),
  }).safeParse(req.body)

  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Select a valid bot and enter a valid phone number.' })
  }

  try {
    const call = await startPhoneCall({
      botId: parsed.data.botId,
      toPhone: parsed.data.toPhone,
      userId: req.user.id,
      isDemo: Boolean(parsed.data.isDemo),
      demoType: parsed.data.demoType || parsed.data.botId,
    })
    res.status(201).json(call)
  } catch (error) {
    console.error('Call initiation error:', error.message)
    res.status(400).json({ error: error.message || 'Unable to place call.' })
  }
})

app.get('/api/calls', auth, (req, res) => {
  const botId = typeof req.query.botId === 'string' ? req.query.botId : undefined
  const status = typeof req.query.status === 'string' ? req.query.status : undefined
  const from = typeof req.query.from === 'string' ? req.query.from : undefined
  const to = typeof req.query.to === 'string' ? req.query.to : undefined
  const isDemo = req.query.isDemo !== undefined ? req.query.isDemo === 'true' : undefined
  const calls = listCalls(req.user.id, { botId, status, from, to, isDemo })
  res.json(calls)
})

app.get('/api/calls/:id', auth, (req, res) => {
  const call = getCall(req.params.id, req.user.id)
  return call ? res.json(call) : res.status(404).json({ error: 'Call not found.' })
})

app.post('/api/calls/:id/hangup', auth, async (req, res) => {
  try {
    const call = await terminateCall(req.params.id, req.user.id)
    res.json(call)
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to hang up call.' })
  }
})

// Stream call recording with Range support for browser <audio> tags
app.get('/api/calls/:id/recording', auth, (req, res) => {
  const callRow = db.prepare('SELECT * FROM calls WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)
  if (!callRow) return res.status(404).json({ error: 'Call not found.' })
  const filePath = resolveRecordingPath(callRow.recording_path)
  if (!filePath) {
    return res.status(404).json({ error: 'No recording file exists for this call.' })
  }

  const stat = fs.statSync(filePath)
  const fileSize = stat.size
  const ext = path.extname(filePath).toLowerCase()
  const mimeType = ext === '.mp3' ? 'audio/mpeg' : ext === '.wav' ? 'audio/wav' : 'audio/webm'

  const range = req.headers.range
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-')
    const start = parseInt(parts[0], 10)
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
    const chunkSize = (end - start) + 1
    const fileStream = fs.createReadStream(filePath, { start, end })

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': mimeType,
      'Cache-Control': 'no-cache',
    })
    fileStream.pipe(res)
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    })
    fs.createReadStream(filePath).pipe(res)
  }
})

// Download recording file
app.get('/api/calls/:id/recording/download', auth, (req, res) => {
  const callRow = db.prepare('SELECT * FROM calls WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)
  if (!callRow) return res.status(404).json({ error: 'Call not found.' })
  const filePath = resolveRecordingPath(callRow.recording_path)
  if (!filePath) {
    return res.status(404).json({ error: 'No recording file exists for this call.' })
  }

  const ext = path.extname(filePath) || '.wav'
  const filename = `nirvana-${callRow.bot_id}-call-${callRow.id.slice(0, 8)}${ext}`
  res.download(filePath, filename)
})

// Delete recording (retention / privacy compliance)
app.delete('/api/calls/:id/recording', auth, (req, res) => {
  const deleted = deleteCallRecording(req.params.id, req.user.id)
  if (!deleted) return res.status(404).json({ error: 'Call not found or already deleted.' })
  res.json({ ok: true, message: 'Recording deleted successfully.' })
})

// Toggle demo submission readiness
app.post('/api/calls/:id/demo-status', auth, (req, res) => {
  const parsed = z.object({
    isDemo: z.boolean(),
    demoType: z.enum(['loan', 'insurance']).optional(),
    demoReady: z.boolean(),
  }).safeParse(req.body)

  if (!parsed.success) return res.status(400).json({ error: 'Invalid parameters.' })

  const callRow = db.prepare('SELECT * FROM calls WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)
  if (!callRow) return res.status(404).json({ error: 'Call not found.' })

  // Integrity checks before marking demo ready:
  if (parsed.data.demoReady) {
    if (!callRow.recording_path || !fs.existsSync(callRow.recording_path)) {
      return res.status(400).json({ error: 'A submission-ready demo requires an existing, verified audio recording file.' })
    }
    const transcript = JSON.parse(callRow.transcript_json || '[]')
    const hasAgent = transcript.some(m => m.speaker === 'agent')
    const hasCustomer = transcript.some(m => m.speaker === 'customer')
    if (!hasAgent || !hasCustomer) {
      return res.status(400).json({ error: 'Recording must contain a dual-sided conversation with both customer and AI agent turns.' })
    }
  }

  const updated = setDemoStatus(req.params.id, req.user.id, parsed.data)
  res.json(updated)
})

// Generate assignment demo call (2–5 minute realistic recording)
app.post('/api/telephony/demo-call', auth, async (req, res) => {
  const parsed = z.object({ botId: z.enum(['loan', 'insurance']) }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Select a valid bot (loan or insurance).' })

  try {
    const demoCall = await generateAssignmentDemo(parsed.data.botId, req.user.id)
    res.status(201).json(demoCall)
  } catch (error) {
    console.error('Demo call generation error:', error)
    res.status(500).json({ error: error.message || 'Failed to generate demo call.' })
  }
})

// Telephony Webhooks for Live Carrier Integration (Twilio / Exotel)
app.post('/api/telephony/webhook/voice', (req, res) => {
  const callId = req.query.callId || req.body.callId
  const call = callId ? getCallById(callId) : null
  const botId = call?.bot_id || 'loan'
  const botRow = getBot(botId)
  const config = botRow ? JSON.parse(botRow.config_json) : { opening: 'Hello, I am Nirvana Voice Studio AI assistant.' }

  if (call) {
    updateCall(call.id, { status: 'in_progress' })
  }

  const webhookBase = (process.env.TELEPHONY_WEBHOOK_BASE_URL || `http://${req.headers.host}`).replace(/\/$/, '')
  const gatherAction = `${webhookBase}/api/telephony/webhook/gather?callId=${callId || ''}`

  const disclosure = 'This call is recorded for quality, training, and compliance by Nirvana Voice Studio. You are speaking with an AI assistant.'
  const fullGreeting = `${disclosure} ${config.opening}`

  const twiml = buildTwiml({
    greeting: fullGreeting,
    gatherAction,
  })

  res.set('Content-Type', 'text/xml').send(twiml)
})

app.post('/api/telephony/webhook/gather', async (req, res) => {
  const callId = req.query.callId || req.body.callId
  const speechResult = req.body.SpeechResult || req.body.speech_result || ''
  const call = callId ? getCallById(callId) : null

  const webhookBase = (process.env.TELEPHONY_WEBHOOK_BASE_URL || `http://${req.headers.host}`).replace(/\/$/, '')
  const gatherAction = `${webhookBase}/api/telephony/webhook/gather?callId=${callId || ''}`

  if (!call || !speechResult.trim()) {
    const twiml = buildTwiml({
      greeting: 'I could not hear your response. Please speak after the tone.',
      gatherAction,
    })
    return res.set('Content-Type', 'text/xml').send(twiml)
  }

  const bot = getBot(call.bot_id)
  let transcript = JSON.parse(call.transcript_json || '[]')

  try {
    const custTurn = { id: crypto.randomUUID(), speaker: 'customer', text: speechResult.trim(), timestamp: new Date().toISOString() }
    transcript.push(custTurn)

    const agentRes = await respond({
      botType: call.bot_id,
      bot,
      input: speechResult.trim(),
      transcript,
    })

    const agentTurn = { id: crypto.randomUUID(), speaker: 'agent', text: agentRes.reply, timestamp: new Date().toISOString(), engine: agentRes.engine }
    transcript.push(agentTurn)

    const existingObjections = JSON.parse(call.objections_json || '[]')
    const existingAddOns = JSON.parse(call.selected_add_ons_json || '[]')
    const existingFlags = JSON.parse(call.compliance_flags_json || '[]')

    const shouldHangup = ['proposed_settlement', 'quote_accepted', 'human_escalation', 'not_converted'].includes(agentRes.outcome) || transcript.length >= 24

    updateCall(call.id, {
      transcript,
      outcome: agentRes.outcome,
      objections: [...new Set([...existingObjections, ...agentRes.objections])],
      commitmentDate: agentRes.commitmentDate || call.commitment_date,
      selectedAddOns: [...new Set([...existingAddOns, ...agentRes.selectedAddOns])],
      finalQuotedAmount: agentRes.finalQuotedAmount || call.final_quoted_amount,
      complianceFlags: [...new Set([...existingFlags, ...agentRes.complianceFlags])],
      status: shouldHangup ? 'completed' : 'in_progress',
      endedAt: shouldHangup ? new Date().toISOString() : null,
    })

    const twiml = buildTwiml({
      greeting: agentRes.reply,
      gatherAction: shouldHangup ? null : gatherAction,
      hangup: shouldHangup,
    })
    res.set('Content-Type', 'text/xml').send(twiml)
  } catch (err) {
    console.error('Telephony gather error:', err)
    const twiml = buildTwiml({
      greeting: 'I apologize, an unexpected system error occurred. A human specialist will follow up with you. Goodbye.',
      hangup: true,
    })
    res.set('Content-Type', 'text/xml').send(twiml)
  }
})

app.post('/api/telephony/webhook/status', (req, res) => {
  const callId = req.query.callId || req.body.callId
  const callStatus = (req.body.CallStatus || req.body.call_status || '').toLowerCase()
  const duration = parseInt(req.body.CallDuration || req.body.duration || '0', 10)

  if (callId) {
    const statusMap = {
      initiated: 'initiating',
      ringing: 'ringing',
      'in-progress': 'in_progress',
      completed: 'completed',
      busy: 'busy',
      'no-answer': 'no_answer',
      failed: 'failed',
      canceled: 'canceled',
    }
    const mapped = statusMap[callStatus] || callStatus || 'completed'
    updateCall(callId, {
      status: mapped,
      duration,
      endedAt: ['completed', 'failed', 'busy', 'no_answer', 'canceled'].includes(mapped) ? new Date().toISOString() : undefined,
    })
  }
  res.status(200).send('<Response/>')
})

app.post('/api/telephony/webhook/recording', async (req, res) => {
  const callId = req.query.callId || req.body.callId
  const recordingUrl = req.body.RecordingUrl || req.body.recording_url
  const duration = parseInt(req.body.RecordingDuration || '0', 10)

  if (callId && recordingUrl) {
    try {
      const localPath = path.join(RECORDINGS_DIR, `${callId}.mp3`)
      const audioUrl = recordingUrl.endsWith('.mp3') ? recordingUrl : `${recordingUrl}.mp3`
      const headers = {}
      if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
        headers.Authorization = `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`
      }
      const fetchRes = await fetch(audioUrl, { headers })
      if (fetchRes.ok) {
        const arrayBuf = await fetchRes.arrayBuffer()
        fs.writeFileSync(localPath, Buffer.from(arrayBuf))
        updateCall(callId, {
          recordingStatus: 'available',
          recordingPath: localPath,
          recordingDuration: duration,
          demoReady: duration >= 120 && duration <= 300,
        })
      }
    } catch (err) {
      console.error('Error fetching provider recording:', err.message)
      updateCall(callId, { recordingStatus: 'failed' })
    }
  }
  res.status(200).send('<Response/>')
})

app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found.' }))


// Express 5 no longer accepts "*" as a path, so the SPA fallback is plain middleware.
const dist = path.join(projectRoot, 'dist')
const indexFile = path.join(dist, 'index.html')
app.use(express.static(dist))
app.use((req, res, next) => {
  if (req.method !== 'GET' || !fs.existsSync(indexFile)) return next()
  res.sendFile(indexFile)
})

app.use((error, _req, res, _next) => {
  if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large.' })
  console.error('Unhandled API error:', error?.message)
  res.status(500).json({ error: 'Unexpected server error.' })
})

app.listen(port, () => console.log(`Nirvana Voice Studio API listening on http://localhost:${port}`))
