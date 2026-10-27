import { chatReply } from './sarvam.js'

const LOAN_OUTCOMES = ['in_progress', 'full_repayment_commitment', 'proposed_settlement', 'follow_up_required', 'human_escalation', 'dispute_or_hardship_referral', 'no_commitment']
const INSURANCE_OUTCOMES = ['in_progress', 'quote_interest', 'quote_accepted', 'add_on_selected', 'callback_requested', 'human_escalation', 'not_converted']
const ENGINE_OUTCOMES = {
  loan: [...LOAN_OUTCOMES, 'authorized_settlement'],
  insurance: [...INSURANCE_OUTCOMES, 'renewal_completed'],
}

const money = (n) => `₹${new Intl.NumberFormat('en-IN').format(n)}`
const spokenDate = (iso) => iso
  ? new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`))
  : ''
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }

/** Turns spoken date phrases into an ISO date so history sorting and follow-ups stay usable. */
export function normaliseDate(input) {
  const text = input.toLowerCase()
  const now = new Date()
  const iso = (date) => date.toISOString().slice(0, 10)
  if (/\btoday\b/.test(text)) return iso(now)
  if (/\btomorrow\b/.test(text)) { const d = new Date(now); d.setDate(d.getDate() + 1); return iso(d) }
  if (/day after tomorrow/.test(text)) { const d = new Date(now); d.setDate(d.getDate() + 2); return iso(d) }
  if (/next week|in a week|one week/.test(text)) { const d = new Date(now); d.setDate(d.getDate() + 7); return iso(d) }
  if (/next month|in a month|thirty days|30 days/.test(text)) { const d = new Date(now); d.setMonth(d.getMonth() + 1); return iso(d) }
  const dayMonth = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/)
  if (dayMonth) {
    const day = Number(dayMonth[1]); let year = now.getFullYear()
    const month = MONTHS[dayMonth[2]]
    const candidate = new Date(Date.UTC(year, month, day))
    if (candidate.getTime() < now.getTime() - 86_400_000) candidate.setUTCFullYear(++year)
    return iso(candidate)
  }
  const numeric = text.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/)
  if (numeric) {
    const day = Number(numeric[1]); const month = Number(numeric[2]) - 1
    let year = numeric[3] ? Number(numeric[3]) : now.getFullYear()
    if (year < 100) year += 2000
    const candidate = new Date(Date.UTC(year, month, day))
    if (!Number.isNaN(candidate.getTime())) return iso(candidate)
  }
  if (/\bnext (monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(text)) {
    const names = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    const target = names.indexOf(text.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/)[1])
    const d = new Date(now); const delta = ((target - d.getDay() + 7) % 7) || 7
    d.setDate(d.getDate() + delta); return iso(d)
  }
  return null
}

function detectObjections(botType, text) {
  const found = []
  const add = (label, pattern) => { if (pattern.test(text)) found.push(label) }
  add('financial_hardship', /cannot pay|can't pay|no money|jobless|unemployed|hardship|medical|hospital|salary|income|loss|no funds/)
  // Price negotiation is a loan scenario signal; in insurance “lower” usually refers to the IDV.
  if (botType === 'loan') add('requests_lower_amount', /less|lower|reduce|waive|discount more|settle for|can('|’)?t afford/)
  add('disputes_amount', /wrong amount|incorrect|not mine|dispute|i already paid|already cleared/)
  add('requests_documentation', /proof|document|statement|breakup|breakdown|in writing|email me|send me/)
  add('vague_postponement', /later|some time|will pay soon|next month|busy|call me later|not now/)
  add('requests_human', /human|real person|agent|supervisor|manager|call me back|callback/)
  add('credit_reporting_question', /credit score|cibil|credit report|credit history/)
  add('legal_question', /legal|notice|court|police|arrest|case/)
  if (botType === 'insurance') {
    add('competitor_quote', /competitor|other company|online|portal|policybazaar|cheaper|lower quote|other quote/)
    add('idv_question', /\bidv\b|insured declared value|value (has|is) (dropped|reduced|changed)|sum insured/)
    add('premium_question', /why.*(15|fifteen|premium)|premium.*(why|high|increase)|discount/)
    add('add_on_question', /add.?on|zero dep|zero depreciation|engine|roadside|rsa|consumables/)
    add('declines_add_ons', /don('|’)?t need|no add.?on|not interested in add|skip (the )?add/)
    add('asks_about_exclusions', /exclusion|not covered|claim|policy wording|terms/)
    add('requests_claim_guarantee', /guarantee|guaranteed|sure.*claim|100% claim/)
  }
  return [...new Set(found)]
}

function detectAddOns(text) {
  const found = []
  if (/zero dep|zero depreciation|nil dep/.test(text)) found.push('Zero depreciation')
  if (/engine (protect|cover|guard)/.test(text)) found.push('Engine protection')
  if (/roadside|rsa|towing/.test(text)) found.push('Roadside assistance')
  if (/return to invoice|rti/.test(text)) found.push('Return to invoice')
  if (/consumable/.test(text)) found.push('Consumables cover')
  if (/passenger cover|occupant/.test(text)) found.push('Passenger cover')
  return [...new Set(found)]
}

const acceptsOrConsents = (text) => /\b(yes|yeah|yep|sure|okay|ok|proceed|accept|agree|renew|go ahead|confirm|i will pay|i'll pay|i can pay|let'?s do it)\b/.test(text)

/**
 * Compliance gate. The prompt asks the model to stay inside the rules; this is the
 * deterministic backstop so a bad generation can never surface a threat or an
 * unauthorised approval to a customer.
 */
const HARD_VIOLATIONS = [
  { rule: 'legal_threat', pattern: /\b(arrest|police|court case|criminal case|legal notice|asset seizure|attach your assets|warrant)\b/i },
  { rule: 'unauthorised_approval', pattern: /\b(settlement|offer|waiver)\b[^.]{0,40}\b(approved|sanctioned|authorised by me|guaranteed|final)\b/i },
  { rule: 'score_prediction', pattern: /credit score[^.]{0,40}\b(will|is going to|must)\b[^.]{0,20}\b(drop|fall|decrease)\b/i },
  { rule: 'claim_guarantee', pattern: /\b(i|we)\s+(can\s+|will\s+)?guarantee\b|\b(claim|payout|approval)\s+(is|are)\s+guaranteed\b|\bassure you\b/i },
  { rule: 'human_claim', pattern: /\b(i am|i'm) (a )?(human|real person|employee)\b/i },
  { rule: 'invented_deadline', pattern: /\b(today only|final deadline|expires today|last chance today)\b/i },
]

export function applyCompliance(reply, botType, fallback) {
  const flags = []
  let safeReply = reply
  for (const { rule, pattern } of HARD_VIOLATIONS) {
    if (!pattern.test(reply)) continue
    flags.push(`compliance_blocked:${rule}`)
    safeReply = fallback
  }
  if (safeReply !== reply) {
    safeReply += botType === 'loan'
      ? ' To be accurate: any settlement still needs written authorisation, and I can’t discuss legal action.'
      : ' To be accurate, cover and claims depend on the policy wording and insurer approval.'
  }
  return { reply: safeReply, flags }
}

function parseJsonObject(content) {
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try { return JSON.parse(content.slice(start, end + 1)) } catch { return null }
}

function coerceStringArray(value, limit = 6) {
  if (!Array.isArray(value)) return []
  return value.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim().slice(0, 120)).slice(0, limit)
}

function coerceAmount(value) {
  const amount = typeof value === 'string' ? Number(value.replace(/[^\d.]/g, '')) : Number(value)
  if (!Number.isFinite(amount) || amount <= 0 || amount > 50_000_000) return null
  return Math.round(amount)
}

/** Outcome safety: sales language cannot manufacture an authorised business event. */
export function guardOutcome(botType, outcome, customerText, engineOutcomes) {
  const flags = []
  let value = engineOutcomes.includes(outcome) ? outcome : null
  if (value === 'authorized_settlement') { value = 'proposed_settlement'; flags.push('authorisation_not_confirmed') }
  if (value === 'renewal_completed') { value = 'quote_accepted'; flags.push('renewal_not_verified') }
  if (!value && (outcome === 'authorized_settlement' || outcome === 'authorized')) { value = 'proposed_settlement'; flags.push('authorisation_not_confirmed') }
  if (!acceptsOrConsents(customerText)) {
    if (value === 'quote_accepted') { value = 'quote_interest'; flags.push('consent_not_confirmed') }
    if (value === 'full_repayment_commitment') { value = 'follow_up_required'; flags.push('commitment_not_confirmed') }
  }
  return { outcome: value, flags }
}

function fallbackOutcome(botType, text) {
  const objections = detectObjections(botType, text)
  if (objections.includes('requests_human')) return 'human_escalation'
  if (botType === 'loan') {
    if (objections.includes('disputes_amount') || objections.includes('financial_hardship')) return 'dispute_or_hardship_referral'
    if (/settle|settlement|four lakh|4,?00,?000|400000/.test(text)) return 'proposed_settlement'
    if (normaliseDate(text)) return 'follow_up_required'
    return 'no_commitment'
  }
  if (objections.includes('asks_about_exclusions') || objections.includes('requests_claim_guarantee')) return 'human_escalation'
  if (/callback|call me later|send.*(email|whatsapp)|written quote/.test(text)) return 'callback_requested'
  if (acceptsOrConsents(text)) return 'quote_accepted'
  if (detectAddOns(text).length) return 'add_on_selected'
  return 'not_converted'
}

function transcriptToMessages(transcript) {
  return transcript
    .filter(message => message.text && message.speaker !== 'system')
    .slice(-24)
    .map(message => ({ role: message.speaker === 'agent' ? 'assistant' : 'user', content: message.text.slice(0, 1500) }))
}

function outputContract(botType, bot) {
  const outcomes = botType === 'loan' ? LOAN_OUTCOMES : INSURANCE_OUTCOMES
  return `

