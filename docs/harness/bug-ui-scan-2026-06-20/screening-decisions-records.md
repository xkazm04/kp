# Screening Decisions & Records — UI Perfectionist scan

> Context: Configure screening rules, run AI-assisted role decisions, reconsider candidates, and persist an auditable decision record. Covers the Decisions tab and decision config/attribution.
> Files reviewed: 11 of 22
> Total: 7 findings — Critical: 0, High: 2, Medium: 3, Low: 2

## 1. Decisions queue has no real empty/loading skeleton during filtered-to-zero or live-refresh re-fetch

- **Severity**: High
- **Category**: missing-loading-state
- **File**: `app/features/sub_decisions/DecisionsTab.tsx:347` (and `:91` `useLiveRefresh`)
- **Scenario**: A recruiter applies a role filter, or `useLiveRefresh` fires after the simulation/automation acts. The first paint shows `entries == null` → a bare `t("loading")` text line, but every subsequent `load()` (filter change is client-only, but the live-refresh re-fetch replaces `entries`) keeps the prior list with no busy affordance, so the queue silently swaps under the user's cursor mid-click.
- **Root cause**: There is exactly one loading branch keyed on `entries == null` (the very first load). Re-fetches via `load()` never reset `entries` to null and there is no separate "refreshing" indicator, so a list mutation during live-refresh is invisible until rows pop in/out.
- **Impact**: A card the recruiter is about to Accept can vanish or reorder with zero visual warning (no skeleton, no fade, no "updating…"), risking a mis-click on the wrong candidate — an irreversible advance/reject. The optimistic-removal animation at `:177` only covers the user's own action, not server-driven churn.
- **Fix sketch**: Add a lightweight "refreshing" flag set around every `load()`/`loadReconsider()` and render a subtle top-of-list spinner or skeleton rows (reuse the same `Loader2` pattern already in the modals). On a live-refresh that removes a card the user is hovering, prefer a brief highlight-then-fade over an instant splice.

## 2. The role filter and governance-mode `<select>` controls have no accessible name

- **Severity**: High
- **Category**: a11y
- **File**: `app/features/sub_decisions/DecisionsTab.tsx:289` (role filter) and `:303` (governance mode)
- **Scenario**: A screen-reader user tabs to the two header dropdowns. Both rely solely on a `title` attribute (`t("filterTitle")` / `t("govModeTitle")`); neither has a `<label htmlFor>`, `aria-label`, nor a visible caption.
- **Root cause**: `title` is not reliably announced as an accessible name by assistive tech and is invisible to keyboard-only users; the governance-mode select in particular silently changes whether the AI verdict is binding ("recommendation" vs "committee"/"eligibility_list") — a consequential control with no programmatic name.
- **Impact**: SR users cannot tell what either dropdown does; the governance selector gates a fairness-sensitive decision mode, so a mislabeled control here is a compliance-adjacent a11y defect. This pattern repeats in `ComplianceSection.tsx:91` (jurisdiction select uses a `<span>` label not associated via `htmlFor`).
- **Fix sketch**: Give each `<select>` an `aria-label` (or wrap with a `<label>` and `id`/`htmlFor`). Add a `visually-hidden` legend for the governance picker noting it changes how the AI recommendation is treated. Associate the jurisdiction select's `<span>` label with `htmlFor`/`id`.

## 3. AiReviewCard accept/reject buttons show no per-card pending state; double-click double-acts visually

- **Severity**: Medium
- **Category**: optimistic-feedback / disabled-state
- **File**: `app/features/sub_decisions/AiReviewCard.tsx:110` (buttons) consumed by `DecisionsTab.tsx:371`
- **Scenario**: A recruiter clicks Accept/Reject on an AI review card. `act()` immediately schedules the row's removal after 260ms (`:177`) and sets `resolving[e.id]`, but the buttons inside `AiReviewCard` are never `disabled` and receive no spinner — only the wrapper fades via `leavingWrapClass`. During those 260ms the buttons stay clickable.
- **Root cause**: The `resolving` map drives only the wrapper's opacity/translate, not the card's own controls. `AiReviewCard` has no `busy`/`disabled` prop, unlike `RoleDecisionRow` which correctly takes `busy`.
- **Impact**: A fast double-click (or click during the fade) re-invokes `act()` on the same entry; the `pointer-events-none` on the wrapper only applies once `resolving` is set, leaving a race on the first click. The user gets no "submitting…" confirmation, so on a slow network the card looks inert and invites a second click.
- **Fix sketch**: Thread a `busy={Boolean(resolving[e.id])}` prop into `AiReviewCard`, disable both buttons and swap the action icon for `Loader2` while busy — matching the spinner treatment already used in `ScreenWaveModal`/`DecisionRulesModal`.

## 4. Reconsider list lacks an empty state and its row layout collapses on narrow viewports

