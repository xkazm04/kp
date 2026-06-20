# Candidate Onboarding Hand-off — UI Perfectionist scan

> Context: Post-Hired onboarding hand-off — recruiter Onboarding tab plus the token-gated candidate pre-boarding questionnaire reached from an accepted offer.
> Files reviewed: 9 of 9 (+ messages/en.json, i18n/request.ts, api-response.ts for grounding)
> Total: 7 findings — Critical: 1, High: 3, Medium: 2, Low: 1

## 1. Recruiter `patch()` writes an error envelope into `detail`, blanking/crashing the run view

- **Severity**: Critical
- **Category**: silent-failure / error-state / runtime-crash
- **File**: `app/features/sub_onboarding/OnboardingTab.tsx:374-381` (and the consumers at `:401`, `:407`, `:410`, `:434`, `:455`)
- **Scenario**: A recruiter on the run detail screen toggles a checklist task, blurs a questionnaire field, or requests a signature, and the PATCH returns a non-2xx — e.g. a 404 (`"Onboarding run not found."`) for a run deleted in another tab, or a 500 (`safeJsonError` → `{ error, code }`) when better-sqlite3 throws.
- **Root cause**: `patch()` does `setDetail((await r.json()) as RunDetail)` with no `r.ok` guard and no try/catch. On an error response the JSON body is `{ error, code }`, not a `RunDetail`, but it is cast and stored anyway.
- **Impact**: `detail` becomes an object with no `run`/`tasks`/`questionnaire`/`progress`. The next render reads `detail.run.candidateLabel` and `detail.tasks.map(...)` → `TypeError`, taking down the whole tab with an unrecoverable blank/error boundary. The user gets no message, no retry, and (worse) believes their checklist toggle was saved when it was rejected.
- **Fix sketch**: Guard the response: `if (!r.ok) { setActionError(t("actionFailed")); return; }` and only `setDetail` on a shape with a `run` field. Surface a dismissible inline error and keep the prior `detail` intact so the view survives a failed action.

## 2. Candidate submit never reconciles with the server result; success is assumed, not confirmed

