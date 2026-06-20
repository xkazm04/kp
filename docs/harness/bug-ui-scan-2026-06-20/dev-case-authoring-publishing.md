# Dev Case Authoring & Publishing — UI Perfectionist scan

> Context: Author developer hiring cases from a role need, orchestrate generation, and publish postings with apply tokens (the Dev tab).
> Files reviewed: 14 of 19
> Total: 7 findings — Critical: 0, High: 3, Medium: 3, Low: 1

## 1. Publish / source / lifecycle mutations swallow every error — failed action looks identical to a click that did nothing
- **Severity**: High
- **Category**: silent-failure / error-state
- **File**: `app/features/sub_dev/DevTab.tsx:187` (`runLifecycle`), `:196` (`approveLifecycle`), `:201` (`publish`), `:210` (`source`)
- **Scenario**: A recruiter clicks "Publish", "Approve", "Run automated lifecycle", or "Source DB" while the API is down, returns 404 ("case not found"), or 500. The `fetch` resolves (or rejects) but the response status is never checked: `runLifecycle`/`approveLifecycle`/`publish` ignore `r.ok` entirely, and `source` only sets a count on `r.ok` with no else branch. No toast, banner, or inline message is shown.
- **Root cause**: These handlers fire-and-forget the POST and immediately call a `loadX()` reload, treating "request returned" as "request succeeded". There is no `try/catch` → error state, unlike the loaders (which surface failure via `LoadStatus`).
- **Impact**: The most consequential write actions in the tab (publishing a posting, approving a design through the human gate, kicking off the autonomous lifecycle) fail completely silently. The user re-clicks, or assumes it worked and walks away — a published-looking case that was never published, or an approval that never registered.
- **Fix sketch**: Wrap each handler in `try/catch`, check `r.ok`, and route failures to a shared inline error state (reuse the `LoadStatus`/amber-banner pattern). Minimum: a per-action error string rendered near the button. Consider a small `useMutation`-style helper so all four share one busy+error contract.

## 2. "Publish" and "Run automated lifecycle" buttons have no pending state — instant double-fire risk
- **Severity**: High
- **Category**: missing-loading-state / double-submit
- **File**: `app/features/sub_dev/CaseDetail.tsx:117` (Publish button), `app/features/sub_dev/DevTab.tsx:201` (`publish` handler)
- **Scenario**: In CaseDetail the Publish button is disabled only by `published` (derived from `casePostings.length > 0`), which doesn't become true until `loadPostings()` round-trips. Between the click and that reload the button stays enabled with no spinner, so a fast double-click sends two `POST /api/devcase/publish` — and `publish()` mints a NEW posting+token each time with no caseId dedup (confirmed in `devcase-orchestrator.ts:140-145` comment: "publish() mints a NEW posting + token with no caseId dedup").
- **Root cause**: `publish` is not tracked by a per-action in-flight flag the way `source` is (`sourcing === kase.id`). The only guard is server-derived state that lags the click.
- **Impact**: Duplicate postings/tokens for one case; submissions split across two live tokens, fragmenting the shortlist. Also no feedback that the click registered, so users re-click.
- **Fix sketch**: Add a `publishing` state (mirror the existing `sourcing` pattern), disable + show a `Loader2` spinner while in flight, and set the button label to "Publishing…". Re-enable on settle.

## 3. NeedForm "Analyze need only" creates a brand-new task on every click with no de-dup — encourages accidental duplicate runs
- **Severity**: Medium
- **Category**: interaction-correctness / dead-feedback
- **File**: `app/features/sub_dev/DevTab.tsx:254` (`submit`), `app/features/sub_dev/NeedForm.tsx:153`
- **Scenario**: The "Analyze need only" button is disabled only while `running` is true for the *currently viewed* task. After a run completes (viewed task succeeds), clicking again with the same JD + repos silently spawns another `need_analysis` task. The "Recent" list then accumulates near-identical entries with no indication they're duplicates, and each costs a GitHub fetch + LLM call.
- **Root cause**: No idempotency/confirmation on re-analyzing an unchanged need; the disabled condition keys on the single `viewed` task's status, not "is an analysis of *this exact need* already present".
- **Impact**: Wasted API/LLM budget and a cluttered Recent list of indistinguishable runs (labels are truncated need titles). The user can't tell which run is which.
- **Fix sketch**: Either disable/relabel the button to "Re-analyze" once a successful result for the current input exists, or dedupe by a hash of `buildNeed()` and reuse the existing task. At minimum, timestamp each Recent entry so duplicates are distinguishable.

