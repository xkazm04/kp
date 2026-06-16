> Total: 4 findings (Crit/High/Med/Low: 0/0/3/1)

Scope traced end-to-end across the assigned `voice-interview-runtime` files: the two provider adapters (`elevenlabs.ts` / `openai.ts`) + their shared types/preflight/finalize helpers; the live client (`VoiceInterview.tsx`); the brief builders (`voice/index.ts`, `interview-run.ts`, `student-interview.ts`); the create/connect/complete/revoke/simulate routes; the portal + lab pages; and the Python interview kit + ElevenLabs setup script.

The runtime itself is genuinely hardened — the finalize/persist/consent/idempotency paths each carry a long rationale comment and a colocated `*.test.ts`, and the apparent adapter "duplication" (ElevenLabs `onDisconnect` vs OpenAI `answer-applied` go-live; signed-URL vs ephemeral-secret connect) is real provider-lifecycle divergence and was deliberately NOT flagged. The findings below are all SAFE, mechanical dedup of verbatim-identical text, plus one cleanup. No dead code was found: `parseOaiTranscriptEvent`/`OaiTranscriptEvent`, `transcriptToNotes`, the preflight/consent/recommendation helpers, and both adapters all have live runtime references and test pins (greps below).

---

## 1. Persona-contract prose is re-inlined verbatim across three runtime brief builders

- **Severity**: Medium
- **Category**: duplication
- **File**: `app/_lib/interview-run.ts:56-64` (composeBrief) and `:110-120` (composeDebriefBrief); `app/_lib/voice/index.ts:24-35` (defaultInterviewerInstructions); against the already-extracted constants in `app/_lib/student-interview.ts:137-150` (`personaLines()`, `NON_NEGOTIABLES`, `CLOSING`). Bootstrap copy also at `scripts/setup-eleven-agent.mjs:36-44`.
- **Evidence**: The agent-persona lines are copy-pasted, character-for-character, across every brief builder. `Grep "masculine grammatical forms"` → 5 hits in 4 files (interview-run.ts ×2, student-interview.ts, voice/index.ts, setup-eleven-agent.mjs). `Grep "Detect whether the candidate speaks Czech or English"` and `Grep "a human recruiter will review the conversation"` return the same brief-builder cluster. `student-interview.ts` already factored these into `personaLines()` / `NON_NEGOTIABLES` / `CLOSING` for its two builders — but `interview-run.ts`'s `composeBrief`/`composeDebriefBrief` and `voice/index.ts`'s `defaultInterviewerInstructions` each re-inline their own near-identical copies instead of importing them. Verified `interview-run.ts` imports from `./student-interview` but NOT those three persona helpers (it pulls only `caseGroundedInterviewerInstructions`, `studentInterviewerInstructions`, run-of-show + id helpers).
- **Impact**: The AI disclosure ("I am an AI assistant… the call is transcribed") and the gender-grammar instruction are compliance-relevant prose. Five independent copies drift silently: a wording fix (or a future "you are female"/neutral variant) must be hand-applied in five places, and a missed copy means one interview lane says something subtly different about consent/recording than the others.
- **Fix sketch**: Promote the three shared snippets to one exported source — either lift `personaLines()`/`NON_NEGOTIABLES`/`CLOSING` out of `student-interview.ts` into a small `app/_lib/interview-persona.ts`, or just export them from `student-interview.ts` as-is. Then have `composeBrief`, `composeDebriefBrief`, and `defaultInterviewerInstructions` compose from those constants (each keeps its own role/run-of-show/closing-verb wording, which legitimately differs). Leave `setup-eleven-agent.mjs` as-is: it is a standalone bootstrap script that bakes a static dashboard prompt and can't import the app's TS persona module without dragging in the runtime — its copy is intentional and isolated.

## 2. The completed-vs-failed signal object is rebuilt verbatim three times in the live client

