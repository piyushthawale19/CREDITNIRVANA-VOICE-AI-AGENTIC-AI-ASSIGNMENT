import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let server
let base
let log = ''
let jar

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

async function call(pathname, { method = 'GET', body, jar: cookieJar = jar, headers = {} } = {}) {
  const requestHeaders = { ...headers }
  if (body !== undefined && typeof body === 'object') requestHeaders['content-type'] = 'application/json'
  if (cookieJar?.cookie) requestHeaders.cookie = cookieJar.cookie
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
  const setCookies = response.headers.getSetCookie?.() || []
  const authCookie = setCookies.find(value => value.startsWith('nirvana_token='))
  if (authCookie && cookieJar) cookieJar.cookie = authCookie.split(';')[0]
  const text = await response.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  return { status: response.status, data, headers: response.headers }
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/health`)
      if (response.ok) return
    } catch { /* waiting */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`API did not become healthy.\n${log}`)
}

before(async () => {
  const port = await freePort()
  base = `http://127.0.0.1:${port}`
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nirvana-telephony-test-'))
  const databasePath = path.join(testDir, 'test.sqlite')
  const recordingsPath = path.join(testDir, 'recordings')

  server = spawn(process.execPath, ['server/index.js'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      JWT_SECRET: 'test-secret-not-for-production',
      SARVAM_API_KEY: '',
      DATABASE_PATH: databasePath,
      RECORDINGS_DIR: recordingsPath,
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.on('data', chunk => { log += chunk.toString() })
  server.stderr.on('data', chunk => { log += chunk.toString() })
  await waitForHealth()

  jar = {}
  const loginRes = await call('/api/auth/login', {
    method: 'POST',
    body: { email: 'demo@nirvana.local', password: 'demo1234' },
    jar,
  })
  assert.equal(loginRes.status, 200)
})

after(() => { server?.kill() })

test('telephony config endpoint returns provider status and capabilities', async () => {
  const res = await call('/api/telephony/config')
  assert.equal(res.status, 200)
  assert.equal(typeof res.data.provider, 'string')
  assert.equal(res.data.dualChannelRecording, true)
  assert.ok(Array.isArray(res.data.capabilities))
  assert.ok(res.data.capabilities.includes('full_call_recording'))
  assert.ok(res.data.capabilities.includes('compliance_disclosure'))
})

test('initiating call validates phone number format', async () => {
  const badPhoneRes = await call('/api/calls', {
    method: 'POST',
    body: { botId: 'loan', toPhone: 'invalid-number' },
  })
  assert.equal(badPhoneRes.status, 400)
  assert.match(badPhoneRes.data.error, /E\.164/i)
})

test('initiating call starts call with legal disclosure and agent greeting', async () => {
  const startRes = await call('/api/calls', {
    method: 'POST',
    body: { botId: 'loan', toPhone: '+919876543210' },
  })
  assert.equal(startRes.status, 201)
  const callData = startRes.data
  assert.ok(callData.id)
  assert.equal(callData.botId, 'loan')
  assert.equal(callData.direction, 'outbound')
  assert.equal(callData.recordingConsentDisclosed, true)
  assert.equal(callData.toPhoneMasked.includes('***'), true) // Masked for privacy
  assert.ok(callData.transcript.length >= 2)
  assert.ok(callData.transcript[0].text.includes('recorded for quality and compliance'))
})

test('hangup endpoint terminates ongoing call and updates status', async () => {
  const startRes = await call('/api/calls', {
    method: 'POST',
    body: { botId: 'insurance', toPhone: '+919876543211' },
  })
  assert.equal(startRes.status, 201)
  const callId = startRes.data.id

  const hangupRes = await call(`/api/calls/${callId}/hangup`, { method: 'POST' })
  assert.equal(hangupRes.status, 200)
  assert.equal(hangupRes.data.status, 'completed')
  assert.ok(hangupRes.data.endedAt)
})

test('telephony voice webhook produces compliant TwiML with recording notice and gather', async () => {
  const startRes = await call('/api/calls', {
    method: 'POST',
    body: { botId: 'loan', toPhone: '+919876543212' },
  })
  const callId = startRes.data.id

  const twimlRes = await call(`/api/telephony/webhook/voice?callId=${callId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  })
  assert.equal(twimlRes.status, 200)
  assert.ok(twimlRes.data.includes('<Response>'))
  assert.ok(twimlRes.data.includes('<Gather'))
  assert.ok(twimlRes.data.includes('recorded for quality, training, and compliance'))
})

test('telephony gather webhook processes customer turn and updates transcript and outcome', async () => {
  const startRes = await call('/api/calls', {
    method: 'POST',
    body: { botId: 'loan', toPhone: '+919876543213' },
  })
  const callId = startRes.data.id

  const gatherParams = new URLSearchParams()
  gatherParams.append('SpeechResult', 'Yes, this is Rakesh speaking. Can I settle for 4 lakh on 15 November?')
  gatherParams.append('callId', callId)

  const gatherRes = await call(`/api/telephony/webhook/gather?callId=${callId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: gatherParams.toString(),
  })
  assert.equal(gatherRes.status, 200)
  assert.ok(gatherRes.data.includes('<Response>'))

  const updatedCallRes = await call(`/api/calls/${callId}`)
  assert.equal(updatedCallRes.status, 200)
  assert.equal(updatedCallRes.data.outcome, 'proposed_settlement')
  assert.ok(updatedCallRes.data.transcript.some(m => m.speaker === 'customer'))
  assert.ok(updatedCallRes.data.transcript.some(m => m.speaker === 'agent'))
})

test('telephony status webhook updates call status and duration', async () => {
  const startRes = await call('/api/calls', {
    method: 'POST',
    body: { botId: 'insurance', toPhone: '+919876543214' },
  })
  const callId = startRes.data.id

  const statusParams = new URLSearchParams()
  statusParams.append('CallStatus', 'completed')
  statusParams.append('CallDuration', '165')
  statusParams.append('callId', callId)

  const statusRes = await call(`/api/telephony/webhook/status?callId=${callId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: statusParams.toString(),
  })
  assert.equal(statusRes.status, 200)

  const checkRes = await call(`/api/calls/${callId}`)
  assert.equal(checkRes.data.status, 'completed')
  assert.equal(checkRes.data.duration, 165)
})

test('assignment demo call generator produces 2-5 min compliant recording ready for submission', async () => {
  const loanDemoRes = await call('/api/telephony/demo-call', {
    method: 'POST',
    body: { botId: 'loan' },
  })
  assert.equal(loanDemoRes.status, 201)
  const loanDemo = loanDemoRes.data
  assert.equal(loanDemo.isDemo, true)
  assert.equal(loanDemo.demoType, 'loan')
  assert.equal(loanDemo.demoReady, true)
  assert.ok(loanDemo.duration >= 120 && loanDemo.duration <= 300) // Target 2-5 minutes
  assert.equal(loanDemo.recordingStatus, 'available')
  assert.equal(loanDemo.hasRecording, true)
  assert.ok(loanDemo.recordingUrl)

  const insuranceDemoRes = await call('/api/telephony/demo-call', {
    method: 'POST',
    body: { botId: 'insurance' },
  })
  assert.equal(insuranceDemoRes.status, 201)
  const insDemo = insuranceDemoRes.data
  assert.equal(insDemo.isDemo, true)
  assert.equal(insDemo.demoType, 'insurance')
  assert.equal(insDemo.demoReady, true)
  assert.ok(insDemo.duration >= 120 && insDemo.duration <= 300)
  assert.equal(insDemo.hasRecording, true)

  // Verify audio streaming with HTTP 206 Range headers
  const streamRes = await fetch(`${base}/api/calls/${loanDemo.id}/recording`, {
    headers: {
      cookie: jar.cookie,
      Range: 'bytes=0-1023',
    },
  })
  assert.equal(streamRes.status, 206)
  assert.ok(streamRes.headers.get('content-range'))
  assert.equal(streamRes.headers.get('accept-ranges'), 'bytes')

  // Verify unauthorized user cannot access recording
  const unauthRes = await fetch(`${base}/api/calls/${loanDemo.id}/recording`)
  assert.equal(unauthRes.status, 401)
})

test('recording deletion removes file and updates recording status', async () => {
  const demoRes = await call('/api/telephony/demo-call', {
    method: 'POST',
    body: { botId: 'loan' },
  })
  const callId = demoRes.data.id
  assert.equal(demoRes.data.hasRecording, true)

  const deleteRes = await call(`/api/calls/${callId}/recording`, { method: 'DELETE' })
  assert.equal(deleteRes.status, 200)

  const checkRes = await call(`/api/calls/${callId}`)
  assert.equal(checkRes.data.hasRecording, false)
  assert.equal(checkRes.data.recordingStatus, 'deleted')
})
