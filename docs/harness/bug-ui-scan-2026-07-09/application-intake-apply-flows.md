# Application Intake & Apply Flows — bug-hunter + ui-perfectionist scan

> Context: Public candidate-facing apply experience — conversational and quick-apply forms, lead intake, application-status tracking, and completeness follow-ups.
> Files reviewed: 16 of 20
> Total: 5

## 1. A stale localStorage draft silently overrides the enrichment prefill and can wrongly DECLINE a qualified returning lead

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: state-corruption
- **File**: `app/apply/[id]/ConversationalApply.tsx:62,134-154` and `app/apply/[id]/page.tsx:97`
- **Scenario**: A candidate opens the full apply page for job X, types a couple of answers, and abandons the tab — a draft is saved under `kp:apply-draft:X` (persist effect, line 159-176). Later they receive the quick-apply enrichment email for the SAME job and click its `?lead=…` link. `page.tsx` resolves the lead, seeds `prefill.answers` (name/email + the KO gates the lead already passed) and hands the client a TRIMMED script (`trimSeededSteps` — the passed-KO steps are removed, line 97). But the mount restore effect (134-154) unconditionally does `setAnswers(d.answers)` / `setMsgs` / `setIdx` from the stale draft, ignoring `prefill` entirely. The seeded KO=true keys — which now live ONLY in `prefill.answers`, because the chat no longer asks those gates — are wiped. The final POST's strict KO verdict (`failedKoStepIds`, server route 142-145) then fails, and a candidate who already qualified is declined.
- **Root cause**: The draft is keyed on `jobId` alone with no awareness of `prefill` and no script fingerprint. Restore assumes the draft's `(idx, answers)` still describe the currently-rendered `steps`; for an enrichment visit the step array is a different, shorter list, and the bounds check `d.idx >= steps.length` (140) only catches out-of-range, not semantic mismatch. The same class also bites a plain first-time visit when the job's script changes (KO/archetype steps added or removed) between save and restore — prior scan finding #6, still unaddressed.
- **Impact**: Silent wrongful decline of an eligible candidate (data-integrity/fairness on the public front door), or a resume at a semantically wrong step with the "Welcome back" greeting lost and the `resumed` banner shown over an enrichment chat.
- **Fix sketch**: In the restore effect, bail when `prefill` is present (an enrichment visit should never be overwritten by a first-time draft), and stamp each draft with a hash of the current step ids — discard on mismatch. Namespace the draft key by `prefill?.leadToken ?? "new"` so the two flows can't collide.

