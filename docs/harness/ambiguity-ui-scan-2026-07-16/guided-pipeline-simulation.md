# Guided Pipeline Simulation — ambiguity-guardian + ui-perfectionist scan

> Total: 6 findings (0 critical, 1 high, 4 medium, 1 low)

## 1. Public demo isolation rests on a "half-built" tenancy assumption stated only in a comment
- **Severity**: High
- **Lens**: ambiguity
- **Category**: silent-security-assumption
- **File**: `app/api/demo/route.ts:29-44`
- **Scenario**: An operator enables the public "Try the live demo" CTA in a gated deploy (`KP_SECRET` set) by making `demoSessionAllowed()` return true. The route then mints an anonymous session scoped to `DEMO_WORKSPACE`, believing the demo is isolated.
- **Root cause**: The route's own comment admits "while tenancy is half-built, this anonymous recruiter session can read the real tenant's PII via the ~28 unscoped tables." The only thing standing between an anonymous visitor and real candidate PII is `demoSessionAllowed()` defaulting to false — a single boolean whose true meaning ("tenancy scoping is provably complete") is documented nowhere near the flag itself and is enforced by no assertion.
- **Impact**: A well-intentioned config change (flipping the flag to show off the demo) silently exposes real candidate PII across every unscoped table. The load-bearing precondition is invisible to whoever owns that flag.
- **Fix sketch**: Add a code-level guard that refuses to mint the demo session unless an explicit "tenancy scoping verified" env/marker is set (separate from `demoSessionAllowed()`), and reference the list of still-unscoped tables from a single named constant so completion can be tracked. At minimum, surface the risk in the flag's own documentation/definition, not only in this route.

## 2. The screening invariant's stated justification doesn't match what the walk actually follows
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: undocumented-assumption
- **File**: `app/features/simulation/constants.ts:69-74`
- **Scenario**: A developer reads the `SIM_SCREEN_POLICY` invariant (+ `constants.test.ts`) which asserts the scripted inbound applicant must outscore the reject ceiling "or the walk to Hired breaks," and treats that as the guarantee the demo depends on.
- **Root cause**: `run()` follows `topScreened(jobId)` — the single highest match score in the cohort (`SimulationProvider.tsx:192-199`), selected by score, not by identity. The inbound applicant is capped in `[floor, floor+9]` and is very unlikely to be the top-scoring entry among the real seeded sourced pool, so the candidate the walk actually follows is almost never the one the invariant protects. A top-scoring candidate structurally cannot be in the auto-rejected bottom tier regardless of the invariant.
- **Impact**: The invariant's justification is misleading: it does not guard the walk it claims to. Its real value is cosmetic (keeping the inbound applicant from visibly appearing "Rejected" in the wave modal). A future maintainer could weaken the invariant reasoning about the wrong failure mode, or waste effort "protecting the walk" that is already safe.
- **Fix sketch**: Rewrite the comment to state the true reason (avoid the scripted applicant showing as auto-rejected in the decision-wave modal for optics), and note explicitly that the walk follows the top-scored entry — so the walk itself is safe irrespective of this invariant. If the intent really is to follow the inbound applicant, capture its `entryId` from `/api/sim/inbound` and follow that, rather than `topScreened`.

## 3. Deterministic offer-draft salary fallback duplicates SIM_SALARY as bare literals
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: magic-number-coupling
- **File**: `app/api/sim/offer-draft/route.ts:21`
- **Scenario**: A developer updates the demo salary band in `constants.ts` (`SIM_SALARY = { 120000, 165000 }`) to reflect a new demo role and expects the offer draft to match.
- **Root cause**: The offer-draft fallback `normalizeSalaryBand(...) ?? [120000, 165000]` hardcodes the same two numbers as `SIM_SALARY` (constants.ts:41) with no reference between them. They agree today only by coincidence. The fallback fires whenever the stored band is missing/garbage, so it is not dead — it just doesn't fire on the happy path, hiding the drift.
- **Impact**: If `SIM_SALARY` changes, a degraded run advertises a stale salary band that silently disagrees with the JD the same demo just published — the kind of inconsistency a prospect could notice on screen.
- **Fix sketch**: Import `SIM_SALARY` and use `[SIM_SALARY.suggestedMinimum, SIM_SALARY.suggestedMaximum]` as the fallback (or export a shared `SIM_SALARY_FALLBACK` tuple), so the demo band is single-sourced the way the screening policy already is.