OPERATIONAL OUTPUT CONTRACT (not customer-facing — never read or mention it)
Return one JSON object and nothing else. No markdown, no code fences.
{"reply": string, "outcome": ${outcomes.map(o => `"${o}"`).join(' | ')}, "objections": string[], "commitmentDate": "YYYY-MM-DD" | null, "selectedAddOns": string[], "finalQuotedAmount": integer rupees | null, "complianceFlags": string[]}
- "reply" is spoken aloud: one to three short sentences, at most one question, plain conversational text, no lists, no emoji, no stage directions.
- Use outcome "follow_up_required" or "callback_requested" unless the customer has clearly agreed to a specific next step.
- Never use an outcome outside the list above. Do not claim a settlement is approved, a renewal is completed, or that a payment has been received.
- If you do not know a figure or policy term, say it needs confirmation instead of guessing.
- fallback response to use when a question is outside your authority: ${JSON.stringify(bot.config?.fallback || 'I will have that confirmed by the team.')}`
}

export async function respond({ botType, bot, input, transcript }) {
  const history = transcriptToMessages(transcript)
  const objections = detectObjections(botType, input.toLowerCase())
  const flags = []
  let outcome = null
  let commitmentDate = normaliseDate(input)
  let selectedAddOns = detectAddOns(input.toLowerCase())
  let reply = ''
  let engine = 'deterministic'
  let model = null

  if (process.env.SARVAM_API_KEY) {
    try {
      const result = await chatReply({
        systemPrompt: bot.system_prompt + outputContract(botType, bot),
        messages: [...history, { role: 'user', content: input }],
        temperature: botType === 'loan' ? 0.2 : 0.35,
        maxTokens: 700,
      })
      model = result.model
      const parsed = parseJsonObject(result.content)
      if (parsed && typeof parsed.reply === 'string' && parsed.reply.trim()) {
        reply = parsed.reply.trim().replace(/[*_#`]/g, '').slice(0, 1200)
        outcome = typeof parsed.outcome === 'string' ? parsed.outcome : null
        objections.push(...coerceStringArray(parsed.objections))
        selectedAddOns.push(...coerceStringArray(parsed.selectedAddOns))
        flags.push(...coerceStringArray(parsed.complianceFlags).map(flag => `model_flag:${flag}`))
        if (typeof parsed.commitmentDate === 'string') {
          const iso = /^\d{4}-\d{2}-\d{2}$/.test(parsed.commitmentDate) ? parsed.commitmentDate : normaliseDate(parsed.commitmentDate)
          if (iso) commitmentDate = iso
        }
        const amount = coerceAmount(parsed.finalQuotedAmount)
        if (amount) flags.push(`quoted_amount:${amount}`)
        engine = 'sarvam-llm'
      } else {
        reply = result.content.trim().slice(0, 1200)
        engine = 'sarvam-llm'
        flags.push('structured_output_fallback')
      }
    } catch (error) {
      flags.push('llm_unavailable')
      reply = ''
    }
  }

  if (!reply) {
    const deterministic = deterministicReply(botType, bot, input, transcript)
    reply = deterministic.reply
    outcome = outcome || deterministic.outcome
    objections.push(...deterministic.objections)
    flags.push(...deterministic.flags)
    if (!commitmentDate) commitmentDate = deterministic.commitmentDate
    if (!selectedAddOns.length) selectedAddOns = deterministic.selectedAddOns
    engine = 'deterministic'
  }

  const compliance = applyCompliance(reply, botType, bot.config?.fallback || 'I will record that for the team to confirm.')
  reply = compliance.reply
  flags.push(...compliance.flags)

  const guarded = guardOutcome(botType, outcome || fallbackOutcome(botType, input.toLowerCase()), input.toLowerCase(), ENGINE_OUTCOMES[botType])

  const unique = (list) => [...new Set(list.filter(Boolean))]
  return {
    reply,
    outcome: guarded.outcome || fallbackOutcome(botType, input.toLowerCase()),
    objections: unique(objections),
    commitmentDate: commitmentDate || null,
    selectedAddOns: unique(selectedAddOns),
    finalQuotedAmount: botType === 'insurance'
      ? (guarded.outcome === 'quote_accepted' || guarded.outcome === 'add_on_selected' ? 15000 : null)
      : (guarded.outcome === 'proposed_settlement' ? 400000 : guarded.outcome === 'full_repayment_commitment' ? 650000 : null),
    complianceFlags: unique([...flags, ...guarded.flags]),
    engine,
    model,
  }
}

