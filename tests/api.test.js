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
let otherJar

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

async function call(pathname, { method = 'GET', body, jar: cookieJar, headers = {} } = {}) {
  const requestHeaders = { ...headers }
  if (body !== undefined) requestHeaders['content-type'] = 'application/json'
  if (cookieJar?.cookie) requestHeaders.cookie = cookieJar.cookie
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const setCookies = response.headers.getSetCookie?.() || []
  const authCookie = setCookies.find(value => value.startsWith('nirvana_token='))
  if (authCookie && cookieJar) cookieJar.cookie = authCookie.split(';')[0]
  if (cookieJar && authCookie) cookieJar.raw = authCookie
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
    } catch { /* server not listening yet */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`API did not become healthy.\n${log}`)
}

const startSession = async (botId, cookieJar = jar) => {
  const response = await call('/api/sessions', { method: 'POST', body: { botId, mode: 'text' }, jar: cookieJar })
  assert.equal(response.status, 201, JSON.stringify(response.data))
  return response.data
}

const say = async (sessionId, text, cookieJar = jar) => {
  const response = await call(`/api/sessions/${sessionId}/respond`, { method: 'POST', body: { text }, jar: cookieJar })
  assert.equal(response.status, 200, JSON.stringify(response.data))
  return response.data
}

before(async () => {
  const port = await freePort()
  base = `http://127.0.0.1:${port}`
  const databasePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nirvana-test-')), 'test.sqlite')
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      JWT_SECRET: 'test-secret-not-for-production',
      SARVAM_API_KEY: '',
      DATABASE_PATH: databasePath,
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.on('data', chunk => { log += chunk.toString() })
  server.stderr.on('data', chunk => { log += chunk.toString() })
  await waitForHealth()
  jar = {}
  otherJar = {}
})

after(() => { server?.kill() })

test('health endpoint is public', async () => {
  const response = await call('/api/health')
  assert.equal(response.status, 200)
  assert.equal(response.data.ok, true)
})

test('private routes reject unauthenticated requests', async () => {
  for (const route of ['/api/bots', '/api/sessions', '/api/auth/me', '/api/integrations/status']) {
    const response = await call(route)
    assert.equal(response.status, 401, route)
  }
})

test('login rejects invalid credentials with a generic message', async () => {
  const response = await call('/api/auth/login', { method: 'POST', body: { email: 'demo@nirvana.local', password: 'wrong-password' } })
  assert.equal(response.status, 401)
  assert.equal(response.data.error, 'Invalid email or password.')
})

test('login sets an HttpOnly session cookie and /me returns the operator', async () => {
  const response = await call('/api/auth/login', { method: 'POST', body: { email: 'demo@nirvana.local', password: 'demo1234' }, jar })
  assert.equal(response.status, 200)
  assert.equal(response.data.user.email, 'demo@nirvana.local')
  assert.match(jar.raw, /HttpOnly/i)
  assert.match(jar.raw, /SameSite=Lax/i)
  const me = await call('/api/auth/me', { jar })
  assert.equal(me.status, 200)
  assert.equal(me.data.user.role, 'operator')
})

test('registration validates input and hashes credentials', async () => {
  const weak = await call('/api/auth/register', { method: 'POST', body: { name: 'A', email: 'not-an-email', password: 'short' } })
  assert.equal(weak.status, 400)
  const created = await call('/api/auth/register', { method: 'POST', body: { name: 'Second Operator', email: 'second@nirvana.local', password: 'secondpass123' }, jar: otherJar })
  assert.equal(created.status, 201)
  assert.equal(created.data.user.email, 'second@nirvana.local')
  const duplicate = await call('/api/auth/register', { method: 'POST', body: { name: 'Second Operator', email: 'second@nirvana.local', password: 'secondpass123' } })
  assert.equal(duplicate.status, 409)
  const badLogin = await call('/api/auth/login', { method: 'POST', body: { email: 'second@nirvana.local', password: 'secondpass123' } })
  assert.equal(badLogin.status, 200)
})

