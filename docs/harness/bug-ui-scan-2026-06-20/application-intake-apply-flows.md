# Application Intake & Apply Flows — UI Perfectionist scan

> Context: Public candidate-facing apply experience — conversational and quick-apply forms, lead intake, application-status tracking, and completeness follow-ups.
> Files reviewed: 9 of 20
> Total: 7 findings — Critical: 0, High: 3, Medium: 3, Low: 1

## 1. Status page has no live polling and no manual refresh — the "stop going dark" feature still goes dark
- **Severity**: High
- **Category**: missing-state / stale-data
- **File**: `app/status/[token]/page.tsx:33-42`
- **Scenario**: A candidate bookmarks their status link (the whole point of idea-e76a6fb2) and reopens it the next day, or leaves the tab open while the recruiter advances them from "received" to "interview". The page fetches `/api/status/${token}` exactly once on mount and never again.
- **Root cause**: The effect runs once (`[token, t]` deps that never change for the page's life); there is no interval poll, no `visibilitychange`/focus revalidation, and no user-visible "refresh" affordance. The data is a snapshot frozen at first paint.
- **Impact**: The feature exists to stop candidates feeling they've gone dark, yet the page silently shows stale state — a candidate who was advanced sees "under review" indefinitely and has no way (short of a hard reload, with no hint that's needed) to learn they progressed. Worse for a long-lived bookmark/tab.
- **Fix sketch**: Add a lightweight poll (e.g. `setInterval` every 30–60s, cleared on unmount) plus a refetch on `document.visibilitychange`/window focus; show a subtle "updated just now / Refresh" control. Keep the single fetch as the initial load.

## 2. Status page renders no empty/skeleton state and a bare text "Loading…" causing layout shift
- **Severity**: Medium
- **Category**: missing-loading-state / CLS
- **File**: `app/status/[token]/page.tsx:68-69` (and the success block 71-126)
- **Scenario**: A candidate on a slow mobile connection opens the status link. Until the fetch resolves the page shows only the eyebrow plus a single line `tCommon("loading")`; then the full timeline (heading, company, 5-step `<ol>`, updated date) pops in, shoving content down.
- **Root cause**: The loading branch is a one-line `<p>` rather than a skeleton matching the resolved layout, so the resolved content has no reserved space — a textbook cumulative-layout-shift jump on the highest-stakes public page.
- **Impact**: Janky first impression on the candidate experience surface; the timeline jumps into place. Every other apply surface paints its real chrome on hydration (apply pages are server components), so this client-only page is the odd one out.
- **Fix sketch**: Replace the bare "Loading…" with a skeleton that reserves the heading + 5 timeline rows (greyed circles + bars), matching the resolved `<ol>` height so the swap is in-place. Reuse any existing skeleton primitive from the design system.

## 3. Conversational apply: the AI/data-consent disclosure renders AFTER the controls, so consent text is below the submit action
- **Severity**: High
- **Category**: a11y / consent-UX / visual-hierarchy
- **File**: `app/apply/[id]/ConversationalApply.tsx:601` (`<AiDisclosure ... showDataConsent />`), and `app/api/apply/[id]/route.ts:446-451` (submitting IS the recorded consent)
- **Scenario**: A candidate fills the chat and taps Send on the final step. The data-processing + 12-month-retention consent statement (`showDataConsent`) is rendered at the very bottom of the component, after every interactive control, and the final answer is what `recordEntryConsent(entry.id, "apply")` stamps as consent.
- **Root cause**: The disclosure is appended last in DOM order and is the only place the retention/erasure statement appears, but the action that legally constitutes consent (the final Send) sits above it. On mobile the candidate may submit without the consent text ever entering the viewport. It is also `text-sm text-steel` (low-contrast muted) — easy to miss even when seen.
- **Impact**: GDPR/consent-UX risk on a public EU-default flow: consent is recorded but the disclosure can be entirely off-screen at the moment of submission. Also a hierarchy problem — the most legally material copy is the least prominent.
- **Fix sketch**: Surface the data-consent line at/above the submit affordance (or as a persistent footer always in view), and lift contrast for the consent sentence specifically. Keep the friendly AI note where it is; it's the `showDataConsent` retention statement that must be visible before submit.

