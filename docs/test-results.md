# Test results — final verification run

Date: 26 October 2026. Environment: Node 22.19.0 on Windows, Chromium browser, local SQLite. Every command below was executed in this repository; the outputs are reproduced as they were printed.

## 1. Automated checks

| Command | Result |
| --- | --- |
| `npm run lint` (`tsc --noEmit`) | Exit 0, no type errors. Run twice — before and after the Sarvam adapter changes. |
| `npm test` (`node --test tests/agent.test.js tests/api.test.js`) | **26 tests, 26 pass, 0 fail** (duration ~2.7–3.2 s). Run twice; the second run covered the modified `server/sarvam.js`. |
| `npm run build` (`tsc --noEmit` + `vite build`) | Success. `dist/assets/index-*.js` 723.71 kB (gzip 213.91 kB) in ~1.1 s. The only output note is Vite's standard chunk-size warning (single bundle > 500 kB). |

Test coverage by area:

- **Authentication** — valid login, invalid credentials return a generic error, JWT required on private routes, logout clears the cookie and the route becomes private again, input validation, `GET /api/auth/me` rejects requests without a session.
- **Authorization** — sessions are scoped to the signed-in user; a second account cannot read or modify another user's session (cross-account read returns 404).
- **Loan bot** — verification before disclosure, exact ₹6,50,000 breakdown, repeated excuses, genuine hardship vs vague postponement, dispute/documentation request, lower-offer negotiation, human-agent request, threatened-legal-claim provocation, and the proposal-vs-approval distinction (`authorized_settlement` can never be produced by the conversation layer).
- **Insurance bot** — IDV change ₹9,00,000 → ₹8,00,000, ₹20,000 → ₹15,000 with the ₹5,000 discount, competitor-quote comparison on equivalent coverage, declined add-ons, exclusion questions, unsupported "guarantee my claim" request, quote acceptance and renewal consent.
- **Voice endpoints** — speech-to-text, speech synthesis and connection-test endpoints fail with a clear message and no fabricated output when `SARVAM_API_KEY` is absent.
- **Outcome guard / compliance gate** — a model reply claiming approval or threatening legal action is replaced by the configured fallback and flagged.

## 2. Production-mode smoke test

Command (run against the built `dist/`):

```
PORT=8899 JWT_SECRET=<random> NODE_ENV=production node server/index.js
```

| Check | Result |
| --- | --- |
| `GET /` | 200, `text/html`, `<title>Nirvana Voice Studio</title>` |
| `GET /bots/loan/playground` (SPA deep link) | 200 (history fallback serves the app) |
| `GET /assets/index-*.js` | 200, `text/javascript` |
| `POST /api/auth/login` with a wrong password | 401 |
| `POST /api/auth/login` with the seeded account | 200, sets `HttpOnly` cookie |
| `GET /api/auth/me` with that cookie | 200 |
| `GET /api/nope` (unknown API path) | 404 |
| `GET /api/health` | `{"ok":true,"service":"nirvana-voice-studio",...}` |

## 3. Browser verification (dev server, Chromium)

Viewport sweeps over **every route** — `/`, `/bots`, `/bots/loan/configure`, `/bots/loan/playground`, `/history`, `/analytics`, `/documentation`, `/settings`:

- At **1440×900** and **390×844**: all eight routes render, `scrollWidth === clientWidth` (no horizontal overflow anywhere), `body` background `rgb(247, 248, 250)` — the light palette, verified on every page.
- Mobile navigation drawer opens with a scrim and closes again.
- Console: no JavaScript errors. The only entries were three `401` responses produced deliberately during the invalid-login check.

Behavioural checks:

1. **Login** — wrong password shows the generic `Invalid email or password.` (no account-existence leak); correct credentials open the dashboard.
2. **JWT is really enforced** — after the API was restarted (new ephemeral dev secret), the browser was redirected back to the login screen instead of showing cached pages.
3. **Loan playground, full text session** (saved as session `10891325`):
   - Opening turn identifies the bot as an AI assistant and verifies the account holder before disclosing anything.
   - Reply states ₹6,50,000 = ₹4,00,000 principal + ₹2,00,000 interest + ₹50,000 charges.
   - Hardship objection → acknowledged without insults, one focused question, server classifies `financial_hardship` and sets outcome `Hardship / dispute referral`.
   - Commitment turn → reply records ₹4,00,000 as a **proposal** that "isn't binding or approved until the lender authorises it in writing", captures **15 Nov 2026**, asks one follow-up question.
   - Final recorded outcome (server-side): `proposed_settlement`, commitment date `2026-11-15`, quoted amount ₹4,00,000, 1 review flag, 0 compliance flags, saved.
