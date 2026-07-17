# Application Intake & Apply Flows — ambiguity-guardian + ui-perfectionist scan

> Total: 6 findings (0 critical, 2 high, 3 medium, 1 low)

## 1. Restored localStorage draft trusts a stale script shape — resumed chat can desynchronize from the current script
- **Severity**: High
- **Lens**: ambiguity
- **Category**: draft-script-fingerprint
- **File**: `app/apply/[id]/ConversationalApply.tsx:144`
- **Scenario**: A candidate abandons the chat mid-way; before they return, the script's shape changes — the job is edited (workMode/languages toggling `ko_mode`/`ko_lang`), the archetype registry gains/loses an `applyLabel` (inserting/removing the `archetype` choice step), or the candidate switches locale. The restore effect only validates `d.idx >= 0 && d.idx < steps.length` (line 150), then replays the old transcript and jumps to `steps[idx]` of the NEW script.
- **Root cause**: The `ApplyDraft` carries no fingerprint of the script it was recorded against — `idx` is positional and `answeredIds`/`answers` are keyed by step ids from a script that no longer exists. A locale switch also reuses the same `draftKey` (line 37), so restored bubbles are in the previous language.
- **Impact**: The last bot bubble shown (from the old draft's `msgs`) and the controls rendered (from the new `steps[idx]`) can belong to *different questions* — the candidate answers question A while the value files under step id B (e.g. their skills text stored as `student_project`), corrupting the application the recruiter and the Python normalizer consume. Positional drift can also skip steps entirely, and with the strict `failedKoStepIds` verdict a skipped KO means a qualified candidate is silently declined.
- **Fix sketch**: Store a script fingerprint in the draft (e.g. `steps.map(s => s.id).join("|")` plus the locale) and discard the draft on mismatch — falling back to the existing "start fresh" path, which is already the safe behavior. Alternatively, on restore re-derive `idx` from `answeredIds` against the *current* steps via `nextVisibleStepIndex` and rebuild the last prompt from `steps[idx]` rather than trusting the stored transcript tail.

## 2. Webhook lead extraction's last-resort email scan can adopt a third party's address as the candidate's identity
- **Severity**: High
- **Lens**: ambiguity
- **Category**: wrong-recipient-fallback
- **File**: `app/_lib/lead-payload.ts:126`
- **Scenario**: A third-party form forwards a payload whose candidate email sits under a key the `EMAIL_KEYS` aliases don't cover, but which also carries *another* email-shaped value — `recruiter_email`, `hiring_manager`, a referral field, a company contact, even a UTM value containing an address. `extractLead` falls back to `Object.values(fields).find((v) => EMAIL_RE.test(v))` and picks whichever email happens to come first in flatten-insertion order.
- **Root cause**: The fallback is documented as "the address shape is the more stable signal", but the multi-email case is an unstated assumption: the scan has no way to know *whose* address it grabbed, and iteration order (top-level fields → `fields` → `field_data`) is an accident of the sender's payload layout, not a preference for candidate-ness.
- **Impact**: The wrong person becomes the entry's `contact`: `intakeLead` then emails the acknowledgement, the **enrichment lead token**, and the **status link** to a third party — who can open the prefilled chat as the candidate, see their application status, and overwrite their profile. It is simultaneously a candidate-data leak and a wrong-identity dedupe key (`applyDedupeKey` keys on this email).
- **Fix sketch**: Constrain the fallback: only scan values whose *normalized key* contains an email-ish token (`email`, `mail`, `e_mail`) rather than all values, and when two or more distinct email-shaped values exist in the payload, treat the email as ungiven ("" — the caller already rejects unreachable leads) instead of guessing. Log the ambiguous payload keys so the recruiter can add a per-job alias.

## 3. Public apply routes echo raw internal error messages, contradicting the codebase's own safeJsonError discipline
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: error-message-leak
- **File**: `app/api/apply/[id]/route.ts:403`
- **Scenario**: Any uncaught throw in the conversational apply POST (SQLite `SQLITE_BUSY`, a Python-runner path error, a comms-dispatch stack detail) is returned verbatim to the unauthenticated public client: `{ error: error.message }`. The quick route does the same (`app/api/apply/[id]/quick/route.ts:173`), and the client's `errMsg(d, …)` renders that string directly in the candidate's chat/form.
- **Root cause**: The sibling status route explicitly switched to `safeJsonError` with the comment "Raw err.message would surface SQLite internals on a public token route" — but the two apply routes, the *most* public and side-effecting surfaces in the context, kept the raw-passthrough catch. The divergence is undocumented, so it reads as policy when it is drift.
- **Impact**: Internal implementation details (DB engine, file paths, subprocess names) leak to anonymous visitors, and candidates can see unlocalized, jargon error text in an otherwise fully localized flow. Since `isRetryableApplyStatus(500)` is retryable, the raw message is also what the candidate stares at while retrying.
- **Fix sketch**: Reuse `safeJsonError(error, "api:apply", …)` in both apply routes' catch blocks (it already exists in `app/_lib/api-response.ts`), keeping the 4xx validation messages — which are deliberate, human-written strings — exactly as they are. The client already falls back to `t("submitFailed")` when no usable message is present.

## 4. The server supports contactless applications, but the chat script makes the email step mandatory — a contract only scripted POSTs can reach
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: unreachable-server-contract
- **File**: `app/_lib/apply.ts:119`
- **Scenario**: The conversational route documents and implements a lenient email contract: "Apply doesn't HARD-block on a missing email (the entry still files; comms just stay undeliverable)" (`app/api/apply/[id]/route.ts:201-208`, `contact: email || null` at 340). But the `email` step in `buildApplyScript` is a plain text step with no `optional: true`, so the UI's Send button stays disabled on empty input and there is no Skip — a candidate cannot decline to give an address.
- **Root cause**: Two halves of one contract evolved apart: the server kept (and re-documented) blank-email support including the dead-letter comms path and the anonymous-dedup rules, while the script quietly made the field required. Whether email is required is now answered differently depending on which file you read.
- **Impact**: Future developers can't tell which behavior is intended — the dead code paths (contactless entries, `contact: null` handling, the "newly reachable" re-apply backfill branch for chat-born entries) look load-bearing but are only reachable by scripted POSTs. If requiring email is the product decision, the server's leniency is silently masking malformed automation traffic as legitimate contactless applicants.
- **Fix sketch**: Decide and align: either mark the email step `optional: true` (the Skip affordance already exists for optional text steps, and the server/dedup paths already handle blank), or require email server-side for the conversational surface and update the route comment — leaving the lenient path only where it's genuinely needed (webhook leads). Either way, one sentence in `apply.ts` stating the decision kills the ambiguity.

## 5. Conversational KO buttons color-hint the "passing" answer; quick-apply's identical question renders neutrally
- **Severity**: Medium
- **Lens**: ui
- **Category**: ko-answer-steering
- **File**: `app/apply/[id]/ConversationalApply.tsx:509`
- **Scenario**: On a knockout question in the chat, hovering "Yes" glows moss (the app's success color, `hover:border-moss/50`) while "No" glows coral (the error/danger color, `hover:border-coral/50`). The candidate is being visually told which answer is "good" *before* they answer an eligibility gate. The quick-apply form renders the exact same KO gates as neutral toggles (`QuickApplyForm.tsx:223-227` — selected = ink, hover = coral for both).
- **Root cause**: The moss/coral pair was applied as generic affirmative/negative styling, but on a knockout question the semantic it broadcasts is pass/fail — a steering signal on a self-reported eligibility answer — and the two intake surfaces disagree on it.
- **Impact**: Candidates are nudged toward answering "Yes" on work-authorization / on-site / language gates (they can see "No" is the red button), degrading the honesty of the strict KO verdict both surfaces rely on; and the same question presents with different visual grammar depending on which door the candidate came through.
- **Fix sketch**: Make both KO buttons in the chat use the same neutral hover treatment the quick form uses (e.g. `hover:border-coral/50` or a neutral `hover:border-stone-400` on both), keeping moss strictly for outcomes (the "You're in" card). One class change on the Yes button at line 509.

## 6. Quick-apply submit sits disabled with no cue about which field is blocking it
- **Severity**: Low
- **Lens**: ui
- **Category**: disabled-submit-no-reason
- **File**: `app/apply/[id]/quick/QuickApplyForm.tsx:70`
- **Scenario**: `ready` requires name + email + *every* KO toggled (line 69-70), and the submit button just renders `disabled={!ready}` (line 246). On a phone, a candidate who missed one yes/no in the middle scrolls to a dead, half-opacity button with no message, no focus jump, and no aria explanation — the form looks broken, on exactly the ≤30-second surface built for impatient ad traffic.
- **Root cause**: The disabled-until-valid pattern encodes the requirement ("a missing KO answer reads as an unearned rejection") but surfaces no feedback path for the incomplete state; every other failure in this form gets an inline explanation (`emailError`, `submitError`), the blocking one gets silence.
- **Impact**: Abandonment on the highest-intent, paid-traffic intake: the fix for a dead button that gives no reason is usually the back button. Screen-reader users get even less — a disabled button with no described reason.
- **Fix sketch**: Keep the button enabled, and on submit with `!allKoAnswered` show an inline `role="alert"` hint ("Please answer all questions") and focus/scroll the first unanswered fieldset — mirroring how `emailError` already works. Alternatively keep it disabled but add a persistent helper line under the button while incomplete, plus `aria-describedby` pointing at it.