/**
 * Offline business-rule engine. It exists so the assignment can be evaluated without
 * credentials, and so a provider outage degrades into a clearly labelled simulation
 * instead of a fabricated voice call.
 */
export function deterministicReply(botType, bot, input, transcript) {
  const text = input.toLowerCase()
  const objections = detectObjections(botType, text)
  const addOns = detectAddOns(text)
  const flags = []
  const date = normaliseDate(text)
  const has = (pattern) => pattern.test(text)
  const askedFactsBefore = transcript.some(message => message.speaker === 'agent' && /6,50,000|9,00,000/.test(message.text))
  const opening = bot.config?.opening || ''

  if (objections.includes('requests_human')) {
    return {
      reply: botType === 'loan'
        ? 'Of course. I’m recording a request for a human review, and the team will call you back on the number on file. Is there a preferred time window for that call?'
        : 'Of course. I’ll record a request for an authorised specialist to call you back. Is there a particular coverage or policy question you want them to prepare?',
      outcome: 'human_escalation',
      objections, flags: ['human_requested'], commitmentDate: date, selectedAddOns: addOns,
    }
  }

  if (botType === 'loan') {
    const verified = has(/\b(yes|speaking|this is|it'?s me|i am|i'm|my name)\b/) || askedFactsBefore
    if (!verified && !askedFactsBefore) {
      return {
        reply: 'Thank you. Before I discuss the account, could you confirm your full name and that I’m speaking with the account holder? If this is a family member, I can arrange a callback instead.',
        outcome: 'in_progress',
        objections, flags: ['identity_unverified'], commitmentDate: null, selectedAddOns: [],
      }
    }
    const mentionsSettlement = has(/settle|settlement|four lakh/) || has(/4,?00,?000|400000/)
    if (mentionsSettlement && (has(/\b(pay|can|will|accept|agree|ok|okay)\b/) || date)) {
      const opening = objections.includes('financial_hardship')
        ? 'I understand things are difficult, and I’m not going to pretend this is easy. '
        : ''
      const dateLine = date
        ? `I’ve recorded ${spokenDate(date)} as the proposed payment date.`
        : 'I can’t attach a date until you give me one.'
      return {
        reply: `${opening}I can record a settlement proposal of ${money(400000)} against the ${money(650000)} total, but it isn’t binding or approved until the lender authorises it in writing. ${dateLine} ${date ? 'Is there anything that could stop that payment?' : 'What exact date could you pay by?'}`,
        outcome: 'proposed_settlement',
        objections, flags: objections.includes('financial_hardship') ? ['financial_hardship'] : [], commitmentDate: date, selectedAddOns: [],
      }
    }
    if (objections.includes('disputes_amount') || objections.includes('requests_documentation')) {
      return {
        reply: `I won’t ask you to accept a figure you can’t verify. The position on file is ${money(650000)} in total: ${money(400000)} principal, ${money(200000)} interest and ${money(50000)} in other charges. I’ll flag this for a documentation review — which line item should the team send you first?`,
        outcome: 'dispute_or_hardship_referral',
        objections, flags: ['documentation_or_dispute'], commitmentDate: date, selectedAddOns: [],
      }
    }
    if (objections.includes('financial_hardship')) {
      return {
        reply: 'I understand, and I’m not going to pretend full repayment is easy right now. The total on file is ₹6,50,000, and the settlement proposal is ₹4,00,000 subject to authorisation. What amount could you realistically arrange, and by when?',
        outcome: 'dispute_or_hardship_referral',
        objections, flags: ['financial_hardship'], commitmentDate: date, selectedAddOns: [],
      }
    }
    if (objections.includes('credit_reporting_question')) {
      return {
        reply: 'Continued non-payment can be reported to credit bureaus and may affect future borrowing, depending on the lender’s and bureau’s processes. I can’t predict a specific score change. Would you like to look at full repayment or the settlement proposal?',
        outcome: date ? 'follow_up_required' : 'no_commitment',
        objections, flags: [], commitmentDate: date, selectedAddOns: [],
      }
    }
    if (objections.includes('legal_question')) {
      return {
        reply: 'I can’t discuss legal action, and I won’t threaten you. What I can do is record your question for the lender’s authorised team and confirm the account position in writing. Would you like that follow-up?',
        outcome: 'follow_up_required',
        objections, flags: ['legal_query_escalated'], commitmentDate: date, selectedAddOns: [],
      }
    }
    if (objections.includes('requests_lower_amount')) {
      return {
        reply: `The only settlement figure on file is ${money(400000)}; I can’t reduce it myself. The total outstanding is ${money(650000)}. I can record ${money(400000)} as a proposal for authorised review — should I do that, or would you rather discuss a full-repayment date?`,
        outcome: 'proposed_settlement',
        objections, flags: [], commitmentDate: date, selectedAddOns: [],
      }
    }
    if (has(/full|entire|6,?50,?000|650000|six lakh fifty/)) {
      return {
        reply: `Full repayment means clearing the entire ${money(650000)}. If that’s the route you want, what date could you complete it by?`,
        outcome: date ? 'full_repayment_commitment' : 'follow_up_required',
        objections, flags: [], commitmentDate: date, selectedAddOns: [],
      }
    }
    if (date) {
      return {
        reply: `Thank you. I’ve noted ${spokenDate(date)} as a proposed date, but a promise isn’t a completed payment and any settlement still needs authorisation. Should the follow-up cover the ${money(400000)} settlement proposal or full repayment of ${money(650000)}?`,
        outcome: 'follow_up_required',
        objections, flags: ['verbal_commitment_only'], commitmentDate: date, selectedAddOns: [],
      }
    }
    if (!askedFactsBefore) {
      return {
        reply: `Thank you for confirming. The account has been unpaid for eight months. The total outstanding is ${money(650000)}: ${money(400000)} principal, ${money(200000)} interest and ${money(50000)} in other charges. What has made payment difficult over that period?`,
        outcome: 'in_progress',
        objections, flags: [], commitmentDate: null, selectedAddOns: [],
      }
    }
    return {
      reply: `The verified position hasn’t changed: ${money(650000)} in total, with a ${money(400000)} settlement proposal that needs authorisation. Are you able to pay something this month, or would a review of the account be more useful?`,
      outcome: 'no_commitment',
      objections, flags: [], commitmentDate: null, selectedAddOns: [],
    }
  }

  // Insurance deterministic flow
  if (objections.includes('requests_claim_guarantee') || objections.includes('asks_about_exclusions')) {
    return {
      reply: 'I can’t guarantee a claim or interpret the policy wording — that depends on the terms and the survey. The IDV of ₹8,00,000 is used in relevant claim and total-loss calculations, subject to those terms. I’ll flag the exact clause for confirmation; which part matters most to you?',
      outcome: 'human_escalation',
      objections, flags: ['policy_wording_required'], commitmentDate: date, selectedAddOns: addOns,
    }
  }
  if (objections.includes('competitor_quote')) {
    return {
      reply: 'That’s worth checking, and I won’t pretend the other quote is worse. A fair comparison needs the same IDV, deductibles, add-ons, exclusions, claim conditions and taxes. The renewal here is ₹15,000 against a ₹20,000 standard premium — does the other quote match this ₹8,00,000 IDV and zero add-ons?',
      outcome: 'quote_interest',
      objections, flags: ['competitor_comparison'], commitmentDate: date, selectedAddOns: addOns,
    }
  }
  if (objections.includes('idv_question')) {
    return {
      reply: 'The IDV moves from ₹9,00,000 to ₹8,00,000 because the vehicle’s market value is lower at renewal. IDV is the insured declared value used in relevant claim and total-loss calculations, subject to policy terms — it isn’t a guaranteed payout. Would you like to review the coverage before you decide?',
      outcome: 'quote_interest',
      objections, flags: [], commitmentDate: date, selectedAddOns: addOns,
    }
  }
  if (objections.includes('premium_question')) {
    return {
      reply: 'The standard premium is ₹20,000, and the available discount is ₹5,000, which brings the renewal to ₹15,000. That figure doesn’t include add-ons. Would you like the base renewal, or should we look at add-ons first?',
      outcome: 'quote_interest',
      objections, flags: [], commitmentDate: date, selectedAddOns: addOns,
    }
  }
  if (objections.includes('declines_add_ons')) {
    return {
      reply: 'Understood — no add-ons. That keeps it at the ₹15,000 renewal premium for the ₹8,00,000 IDV. Do you want to proceed with that, or would you prefer the quote in writing first?',
      outcome: 'quote_interest',
      objections, flags: [], commitmentDate: date, selectedAddOns: [],
    }
  }
  if (addOns.length) {
    return {
      reply: `Noted: ${addOns.join(', ')}. Each has its own premium, eligibility and exclusions, so I can’t quote a final amount here — the insurer has to confirm it. The base renewal is ₹15,000 for the ₹8,00,000 IDV. Should I record those add-ons for a confirmed quote before you pay?`,
      outcome: 'add_on_selected',
      objections, flags: ['add_on_price_unconfirmed'], commitmentDate: date, selectedAddOns: addOns,
    }
  }
  if (objections.includes('add_on_question') || has(/drive|park|usage|highway|city/)) {
    return {
      reply: 'Zero-depreciation cover reduces what you pay for plastic and fibre parts in a claim, engine protection matters in water-logging, and roadside assistance covers breakdowns — each has its own premium and conditions. How is the Brezza used day to day, and where is it parked overnight?',
      outcome: 'quote_interest',
      objections, flags: [], commitmentDate: date, selectedAddOns: addOns,
    }
  }
  if (acceptsOrConsents(text) && /renew|proceed|accept|go ahead|confirm|pay/.test(text)) {
    return {
      reply: 'Thank you. I’m recording your consent to proceed with the ₹15,000 renewal at an IDV of ₹8,00,000 with no add-ons. This isn’t a bound policy yet — the insurer still has to confirm the premium and issue the renewal. Shall I also send the written quote to the number on file?',
      outcome: 'quote_accepted',
      objections, flags: ['renewal_needs_insurer_confirmation'], commitmentDate: date, selectedAddOns: [],
    }
  }
  if (has(/callback|call me later|busy|written|email|whatsapp/)) {
    return {
      reply: 'I’ll arrange that. I’m recording a callback request and can have the quote sent in writing instead. What day and time suits you best?',
      outcome: 'callback_requested',
      objections, flags: [], commitmentDate: date, selectedAddOns: addOns,
    }
  }
  return {
    reply: `The renewal is ₹15,000 after a ₹5,000 discount from the ₹20,000 standard premium, with the IDV changing from ₹9,00,000 to ₹8,00,000. How do you use the Brezza, and where do you park it overnight?`,
    outcome: 'in_progress',
    objections, flags: [], commitmentDate: null, selectedAddOns: [],
  }
}
