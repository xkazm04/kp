---
id: voice-interview
type: tiger/call-site
modality: audio
file: app/api/interview/connect/route.ts:148
wrapper: voice registry (separate from the text wrapper)
provider: elevenlabs (default; openai-realtime the other arm)  model: eleven_flash_v2_5 (LLM gemini-2.5-flash) / gpt-realtime
schema: app/_lib/voice/types.ts:58 (VoiceTurn[]; captured live, persisted at complete/route.ts:125)
grounding: 4/4 sources (on the candidate/grounded path; the openai arm grounds server-side, the elevenlabs arm via a best-effort override)
quality_score: 4  code_score: 4
recommended_model: "—"
status: assessed
last_scanned: 2026-06-20
characters: ["[[tereza-candidate]]", "[[sam-dev-candidate]]"]
---
## What it does
In-browser first-round AI voice screen. Two realtime providers behind one tiny registry (voice/index.ts:11 getVoiceAdapter): OpenAI Realtime over WebRTC (openai.ts) + ElevenLabs Agents (elevenlabs.ts). The server mints short-lived creds per provider so no key reaches the browser (connect/route.ts:148). Recruiter builds a grounded brief + emails a tokenized link; candidate takes the call at /interview/<token>; the live transcript POSTs to complete/route.ts on hang-up, which debits minutes + synthesizes the scorecard gating Interview→Offer.

## Prompt & grounding
Brief assembled in interview-run.ts:127 (buildGroundedInterview), stored on the session (create/route.ts:67-79), fed to the provider at connect (117-119,148). Strong, branch-specific:
- **Submission debrief** (97-123) — minted authorship follow-ups from the candidate's own evaluated take-home (Sam's path); internal red-flags kept out of the candidate-facing run-of-show. Clears the bar.
- **Early-career / case-grounded** (student-interview.ts:233,173) — shared work scenario or six-phase script with a coachability hint.
- **Experienced** (composeBrief, interview-run.ts:42) — CV chronology from the interview-prep artifact → per-topic run-of-show with company/role/seniority (Tereza's path).
- **Czech** — byte-identical persona lines single-sourced (student-interview.ts:145-148) + Czech-first ElevenLabs agent prompt + locale-seeded hint. Tereza's "must work in Czech" met. **4/4.**
One real gap — **provider-asymmetric delivery**: the grounded brief reaches ElevenLabs only as a runtime *prompt override* (VoiceInterview.tsx:527-531, requires the agent to allow overrides, else silently falls back to the generic dashboard prompt at setup-eleven-agent.mjs:36). For OpenAI it's the session `instructions` (openai.ts:96) — server-side grounded. No server-side assertion the override was accepted → a misconfigured agent quietly downgrades to a generic 3-question screen with no recruiter signal.

## Code quality (wrapping · logging · caching)
Strong for an MVP. Chokepoint: one typed registry + requiredEnv availability + shared default-provider policy. Typed config + coercion guards. Session handling robust: 30s connect timeout, teardown guards stop a hot mic, idempotent terminal completion, consent enforced both ends, credential-minting gated on token/lab/revoked/expired. Brief built once at create, reused at connect. Hard meter gate on interview_minutes at create. Two weaknesses:
1. **Telemetry/ledger gap (minutes are billed):** complete/route.ts:143-148 debits recordMeterUsage("interview_minutes",…), a quantity-only quota counter. Nothing records provider/model/cost_usd, nothing writes the llm_usage ledger. OpenAI Realtime vs ElevenLabs+gemini have very different per-minute costs → the platform bills minutes it cannot cost-attribute.
2. **BYOM key resolution NOT shared with the text layer** (contradicts the doc): voice reads raw process.env (openai.ts:86, elevenlabs.ts:20-21); the shared resolver (llm-config.ts:19,56) doesn't even know `elevenlabs`. A BYOM customer's voice key never serves their traffic. Doc flags this as Phase 4 outstanding.

## Findings
1. [code/value] **HIGH — interview minutes have no cost/provider telemetry for the ledger** (complete/route.ts:147). Fix: emit a per-call ledger row (provider, model, wall-minutes, computed cost_usd) — extend the meter to carry provider+model for interview_realtime, priced from a voice price book.
2. [code/value] **HIGH — grounded brief silently downgrades on the ElevenLabs arm** (VoiceInterview.tsx:531). Fix: after startSession assert the override took (or have /connect verify the agent allows prompt override) and surface a recruiter warning when it didn't.
3. [code] **MED — BYOM key resolution unshared** (openai.ts:86, elevenlabs.ts:20). Fix: add elevenlabs to the keyable-provider set; resolve voice keys via the same byom→platform→env order.
4. [value] **LOW — no per-provider fairness/parity check across candidates.** A server-grounded openai candidate vs a generic-fallback elevenlabs candidate could be scored from different interviews. Mitigated by Finding 2; worth an explicit invariant.
5. [code] **LOW — groundedPrompt only returned for mode==="candidate"** (connect/route.ts:151); lab/sim can't A/B the brief on ElevenLabs. Minor.

**Best-grounded, best-engineered AI call site reviewed** — real CV/role/rubric/follow-up sources reach the agent, Czech-capable. Gaps are operational: cost telemetry + non-silent, provider-symmetric brief delivery.