test('bot prompt exposes verified facts and cannot be saved below the minimum', async () => {
  const bots = await call('/api/bots', { jar })
  assert.equal(bots.status, 200)
  const loan = bots.data.find(bot => bot.id === 'loan')
  assert.match(loan.systemPrompt, /₹6,50,000/)
  assert.match(loan.systemPrompt, /₹4,00,000/)
  assert.match(loan.systemPrompt, /8 months/)
  const insurance = bots.data.find(bot => bot.id === 'insurance')
  assert.match(insurance.systemPrompt, /₹9,00,000/)
  assert.match(insurance.systemPrompt, /₹8,00,000/)
  assert.match(insurance.systemPrompt, /₹20,000/)
  assert.match(insurance.systemPrompt, /₹15,000/)

  const short = await call('/api/bots/loan', { method: 'PUT', body: { systemPrompt: 'too short', config: loan.config }, jar })
  assert.equal(short.status, 400)
})

test('saving a prompt creates a version, rejects unknown speakers and reset restores defaults', async () => {
  const before = await call('/api/bots/loan', { jar })
  const version = before.data.promptVersion
  const badSpeaker = await call('/api/bots/loan', { method: 'PUT', body: { systemPrompt: before.data.systemPrompt, config: { ...before.data.config, speaker: 'unknown_speaker' } }, jar })
  assert.equal(badSpeaker.status, 400)

  const saved = await call('/api/bots/loan', { method: 'PUT', body: { systemPrompt: `${before.data.systemPrompt}\n\nTEST ADDITION: keep the compliance rules unchanged.`, config: before.data.config }, jar })
  assert.equal(saved.status, 200)
  assert.equal(saved.data.promptVersion, version + 1)
  assert.match(saved.data.systemPrompt, /TEST ADDITION/)

  const versions = await call('/api/bots/loan/versions', { jar })
  assert.equal(versions.status, 200)
  assert.equal(versions.data[0].promptVersion, version + 1)

  const restored = await call('/api/bots/loan/reset', { method: 'POST', body: {}, jar })
  assert.equal(restored.status, 200)
  assert.equal(restored.data.promptVersion, version + 2)
  assert.equal(restored.data.systemPrompt.includes('TEST ADDITION'), false)
})

test('a second operator cannot read another operator’s session', async () => {
  const session = await startSession('loan', jar)
  const crossRead = await call(`/api/sessions/${session.id}`, { jar: otherJar })
  assert.equal(crossRead.status, 404)
  const crossWrite = await call(`/api/sessions/${session.id}/respond`, { method: 'POST', body: { text: 'hello' }, jar: otherJar })
  assert.equal(crossWrite.status, 404)
  const ownList = await call('/api/sessions', { jar: otherJar })
  assert.equal(ownList.data.some(item => item.id === session.id), false)
})

test('loan conversation verifies identity, records a proposal and never fakes approval', async () => {
  const session = await startSession('loan')
  assert.equal(session.mode, 'text-simulated')
  assert.equal(session.outcome, 'in_progress')
  assert.match(session.transcript[0].text, /AI assistant/i)

  const identity = await say(session.id, 'Yes, this is Rakesh speaking.')
  assert.equal(identity.engine, 'deterministic')
  assert.match(identity.reply, /₹6,50,000/)
  assert.match(identity.reply, /₹4,00,000/)
  assert.equal(identity.session.outcome, 'in_progress')

  const proposal = await say(session.id, 'I lost my job and cannot pay the full amount. Can I settle for 4 lakh on 15 November?')
  assert.equal(proposal.outcome, 'proposed_settlement')
  assert.match(proposal.commitmentDate, /-11-15$/)
  assert.equal(proposal.finalQuotedAmount, 400000)
  assert.match(proposal.reply, /authoris|not binding/i)
  assert.equal(/is approved|has been approved|sanctioned/i.test(proposal.reply), false)
  assert.ok(proposal.objections.includes('financial_hardship'))
  assert.ok(proposal.session.transcript.length >= 5)

  const escalation = await say(session.id, 'I want to speak to a human agent about this.')
  assert.equal(escalation.outcome, 'human_escalation')

  const completed = await call(`/api/sessions/${session.id}/complete`, { method: 'POST', body: { duration: 95 }, jar })
  assert.equal(completed.status, 200)
  assert.ok(completed.data.completedAt)
  assert.equal(completed.data.duration, 95)

  const late = await call(`/api/sessions/${session.id}/respond`, { method: 'POST', body: { text: 'one more thing' }, jar })
  assert.equal(late.status, 409)
})

