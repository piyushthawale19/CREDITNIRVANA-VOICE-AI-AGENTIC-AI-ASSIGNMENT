# Design and objection-handling note

## 1. Product intent

Nirvana Voice Studio is an operator tool, not a marketing site. An evaluator should be able to answer four questions quickly:

1. What are these two bots, and what are they allowed to say?
2. Can I challenge them with a difficult customer?
3. What did the server actually record as the outcome?
4. Is voice real, simulated, or unavailable?

Every screen serves one of those questions. Decorative cards, invented testimonials, fake success rates and non-functional buttons were deliberately excluded.

## 2. Visual system

**Light theme only.** The canvas is `#F7F8FA`, primary surfaces are white, secondary surfaces are `#F1F5F9`, and text is `#172033` / `#64748B`. Blue `#2563EB` is reserved for primary actions, active navigation and loan identity; teal `#0F766E` marks the insurance bot. Green, amber and red are used only for state (converted, needs review, failed/denied). No dark cards, no glow, no rainbow gradients.

**Typography.** DM Sans for interface text, Manrope for headings and figures, DM Sans 800 only where a number needs hierarchy. The type scale is 30px page title, 16px card title, 13px body, 11px metadata. Tables stay dense; prose is capped near 70 characters per line.

**Hierarchy.** One primary action per page: *New test session* on the dashboard, *Test bot* on a bot card, *Save configuration* in the editor, *Start voice test* in the playground. Secondary actions are outlined; destructive actions (reset prompt, sign out) are red text, never solid red buttons, so they do not compete with the primary path.

**Components.** The project ships a small, intentional CSS component layer (buttons, cards, badges, fields, tables, transcript bubbles, tabs, banners) rather than pulling a component library into a Vite app that already had a worked-out visual language. The result is fewer dependencies, consistent radii (8–14px), one shadow, and a predictable focus ring. All icons come from Lucide.

**States.** Every data surface has loading, empty and error states. Disabled controls explain why (voice start requires `SARVAM_API_KEY`; the voice tab is locked while a session is live). Errors name the failed action and keep the transcript intact.

**Responsive behaviour.** The sidebar becomes an off-canvas sheet under 760px with a scrim, the playground stacks control panels under the transcript, composer buttons wrap, filters go full width, and grid children are forced to `min-width: 0` so wide tables scroll inside their card instead of pushing the page sideways. Verified at 1440×900 and 390×844 with zero horizontal overflow.

**Accessibility.** Visible focus rings, labelled inputs, `aria-live` on the transcript, tab roles and `aria-selected`, `aria-invalid` on invalid login fields, 4.5:1 contrast for body text, and no colour-only state (badges carry words).

## 3. Voice playground state model

The UI never invents agent state; it is derived from actual operations:

| State | Trigger | What the user sees |
| --- | --- | --- |
| idle | no operation in flight | neutral dot, session controls |
| connecting | `POST /api/sessions` | “Connecting…” pill |
| listening | voice session ready / transcription complete | green dot, mic prompt |
| processing | request to the turn engine or STT in flight | “Thinking…” bubble |
| speaking | Sarvam audio is playing | teal dot, speaker indicator, stop button |
| error | mic denial, STT/TTS failure, engine failure | red pill plus a specific message; text fallback remains usable |

Voice mode is disabled unless the server reports credentials. That is a deliberate honesty decision: a “voice” session that only moves text would misrepresent the integration.

The microphone records a short browser clip, posts it to the server for Sarvam transcription, and discards it. No audio is persisted, and the UI says so next to the session rather than implying a recording exists. Replay uses a fresh TTS request for the stored text; it is not a recording of the original call.

## 4. Loan bot — objection playbook

Principles: acknowledge in one sentence, state the verified fact, ask one focused question. Firm but not theatrical. Never invent a deadline, legal step or discount.

