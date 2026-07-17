# Landing & Marketing — ambiguity-guardian + ui-perfectionist scan

> Total: 6 findings (0 critical, 1 high, 4 medium, 1 low)

## 1. Every pricing-tier CTA drops the selected plan on the floor
- **Severity**: High
- **Lens**: ambiguity
- **File**: `app/landing/spark/PricingSection.tsx:97`
- **Scenario**: A visitor compares Free / Starter / Growth / BYOM, decides on "Growth", and clicks its button expecting to start on that plan. All four tier buttons run the identical `onClick={() => void enterWorkspace()}` — `enterWorkspace()` takes no argument and posts an empty body to `/api/auth/login`, so the chosen tier is never captured, passed, or remembered.
- **Root cause**: The tier identity (`tier.id`) is in scope at the click site but is never threaded into the entry call; the CTA is wired as a generic "enter product" action rather than a plan-selection action.
- **Impact**: The single highest-intent signal on the marketing surface — which plan the user picked — is silently discarded. Growth/Starter/BYOM clicks are indistinguishable from a Free click, so onboarding/billing can't preselect a plan and analytics can't attribute intent. The page *looks* like a plan picker but behaves like one big "Sign in".
- **Fix sketch**: Give `enterWorkspace` an optional `plan` (or `intent`) parameter and pass `tier.id` from each button; persist it (query param on the post-login redirect, or a short-lived cookie) so the workspace can land the user on the matching plan/billing step. If tier selection genuinely isn't wired yet, make that explicit in copy rather than implying selection.

## 2. Voice-transcript speaker attribution is coupled to a hardcoded 3-element array, decoupled from the i18n catalog
- **Severity**: Medium
- **Lens**: ambiguity
- **File**: `app/landing/spark/SparkLanding.tsx:68`
- **Scenario**: `TRANSCRIPT_WHO = ["ai", "them", "ai"]` decides left/right bubble alignment by index, while the actual lines come from `t.raw("voice.transcript")` (line 128, rendered at 514–515). A translator who adds a 4th line, drops to 2, or reorders speakers in `messages/{en,cs}.json` gets silent misattribution: `TRANSCRIPT_WHO[i]` is `undefined` past index 2, so any extra line falls through to the `"them"` (right-aligned) styling as if the candidate said it.
- **Root cause**: Two parallel arrays (copy in the catalog, speaker roles in code) are joined only by array index, with no length check and no per-line speaker field.
- **Impact**: A routine copy/translation edit can attribute the AI's words to the candidate (or vice versa) with no error — a correctness-of-meaning bug that no build step catches.
- **Fix sketch**: Move the `who` marker into the translation entries (e.g. objects `{ who, text }`), or assert `transcript.length === TRANSCRIPT_WHO.length` in dev. At minimum, default an out-of-range index deterministically and document the fixed 3-line/ai-them-ai contract next to the catalog key.

## 3. Home and About headers have no mobile navigation, unlike their Market sibling
- **Severity**: Medium
- **Lens**: ui
- **File**: `app/landing/spark/SparkLanding.tsx:171`
- **Scenario**: The home header `<nav>` is `hidden … sm:flex`, so below the `sm` breakpoint the entire nav — including the "Sign in" button — disappears, with no hamburger fallback. `AboutCurve.tsx:104` has the same pattern. Meanwhile the sibling `MarketPulseApp.tsx:60-94` explicitly added a mobile menu toggle with the comment that the links "were otherwise unreachable on a phone."
- **Root cause**: The mobile-menu retrofit was applied only to Market Pulse; Home and About kept the desktop-only nav, so three sibling marketing pages now diverge in responsive behavior.
- **Impact**: On phones the top-of-page Sign in / Home / section anchors are gone on the two most-trafficked marketing pages. Home is partially rescued by its hero CTAs, but /about loses its header Sign in and Home links entirely (reachable only via the closing CTA and footer). Inconsistent header behavior across the marketing set reads as unfinished.
- **Fix sketch**: Extract the Market Pulse mobile-menu pattern (toggle + `aria-expanded`/`aria-controls` panel) into a shared landing header, or replicate it in `SparkLanding` and `AboutCurve`. One shared header component also removes the triplicated topbar markup.

