# Sourcing, Campaigns & Rediscovery — UI Perfectionist scan

> Context: Surface matching candidates for a role, run outreach campaigns, rediscover past applicants, and assess role winnability.
> Files reviewed: 13 of 20
> Total: 7 findings — Critical: 0, High: 3, Medium: 3, Low: 1

## 1. Disabled "Add to pipeline" buttons hide their error in a title-only tooltip (a11y + dead affordance)

- **Severity**: High
- **Category**: a11y
- **File**: `app/features/sub_jobs/RecruiterCandidates.tsx:500` (and `:504` title); also the success branch at `:493`
- **Scenario**: A pipeline-add fails (e.g. 500), then the user re-clicks; while `adding` is true the button is `disabled` and its only error affordance is `title={error ?? undefined}`. On the rediscovery surface the same `title={err ?? undefined}` pattern appears (`RediscoverPanel.tsx:112`).
- **Root cause**: Error feedback is leaned on a native `title` tooltip. Disabled elements are removed from the tab order and do not reliably fire tooltips for keyboard or screen-reader users; `title` is also never announced by most ATs.
- **Impact**: Keyboard/SR users get no error text on the control they just operated. (Here a visible `<p>` does render the error below at `:520`, so it is degraded rather than fully silent — but the rediscovery panel's inline error sits in a `max-w-[12rem]` block that can be missed, and the `title` is doing no real work.)
- **Fix sketch**: Drop the `title` as the error channel. Keep the visible inline `<p role="alert">` (already present for add), wire `aria-describedby` from the button to that message id, and prefer `aria-disabled` + a no-op handler over `disabled` so the control stays focusable while erroring.

## 2. `RediscoveryFeed` declares an AbortController ref but never attaches it — abort-on-unmount is dead code

- **Severity**: High
- **Category**: silent-failure
- **File**: `app/features/sub_jobs/RediscoveryFeed.tsx:39` (decl), `:57` (abort), `:47`/`:66`/`:91`/`:109` (fetches)
- **Scenario**: User opens the Jobs tab (mounts the feed, kicks the initial GET), triggers a `sweep` (a long pool-change sweep over published roles), then navigates away before it resolves.
- **Root cause**: `abortRef = useRef<AbortController|null>(null)` is created and `abortRef.current?.abort()` runs on cleanup, but no fetch is ever given `signal: controller.signal` and `abortRef.current` is never assigned. The initial load uses an `alive` flag; `sweep`/`dismiss`/`addToPipeline` use nothing.
- **Impact**: The in-flight POST sweep (which SIGKILLs server CLI children when aborted, per the route's AbortSignal threading) keeps running after unmount; the abort plumbing gives a false impression of cancellation. Wasted CPU and a misleading code contract.
- **Fix sketch**: Either assign `abortRef.current = new AbortController()` before each cancelable fetch and pass `signal`, or delete the ref + cleanup abort entirely so the code stops implying a guarantee it doesn't keep.

## 3. Campaign and Rediscover panels have no skeleton/empty-equivalent loading state — long CLI calls show a bare ellipsis or one line

- **Severity**: High
- **Category**: missing-loading-state
- **File**: `app/features/sub_jobs/CampaignTab.tsx:188-191`; `app/features/sub_jobs/RediscoverPanel.tsx:33`
- **Scenario**: These surfaces shell out to Python/Claude CLIs (campaign generation `maxDuration` 180s; rediscovery ranks the whole pool). During that window CampaignTab renders `<Loader2 .../> …` — a spinner next to a literal `…` ellipsis with no copy — and RediscoverPanel renders a single line `t("scanning")`.
- **Root cause**: No structural placeholder for a multi-second operation; the project already ships a `SkelBar` primitive (`JobsShared.tsx:123`) and a full `EmptyState`, neither is used here.
- **Impact**: On a slow generation the UI reads as broken/empty; the bare `…` is not localized, conveys no progress, and has no `aria-busy`/live region so SR users hear nothing. Inconsistent with the rest of the jobs tab which uses `SkelBar`/`EmptyState`.
- **Fix sketch**: Replace the `…` and the bare scanning line with `SkelBar` rows (mirroring the variant/candidate card layout) wrapped in `aria-busy="true"`, and add a localized "Generating campaign…/Scanning the pool…" caption.

## 4. CampaignTab error banner is not scrolled-to or focus-managed, and generate failures don't announce

- **Severity**: Medium
- **Category**: a11y
- **File**: `app/features/sub_jobs/CampaignTab.tsx:182-186` (error), `:170-178` (generate button)
- **Scenario**: User clicks Generate, the CLI fails; the `role="alert"` banner appears at the top of the tab body, but the user's focus stays on the Generate button which may be below the fold in the modal, and there's no `aria-live` tie to the button's state change.
- **Root cause**: The error relies solely on `role="alert"` rendering — which announces text once — but the generating→error transition gives no positive confirmation and the banner isn't focus-moved or scrolled into view.
- **Impact**: In a tall posting modal the user can click Generate, see the spinner stop, and not notice the failure banner above the current scroll position. The `role="alert"` helps SR users but sighted keyboard users get no cue.
- **Fix sketch**: On error, scroll the banner into view and optionally move focus to it (`tabIndex={-1}` + ref.focus()); keep `role="alert"`. Consider an `aria-live` status line near the Generate button reflecting generating/failed.

## 5. RecruiterCandidates has no top-level empty state when the ranked pool clears no one

- **Severity**: Medium
- **Category**: missing-empty-state
- **File**: `app/features/sub_jobs/RecruiterCandidates.tsx:108-117`, `:205-233`
- **Scenario**: A job whose pool exists but where every candidate fails KO (or `data.candidates` is `[]` with a `note`). After clicking "Score candidates", `eligible` is empty, both `experienced` and `earlyCareer` columns render their per-column compact empty state, and `notEligible` may be a count with a collapsed disclosure.
- **Root cause**: There's a per-column `EmptyState` (`:383-384`) but no panel-level "no eligible candidates for this role yet" summary; the API's `{ candidates: [], note }` (`candidates/route.ts:22`) `note` field is never surfaced.
- **Impact**: A genuinely empty result reads as two side-by-side empty boxes with no single explanation — the recruiter can't tell "pool is empty" from "everyone was knocked out". The server's helpful `note` ("No saved candidates yet.") is dropped.
- **Fix sketch**: When `eligible.length === 0`, render one full `EmptyState` (reuse the shared primitive) using the API `note` when present, instead of two compact column empties; keep the NotEligible disclosure below it.

## 6. Prior-outcome chip uses an unguarded style lookup that yields an unstyled chip for unknown kinds

- **Severity**: Medium
- **Category**: visual-consistency
- **File**: `app/features/sub_jobs/RediscoverPanel.tsx:71` (`PRIOR_STYLE[c.prior.kind]`), vs the guarded `RediscoveryFeed.tsx:174` (`PRIOR_STYLE[a.prior.kind] ?? PRIOR_STYLE.elsewhere`)
- **Scenario**: `prior.kind` is typed as `"rejected" | "closed" | "elsewhere"` in `rediscover.ts`, but `RediscoverPanel` types the wire row loosely and indexes `PRIOR_STYLE[c.prior.kind]` with no fallback. If the engine ever emits a new kind, the class string is `undefined`.
- **Root cause**: Two renderers of the same chip diverged — the feed added a `?? PRIOR_STYLE.elsewhere` guard, the panel did not.
- **Impact**: An unrecognized prior kind renders a chip with `class="... undefined"` — no background/text color, an invisible-on-white pill. Inconsistent hardening across two views of one concept.
- **Fix sketch**: Mirror the feed: `PRIOR_STYLE[c.prior.kind] ?? PRIOR_STYLE.elsewhere`. Better: extract a single `<PriorChip kind label />` component used by both `RediscoverPanel` and `RediscoveryFeed` so the style map and fallback live once.

## 7. CoachPanel stat tiles lock to a 3-column grid and uppercase labels can wrap/truncate awkwardly on narrow modals

- **Severity**: Low
- **Category**: responsiveness
- **File**: `app/features/sub_jobs/CoachPanel.tsx:107-114`
- **Scenario**: Inside the posting modal on a small viewport, three tiles share `grid grid-cols-3 gap-2`; the `text-2xl` number plus an `uppercase` label (e.g. localized "Qualified"/"Vyhovující") can crowd, and the fixed three columns never reflow.
- **Root cause**: Hard-coded `grid-cols-3` with no responsive breakpoint and no min-width consideration for longer localized labels.
- **Impact**: On phones / a narrow modal the labels wrap to two lines unevenly across the three tiles, breaking the baseline alignment of the numbers — minor visual roughness, not a functional break.
- **Fix sketch**: Use `grid-cols-1 xs:grid-cols-3` (or `sm:grid-cols-3`) so tiles stack when cramped, and add `truncate`/`leading-tight` to the label, matching the responsive treatment used elsewhere in the tab.
