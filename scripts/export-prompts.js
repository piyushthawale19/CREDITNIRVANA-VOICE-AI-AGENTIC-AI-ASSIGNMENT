import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_PROMPTS, DEFAULT_CONFIG } from '../server/db.js'

const docsDir = path.join(import.meta.dirname, '..', 'docs')
fs.mkdirSync(docsDir, { recursive: true })

const title = {
  loan: 'Bot A — Resolve Personal Loan (settlement)',
  insurance: 'Bot B — Cover Renewal (car insurance)',
}

const sections = Object.entries(DEFAULT_PROMPTS).map(([id, prompt]) => `## ${title[id]}

**Purpose:** ${DEFAULT_CONFIG[id].objectives.join(' · ')}

**Default voice:** \`${DEFAULT_CONFIG[id].speaker}\` · **Language:** \`${DEFAULT_CONFIG[id].language}\`

**Opening statement:** ${DEFAULT_CONFIG[id].opening}

**Fallback:** ${DEFAULT_CONFIG[id].fallback}

**Objection guidance:** ${DEFAULT_CONFIG[id].objectionGuidelines}

**Compliance instruction:** ${DEFAULT_CONFIG[id].complianceNote}

### Full system prompt

\`\`\`text
${prompt}
\`\`\`
`).join('\n---\n\n')

const content = `# Nirvana Voice Studio — system prompts

These are the canonical prompts shipped with the application. The running database stores a
copy that an operator can edit; every save creates a new version and the editor can restore
this default. Regenerate this document with:

\`\`\`bash
node scripts/export-prompts.js
\`\`\`

Both prompts end with an \`OPERATIONAL OUTPUT CONTRACT\` appended by the server at call time.
That contract is not editable and asks the model for a JSON object containing the spoken
reply, an outcome enum, objections, commitment date, add-ons, quoted amount and compliance
flags. The contract is never shown to a customer.

---

${sections}
## Why the prompts are shaped this way

1. **Facts before persuasion.** Every monetary figure, the 8-month default, the vehicle, the
   IDV and both premium amounts are stated once and marked as authoritative. The prompt
   forbids inventing any other number.
2. **Verification before disclosure.** Both bots confirm the customer or an authorised person
   before discussing account or policy details.
3. **Separate interest from authorisation.** A settlement is never “approved” in conversation,
   and a renewal is never “issued”. The server enforces the same rule in code, so a persuasive
   model response cannot fabricate a business outcome.
4. **One question per turn.** Spoken conversations fail when the agent reads a questionnaire.
   Objectives and required questions are listed for the model, but the response contract caps
   the reply at three sentences and one question.
5. **Escalation is a success path.** Disputes, documentation requests, hardship and policy
   wording questions produce a recorded referral rather than a guess.
6. **No legal theatre.** Threats, invented deadlines and specific credit-score predictions are
   prohibited and additionally blocked by a regex compliance gate before storage.
7. **Honest conversion.** A verbal promise is stored as a proposed commitment with a date, not
   as a payment. Add-on selections are stored with a flag that the final premium is unconfirmed.
`

fs.writeFileSync(path.join(docsDir, 'system-prompts.md'), content)
console.log(`Wrote ${path.join(docsDir, 'system-prompts.md')} (${content.length} chars)`)
