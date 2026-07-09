# Dev Submissions & Live Work Surface — bug-hunter + ui-perfectionist scan

> Context: Candidate-facing dev-case live work surface plus recruiter-side submission review, authenticity scoring, and side-by-side comparison.
> Files reviewed: 17 of 25
> Total: 5

## 1. Paste events are dropped end-to-end, so the bulk-paste authenticity penalty can never fire

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent-failure / defeated-control
- **File**: `app/api/devcase/session/[id]/route.ts:9,29-33` (with `app/devcase/apply/[token]/LiveWorkSurface.tsx:184-190`, `app/_lib/db/devcase.ts:523,575-581`, `app/_lib/devcase-run.ts:500`)
- **Scenario**: A candidate pastes a whole LLM solution into the watched editor. The client dutifully records `record("paste", path, n)` with the char count. The save route filters events against `KINDS = {"open","edit","decision_log","submit"}` — which excludes `"paste"` — so every paste event is discarded; even for kept kinds the `.map` keeps only `{t,kind,path}` and drops `size`. `DevSessionEvent` and the `dev_session_events` table have no `size` column either.
- **Root cause**: The wire→DB coercion is a hand-maintained allow-list + hand-picked field list that silently drifted from the client `ProcessEventKind` (`DevTypes.ts:15` includes `"paste"` and `size`). `devcase-run.ts:500` then computes `observedBulkPaste = events.some(e => e.kind === "paste" && (e.size ?? 0) >= PASTE_BULK_CHARS)` over events that can contain neither — so it is **always false**.
- **Impact**: The flagship in-product paste-from-LLM control (`devcase-authenticity.ts:81`, the decisive −65 penalty that lands a submission in "suspect" and holds it from auto-promotion) is dead code. A ghost-written live submission scores "authentic" and can auto-advance — the exact failure the Live Work Surface exists to prevent. The candidate need not even suppress events; the server destroys them.
- **Fix sketch**: Add `"paste"` to `KINDS`, carry `size` through the map, the `DevSessionEvent` type, the table (+ `getDevSessionEvents`). To kill the class: derive the server coercion and the DB row from ONE shared zod schema of `ProcessEvent` so a new client event kind/field can't be silently dropped, and unit-test that a `paste` event with `size >= PASTE_BULK_CHARS` round-trips into `observedBulkPaste`.

## 2. Live-session finalize is a parallel intake that skips the closed-posting guard and has no per-token cap

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: validation-gap / trust-boundary
- **File**: `app/api/devcase/session/[id]/submit/route.ts:11-24` (contrast `app/api/devcase/inbound/route.ts:33-38`; also `app/api/devcase/session/route.ts:14-19`, `app/api/devcase/session/[id]/route.ts:9-12`)
- **Scenario**: A candidate starts a session while a posting is OPEN, then the recruiter closes it. The candidate clicks Submit: the finalize route resolves the posting from `session.token` and calls `submitDevSession` **without ever checking `posting.status === "closed"`** — a submission is minted on a closed intake. The public inbound webhook explicitly 410s that exact case ("a closed posting answers honestly"), so the two intake paths disagree. Separately, `session` POST mints unlimited sessions per token and the flush route caps only *per flush* (500 events / 50 files), not the number of flushes or sessions.
- **Root cause**: The live-session surface was added as a second intake path that re-implemented submission creation but did not inherit the inbound path's guardrails (closed-posting rejection, and any per-token throttle). Apply tokens are CSPRNG (`randomToken`, good) but are deliberately shareable public links, so an unauthenticated holder is the trust boundary here.
- **Impact**: Submissions land on cases the recruiter has closed (confusing, and they bypass the honest-closure UX). The uncapped write path lets one shared/leaked token amplify into unbounded `dev_sessions` + `dev_session_events` rows — a cheap unauthenticated storage-exhaustion vector.
- **Fix sketch**: In the finalize route, re-read the posting and return 410 when `status === "closed"` (reuse the inbound guard). Add a per-token/day session cap and a per-session event ceiling. Route both intakes through one `intakeSubmission`-style helper so the closed-check can't be omitted by a new path.

