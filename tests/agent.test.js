import test from 'node:test'
import assert from 'node:assert/strict'
import { applyCompliance, deterministicReply, guardOutcome, normaliseDate } from '../server/agent.js'

const bot = (type) => ({
  id: type,
  config: {
    opening: 'Hello, this is an AI assistant.',
    fallback: 'I will have that confirmed by the team.',
    language: 'en-IN',
    speaker: 'simran',
  },
})

const engineOutcomes = {
  loan: ['in_progress', 'full_repayment_commitment', 'proposed_settlement', 'follow_up_required', 'human_escalation', 'dispute_or_hardship_referral', 'no_commitment', 'authorized_settlement'],
  insurance: ['in_progress', 'quote_interest', 'quote_accepted', 'add_on_selected', 'callback_requested', 'human_escalation', 'not_converted', 'renewal_completed'],
}

test('normaliseDate understands spoken and numeric dates', () => {
  const today = new Date()
  assert.equal(normaliseDate('tomorrow'), new Date(today.getTime() + 86_400_000).toISOString().slice(0, 10))
  assert.equal(normaliseDate('15 November').slice(5), '11-15')
  const numeric = normaliseDate('15/11/2026')
  assert.equal(numeric, '2026-11-15')
  assert.equal(normaliseDate('sometime soon'), null)
})

test('compliance gate blocks threats and unverified approvals', () => {
  const threat = applyCompliance('If you do not pay we will arrest you and send a legal notice.', 'loan', 'Fallback text.')
  assert.ok(threat.flags.includes('compliance_blocked:legal_threat'))
  assert.equal(threat.reply.startsWith('Fallback text.'), true)
  assert.equal(/arrest/i.test(threat.reply), false)

  const approval = applyCompliance('Your settlement is approved and guaranteed.', 'loan', 'Fallback text.')
  assert.ok(approval.flags.includes('compliance_blocked:unauthorised_approval'))

  const guarantee = applyCompliance('I guarantee your claim will be approved.', 'insurance', 'Fallback text.')
  assert.ok(guarantee.flags.includes('compliance_blocked:claim_guarantee'))

  const clean = applyCompliance('The total outstanding is ₹6,50,000.', 'loan', 'Fallback text.')
  assert.deepEqual(clean.flags, [])
  assert.equal(clean.reply, 'The total outstanding is ₹6,50,000.')
})

test('outcome guard never lets a model authorise a settlement or renewal', () => {
  const settlement = guardOutcome('loan', 'authorized_settlement', 'yes I agree', engineOutcomes.loan)
  assert.equal(settlement.outcome, 'proposed_settlement')
  assert.ok(settlement.flags.includes('authorisation_not_confirmed'))

  const renewal = guardOutcome('insurance', 'renewal_completed', 'yes proceed', engineOutcomes.insurance)
  assert.equal(renewal.outcome, 'quote_accepted')
  assert.ok(renewal.flags.includes('renewal_not_verified'))

  const noConsent = guardOutcome('insurance', 'quote_accepted', 'I am just checking prices', engineOutcomes.insurance)
  assert.equal(noConsent.outcome, 'quote_interest')
  assert.ok(noConsent.flags.includes('consent_not_confirmed'))
})

test('loan bot verifies identity before disclosing account figures', () => {
  const reply = deterministicReply('loan', bot('loan'), 'Hello, who is this?', [
    { speaker: 'agent', text: 'Hello, I am an AI assistant calling about an account review. May I confirm I am speaking with the account holder?' },
  ])
  assert.equal(reply.outcome, 'in_progress')
  assert.match(reply.reply, /confirm your full name/i)
  assert.equal(/6,50,000/.test(reply.reply), false)
})

test('loan bot shares verified figures after verification and asks one focused question', () => {
  const history = [
    { speaker: 'agent', text: 'Hello, I am an AI assistant. May I confirm I am speaking with the account holder?' },
  ]
  const reply = deterministicReply('loan', bot('loan'), 'Yes, Rakesh here.', history)
  assert.equal(reply.outcome, 'in_progress')
  assert.match(reply.reply, /₹6,50,000/)
  assert.match(reply.reply, /₹4,00,000/)
  assert.match(reply.reply, /₹2,00,000/)
  assert.match(reply.reply, /₹50,000/)
  assert.equal(reply.reply.split('?').length - 1, 1)
})

