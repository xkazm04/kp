# Conversational Apply — UI+Bug combined scan
> Total: 4 findings (0 crit / 1 high / 3 med / 0 low)
> Group: Candidate-Facing Experiences | Lens mix: 2 bug / 2 ui | Files read: 6

Files read: `app/apply/[id]/page.tsx`, `app/apply/[id]/ConversationalApply.tsx`, `app/api/apply/[id]/route.ts`, `app/_lib/apply.ts`, `app/_lib/apply-intake.ts`, `app/_lib/db.ts` (createPipelineEntry / findApplicationByApplicant), plus `app/api/extract-text/route.ts` (CV upload boundary — verified hardened).

Verified-hardened (NOT re-flagged): body cap before buffering (`MAX_APPLY_BODY_BYTES` + per-field caps, route.ts:163-226); CV `file` step text-extract with server MIME+size gate (`validateUploadServer`, extract-text/route.ts:37); dedup-by-email primary check + `dedupeKey` concurrent-race backstop (route.ts:233-238, 271, 282-284; db.ts:1995-2013, 1921-1939); double-submit guards (`busy`, `answeredRef`, `finalAnswersRef`, ConversationalApply.tsx:74,140-141); `contact` captured at apply (route.ts:277).

## 1. Knockout (KO) questions are skippable by omitting their keys on a direct POST
- **Severity**: Medium
- **Lens**: Bug (Bug Hunter)
- **Category**: Validation gap at a public trust boundary / silent acceptance
- **File**: `app/api/apply/[id]/route.ts:174`
- **Scenario**: The KO gate is `KO_STEP_IDS.some((k) => k in answers && answers[k] === false)`. It only declines when a KO key is present *and* explicitly `false`. A scripted/automated POST to this PUBLIC, unauthenticated endpoint that simply omits `ko_auth` / `ko_mode` / `ko_lang` (or sends them as any non-`false` value — `"no"`, `0`, `null`) passes the gate. The applicant is then built into a real profile and lands an **Accepted** pipeline entry without ever truthfully answering "are you legally authorized to work / can you do this work mode / language".
- **Root cause**: The server treats *absence* of a KO answer as a pass. It trusts that the client always walks every KO step, but the trust boundary is the POST body, which the client does not own. There is no "all required KO steps must be present-and-true" check; KO presence is only enforced by the in-page flow.
- **Impact**: The knockout filter — the one substantive eligibility gate on a candidate-facing flow that auto-creates `stage: "Accepted"` rows — is trivially bypassable. Recruiters get Accepted entries that never cleared work-authorization / language / work-mode. Degrades the integrity of every downstream "Accepted" signal; not a crash or data-loss, hence Medium, but it is a real public-boundary gap.
- **Fix sketch**: Recompute the *expected* KO step ids server-side from `buildApplyScript(job)` (the route already imports it), then require each expected KO id to be present and `=== true`; treat a missing or non-`true` KO as a decline (or 400). This makes the gate depend on the job's own script rather than on client cooperation. (Same `buildApplyScript` is already the source of truth for the GET script, so no new derivation logic is needed.)