| Customer move | Intent | Response strategy | Recorded outcome / flag |
| --- | --- | --- | --- |
| “I can’t pay, I lost my job.” | Hardship | Acknowledge; state ₹6,50,000 and the ₹4,00,000 proposal that needs authorisation; ask what amount and date is realistic. | `dispute_or_hardship_referral`, objection `financial_hardship` |
| “I can settle at 4 lakh on 15 Nov.” | Offer | Accept as a **proposal**; explain it is not binding or approved; confirm the date; ask what could block payment. | `proposed_settlement`, amount ₹4,00,000 |
| “Reduce it to 2 lakh.” | Negotiation | Only ₹4,00,000 is on file; cannot reduce; offer authorised review. | `proposed_settlement`, objection `requests_lower_amount` |
| “The amount is wrong, send proof.” | Dispute | Do not defend the figure; read back the three components; record a documentation review. | `dispute_or_hardship_referral`, flag `documentation_or_dispute` |
| “I already paid.” | Payment claim | Do not accuse; ask for date/reference; escalate for reconciliation. | referral + `documentation_or_dispute` |
| “Will my CIBIL score fall?” | Credit reporting | Explain conditional bureau reporting; refuse to predict a score change. | no conversion |
| “Send the police / take me to court.” | Legal pressure | Refuse to discuss legal action; record the question for the lender. | `follow_up_required`, `legal_query_escalated` |
| “I want a human.” | Escalation | Agree immediately; record callback preference; stop selling. | `human_escalation` |
| “I’ll pay next month.” | Vague promise | Distinguish a proposal from a payment; ask for a specific date and amount. | `follow_up_required`, `verbal_commitment_only` |

Hard boundaries: no arrest, police, court, legal notice, asset seizure, public shaming, invented waiver, “today only” deadline, guaranteed approval, or a specific score prediction. The server-side compliance gate blocks these even if a model generates them.

## 5. Insurance bot — objection playbook

Principles: confident, consultative, concise. Price is never discussed without coverage context. A decline is accepted the first time.

| Customer move | Intent | Response strategy | Recorded outcome / flag |
| --- | --- | --- | --- |
| “Why did IDV fall?” | Value concern | ₹9,00,000 → ₹8,00,000 due to market value at renewal; IDV is used in relevant claim/total-loss calculations subject to policy terms, not a guaranteed payout. | `quote_interest` |
| “Why ₹15,000?” | Price concern | Standard ₹20,000 minus ₹5,000 discount; add-ons are separate. | `quote_interest` |
| “PolicyBazaar is cheaper.” | Competitor | Ask for like-for-like IDV, deductibles, add-ons, exclusions, claim conditions and taxes; never invent a competitor price. | `quote_interest`, objection `competitor_quote` |
| “I don’t need add-ons.” | Decline | Accept immediately; confirm the base ₹15,000 quote. | `quote_interest` |
| “Add zero dep and engine cover.” | Upsell | Explain each has its own premium, eligibility and exclusions; record selection; final premium needs insurer confirmation. | `add_on_selected`, `add_on_price_unconfirmed` |
| “Guarantee my claim.” | Unsupported promise | Refuse; explain claims depend on policy wording and survey; escalate. | `human_escalation`, `policy_wording_required` |
| “I accept, renew it.” | Consent | Record explicit consent at ₹15,000; state that cover is not bound until insurer confirmation/payment. | `quote_accepted`, amount ₹15,000 |
| “Call me later / send it in writing.” | Deferral | Record callback or written-quote request with a date if given. | `callback_requested` |

Hard boundaries: no fabricated coverage, competitor price, discount, claim approval, zero-risk claim or legal interpretation; no hidden exclusions; no pressure after a decline.

## 6. Honesty patterns in the UI

- Demo mode is stated on the dashboard, playground, settings and documentation, not buried.
- Transcript bubbles generated by the fallback engine are labelled **simulation**; Sarvam-generated turns are labelled **Sarvam LLM**.
- “Verified conversions” only counts `authorized_settlement` and `quote_accepted`. Proposed settlements and renewal interest are shown separately.
- The analytics page prints sample size and measurement window beside every rate and explains that a single call can produce a meaningless 100%.
- History exports include the line “not proof of payment, settlement approval or an issued policy”.
- Compliance flags and review flags are separated so a hardship referral is not presented as a rule breach.
