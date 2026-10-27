export type BotType = 'loan' | 'insurance'
export type User = { id: number; name: string; email: string; role: string; createdAt?: string }
export type BotConfig = {
  tone?: string
  language: string
  speaker: string
  opening: string
  fallback: string
  objectives: string[]
  objectionGuidelines: string
  complianceNote: string
}
export type Bot = {
  id: BotType
  name: string
  type: BotType
  description: string
  systemPrompt: string
  config: BotConfig
  status: string
  promptVersion: number
  updatedAt: string
}
export type PromptVersion = { promptVersion: number; systemPrompt: string; config: BotConfig; createdAt: string }
export type Message = { id: string; speaker: 'agent' | 'customer'; text: string; timestamp: string; engine?: string }
export type Session = {
  id: string
  userId?: number
  botId: BotType
  scenarioType: string
  transcript: Message[]
  outcome: string
  objections: string[]
  commitmentDate?: string | null
  selectedAddOns: string[]
  finalQuotedAmount?: number | null
  complianceFlags: string[]
  duration: number
  mode: string
  engine: string
  createdAt: string
  completedAt?: string | null
}
export type IntegrationStatus = {
  provider: string
  configured: boolean
  mode: 'live' | 'demo'
  chatModel: string
  sttModel: string
  ttsModel: string
  speakers: string[]
  voiceReady: boolean
  chatReady: boolean
  notes: string
}
export type RespondResult = {
  reply: string
  outcome: string
  objections: string[]
  commitmentDate: string | null
  selectedAddOns: string[]
  finalQuotedAmount: number | null
  complianceFlags: string[]
  engine: 'sarvam-llm' | 'deterministic'
  model?: string | null
  transcript: Message[]
  session: Session
}

export type CallStatus = 'initiating' | 'ringing' | 'in_progress' | 'completed' | 'busy' | 'no_answer' | 'failed' | 'canceled'

export type Call = {
  id: string
  userId?: number
  botId: BotType
  sessionId?: string | null
  provider: string
  providerCallId?: string | null
  toPhone: string
  toPhoneMasked: string
  fromPhone?: string | null
  direction: 'outbound' | 'inbound'
  status: CallStatus
  duration: number
  startedAt: string
  endedAt?: string | null
  recordingStatus: 'none' | 'recording' | 'available' | 'failed' | 'deleted'
  hasRecording: boolean
  recordingUrl?: string | null
  recordingDuration: number
  recordingConsentDisclosed: boolean
  transcript: Message[]
  outcome: string
  objections: string[]
  commitmentDate?: string | null
  selectedAddOns: string[]
  finalQuotedAmount?: number | null
  complianceFlags: string[]
  errorMessage?: string | null
  isDemo: boolean
  demoType?: BotType | null
  demoReady: boolean
  createdAt: string
}

export type TelephonyConfig = {
  provider: 'twilio' | 'exotel' | 'mock'
  configured: boolean
  mode: 'live' | 'simulation'
  callerId: string
  webhookBaseUrl: string
  dualChannelRecording: boolean
  capabilities: string[]
  notes: string
}