## 3. A failed evaluation shows nothing — SubmissionRow ignores the task error and silently reverts

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: missing-ui-state
- **File**: `app/features/sub_dev/SubmissionRow.tsx:168-171,268-271`
- **Scenario**: A recruiter clicks Evaluate. The button shows "Evaluating…" while `busy = status === "running" || "queued"`. If the task ends `"failed"` (or `"interrupted"`), `busy` flips false, `fresh` stays null (only set on `succeeded`), and `ev` falls back to `submission.evaluation` — null on a first-ever evaluation. The panel renders nothing and the button quietly returns to "Evaluate". `useTaskResult` DOES expose an `error` string for failed tasks, but this row destructures only `{ status, full }` and never reads it.
- **Root cause**: The component models only the happy path (queued/running/succeeded) and treats "failed" as indistinguishable from "never ran," discarding the error the hook already surfaces.
- **Impact**: The recruiter cannot tell a failed evaluation from an un-run one; a transient engine failure looks like a no-op, inviting silent repeated clicks and eroding trust in the score. No retry affordance, no cause shown.
- **Fix sketch**: Destructure `error` from `useTaskResult`; when `evalStatus === "failed" | "interrupted"`, render an inline error chip (`role="alert"`) with the message and a Retry that re-calls `evaluate()`. Add a lightweight skeleton/spinner in the panel slot while `busy` so the pending state has a visible target.

## 4. The submission header crams ~10 heterogeneous controls into one micro-type row with no hierarchy

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: visual-consistency / responsiveness
- **File**: `app/features/sub_dev/SubmissionRow.tsx:230-292`
- **Scenario**: A single flex row at `text-micro` holds: rank chip, "Top match" pill, channel pill, git icon, candidate name, a `flex-1` truncated repoRef, the fit chip, "Author's GitHub", "Evaluate", and "Send feedback". In the narrow dev-studio drawer these wrap onto 2–3 ragged lines where the candidate NAME (the row's identity) sits at the same `text-micro` weight as three action buttons and competes with them for the eye; the `min-w-0 flex-1 truncate` repoRef can collapse to a few characters between pills.
- **Root cause**: Everything is rendered at the smallest type token in one undifferentiated flex line with no primary/secondary split and no responsive stacking — density substituted for hierarchy.
- **Impact**: Poor scannability of a triage surface: the recruiter's first read (who + fit score) is visually equal to utility buttons; layout is unpredictable across widths; the small targets sit below comfortable click/touch size.
- **Fix sketch**: Split into an identity line (name + fit chip, promoted one step in the type scale) and a secondary actions cluster that wraps as a unit; move overflow actions into a kebab/menu on narrow widths. Extract a shared `RowActions` cluster so density is governed by one component, not per-button markup.

## 5. [STILL-OPEN] EvalPanel strengths/concerns use a fixed 2-column grid and join arrays into run-on text

- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: responsiveness / readability
- **File**: `app/features/sub_dev/EvalPanel.tsx:104-106`
- **Scenario**: Reported in the 2026-06-20 scan (#5) and still present: `grid grid-cols-2` with no `sm:` breakpoint keeps two columns at every width, and each list is flattened via `(...).join("; ")` into one `text-micro` run-on paragraph. In the embedded recruiter drawer the two micro columns squeeze to a few characters wide.
- **Root cause**: A fixed two-column grid with no mobile fallback plus semantic list data rendered as a joined string rather than a `<ul>`. Still matters because strengths/concerns are the core decision content of the panel and become unreadable exactly where the panel is most used (the narrow drawer).
- **Impact**: On small/embedded widths the two columns are unreadable; the join hurts scannability and gives assistive tech no list semantics.
- **Fix sketch**: `grid-cols-1 sm:grid-cols-2`; render each as a real `<ul>` of `<li>` (or comma-chips) instead of `join("; ")`. Apply the same to the `iterationPattern`/fluency trace line, which also packs several signals into one wrapped sentence.