- **Severity**: Medium
- **Category**: missing-empty-state / responsiveness
- **File**: `app/features/sub_decisions/DecisionsTab.tsx:405`
- **Scenario**: The entire `<details>` reconsider block is gated on `reconsider.length > 0`, so when the queue empties (the recruiter reinstates the last item) the disclosure vanishes outright rather than showing "no auto-rejected candidates to reconsider". On a phone, each `<li>` uses `flex-wrap` with a `ml-auto` button (`:430`); with a long candidate label + job title + match + date, the reinstate button wraps to its own full-width line detached from any row affordance.
- **Root cause**: Visibility is binary on count (no zero state), and the row is a single flex line relying on `ml-auto` that breaks down once the metadata wraps to multiple lines.
- **Impact**: The "safety valve over irreversible auto-rejection" disappears the moment it's emptied, so a recruiter who just reinstated someone loses the entry point to re-open it; on mobile the action button floats ambiguously below dense metadata.
- **Fix sketch**: Keep the `<details>` mounted (or a slim entry point) with an empty-state line when `reconsider.length === 0`. For the row, move the button into a dedicated right-aligned column that stays pinned (e.g. `grid grid-cols-[1fr_auto]`) so it never detaches from its row on wrap.

## 5. ScreenWaveModal commit button disabled-reasons are conveyed only by `title`, and the irreversible action lacks a confirm step

- **Severity**: Medium
- **Category**: unguarded-destructive-action / a11y
- **File**: `app/features/sub_decisions/ScreenWaveModal.tsx:208`
- **Scenario**: The commit button ("Reject and notify N") is `disabled` when `!enabled` or `rejects.length === 0`, with the reason surfaced only via `title`. When enabled, a single click irreversibly flips statuses and queues rejection emails for the whole previewed cohort — there is no second confirmation between the preview and the irreversible send.
- **Root cause**: The disabled-reason is `title`-only (not announced / not visible), and the destructive commit is one click from the preview. The approval-token CAS protects against *stale* sets, but not against an accidental click on a fresh one.
- **Impact**: SR/keyboard users get no explanation for why the primary action is greyed out; any user can fire a batch of irreversible candidate rejections + emails with a single click and no "are you sure". For an adverse, emailed, auditable action this is under-guarded.
- **Fix sketch**: Replace the `title`-only reason with an inline helper line near the button (e.g. "Enable auto-reject to commit" / "No candidates fall below the threshold") rendered with `aria-live`. Add a lightweight confirm affordance (a held-state "Confirm rejection of N candidates" two-step, reusing the existing `Modal` stack) before the irreversible dispatch.

## 6. DecisionRulesModal number inputs use a shared static `id` for `aria-describedby`, breaking the label→sentence association

- **Severity**: Low
- **Category**: a11y
- **File**: `app/features/sub_decisions/DecisionRulesModal.tsx:100`, `:113`, `:120`
- **Scenario**: Both numeric inputs (`rejectBottomPct`, `onlyIfBelow`) point `aria-describedby="screening-rule-sentence"` at a single hardcoded id. This is technically valid for one modal instance, but the description is the *combined* rule sentence, so a SR announces the whole "reject bottom X% … only if below Y" paragraph when focusing *either* field, never the field-specific meaning.
- **Root cause**: One shared static id reused as the description for two distinct inputs; there is no per-field hint. (The hardcoded id would also collide if the modal were ever rendered twice, though today it is singleton.)
- **Impact**: Screen-reader users hear the full rule sentence twice and get no per-field guidance ("0–100, percent" vs "0–100, match score"); the two inputs are aurally indistinguishable.
- **Fix sketch**: Add a short per-field `aria-describedby` hint (units + range) in addition to the shared sentence, and derive the sentence id from `useId()` so it is instance-safe.

## 7. Archetype color dot is the only signal distinguishing candidate chips; color-blind users get no text differentiation in the row

- **Severity**: Low
- **Category**: a11y / visual-hierarchy
- **File**: `app/features/sub_decisions/RoleDecisionRow.tsx:76`
- **Scenario**: Each candidate chip in a role row shows a 12px colored dot (`s.bg`) whose only meaning is the archetype (steel/coral/moss). The dot has a `role="img"` + `aria-label`, which is good for SR, but sighted color-blind users see three near-indistinguishable dots and the archetype text appears only in the chip's `title` tooltip, not inline.
- **Root cause**: Archetype is encoded primarily as color on a tiny dot; the human-readable archetype label is hidden behind hover-only `title`, so the visual channel relies on color alone for low-vision/color-blind sighted users.
- **Impact**: A recruiter who is color-blind cannot tell a "Student" (coral) chip from a "Switcher" (moss) chip at a glance — exactly the fairness-relevant distinction the screening shield turns on — without hovering each one.
- **Fix sketch**: Add a tiny inline archetype glyph or single-letter token next to the dot (or a subtle text label on hover-capable + always-visible compact form), so archetype is conveyed by shape/text, not color alone. The `ARCHETYPE` map in `DecisionsTypes.ts:29` already has `label`s to reuse.