4. **Insurance playground, full text session** (saved as session `b87e05f1`):
   - IDV question → explains the ₹9,00,000 → ₹8,00,000 change, defines IDV as used in claim and total-loss calculations "subject to policy terms — it isn't a guaranteed payout".
   - Competitor at ₹12,000 → compares on IDV, deductibles, add-ons, exclusions, claim conditions and taxes; invents no competitor price and asserts no competitor figures.
   - Add-ons accepted → records `Zero depreciation, Engine protection`, states each has its own premium/eligibility and that the insurer must confirm the final amount; base renewal ₹15,000 against the ₹20,000 standard premium.
   - Recorded outcome (server-side): `add_on_selected`, quoted amount ₹15,000, four objections classified (`idv_question`, `competitor_quote`, `premium_question`, `add_on_question`), 2 review flags, **not** counted as a completed renewal. Saved.
5. **History** — both sessions listed with bot, mode, outcome, commitment and timestamp; `Inspect` shows the full transcript, objections classified server-side, copy/export controls, and the disclaimer "Test conversation. Not evidence of payment, settlement approval, or an issued policy. No audio recording exists for this session."
6. **Analytics** — computed only from the two stored sessions, with sample size next to every rate (`n = 1`, `n = 0`), the measurement window, rate definitions, objection table and compliance/review flag table, plus the note that a single test call can produce a 100% rate and mean nothing. No seeded or invented figures.
7. **Bot configuration** — Save creates a new prompt version, version history lists v1…v4 and can be loaded back, Reset restores the reviewed default (verified: loan bot back to the default prompt containing ₹6,50,000 and ₹4,00,000, current `promptVersion` incremented, history retains the earlier versions).
8. **Documentation** — architecture, local setup, environment variables, security model, testing, known limitations and both complete system prompts render in-app.
9. **Settings → Test Sarvam connection** (no key present) → `No live connection established / SARVAM_API_KEY is not set on the server.` — an honest failure, not a simulated success.

## 4. Sarvam documentation accuracy pass

Every request shape in `server/sarvam.js` was checked against the official documentation (docs.sarvam.ai) on 26 October 2026:

- `POST https://api.sarvam.ai/v2/chat/completions`, `model: sarvam-105b`, OpenAI-compatible `messages` — confirmed current.
- `POST https://api.sarvam.ai/speech-to-text`, multipart `file` + `model: saaras:v4` + `language_code`, response field `transcript` — confirmed.
- `POST https://api.sarvam.ai/text-to-speech`, JSON `text` + `language_code` + `model` + `speaker`, response `audios[]` of base64 — confirmed.
- Header `api-subscription-key` for all three — confirmed.

Defects found and fixed in this pass:

1. `mode=transcribe` was sent with `saaras:v4`; the API reference says `mode` applies only to `saaras:v3` → **removed**.
2. Default TTS model was `bulbul:v4-flash`, whose voices are `<name>_<language>_<style>` persona ids while the playground offers the v3/v2 short names → default switched to the documented API default **`bulbul:v3`**, and for a `bulbul:v4*` override the `speaker` field is omitted so the provider default persona is used instead of risking a 4xx.
3. The speaker allow-list contained three ids that are not in Sarvam's enum (`amelie`, `sophia`, `sucheta`) and was missing three valid ones → corrected to exactly the `bulbul:v2` + `bulbul:v3` voice lists, so a bot can no longer be saved with a speaker the API would reject.

Because these are request-shape corrections, they are covered by the API tests above; the calls themselves still require a real key (see limitations).

## 5. Not verified, and why

| Item | Status |
| --- | --- |
| Live Sarvam chat / STT / TTS round-trip | **Blocked** — no `SARVAM_API_KEY` exists in this workspace, and creating one requires the owner's Sarvam account. Request shapes are verified against official docs; the app labels the mode `demo` and disables voice controls until a key is set. |
| Microphone capture → transcription → spoken reply | **Blocked** by the same missing key. Mic-permission denial and disabled-state handling are exercised in the UI. |
| Call recordings / DOCX-PDF prompt export | **Not implemented by design.** The app stores no audio, so no recordings exist to submit; prompts ship as Markdown (`docs/system-prompts.md`, `npm run prompts`). |
| Two authorised test phone numbers | **Blocked** — no numbers were supplied and none are invented. There is no PSTN dialling in this build; tests run through the browser. |

## 6. Current workspace state after the run

- `data/nirvana.sqlite` holds the seeded operator (`demo@nirvana.local`), both bots (loan prompt at version 4 after the save/reset exercise, insurance at version 1) and exactly **two** stored test sessions, both labelled `text-simulated` in history.
- Processes left running for review: Vite dev server on `http://localhost:5173` and the API on `http://localhost:8787`.
- Temporary production-smoke database (`data/prod-smoke.sqlite*`) was removed after the smoke test.
