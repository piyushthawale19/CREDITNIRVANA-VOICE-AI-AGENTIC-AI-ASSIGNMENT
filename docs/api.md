# API and data model

Base URL in development: `http://localhost:8787/api`. The Vite dev server proxies `/api`.
All responses are JSON. Errors use `{ "error": "human readable message" }`.

## Authentication

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/auth/register` | public, rate limited | Create an operator account. Name 2–80 chars, valid email, password 8–128. |
| POST | `/auth/login` | public, rate limited | Email/password. Sets the `nirvana_token` cookie. Generic 401 on failure. |
| POST | `/auth/logout` | public | Clears the cookie. |
| GET | `/auth/me` | required | Returns the signed-in operator. |

The JWT is HS256, valid for two hours, and stored in an `HttpOnly`, `SameSite=Lax` cookie
(`Secure` when `NODE_ENV=production`). It carries `sub` (user id) and `role`. The middleware
verifies the signature and expiry and re-loads the user on every request. A `Bearer` header is
also accepted for scripted testing.

## Bots and prompt versions

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/bots` | Both bots with config and current prompt version. |
| GET | `/bots/:id` | One bot (`loan` or `insurance`). |
| PUT | `/bots/:id` | Save prompt + config. Creates a new `bot_prompt_versions` row and increments `prompt_version`. |
| GET | `/bots/:id/versions` | Latest 20 versions. |
| POST | `/bots/:id/reset` | Restore the reviewed default prompt/config as a **new** version. |

`PUT` body:

```json
{
  "systemPrompt": "at least 200 characters",
  "config": {
    "language": "en-IN",
    "speaker": "shubh",
    "opening": "…",
    "fallback": "…",
    "objectives": ["…"],
    "objectionGuidelines": "…",
    "complianceNote": "…"
  }
}
```

Validation: prompt 200–20,000 chars; opening/fallback 20–600; 1–8 objectives; speaker must be
a documented Sarvam Bulbul speaker; language must be a supported BCP-47 code.

## Sessions

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/sessions` | Create a session. Body `{ botId: "loan" | "insurance", mode: "text" | "voice" }`. Returns the session with the configured opening statement. |
| POST | `/sessions/:id/respond` | Send one customer turn. Body `{ text }` (1–2000 chars). Returns the agent reply, recorded outcome, objections, date, add-ons, amount, flags, engine and the updated session. |
| POST | `/sessions/:id/complete` | Body `{ duration }` seconds. Sets `completed_at`; later turns return 409. |
| GET | `/sessions` | All sessions for the current user, newest first. |
| GET | `/sessions/:id` | One owned session. |

Turns are capped at 60 per session. Reads and writes are always filtered by `user_id`.

### Session object

```json
{
  "id": "uuid",
  "botId": "loan",
  "scenarioType": "loan",
  "transcript": [{ "id": "uuid", "speaker": "agent", "text": "…", "timestamp": "…", "engine": "sarvam-llm" }],
  "outcome": "proposed_settlement",
  "objections": ["financial_hardship"],
  "commitmentDate": "2026-11-15",
  "selectedAddOns": [],
  "finalQuotedAmount": 400000,
  "complianceFlags": ["financial_hardship"],
  "duration": 95,
  "mode": "text-simulated",
  "engine": "deterministic",
  "createdAt": "2026-10-25 20:23:00",
  "completedAt": null
}
```

`finalQuotedAmount` is stored as whole rupees (an exact integer; INR scenario values have no
sub-rupee component). UI formatting uses `Intl.NumberFormat('en-IN')`.

### Outcome vocabulary

Loan: `in_progress`, `full_repayment_commitment`, `proposed_settlement`,
`authorized_settlement` (reserved for a backend authorisation), `follow_up_required`,
`dispute_or_hardship_referral`, `human_escalation`, `no_commitment`.

Insurance: `in_progress`, `quote_interest`, `quote_accepted`, `add_on_selected`,
`renewal_completed` (reserved for verified policy issuance), `callback_requested`,
`human_escalation`, `not_converted`.

The model may not emit the reserved values. `authorized_settlement` is downgraded to
`proposed_settlement` with `authorisation_not_confirmed`; `renewal_completed` becomes
`quote_accepted` with `renewal_not_verified`. `quote_accepted` without explicit consent becomes
`quote_interest` with `consent_not_confirmed`.

## Voice

| Method | Path | Body | Behaviour |
| --- | --- | --- | --- |
| POST | `/voice/speak` | `{ text, languageCode, speaker }` | Returns `audio/mpeg` from Sarvam Bulbul. 503 with a provider message when unavailable. |
| POST | `/voice/transcribe` | raw audio body (≤8 MB), `x-language` header | Returns `{ transcript, languageCode }` from Sarvam Saaras. |
| GET | `/integrations/status` | — | Configured flag, mode, model IDs, supported speakers, notes. |
| POST | `/integrations/test` | `{}` | Performs a minimal live chat completion. 200 with model/latency or 503 with the reason. |

## Data model (SQLite)

```
users(id, name, email UNIQUE, password_hash, role, created_at)
bots(id TEXT PK, name, type, description, system_prompt, config_json,
     status, prompt_version, updated_at)
bot_prompt_versions(id, bot_id, prompt_version, system_prompt, config_json,
                    created_by, created_at, UNIQUE(bot_id, prompt_version))
sessions(id UUID PK, user_id, bot_id, scenario_type, transcript_json, outcome,
         objections_json, commitment_date, selected_add_ons_json,
         final_quoted_amount, compliance_flags_json, duration, mode, engine,
         created_at, completed_at)
```

Indexes: `users.email`, `sessions(user_id, created_at DESC)`, `sessions(bot_id, created_at DESC)`.
Foreign keys are enforced. Monetary values are integers. Passwords are bcrypt hashes only.

## Security controls

- Helmet security headers; `x-powered-by` disabled.
- CORS allow-list from `APP_ORIGIN` (defaults to local dev origins).
- Origin check on every mutating `/api` request (403 for unknown origins).
- Global API rate limit 240/min; auth 20 per 10 min; voice 30/min.
- JSON body limit 256 KB; audio limit 8 MB.
- Zod validation on every body; no `any` passthrough except the stored bot config, which is
  itself schema-validated.
- Generic auth errors and a dummy bcrypt comparison for unknown emails.
- API keys read from `process.env` only; never logged, returned or bundled.
- Session ownership enforced on read, respond and complete.
- 404 for `/api/*` unknowns, JSON error handler, SPA fallback only for GET.