test('loan bot records a settlement proposal but not an approval', () => {
  const history = [
    { speaker: 'agent', text: 'Hello, I am an AI assistant. May I confirm I am speaking with the account holder?' },
    { speaker: 'customer', text: 'Yes, this is Rakesh.' },
    { speaker: 'agent', text: 'The total outstanding is ₹6,50,000: ₹4,00,000 principal, ₹2,00,000 interest and ₹50,000 other charges. What has made payment difficult?' },
  ]
  const reply = deterministicReply('loan', bot('loan'), 'I lost my job and cannot pay. Can I settle for 4 lakh on 15 November?', history)
  assert.equal(reply.outcome, 'proposed_settlement')
  assert.equal(reply.commitmentDate?.slice(5), '11-15')
  assert.match(reply.reply, /not binding|isn’t binding|authoris/i)
  assert.equal(/is approved|has been approved|sanctioned/i.test(reply.reply), false)
})

test('loan bot escalates documentation disputes and human requests', () => {
  const history = [{ speaker: 'agent', text: 'The total outstanding is ₹6,50,000.' }]
  const dispute = deterministicReply('loan', bot('loan'), 'I never took this loan. Send me the statement.', history)
  assert.equal(dispute.outcome, 'dispute_or_hardship_referral')
  assert.ok(dispute.flags.includes('documentation_or_dispute'))

  const human = deterministicReply('loan', bot('loan'), 'I want to speak to a human agent.', history)
  assert.equal(human.outcome, 'human_escalation')
})

test('loan bot refuses to invent legal action or a score prediction', () => {
  const history = [{ speaker: 'agent', text: 'The total outstanding is ₹6,50,000.' }]
  const legal = deterministicReply('loan', bot('loan'), 'Will you send police or take me to court?', history)
  assert.equal(legal.outcome, 'follow_up_required')
  assert.equal(/we will (arrest|send police|file)/i.test(legal.reply), false)
  assert.match(legal.reply, /won’t threaten|can’t discuss legal/i)

  const score = deterministicReply('loan', bot('loan'), 'Will my credit score drop by 100 points?', history)
  assert.match(score.reply, /can’t predict|depending on/i)
  assert.equal(/will drop by/i.test(score.reply), false)
})

test('insurance bot explains IDV, premium and competitor comparisons honestly', () => {
  const history = [{ speaker: 'agent', text: 'This is about your Maruti Brezza renewal.' }]
  const idv = deterministicReply('insurance', bot('insurance'), 'Why did the IDV reduce from 9 lakh?', history)
  assert.match(idv.reply, /₹9,00,000/)
  assert.match(idv.reply, /₹8,00,000/)

  const premium = deterministicReply('insurance', bot('insurance'), 'Why is the premium 15000 now?', history)
  assert.match(premium.reply, /₹20,000/)
  assert.match(premium.reply, /₹5,000/)

  const competitor = deterministicReply('insurance', bot('insurance'), 'PolicyBazaar gave me a cheaper quote, can you beat it?', history)
  assert.match(competitor.reply, /IDV|deductibles|exclusions/i)
  assert.equal(/₹?\s?12,000|₹12,000/.test(competitor.reply), false)
})

test('insurance bot records consent and add-ons without inventing a price', () => {
  const history = [{ speaker: 'agent', text: 'The renewal is ₹15,000 for an IDV of ₹8,00,000.' }]
  const accepted = deterministicReply('insurance', bot('insurance'), 'Yes, I want to renew at 15000.', history)
  assert.equal(accepted.outcome, 'quote_accepted')
  assert.match(accepted.reply, /isn’t a bound policy|isn't a bound policy/i)

  const addOn = deterministicReply('insurance', bot('insurance'), 'I want zero depreciation and engine protection.', history)
  assert.equal(addOn.outcome, 'add_on_selected')
  assert.deepEqual(addOn.selectedAddOns, ['Zero depreciation', 'Engine protection'])
  assert.ok(addOn.flags.includes('add_on_price_unconfirmed'))

  const exclude = deterministicReply('insurance', bot('insurance'), 'Can you guarantee my claim will be approved?', history)
  assert.equal(exclude.outcome, 'human_escalation')
  assert.match(exclude.reply, /can’t guarantee|can't guarantee/i)
})