## 4. Empty-state failure semantics collapse a degraded load into "nothing here" for cases, but inconsistently across sections
- **Severity**: Medium
- **Category**: missing-empty-state / inconsistency
- **File**: `app/features/sub_dev/CasesTable.tsx:36-57`, `app/features/sub_dev/DevShared.tsx:28`
- **Scenario**: `CasesTable` renders `LoadStatus` *above* a full "No cases yet" empty card whenever `cases.length === 0` — so on a fetch failure the user sees a prominent "Define a need" call-to-action plus a small amber strip, implying the workspace is genuinely empty and they should author a case. Meanwhile `DevSection` (lifecycle/outbox) returns ONLY the `LoadStatus` banner with no marketing empty card. The two empty/error treatments diverge for sections that sit on the same screen.
- **Root cause**: Two different empty-vs-failed shells (`CasesTable`'s bespoke card vs the shared `DevSection`) were built independently; only `DevSection` cleanly suppresses the empty CTA on failure.
- **Impact**: On an API outage the Cases view actively misleads (urges authoring a new case when cases may exist but failed to load), and the visual language for "empty" differs between adjacent panels, reducing trust.
- **Fix sketch**: When `state.failed && cases.length === 0`, render only the `LoadStatus` banner (suppress the "No cases yet" CTA), matching `DevSection`. Better: fold `CasesTable`'s empty card into the shared `DevSection`/empty-state primitive so all Dev sections share one contract.

## 5. CasesTable row is a click target but not keyboard-operable as a row; nested button is the only focus stop, and `aria-sort`/row semantics are missing
- **Severity**: Medium
- **Category**: a11y
- **File**: `app/features/sub_dev/CasesTable.tsx:80-98`
- **Scenario**: The entire `<tr>` has `onClick={() => onOpen(c.id)}` (pointer users click anywhere), but the row itself is not focusable and has no `role`/key handler. Keyboard users can only reach the inner title `<button>`. A user who tabs to the row's other cells (Stage, Submissions) has no way to open the case, and a screen-reader user gets a generic table cell with a clickable region that AT may not announce as actionable. The trailing `ChevronRight` affordance (`:109`) is `aria-hidden` with no accessible name suggesting "open".
- **Root cause**: The "whole row clickable for pointer, inner button for keyboard" pattern leaves the row's pointer affordance inaccessible to keyboard/AT, and the visual "open" chevron carries no semantics.
- **Impact**: Inconsistent affordance — the row *looks* and behaves clickable for mouse users but the chevron column is a dead control for keyboard/AT. Mild WCAG 2.1 (name/role/value, 4.1.2) gap.
- **Fix sketch**: Keep the inner title button as the single accessible action, and make the chevron column decorative-only (it is), OR convert the whole row to a `<button>`-styled cell with one accessible name. Ensure only one focus stop per row and that its label reads e.g. "Open case: {title}".

## 6. ApplyTokenPill copy failure is silently swallowed — no fallback or feedback in insecure/denied contexts
- **Severity**: Low
- **Category**: silent-failure / error-state
- **File**: `app/features/sub_dev/ApplyTokenPill.tsx:38-40`
- **Scenario**: On non-HTTPS origins or when clipboard permission is denied, `navigator.clipboard.writeText` throws; the `catch {}` no-ops. The recruiter clicks the pill, sees no "Copied!" confirmation and no error, and has no other way to grab the apply URL (the full URL is never shown as selectable text — only `token {token}` is rendered).
- **Root cause**: Clipboard is the only path to the apply link; the failure branch gives the user nothing.
- **Impact**: On a self-hosted HTTP deployment the share-link affordance appears broken with no recourse. The token is the artifact you must hand to candidates, so this blocks distribution in that environment.
- **Fix sketch**: On catch, either select+expose the full `applyUrl` in a readable/selectable field, or show a brief "Couldn't copy — select to copy" state. At minimum render the full URL in the `title`/an expandable so it can be copied manually.

## 7. CaseDetail Publish/Source action cluster lacks a disabled-reason and the degraded provenance pills are title-only (not screen-reader friendly)
- **Severity**: Low
- **Category**: a11y / polish
- **File**: `app/features/sub_dev/CaseDetail.tsx:94-115` (degraded badges), `:117-124` (Publish disabled)
- **Scenario**: The "interview scenario: template probes" and "seed: skeleton only" warning pills convey their critical meaning ("re-run before interviewing/sending") ONLY through a `title` attribute (`:97`, `:110`) — invisible to keyboard and screen-reader users, and unavailable on touch. Separately, once `published` the Publish button is `disabled` with no tooltip/text explaining why it can't be re-used.
- **Root cause**: Important degraded-state guidance is hidden in hover-only `title` text; disabled state has no accessible explanation.
- **Impact**: A reviewer on a screen reader or touch device never learns the case shipped with template-only probes / skeleton seed — exactly the cases that should not go to interview. The disabled Publish reads as an inexplicable dead control.
- **Fix sketch**: Render the degraded warning as visible inline helper text (or an `aria-label` + visually-hidden description), not just `title`. For the disabled Publish, add a short visible "Already published" caption or `aria-describedby` so the disabled reason is announced.