- **Severity**: Medium
- **Category**: duplication
- **File**: `app/_components/voice/VoiceInterview.tsx:290-294` (onDisconnect), `:546-552` (end() ElevenLabs fallback timer), `:563-567` (end() OpenAI branch)
- **Evidence**: All three call sites pass the byte-identical literal `interviewFinalStatus({ errored: erroredRef.current, reachedLive: reachedLiveRef.current, turnCount: turnsRef.current.length })`. `Grep` (multiline) for that exact object → 3 occurrences in this one file, 0 elsewhere. Every input is a ref read at call time, so the three are not provider-specific — they each ask the same single question ("given the live refs right now, did this call really complete?"). The provider divergence is only in WHEN/whether finalize fires (EL defers to onDisconnect with a timer fallback; OpenAI finalizes inline), not in how the status is computed.
- **Impact**: Low bug-risk but real maintenance cost: if a fourth end-signal is ever added to `InterviewEndSignals` (e.g. a "user-initiated" flag), all three sites must be updated in lockstep or the EL and OpenAI paths will classify the same call differently — exactly the completed-vs-failed divergence `finalize-status.ts` exists to prevent.
- **Fix sketch**: Add one tiny local helper inside the component, e.g. `const currentFinalStatus = () => interviewFinalStatus({ errored: erroredRef.current, reachedLive: reachedLiveRef.current, turnCount: turnsRef.current.length });`, and replace all three call sites with `finalize(currentFinalStatus())`. Pure refactor — no behavior change, all refs are already in scope. Keep the provider branching (onDisconnect gate, EL timer, OpenAI inline) exactly as-is.

## 3. Configured-provider fallback expression duplicated between the create and simulate routes

- **Severity**: Medium
- **Category**: duplication
- **File**: `app/api/interview/create/route.ts:35-36` and `app/api/interview/simulate/route.ts:38-39`
- **Evidence**: Both routes resolve the provider with the identical expression `coerceProviderId(body.provider) ?? (avail.openai ? "openai" : avail.elevenlabs ? "elevenlabs" : "openai")` over `const avail = voiceAvailability()`. `Grep` for the exact ternary tail → 2 hits, in exactly those two files. Note `connect/route.ts` deliberately uses a DIFFERENT fallback (`requested ?? session0?.provider ?? null`, session-bound), so this is a clean 2-site consolidation, not 3 — I confirmed connect is not a candidate.
- **Impact**: The default-provider preference order (OpenAI-first when no provider requested) lives in two routes; changing the house default — or adding a third provider to the preference chain — silently requires editing both, and the two could drift so a recruiter-created link and a simulator link default to different providers.
- **Fix sketch**: Add a small exported helper in the voice adapter layer, e.g. `pickDefaultProvider(requested: unknown, avail = voiceAvailability()): VoiceProviderId` in `app/_lib/voice/index.ts` (it already owns `voiceAvailability` and `coerceProviderId`), returning `coerceProviderId(requested) ?? (avail.openai ? "openai" : avail.elevenlabs ? "elevenlabs" : "openai")`. Call it from both routes. This co-locates the default-preference policy with the adapter registry it depends on.

## 4. Stale `scripts/interview.py` docstring example references a non-existent `--bucket` value namespace

- **Severity**: Low
- **Category**: cleanup
- **File**: `scripts/interview.py:9-11` (docstring examples) vs `:41` (the actual `--bucket` help) and `:55-58` (`build_interview_kit` bucket names in `pipeline/jobfit/interview.py`)
- **Evidence**: The module docstring example reads `python scripts/interview.py path/to/cv.pdf --bucket experience`, and the `--bucket` argparse help (`:41`) suggests `e.g. experience, skills, leadership`. But the kit only ever emits three buckets — `behavioral`, `technical`, `red-flag-defense` (`pipeline/jobfit/interview.py:55`, `:155`, `:243`). `experience`/`skills`/`leadership` are not produced by any code path, so `--bucket experience` always falls through to the "No questions in bucket 'experience'. Available: behavioral, red-flag-defense, technical" branch (`:99-101`). The docstring and help advertise filter values that can never match.
- **Impact**: Cosmetic / docs-accuracy only — a CLI user following the documented example gets an empty result and a confusing "available buckets" line. No runtime effect.
- **Fix sketch**: Update the docstring example (`:9-11`) and the `--bucket` help string (`:41`) to the real bucket names (`behavioral`, `technical`, `red-flag-defense`). Pure comment/help-text edit; no logic change.