- **Severity**: High
- **Category**: optimistic-feedback / silent-failure
- **File**: `app/onboarding/[token]/page.tsx:75-91`
- **Scenario**: A candidate fills the pre-boarding questionnaire and taps "Send my details". The POST succeeds but the server stored a *bounded/filtered* version (`submitCandidateIntake` drops unknown keys and `saveIntake` trims to 500 chars and strips empty values), or the POST is rate-limited (429).
- **Root cause**: `submit()` only sets `saved = true` on `r.ok` and never reloads the canonical answers from the server, so the "saved" screen and the "Update my details" form silently diverge from what was actually persisted. The 429 path (`RATE_LIMITED_ERROR`, see route `:23`) is swallowed into the generic `submitFailed` message with no "try again in a moment" hint.
- **Impact**: A candidate can believe a value (e.g. a too-long emergency contact, or a field the template doesn't define) was recorded when it was silently dropped; repeated taps that trip the rate limit show a vague failure with no guidance.
- **Fix sketch**: After a successful POST, `await load()` to re-pull `answers`/`submitted` from the server (the GET already returns the persisted set). Branch on `r.status === 429` for a distinct "please wait a moment and retry" message.

## 3. Recruiter questionnaire auto-saves on blur with zero feedback and no error handling

- **Severity**: High
- **Category**: optimistic-feedback / silent-failure / data-loss
- **File**: `app/features/sub_onboarding/OnboardingTab.tsx:439-443`
- **Scenario**: A recruiter edits a pre-boarding answer in the run detail and tabs away; `onBlur` fires `patch({ action: "intake", answers })`. There is no saving indicator, no saved confirmation, and (per finding #1) any failure corrupts the view. Because `saveIntake` is last-write-wins over the *same* row the candidate writes (`onboarding-candidate.ts:63`), a recruiter blur can silently clobber answers the candidate just submitted, and vice-versa.
- **Root cause**: Blur-to-save with no status affordance and a shared single intake row with no per-author separation or conflict signal.
- **Impact**: Edits appear to vanish or silently overwrite the candidate's own submission; the recruiter has no way to know whether their change landed. CLS-free but trust-eroding.
- **Fix sketch**: Add a per-field "Saving… / Saved" affordance (an `aria-live="polite"` status), only save when the value actually changed, and on error revert the field + show a retry. Longer term, separate candidate-authored vs recruiter-authored intake or stamp/show "last edited by".

## 4. `startDateConfirm` is a real date picker for the candidate but a plain text box for the recruiter

- **Severity**: Medium
- **Category**: visual-consistency / input-correctness
- **File**: `app/onboarding/[token]/page.tsx:154` (`type={field.key === "startDateConfirm" ? "date" : "text"}`) vs `app/features/sub_onboarding/OnboardingTab.tsx:437` (always `type="text"`)
- **Scenario**: The candidate confirms their start date via a native date control (ISO `YYYY-MM-DD`), but the recruiter editing the same `startDateConfirm` answer in the run detail gets a free-text field.
- **Root cause**: The per-field input-type rule exists only on the candidate page; the recruiter `RunDetailView` renders every field as a generic text input with no type/format awareness.
- **Impact**: Inconsistent affordance and data shape for the same field — a recruiter can type "next Monday" into a slot the candidate fills as a calendar date, breaking any downstream parsing and looking unpolished.
- **Fix sketch**: Extract a shared `OnboardingFieldInput` that maps `field.key` → input type (date for `startDateConfirm`, text otherwise) and reuse it on both surfaces so the candidate and recruiter views can't drift.

## 5. No loading skeletons — both surfaces flash bare "Loading…" text causing layout shift

- **Severity**: Medium
- **Category**: missing-loading-state / CLS
- **File**: `app/features/sub_onboarding/OnboardingTab.tsx:90-91` and `:383`; `app/onboarding/[token]/page.tsx:118-119`
- **Scenario**: On first paint of the Onboarding tab, the run detail, and the candidate page, the only loading affordance is a single line of grey text ("Loading…") that is then replaced by the full multi-section layout (ready list, runs, templates / checklist, questionnaire, signatures).
- **Root cause**: Loading is rendered as a text node rather than a skeleton that reserves the eventual layout. The candidate page does animate its submit button (`Loader2`), but the initial fetch does not.
- **Impact**: Visible content jump / layout shift on every entry; the recruiter tab in particular pops from one line to three sections. Feels unfinished versus the rest of the app.
- **Fix sketch**: Replace the `"Loading…"` strings with skeleton blocks sized to the real sections (a few rounded `bg-stone-100` rows for the lists, a card outline for the run detail). Keep the existing `aria-busy`/`aria-live` semantics.

## 6. Empty questionnaire / empty checklist templates render an empty section with no message

- **Severity**: Medium
- **Category**: missing-empty-state
- **File**: `app/features/sub_onboarding/OnboardingTab.tsx:433-446` (questionnaire grid) and `:409-426` (checklist); candidate side `app/onboarding/[token]/page.tsx:149-162`
- **Scenario**: A recruiter creates a template with tasks but an intentionally empty questionnaire (`coerceQuestionnaire` honours `[]`, and `createTemplate` persists it). The run detail then renders the "Pre-boarding questionnaire" heading + note over an empty grid; the candidate page likewise renders the intro and submit button over zero fields, letting them "Send my details" with nothing to send.
- **Root cause**: `detail.questionnaire.map(...)` / `view.fields.map(...)` have no zero-length branch; the heading and surrounding chrome always render.
- **Impact**: A heading with no content (recruiter) and a meaningless submit-empty-form flow (candidate) — confusing and unpolished. The candidate can POST an empty answer set.
- **Fix sketch**: When `questionnaire.length === 0`, hide the questionnaire section (recruiter) and, on the candidate page, show a "Nothing to fill in right now" reassurance instead of an empty form + active submit.

## 7. "Mark signed" / "Request signature" give no in-flight or success feedback; signer name is silently auto-filled

- **Severity**: Low
- **Category**: polish / a11y / interaction-correctness
- **File**: `app/features/sub_onboarding/OnboardingTab.tsx:465-472` (`markSigned`) and `:485-496` (`request_sign`)
- **Scenario**: A recruiter clicks "Mark signed" or "Request signature". Both fire `patch()` with no disabled/in-flight state and no confirmation, and "Mark signed" auto-passes `signer: detail.run.candidateLabel ?? "Signed"` — recording the candidate as the signer of a demo (non-eIDAS) signature with no prompt or audit clarity.
- **Root cause**: The buttons lack a pending state, and the signer identity is inferred rather than entered, despite the section's own banner stressing these aren't legally binding.
- **Impact**: Double-clicks can fire duplicate signature requests; the recorded "signer" is a guess, undermining the audit-stamp story. No `aria-live` confirmation for screen-reader users.
- **Fix sketch**: Disable each button while its `patch` is in flight and announce the result via `aria-live`. For "Mark signed", prompt for (or clearly label) the signer rather than defaulting to the candidate label, keeping the demo-vs-binding distinction honest.
