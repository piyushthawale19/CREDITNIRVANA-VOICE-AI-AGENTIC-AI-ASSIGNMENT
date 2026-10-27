// Server-side Sarvam AI adapters. The API key never leaves this process.
const API = 'https://api.sarvam.ai'

const CHAT_MODEL = process.env.SARVAM_CHAT_MODEL || 'sarvam-105b'
const STT_MODEL = process.env.SARVAM_STT_MODEL || 'saaras:v4'
const TTS_MODEL = process.env.SARVAM_TTS_MODEL || 'bulbul:v3'
const DEFAULT_SPEAKER = 'simran'
// Speaker ids accepted by the bulbul REST enum: the bulbul:v2 voices plus the bulbul:v3
// voices. Anything else is rejected by the API, so an unknown value falls back to a known
// speaker instead of failing the call.
const SPEAKERS = new Set(['anushka', 'manisha', 'vidya', 'arya', 'abhilash', 'karun', 'hitesh', 'shubh', 'simran', 'aditya', 'ritu', 'priya', 'neha', 'rahul', 'pooja', 'rohan', 'kavya', 'amit', 'dev', 'ishita', 'shreya', 'ratan', 'varun', 'manan', 'sumit', 'roopa', 'kabir', 'aayan', 'ashutosh', 'advait', 'anand', 'tanya', 'tarun', 'sunny', 'mani', 'gokul', 'vijay', 'shruti', 'suhani', 'mohit', 'kavitha', 'rehan', 'soham', 'rupali'])

const configured = () => Boolean(process.env.SARVAM_API_KEY)

export function sarvamStatus() {
  return {
    provider: 'Sarvam AI',
    configured: configured(),
    mode: configured() ? 'live' : 'demo',
    chatModel: CHAT_MODEL,
    sttModel: STT_MODEL,
    ttsModel: TTS_MODEL,
    speakers: [...SPEAKERS],
    voiceReady: configured(),
    chatReady: configured(),
    notes: configured()
      ? 'Server-side Sarvam chat, speech-to-text and text-to-speech are enabled.'
      : 'SARVAM_API_KEY is not set. Conversations use the labelled deterministic engine and speech buttons stay disabled.',
  }
}

/**
 * bulbul:v4-flash voices are <name>_<language>_<style> persona ids, while v2/v3 use the
 * short names the playground offers. Sending a short name to v4 risks a provider 4xx, so
 * v4 falls back to its documented default persona instead of guessing.
 */
function ttsSpeaker(speaker) {
  if (TTS_MODEL.startsWith('bulbul:v4')) return undefined
  return SPEAKERS.has(speaker) ? speaker : DEFAULT_SPEAKER
}

function authHeaders(extra = {}) {
  if (!configured()) throw new Error('Sarvam API key is not configured on the server.')
  return { 'api-subscription-key': process.env.SARVAM_API_KEY, ...extra }
}

function providerError(status, data) {
  const detail = data?.error?.message || data?.error?.code || data?.message || data?.detail
  return new Error(detail ? `Sarvam API error (${status}): ${detail}` : `Sarvam API error (${status}).`)
}

async function readJson(response) {
  const text = await response.text()
  try { return text ? JSON.parse(text) : {} } catch { return { message: text.slice(0, 300) } }
}

/**
 * OpenAI-compatible Sarvam chat completion. Returns the assistant message content.
 * A 30s timeout keeps a stalled provider from holding an API request open.
 */
export async function chatReply({ systemPrompt, messages, temperature = 0.3, maxTokens = 700 }) {
  if (!configured()) throw new Error('Sarvam chat is not configured.')
  const response = await fetch(`${API}/v2/chat/completions`, {
    method: 'POST',
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({
      model: CHAT_MODEL,
      temperature,
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
    }),
    signal: AbortSignal.timeout(30_000),
  })
  const data = await readJson(response)
  if (!response.ok) throw providerError(response.status, data)
  const content = data?.choices?.[0]?.message?.content
  if (!content || typeof content !== 'string') throw new Error('Sarvam chat returned an empty response.')
  return { content, model: data.model || CHAT_MODEL, usage: data.usage || null }
}

export async function transcribeAudio(fileBuffer, filename, mimeType, languageCode = 'en-IN') {
  const cleanMime = (mimeType || 'audio/webm').split(';')[0].trim().toLowerCase()
  const form = new FormData()
  form.append('file', new Blob([fileBuffer], { type: cleanMime || 'audio/webm' }), filename || 'voice.webm')
  form.append('model', STT_MODEL)
  if (languageCode && languageCode !== 'auto') form.append('language_code', languageCode)
  const response = await fetch(`${API}/speech-to-text`, { method: 'POST', headers: authHeaders(), body: form, signal: AbortSignal.timeout(45_000) })
  const data = await readJson(response)
  if (!response.ok) throw providerError(response.status, data)
  if (!data?.transcript) throw new Error('Sarvam speech-to-text returned no transcript. Try speaking again.')
  return { transcript: data.transcript, languageCode: data.language_code || languageCode, requestId: data.request_id || null }
}

export async function synthesize(text, { languageCode = 'en-IN', speaker = DEFAULT_SPEAKER } = {}) {
  const voice = ttsSpeaker(speaker)
  const response = await fetch(`${API}/text-to-speech`, {
    method: 'POST',
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({
      text: text.slice(0, 2500),
      language_code: languageCode || 'en-IN',
      ...(voice ? { speaker: voice } : {}),
      model: TTS_MODEL,
      output_audio_codec: 'mp3',
      speech_sample_rate: 22050,
    }),
    signal: AbortSignal.timeout(45_000),
  })
  const data = await readJson(response)
  if (!response.ok) throw providerError(response.status, data)
  const audio = data?.audios?.[0]
  if (!audio) throw new Error('Sarvam text-to-speech returned no audio.')
  return { audio: Buffer.from(audio, 'base64'), contentType: 'audio/mpeg', requestId: data.request_id || null }
}

/** Small live check used by Settings so integration status is verified, not assumed. */
export async function testConnection() {
  if (!configured()) return { ok: false, mode: 'demo', message: 'SARVAM_API_KEY is not set on the server.' }
  const started = Date.now()
  try {
    const result = await chatReply({ systemPrompt: 'Reply with the single word: ready', messages: [{ role: 'user', content: 'Connection test' }], temperature: 0, maxTokens: 60 })
    return { ok: true, mode: 'live', model: result.model, latencyMs: Date.now() - started, reply: result.content.trim().slice(0, 40) }
  } catch (error) {
    return { ok: false, mode: 'error', message: error.message, latencyMs: Date.now() - started }
  }
}
