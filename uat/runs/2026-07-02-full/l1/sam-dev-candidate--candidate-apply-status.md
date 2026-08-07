# L1 theoretical — Sam Okafor × candidate-apply-status

- **Run:** 2026-07-02-full · main @ 3395b4c · cert_level L1 (no browser — code-derived surface model)
- **Verdict:** **L1-conditional** — structurally he finishes fast and informed; the comms delivery seam (capst-l1-001) is the major that carries to L2
- **Grounding score:** 9/11 (apply script 5/6 · candidate comms 4/5)
- **Estimated time saved (if it all worked):** ~20 min vs. a typical ATS account-wall + long-form apply, plus the transparency he normally never gets · **medium-high confidence**
- **Scope note:** his dev-case / live-work surface (`/devcase/apply/[token]`) is a different journey; judged here: apply in English, status transparency, AI disclosure.

## Surface model (code-derived — what his path executes)

- **`/apply/[id]` (en):** script is server-built from the real job and localized per request (`app/apply/[id]/page.tsx:42-47`; `app/_lib/apply.ts:99-246`). For him: skip CV or attach it (text extracted via `/api/extract-text`, pre-fills name/email as *editable* defaults — `ConversationalApply.tsx:353-376,191-201`), name, email (validated inline at its own step, `:321-324`), archetype → experienced lane, experience, skills, **optional GitHub handle** (shape-gated inline, skippable, `:330-333`; persisted for the recruiter's on-demand deep-dive — `apply.ts:207-218`), then role-derived KO gates (`ko_auth` from `job.location`, `ko_mode` only if non-remote, `ko_lang` only if the job lists languages — `apply.ts:224-245`). ~8–9 short steps; double-submit-proof (`answeredRef`, `:110-111,291-292`); a failed final POST distinguishes retryable from rejected-input (`:456-482`).
- **Submit:** `POST /api/apply/[id]` — KO fail → polite decline, **audited** (`route.ts:238-253`); pass → profile normalized via the Python `profile_cli` with a visible degraded-stub fallback (`:95-158`), entry filed at Accepted, consent + TTL stamped (`:447-452`), ack dispatched with the status link, and the JSON returns `statusToken` → the in-page **"Track your application status"** link (`ConversationalApply.tsx:443-450`).
- **`/status/[token]`:** unguessable token → candidate-safe projection only (status, role, company, updatedAt — never ids/scores/reasoning; `api/status/[token]/route.ts:9-26`, `application-status-store.ts:5-11`). Timeline received → under review → interview → offer → hired with a "now" line (`status/[token]/page.tsx:91-114`).
- **AI disclosure:** `AiDisclosure` under the chat the whole flow (`ConversationalApply.tsx:601`) — "AI assists screening… a human reviews and makes every advance, offer, and rejection decision" + jurisdiction-aware framework line self-resolved from the public `GET /api/compliance` (`AiDisclosure.tsx:30-45`, `app/api/compliance/route.ts:11-13`) + data-consent/retention/erasure sentence (`showDataConsent`).
- **Comms:** deterministic templates, rendered in the locale he applied in (`comms-dispatch.ts:39-47,136`), GDPR erasure footer on each (`:93-98`). **Delivery:** outbox-terminal unless `COMMS_WEBHOOK_URL` is set; no email provider integration exists (`comms.ts:36-42,97-100`) — F-001.

## Reachability

Sam reaches only the tokenized/public pages in **English**. `/apply/[id]` needs an open published job; `/status/[token]` is minted by his own submit — reachable within the journey. The `?lead=` enrichment entry (optional for him) resolves server-side and degrades silently to first-time flow on a stale token (`page.tsx:58-75`) — an emailed link is never worse than none. Bare-URL 404 suppressed per accepted-gaps.

## Cognitive walkthrough (en, terse, senior)

1. **Will he even start?** No account wall, no 20-field form, "A quick chat — no forms, no logins." He starts. ✓
2. **Does it respect his time?** ~8 steps, all one-liners; CV upload optional and it *pre-fills* instead of making him retype (the classic ATS insult). GitHub step is optional with a skip — correct call. Draft survives a refresh. Effort bar: **pass**. ✓
3. **Is the English real?** Native-quality throughout (`messages/en.json apply.*`, `status.*`, `aiDisclosure.*`) — written, not machine-translated. His pet peeve isn't triggered. ✓
4. **AI disclosure an engineer takes seriously?** Better than most: names what AI assesses (skills/experience/fit), claims human review of every adverse decision, names the legal framework for the active jurisdiction (live-fetched, not hardcoded), states retention + a self-service erasure path. He reads code for a living though, and the absolutist sentence "nothing adverse is decided automatically" doesn't survive contact with the source: the KO gate auto-declines (`api/apply/[id]/route.ts:238-253`) and the screening wave auto-rejects the bottom cohort by match score with batch-level human approval, actor `"system"` (`screen-wave.ts:12-17,253,281` — mitigated by the approval token + Art.22-style sealed record + fairness fail-closed gate at `:266-272`). Overclaim, not black box → **F-004, minor**. ~
5. **Signal his effort mattered?** Structurally yes: instant in-page acceptance + a durable status link + `applied` provenance event; the status page later shows a human-driven stage change, and even a rejection is a respectful templated message plus a truthful "Not selected" terminal card — not a void (`application-status.ts:38-42`). **But** the push half of that promise (ack/rejection emails) rides F-001: by default those messages exist only in a recruiter-side outbox he can never read. If he closes the tab without saving the status link, the durable touchpoint is gone. **major, carried to L2.** ✗
6. **Trust the status page?** It deliberately leaks nothing (no score, no reasoning, no internal ids) — as an engineer he *approves*: minimal surface, unguessable token, not the DB PK. ✓

## Scored acceptance criteria (his fixed lens; dev-case items out of scope here)

| Criterion | Verdict | Evidence |
|---|---|---|
| **effort/time-saved** — brief and real | **PASS** (apply leg) — ~8 one-line steps, optional CV/GitHub, no account | `apply.ts:99-246`, `ConversationalApply.tsx` |
| **completion** — live-work surface works | out of scope (dev-case journey) | — |
| **clarity** — natively fluent English | **PASS** — no machine-translation smell in any surface string | `messages/en.json apply./status./aiDisclosure.*` |
| **senior-quality** — measures judgment, not puzzles | out of scope (dev-case journey); the intake questions are sane and role-grounded | `apply.ts:224-245` |
| **trust** — AI-use disclosure an engineer takes seriously | **PASS with a caveat** — present, specific, jurisdiction-aware; one sentence overclaims (F-004, minor) | `AiDisclosure.tsx:47-61`, `screen-wave.ts:281` |
| **missing/completion** — evidence his effort mattered, not a void | **CONDITIONAL** — in-page ack + status link + honest terminal states; push delivery is outbox-terminal by default (F-001, major) | `ConversationalApply.tsx:443-450`, `comms.ts:36-42` |

## Findings raised (see candidate-apply-status.findings.json)

- **capst-l1-001 (major, trust)** — comms not delivered by default; outbox terminal, recruiter-only; no provider integration. `comms.ts:36-42,97-100`
- **capst-l1-004 (minor, trust)** — "nothing adverse is decided automatically" overstates: KO auto-decline + batch-approved auto-reject wave. `api/apply/[id]/route.ts:238-253`, `screen-wave.ts:253,281`
- **capst-l1-005 (minor, trust)** — hardcoded "12 months" vs configurable `KP_CONSENT_TTL_DAYS`. `consent.ts:14-18`
- **Strengths:** capst-l1-007 (candidate-safe status projection), capst-l1-008 (fast resilient apply incl. optional GitHub + CV pre-fill), capst-l1-009 (deterministic locale-pinned comms + erasure footer).

## L2 priorities (hand-off)

1. F-001: after a live en apply, verify what he can actually receive — outbox-only vs a configured relay; does the ack carry the working status + erasure links?
2. Grounded path: apply against a real seeded ČS digital/IT role — prompts must name that role; entry lands Accepted in the pipeline; status link shows the live stage.
3. CV upload live: extraction latency + the pre-fill hint ("Filled in from your CV — please check it's right").
4. Confirm the disclosure's regime line resolves (the `/api/compliance` fetch) on the public page with no auth.

## Character feedback — Sam, first person

"Honest review, like a PR. The apply flow is the first one in months I didn't abandon: no account, no re-typing my CV into eleven fields — I attached the PDF and it pre-filled my name and email as *editable* defaults, which is exactly how you do that. Eight questions, all of which had a reason to exist; the knockouts were derived from the actual role, not compliance boilerplate. The English is written by someone fluent. The GitHub step being optional-with-skip instead of required tells me an engineer reviewed this UX.

The status link is the feature. A tokenized page that shows me exactly where I stand, leaks nothing it shouldn't — not even the entry id — and flips to an honest 'not selected' instead of ghosting me. I checked the API: it returns four fields. Minimal surface. Respect.

Two things I'd flag in review. One: the disclosure says 'nothing adverse is decided automatically', but there's a knockout auto-decline and an auto-reject wave in the codebase — human-approved at batch level, sealed and audited, fine — but then say *that*. Engineers trust precision, not absolutes. Two, the blocker-shaped one: every email this thing 'sends' — my acknowledgement, the rejection, presumably the interview invite — lands in a local outbox table unless someone configures a webhook relay. There's no mail provider in the dependency tree at all. So the durable copy of my status link only exists if I bookmark it before closing the tab. Ship a real sender, or stop implying you sent something.

Would I keep talking to this employer? Yes — this respects my time more than any bank ATS I've touched. But close the delivery seam before a real candidate closes the tab."

**Adoption:** yes for the flow; conditional on delivery for the loop-closure promise. **Time saved:** ~20 min on mechanics, plus not writing the 'any update?' email he hates sending.