## 4. CV-upload step has no drag-and-drop and an invisible progress state — only a labelled file `<input>` and a static "Reading…" word
- **Severity**: Medium
- **Category**: polish / loading-state / affordance
- **File**: `app/apply/[id]/ConversationalApply.tsx:519-550` (file step), `353-376` (`uploadCv`)
- **Scenario**: A candidate reaches the optional CV step and uploads a multi-MB PDF. The "Attach CV" label flips its text to `t("reading")` and the controls dim, but there is no spinner, progress indicator, or visual upload affordance — and unlike the recruiter Analyze workspace (which has a dedicated drop zone, `useGlobalFileDrag`, `useDropZoneHighlight`), this candidate-facing step offers no drag-and-drop target at all.
- **Root cause**: The file step is a minimal `<label><input type=file></label>` with a text swap; extraction (`/api/extract-text` round-trip on the full file) can take seconds with zero motion feedback, reading as a frozen UI on slow connections.
- **Impact**: On the surface where applicants drop off, a multi-second silent "Reading…" with no spinner invites a second tap / abandonment, and the missing drop affordance is below the bar the recruiter side already sets. The disabled `opacity-50` label is the only feedback.
- **Fix sketch**: Add a spinner (or indeterminate bar) next to "Reading…"; make the step a real drop target (reuse the Analyze drop-zone hooks/component) with a dashed-border hover state; keep the click-to-pick fallback.

## 5. Quick-apply KO toggles expose no validation/required hint — disabled submit with no explanation of what's missing
- **Severity**: Medium
- **Category**: missing-error-state / affordance
- **File**: `app/apply/[id]/quick/QuickApplyForm.tsx:60-61` (`allKoAnswered`/`ready`), `189-211` (KO fieldsets), `220-226` (submit)
- **Scenario**: A candidate fills name + email but skips one of several knockout yes/no questions (or scrolls past it). The submit button stays `disabled` (greyed at `opacity-50`) with no message saying which field is still required; the `fieldset`/`legend` carry no `aria-required`/`aria-invalid` and no "answer all questions" hint.
- **Root cause**: `ready` silently gates on `allKoAnswered` but the UI gives no signal about the unanswered gate — a dead-looking disabled button is the only feedback, and there's no per-question required marker.
- **Impact**: On the ≤30-second mobile lead form, a candidate who can't tell why "Apply" won't activate simply leaves — a silent drop-off exactly where the form is supposed to minimize it. Screen-reader users get no required cue on the toggle groups at all.
- **Fix sketch**: Mark each KO `fieldset` `aria-required` and flag the unanswered ones on a submit attempt (`aria-invalid` + an inline "please answer" note); when `!ready`, render a small helper line ("Answer all questions to continue") instead of relying solely on the disabled button.

## 6. Resume-draft banner can mismatch the visible conversation, and a stale draft from another browser/device is silently absent
- **Severity**: Medium
- **Category**: confusing-state / data-consistency
- **File**: `app/apply/[id]/ConversationalApply.tsx:133-175` (restore + persist), `396-409` (resumed banner)
- **Scenario**: A candidate starts the chat on their phone, switches to a laptop, and sees a fresh chat with no "we picked up where you left off" (the draft is `localStorage`, per-device). Separately, if a future script change shifts step order, a restored draft whose `idx`/`answeredIds` no longer line up with the new `steps` is only bounds-checked (`d.idx < steps.length`), not validated against step identity — so the banner can appear over a conversation that resumes at a semantically wrong question.
- **Root cause**: Draft restore is keyed only on `jobId` + numeric index with no script-version/step-id fingerprint, and persistence is device-local with no cross-device continuity and no messaging that a draft is device-bound.
- **Impact**: A returning candidate either loses their progress without explanation (cross-device) or resumes at a mismatched step after a script change — both erode trust on the drop-off-sensitive flow. The banner's promise ("we resumed you") can be quietly false.
- **Fix sketch**: Stamp the draft with a script fingerprint (hash of step ids) and discard/ignore on mismatch; only show the resume banner when the restored `answeredIds` are all still valid step ids. Optionally note the draft is saved on this device only.

## 7. Inline error and prefill hints use a smaller, lower-contrast type than the body, weakening the most important micro-copy
- **Severity**: Low
- **Category**: visual-consistency / a11y-contrast
- **File**: `app/apply/[id]/ConversationalApply.tsx:549` (`text-sm text-coral` upload error), `595-597` (`text-sm` prefill hint + step error); cf. `QuickApplyForm.tsx:182` which also uses `text-sm`
- **Scenario**: A candidate hits a step validation error (bad email/GitHub handle) or a CV-read failure. The error and the "prefilled from your CV" hint render at `text-sm` (smaller than the surrounding `text-base` chat copy), and the prefill hint is muted `text-steel`.
- **Root cause**: Inline validation/hint text is one notch smaller and lower-contrast than the body it qualifies, so the exact guidance that unblocks the candidate is the least legible text in the flow. `role="alert"` is correctly present, but visual prominence doesn't match the semantic importance.
- **Impact**: On mobile, easy-to-miss error guidance increases re-tries and abandonment; the size/contrast drift is also an inconsistency vs. the `text-base` conversation bubbles. Minor but it touches the recovery path.
- **Fix sketch**: Bump inline errors to `text-base` (or at least a higher-contrast coral) and standardize a single error-text token across both apply forms; keep the prefill hint subtle but ensure it meets contrast minimums.