## 4. Region detail card is a live region driven by mouse-hover, flooding screen readers
- **Severity**: Medium
- **Lens**: ui
- **File**: `app/landing/spark/market/parts.tsx:122`
- **Scenario**: `RegionDetail` is `role="status" aria-live="polite" aria-atomic="true"`, and `CzMap.tsx:82` activates a region on `onMouseEnter` (as well as focus/click). Sweeping the pointer across the 14-region choropleth reassigns `active` on every region the cursor crosses, and each change re-reads the whole card. A screen-reader user navigating with a mouse (or any AT that mirrors pointer activation) hears a rapid, uninterruptible stream of region names/figures for regions they never intended to select.
- **Root cause**: The same handler serves intentional selection (focus/click) and incidental traversal (hover); the live region can't tell a deliberate pick from a fly-over.
- **Impact**: The considerate live-region design (added so selection is announced) backfires under mouse hover into announcement spam, degrading the very AT experience it was meant to serve.
- **Fix sketch**: Announce only on deliberate selection — drive the live region from focus/click, not `onMouseEnter`, or debounce hover-driven `active` changes before they reach the announced card. Keeping hover for the *visual* highlight while gating the announcement to focus/click resolves it.

## 5. `Math.min/Math.max` over possibly-empty value arrays yield `Infinity`/`NaN` in the map legend and scales
- **Severity**: Medium
- **Lens**: ambiguity
- **File**: `app/landing/spark/market/MarketPulseAtlas.tsx:52`
- **Scenario**: `min = Math.min(...vals)` / `max = Math.max(...vals)` run over `vals` filtered to non-null numbers for the active metric. For the "salary" metric, regions with `medianSalary: null` are dropped; if a snapshot ever ships with all-null salaries (or an empty region set), `vals` is empty → `Math.min()` is `+Infinity`, `Math.max()` is `-Infinity`, and the legend's `lo/mid/hi` format from those. The same happy-path assumption sits in `regionScale` (`data.ts:196`) and `SalaryBands` (`parts.tsx:156`, `Math.max(...families.map(f => f.lead||0))` → `-Infinity`/`NaN%` widths if empty).
- **Root cause**: The code assumes the committed snapshot always has ≥1 populated value for every metric; there's no empty-guard, and the snapshot is a generated artifact (`scripts/build-market-pulse.mjs`) that could regress upstream.
- **Impact**: A data regression renders "∞"/"NaN" tick labels and broken bar widths on a public, indexable page, with no error surfaced — a latent correctness/quality risk gated only on the input file staying well-formed.
- **Fix sketch**: Guard the empty case (`if (!vals.length) …` → render a "no data" legend / skip the section), and have the snapshot build assert per-metric non-emptiness. Document the invariant that every published metric must have at least one populated region.

## 6. Feature card focus opens an inert, "dialog"-labeled preview
- **Severity**: Low
- **Lens**: ui
- **File**: `app/landing/spark/SparkLanding.tsx:411`
- **Scenario**: Feature cards declare `aria-haspopup="dialog"` and set `aria-expanded` true on `onFocus` via `hoverOpen`, which opens the preview *unpinned*. The `FeatureSpotlight` renders unpinned with `pointer-events-none` and `aria-modal={pinned}` = false, and its close button only appears when pinned (`FeaturePreviews.tsx:468`). So a keyboard user tabbing onto a card triggers `aria-expanded=true` and a visible "dialog" that is non-interactive and non-modal; only Enter/Space (which pins) yields a real dialog.
- **Root cause**: Focus reuses the hover-peek path (unpinned) while the ARIA semantics promise a real popup dialog, so the announced state overstates what focus actually delivers.
- **Impact**: Minor AT confusion — "expanded / dialog" is announced for a peek that can't be entered or dismissed as a dialog. Functional (Enter still pins), so polish-level.
- **Fix sketch**: Either don't flip `aria-expanded`/`aria-haspopup="dialog"` for the unpinned hover-peek (treat the peek as a decorative `aria-hidden` preview), or make focus pin the dialog so the announced state matches an actually-interactive, dismissible modal.