## 2. A mistyped email (step 2) is only caught at the FINAL submit and forces a full "Start over"
- **Severity**: High
- **Lens**: Bug (Bug Hunter) — validation timing on the common path
- **File**: `app/apply/[id]/ConversationalApply.tsx:162-168` (text submit) + `app/api/apply/[id]/route.ts:224-226` (server reject)
- **Scenario**: The `email` step (`buildApplyScript`, apply.ts:80-84) is the 2nd question. The client validates only `input.trim()` non-empty (`submitText`, line 164) — any string ("john@", "john at gmail", a phone number) is accepted and the chat continues. The candidate then walks the rest of the script (archetype lane, skills, optional CV, all KO questions). On the FINAL POST the server runs `if (email && !/.../.test(email))` and returns **400**. `isRetryableApplyStatus(400)` is `false`, so the inline recovery renders **"Start over"** (line 256-263), which calls `restartConversation()` and resets `idx` to 0 — wiping every answer. The candidate must re-answer the entire conversation because of a typo on question 2.
- **Root cause**: Email format validation exists only at the all-or-nothing final POST; the email step itself has no per-step format check, and the only non-retryable recovery is a full restart (correct for a genuinely un-resendable payload, but punishing here where one early field is the sole problem).
- **Impact**: A single common typo on an early step costs the candidate the whole conversation — a strong drop-off/abandonment driver on a public funnel whose entire selling point is "a quick chat, no forms". Lands as broken UX on a very common path → High.
- **Fix sketch**: Validate the email at the `email` step client-side (reuse the same regex, or accept blank since the server allows a blank email) before `advance()`, showing an inline retry on that step so the candidate fixes it in place with all other answers intact. As defense in depth, prefer this over relying on the final-submit reject. (Optional: even if kept server-only, surfacing *which* field was rejected so a restart can pre-seed the rest would help, but client-side step validation is the clean fix.)

## 3. Streamed bot prompts are not announced to screen readers (no aria-live)
- **Severity**: Medium
- **Lens**: UI (UI Perfectionist) — accessibility, missing state announcement
- **File**: `app/apply/[id]/ConversationalApply.tsx:214-238`
- **Scenario**: After each answer, the next bot prompt is appended to the `msgs` array and rendered into a plain `<div className="space-y-3">` after a 250ms hand-off (line 151-156). The container is not a live region (`aria-live` / `role="log"` / `role="status"`). A screen-reader user answers a question, hears nothing new, and has no signal that the next question has appeared below — the conversation silently advances out of their awareness. The `done` acceptance/decline block (line 226-236) and the success path similarly never announce or move focus. (The upload error at line 333 does use `role="alert"`, so the pattern exists in the file but isn't applied to the conversation stream.)
- **Root cause**: The chat transcript is built as a static list with no live-region semantics; new bot turns are visual-only.
- **Impact**: The core interaction loop of an accessibility-sensitive PUBLIC candidate flow is inaccessible to SR users — they can't follow the conversation without manually re-reading the page after each answer. Medium (degraded for an assistive-tech subset; not a hard block since content is in the DOM).
- **Fix sketch**: Wrap the messages list (or a dedicated child holding the latest bot message) in `aria-live="polite"` with `role="log"` (or announce just the newest bot prompt via a visually-rendered polite live region). Announce the final `done`/`submitError` outcome the same way. No visual change, no a11y regression.

## 4. Focus is lost between steps for keyboard/SR users (only `text` steps auto-focus)
- **Severity**: Medium
- **Lens**: UI (UI Perfectionist) — accessibility / keyboard navigation
- **File**: `app/apply/[id]/ConversationalApply.tsx:268-360`
- **Scenario**: Only the free-text `<input>` carries `autoFocus` (line 344). When the next visible step is a `ko` (Yes/No buttons), a `choice` (option buttons), or the `file` step, nothing receives focus after the previous answer — focus stays on the just-clicked control, which then unmounts, dropping focus to `<body>`. A keyboard-only or SR user must tab from the top of the document to reach the new Yes/No or option buttons on every such step. Likewise, when the inline `submitError` recovery (line 245-265) or the `done` block appears, focus is never moved to the new "Try again" / "Start over" button or the outcome.
- **Root cause**: Focus management is implemented ad hoc via `autoFocus` on the text input only; the `ko` / `choice` / `file` / error / done branches have no programmatic focus handoff.
- **Impact**: Each non-text step (every job has at least the `ko_auth` step, and archetype is a `choice`) imposes a from-the-top tab traversal — a real, repeated keyboard-navigation burden on a public flow. Medium a11y; not a regression (text steps already focus correctly).
- **Fix sketch**: After each `advance()` hand-off (and when `submitError`/`done` first render), move focus to the first interactive control of the newly rendered step (e.g. a ref on the first button / the recovery button / the outcome heading with `tabIndex={-1}`). Mirrors the existing `autoFocus` behavior for the other step types. Pairs naturally with finding 3's live-region work.