## 2. Public apply throttle is defeated by a spoofable `X-Forwarded-For` first hop

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: validation-gap
- **File**: `app/_lib/rate-limit.ts:40-47` (consumed at `app/api/apply/[id]/route.ts:97` and `app/api/apply/[id]/quick/route.ts:59`)
- **Scenario**: The per-`(job, client)` limiter keys on `clientIpFrom`, which returns `xff.split(",")[0]` — the CLIENT-most, fully attacker-controlled hop of `X-Forwarded-For`. A script sends the apply POST with a fresh `X-Forwarded-For: <random>` header on every request; each maps to a distinct bucket, so the 20/min (conversational) and 30/min (quick) caps never trip. The throttle is the ONLY defense against a flood of small valid bodies — and each accepted conversational POST spawns a Python `buildApplicantProfile` subprocess and can dispatch a candidate email — so the DoS the limit exists to contain is fully restored.
- **Root cause**: The helper trusts the first XFF entry as "the caller," but behind a CDN/proxy that appends XFF (Vercel, nginx `proxy_add_x_forwarded_for`), the first entry is whatever the external client pre-seeded. The trusted client IP is the LAST hop your own proxy added, not the first.
- **Impact**: Unbounded Python-subprocess spawns / temp-file writes / email dispatch from a single origin — CPU/memory exhaustion and comms-provider cost, from an unauthenticated route.
- **Fix sketch**: Derive the client IP from the RIGHT of XFF, dropping a configured number of trusted proxy hops (or use the platform's verified client-IP header), and fall back to a single shared bucket rather than a per-spoofed-value one. A conservative default (last hop) makes the header non-forgeable for the common single-proxy deploy.

## 3. [STILL-OPEN] The status page fetches once and never revalidates — the "stop going dark" feature shows a frozen snapshot

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: missing-ui-state
- **File**: `app/status/[token]/StatusClient.tsx:36-45`
- **Scenario**: A candidate bookmarks their status link (the whole point of idea-e76a6fb2) or leaves the tab open while the recruiter advances them received → interview. `StatusClient` fetches `/api/status/${token}` exactly once in an effect keyed on `[token, t]` (which never change for the page's life). There is no interval poll, no `visibilitychange`/focus revalidation, and no manual refresh control.
- **Root cause**: The prior scan (finding #1) flagged this on the old inline-fetch `page.tsx`; the refactor to a `StatusClient` child preserved the exact one-shot fetch. The rendered data is a snapshot frozen at first paint.
- **Impact**: The feature built specifically so candidates don't "go dark" itself goes dark — an advanced candidate sees a stale stage indefinitely with no hint a hard reload is needed. Still matters because it defeats the entire feature's promise on the highest-stakes public page.
- **Fix sketch**: Add a `setInterval` poll (30–60s, cleared on unmount) plus a refetch on `document.visibilitychange`/window focus, and a subtle "updated just now / Refresh" affordance. Stop polling once `isTerminalCandidateStatus(view.status)` is true.

## 4. Status page collapses every failure — offline, 5xx, and an invalid/expired token — into one dead-end message

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: missing-error-state
- **File**: `app/status/[token]/StatusClient.tsx:36-45,70-75`
- **Scenario**: A candidate mistypes or reuses an expired status link. `/api/status/[token]` returns `404 {error:"not found"}`; the client's `.then` throws on `p.error` and lands in the same `.catch(() => setError(t("loadFailed")))` as a real network failure. The candidate sees a generic "couldn't load" with no indication the LINK is the problem, no "request a new link" path, and no retry button. Separately, the pre-resolve state is a bare `<p>{tCommon("loading")}</p>` (line 75) — no skeleton — so the full timeline pops in and shoves layout (CLS) on the resolve.
- **Root cause**: A single error channel with no status-code discrimination: an invalid/expired token (a permanent, user-actionable condition) is indistinguishable from a transient fetch error (a retryable one), so the copy can't be honest about either.
- **Impact**: On the one public page a rejected candidate reaches unauthenticated, the only failure UX is an ambiguous dead-end — the candidate can't tell whether to retry, fix the URL, or give up.
- **Fix sketch**: Branch on `res.status`: a 404 renders a distinct "this link is no longer valid — check your email for the latest one" state; other failures render a retryable message with a Retry button. Replace the bare "Loading…" with a skeleton that reserves the heading + 5 timeline rows so the swap is in-place.

## 5. Conversational apply's final-submit failure is the one error in the flow not announced to screen readers

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: a11y
- **File**: `app/apply/[id]/ConversationalApply.tsx:459-485` (cf. `552`, `600` which DO use `role="alert"`)
- **Scenario**: A screen-reader user completes the chat and taps Send; the POST fails (network blip, 5xx, or a rejected payload). The failure renders in a `<div>` whose message `<p className="text-base text-coral">` (465) carries NO `role="alert"` and sits OUTSIDE the `role="log" aria-live="polite"` region (that region closes at line 457). So an AT user hears nothing after Send — no error, no "Try again"/"Start over" prompt — while every sibling error in the same file (`uploadErr` line 552, `stepError` line 600) and both errors in `QuickApplyForm` (203, 238) correctly use `role="alert"`.
- **Root cause**: The submit-error block was added outside the live-region wrapper without its own assertive role, so the single most important failure state — the whole application didn't go through — is the only one that is silent.
- **Impact**: Keyboard/AT users on the public apply flow get no feedback that submission failed and no cue toward the recovery action, reading as a frozen page — a real abandonment driver on the drop-off-sensitive surface.
- **Fix sketch**: Add `role="alert"` to the submit-error message `<p>` (and ideally the recovery buttons' container), matching the existing inline-error pattern. Consider a shared `<InlineError>` primitive so every error in both apply forms carries the same semantics by construction.