## 4. Sim overlays anchored to `--sim-bar-h` misposition when the dock is collapsed
- **Severity**: Medium
- **Lens**: ui
- **Category**: broken-responsive-anchor
- **File**: `app/features/simulation/SimExplainDrawer.tsx:28`
- **Scenario**: During a running demo the viewer clicks the Candi orb to collapse the bottom dock (`ControlDock` → `setCollapsed(true)`) while the explainer drawer (or the offer frame) is still open.
- **Root cause**: `usePublishBarHeight` only publishes `--sim-bar-h` while the dock is expanded, and *removes the property* on collapse (`controlCenterKit.ts:128-144`). The overlays position with `bottom-[calc(var(--sim-bar-h)_+_8px)]` and no fallback, so `calc(var(--sim-bar-h) + 8px)` becomes invalid at computed-value time and `bottom` resolves to `auto`. The explain drawer (`top-3` + `bottom:auto` + a `flex-1` scroll region) then loses its bounded height and runs off the bottom of the viewport; the offer frame (`SimOfferFrame.tsx:57`) similarly loses its bottom edge and its full-screen dim/centering.
- **Impact**: A visible layout break (drawer overflowing past the viewport / frame no longer centered and dimmed full-height) at exactly the moment a presenter tidies the screen mid-demo.
- **Fix sketch**: Give every `--sim-bar-h` consumer a fallback: `bottom-[calc(var(--sim-bar-h,0px)_+_8px)]` in `SimExplainDrawer.tsx` and `SimOfferFrame.tsx`. Optionally keep publishing the collapsed orb's height so overlays still clear it.

## 5. SimOfferFrame claims a real modal but never traps focus or inerts the background
- **Severity**: Medium
- **Lens**: ui
- **Category**: a11y-focus-management
- **File**: `app/features/simulation/SimOfferFrame.tsx:44-69`
- **Scenario**: A keyboard-only viewer opens the candidate offer/self-schedule frame and presses Tab a few times.
- **Root cause**: The dialog sets `role="dialog"` + `aria-modal="true"` and moves focus to Close on open (and restores on close), but it does not trap Tab within the dialog nor mark the backdrop content `inert`/`aria-hidden`. Once focus tabs past the iframe, it lands on the still-focusable ControlDock buttons behind the dim layer — contradicting the file's own "It is a real modal … a viewer is never trapped behind the dim layer" claim (the guarantee is one-directional: they can't get stuck, but focus can silently wander behind the scrim).
- **Impact**: Keyboard/screen-reader users can operate controls hidden behind the backdrop, defeating the modal affordance the code advertises; focus visibly disappears behind the dim overlay.
- **Fix sketch**: Trap Tab/Shift+Tab within the dialog (cycle between the first/last focusable elements, or use a focus-trap utility) and apply `inert` (or `aria-hidden`) to the app root while the frame is open. Escape/backdrop dismissal already exist and should stay.

## 6. Spotlight caption clamp reserves less width than the bubble can occupy
- **Severity**: Low
- **Lens**: ui
- **Category**: layout-overflow
- **File**: `app/features/simulation/SimSpotlight.tsx:62`
- **Scenario**: The simulation spotlights a `[data-sim]` target near the right edge of a narrow viewport; the caption bubble renders partly off-screen.
- **Root cause**: `captionLeft = Math.max(8, Math.min(rect.left, window.innerWidth - 420))` reserves only 420px for the bubble, but the bubble is `max-w-md` (28rem ≈ 448px) at `SimSpotlight.tsx:86`. For a wide caption near the right edge the bubble can overflow the viewport by ~28px, and `pointerLeft`'s 360px clamp is derived from the same mismatched assumption.
- **Impact**: A right-aligned coachmark bubble can clip past the right edge — a small but visible polish defect in the flagship guided demo.
- **Fix sketch**: Single-source the bubble max width (e.g. a `const BUBBLE_W = 448`) and use it in both the Tailwind class (`max-w-[448px]`) and the clamp (`window.innerWidth - BUBBLE_W - 8`), and derive the pointer clamp from it too.
