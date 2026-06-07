# kp — harness learnings

## Structural facts
- **2026-06-07** — Voice-interview architecture: `/connect` mints short-lived provider credentials server-side (OpenAI ephemeral client secret, ElevenLabs signed URL) so no API key reaches the browser; transcripts POST back to `/complete`, which runs `runInterviewScorecard` → `runAutomationTask(entryId, "scorecard")` → `setApproval(entryId, "scorecard_review")`, the Interview→Offer gate. `app/_lib/interview-run.ts`.
- **2026-06-07** — The session **token** (`tk` + 24 random bytes, `randomToken`) is the only credential on the candidate link, and is now also the required completion capability at `/complete` (`app/api/interview/complete/route.ts`). `randomId("iv")` session ids are NOT capabilities.
- **2026-06-07** — kp has **no authentication layer at all** (no middleware.ts, no session checks). The recruiter-facing read APIs `/api/interview/by-entry`, `/api/interview/compare`, `/api/interview-prep` remain unauthenticated — idea ccb4d851 (server-side authz) was rejected as out-of-scope for a scan run; it needs an app-wide auth decision. Same applies to most other recruiter API surfaces.
- **2026-06-07** — `app/api/interview/simulate/route.ts` exists but is NOT in the "Interviews" context group's file list (context drift). It creates demo sessions (mode "candidate", no entryId) and returns the token; the sim tab passes it to `VoiceInterviewClient`.
- **2026-06-07** — Error-hygiene pattern: `safeJsonError` + `STORE_ERRORS` catalogue in `app/_lib/api-response.ts`, locked by source-level guard tests (`app/api/jds/error-message-hygiene.test.ts`, `app/api/interview/error-message-hygiene.test.ts`). `jsonError` forwards raw `err.message` — only safe for routes whose messages are client-safe by construction.
- **2026-06-07** — OpenAI Realtime transcription is configured with `whisper-1` (`app/_lib/voice/openai.ts`), which emits only final `.completed` events — no streamed input deltas. The candidate-side delta buffer in `VoiceInterview.tsx` is a forward-compat fallback for gpt-4o-transcribe-style configs; the load-bearing last-answer fix is the VAD-pending grace window in `finalize()`.

## Conventions enforced
- Unit tests are colocated `*.test.ts` run by Node's built-in runner with type stripping (`npm run test:unit` → `node --test "app/**/*.test.ts"`); imports inside tests use relative `./x.ts` paths (the `@/` alias does not resolve under node --test) — route contracts are locked via source-level regex guards instead.
- Validation is hand-rolled coercers at the trust boundary (`coerceProviderId`, `coerceLanguage` in `app/_lib/voice/types.ts`, `parseEntriesParam`), NOT zod — zod is reserved for the Python-generated LLM schemas (`schemas.generated.ts`).
- Browser-safe pure-decision helpers live beside the voice adapters (`finalize-status.ts`, `preflight.ts`): pure function over a snapshot, unit-tested; only a thin collector touches browser globals.
- Trust-critical truncation policy is named, documented and head+tail-sampling (never front-slice): `interview-transcript.ts` (`MAX_TURN_TEXT_CHARS`, `MAX_TRANSCRIPT_TURNS`, `MAX_SCORECARD_NOTES_CHARS`).
- Concurrency guards go in the SQL `WHERE` clause (`completeInterviewSession`, `markInterviewStarted` return `applied`/boolean), not read-then-write in routes.
- `npm run build` = `schemas:gen` (python codegen) + `next build`; `npm run typecheck` also regenerates schemas first.

## Anti-patterns to avoid
- Casting `request.json()` straight to a typed shape — the cast IS the vulnerability; every interview route now validates field-by-field (idea-c7df6b55).
- Page-level guards standing in for API guards: the portal page blocked *rendering* a completed session while `/connect` happily reopened it (idea-836e08d8).
- Scoring before persisting: any side-effecting step (approvals, skill minting) ordered before the durable artifact write produces phantom state on partial failure (idea-55fd89f9).
- An `else` catch-all on a parsed-event union: adding a new event kind silently misroutes through the old `else` (VoiceInterview's `handleOaiEvent` had to switch to explicit kinds when the parser grew).

## Open follow-ups (from Pipeline C run #1, 2026-06-07)
- **Recruiter API authz (rejected idea ccb4d851)**: `/api/interview/by-entry`, `/compare`, `/interview-prep` (and sibling recruiter surfaces) expose transcripts/scorecards/PII unauthenticated. Needs an app-wide auth layer decision — right-sized as its own Pipeline A goal.
- `app/api/interview/simulate/route.ts` was out of the scanned group: it still uses `jsonError` (raw err.message) and unvalidated `language`. Apply the same safeJsonError + coerceLanguage treatment when next touching it; also consider adding it to the Interviews context group.
- The Interviews context group's `file_paths` omit `simulate/route.ts`, `InterviewSidebar.tsx`, `finalize-status.ts`, `interview-consent.ts` — group definition has drifted from the real surface.
- ElevenLabs path has no last-answer protection equivalent (idea-b70b8bd7 was OpenAI-scoped); the SDK delivers complete messages, but endSession() racing a final onMessage is unverified.