test('loan bot escalates disputes and refuses legal threats', async () => {
  const session = await startSession('loan')
  await say(session.id, 'Yes, this is Meera.')
  const dispute = await say(session.id, 'The amount is wrong. Send me the statement and proof.')
  assert.equal(dispute.outcome, 'dispute_or_hardship_referral')
  assert.ok(dispute.complianceFlags.includes('documentation_or_dispute'))

  const legal = await say(session.id, 'Will you send the police or take me to court?')
  assert.equal(/arrest|we will send police|we will file/i.test(legal.reply), false)
  assert.match(legal.reply, /can’t discuss legal|won’t threaten/i)
})

test('insurance conversation explains IDV and sceptical objections, then records consent', async () => {
  const session = await startSession('insurance')
  const idv = await say(session.id, 'Why did the IDV go down to 8 lakh?')
  assert.match(idv.reply, /₹9,00,000/)
  assert.match(idv.reply, /₹8,00,000/)

  const competitor = await say(session.id, 'PolicyBazaar is quoting 12000, why should I pay 15000?')
  assert.ok(competitor.objections.includes('competitor_quote'))
  assert.match(competitor.reply, /IDV|deductibles|exclusions|add-ons/i)
  assert.equal(/₹?12,000 uses a lower|they are cheaper/i.test(competitor.reply), false)

  const decline = await say(session.id, 'I don’t need any add-ons.')
  assert.match(decline.reply, /no add-ons/i)

  const accepted = await say(session.id, 'Yes, I accept and want to renew at 15000.')
  assert.equal(accepted.outcome, 'quote_accepted')
  assert.equal(accepted.finalQuotedAmount, 15000)
  assert.match(accepted.reply, /isn’t a bound policy|insurer/i)
})

test('insurance bot escalates policy wording and add-on pricing instead of inventing terms', async () => {
  const session = await startSession('insurance')
  const addOn = await say(session.id, 'Add zero depreciation and engine protection for me.')
  assert.equal(addOn.outcome, 'add_on_selected')
  assert.deepEqual(addOn.selectedAddOns, ['Zero depreciation', 'Engine protection'])
  assert.ok(addOn.complianceFlags.includes('add_on_price_unconfirmed'))

  const guarantee = await say(session.id, 'Guarantee that my claim will be approved.')
  assert.equal(guarantee.outcome, 'human_escalation')
  assert.match(guarantee.reply, /can’t guarantee|can't guarantee/i)
})

test('session history persists outcome, objections, add-ons and flags', async () => {
  const list = await call('/api/sessions', { jar })
  assert.equal(list.status, 200)
  assert.ok(list.data.length >= 5)
  const withProposal = list.data.find(item => item.finalQuotedAmount === 400000)
  assert.ok(withProposal)
  assert.ok(Array.isArray(withProposal.objections))
  assert.ok(Array.isArray(withProposal.complianceFlags))
  assert.ok(list.data.every(item => item.transcript.length >= 1))
})

test('request validation and origin checks are enforced', async () => {
  const badBot = await call('/api/sessions', { method: 'POST', body: { botId: 'mortgage' }, jar })
  assert.equal(badBot.status, 400)
  const session = await startSession('loan')
  const empty = await call(`/api/sessions/${session.id}/respond`, { method: 'POST', body: { text: '   ' }, jar })
  assert.equal(empty.status, 400)
  const foreignOrigin = await call('/api/sessions', { method: 'POST', body: { botId: 'loan' }, jar, headers: { origin: 'http://evil.example' } })
  assert.equal(foreignOrigin.status, 403)
})

test('voice endpoints fail clearly when Sarvam is not configured', async () => {
  const speak = await call('/api/voice/speak', { method: 'POST', body: { text: 'hello', languageCode: 'en-IN', speaker: 'simran' }, jar })
  assert.equal(speak.status, 503)
  assert.match(speak.data.error, /Sarvam API key is not configured/i)

  const status = await call('/api/integrations/status', { jar })
  assert.equal(status.data.configured, false)
  assert.equal(status.data.mode, 'demo')

  const test = await call('/api/integrations/test', { method: 'POST', body: {}, jar })
  assert.equal(test.status, 503)
  assert.equal(test.data.ok, false)
})

test('logout clears the session cookie and protects private routes again', async () => {
  const logout = await call('/api/auth/logout', { method: 'POST', body: {}, jar })
  assert.equal(logout.status, 200)
  jar.cookie = ''
  const me = await call('/api/auth/me', { jar })
  assert.equal(me.status, 401)
})
