# Shared UI & Design System — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀2 / 🚀3 | Severity: C0/H2/M3/L0

## 1. brand.ts `PAPER` has already drifted from the live canvas — the share-card cream is the OLD hex
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: brand consistency / unenforced "lockstep" contract
- **File**: app/_lib/brand.ts:20
- **Observation**: `brand.ts` exists explicitly to be "the JS-side mirror of the @theme color tokens" with the instruction "Keep these literals in lockstep with the @theme block … so the social-card and icon colors [don't] quietly drift from the live UI." Yet `PAPER = "#f7f5ef"` (line 20) no longer matches the app canvas `--color-paper: #fdf8ee` set in `app/globals.css:9` (the "Option C — warm cream" change). Every other brand literal (INK/MOSS/CORAL/STEEL/…) still matches; only PAPER drifted. The stale value is consumed on the product's most-shared first-impression surfaces: `app/opengraph-image.tsx:26,42,90` (OG card background + the "KP" logo card + paper rects), `app/apple-icon.tsx:20` (home-screen icon), plus `results/shared.tsx` and `ScanAnimation.tsx`. `app/icon.svg:4` also hardcodes the old `#f7f5ef`.
- **Why it matters**: The Open Graph card, favicon and Apple touch icon are the brand's handshake in Slack/LinkedIn/iMessage previews and the browser tab. They now render on a visibly cooler cream than the actual app, and the drift is exactly the failure mode `brand.ts` was written to prevent — so the guard rail is giving false confidence.
- **Recommendation**: Set `PAPER = "#fdf8ee"` (and the dark `DARK.PAPER` already = `#141b24`, correct), update `app/icon.svg` to `#fdf8ee`, and add a tiny test asserting `brand.ts` literals equal the `@theme` tokens so future drift fails CI instead of shipping.
- **Effort**: S

## 2. ScoreDial paints a fourth, undocumented score-band scale — its spoken label disagrees with the number's color
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: magic numbers / score-band cutoffs / a11y label-vs-visual mismatch
- **File**: app/_components/ScoreDial.tsx:35
- **Observation**: `bandIndex` uses cutoffs **40 / 55 / 70 / 85** (lines 35-41, labels Early/Developing/Solid/Strong/Excellent) with no recorded rationale for those numbers. But `format.ts:328-329` declares `SCORE_STRONG_MIN = 75 / SCORE_MID_MIN = 50` as "the ONE place these numbers live … canonical app-wide," and `Badge.tsx:190` adds yet a third set (`scoreToFitTier` 70/55, mirroring matching.py). The dial already reconciled its *readout color* to `scoreTone` (50/75) — the comment at lines 84-90 admits the old 40/70 split "disagreed with 50/75" — but the *band label* still comes from the 40/55/70/85 scale, and that label is what the `aria-label` announces (line 96: `Score ${clamped} out of 100, ${activeBand.label}`). Net effect at score 72: a sighted user sees an **amber/"mid"** number, a screen-reader user hears **"Strong"**, and the arc's "Strong" band is lit — three different verdicts on the hero number.
- **Why it matters**: The dial is the single most prominent figure on the analysis screen — the recruiter's at-a-glance verdict. A label that contradicts the color (and the badge beside it) undermines trust in the score and leaks an unresolved "which cutoffs are real?" ambiguity onto the most visible surface. There is no documented reason the dial needs its own 5-band scale at all.
- **Recommendation**: Either derive the dial's band thresholds from the canonical 50/75 cutoffs (collapse to the same strong/mid/weak language), or document in the file why the 5 aesthetic bands exist AND align the announced `aria-label` tier with the `scoreTone` color so the spoken and visual verdicts can't disagree.
- **Effort**: S

## 3. SegmentedControl is a "dark capability": the accessible radiogroup primitive is adopted in only 2 of ~6 single-select toggles
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: accessibility / built-but-underadopted primitive
- **File**: app/_components/SegmentedControl.tsx:19
- **Observation**: SegmentedControl's own doc claims it owns "the app's segmented-control motion standard" and was "Extracted so every single-select toggle shares this behavior instead of re-deriving it" — full APG radiogroup semantics: roving tabindex, arrow/Home/End keys, `aria-checked`, reduced-motion fallback. Yet it is imported in only **2** files (`sub_match/MatchTab.tsx`, `sub_profile/ProfileEditor.tsx`). Meanwhile a single-select group is **hand-rolled** as `role="radiogroup"` in `app/features/sub_interview/InterviewSimTab.tsx`, and the signature `layoutId` motion pill is re-implemented in `app/features/sub_analyze/AnalyzeWorkspace.tsx` and `app/features/sub_schedule/ScheduleCalendar.tsx` — none of which inherit the primitive's keyboard contract. (22+ files hand-roll `aria-pressed` button toggles besides.)
- **Why it matters**: Keyboard/screen-reader operability of the app's most common control is now a coin-flip per screen — a real WCAG 2.1 (4.1.2 / keyboard) compliance and market-reach risk for a B2B recruiting SaaS likely facing procurement accessibility questionnaires. The expensive part (the accessible primitive) is already built and paid for; the value is left on the table by non-adoption.
- **Recommendation**: Migrate the hand-rolled radiogroup (InterviewSimTab) and the two `layoutId` pill toggles to SegmentedControl; add a lint/grep guard (or a DESIGN.md note) steering new single-select toggles to the primitive instead of re-deriving roving-tabindex.
- **Effort**: M

## 4. The flagship Modal opts out of the Spark Dark "depth is drawn, not diffused" contract
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: two-theme coverage parity / undocumented trade-off
- **File**: app/_components/Modal.tsx:61
- **Observation**: The dialog surface is styled `… rounded-lg border border-stone-200 bg-white shadow-2xl` (line 61). `shadow-2xl` is a stock Tailwind 50px-blur shadow, NOT one of the design system's `--shadow-panel/-pop/-sticker` tokens. The whole Spark Dark register is built on the inverse premise — globals.css:175 "The Spark signature: depth is drawn, not diffused" overrides every shadow token to a hard offset, and the `.shadow-panel` ride (globals.css:202-206) gives panels a 2px outline + 16px radius in dark. Because Modal hardcodes `shadow-2xl` and never uses the `.shadow-panel` class, the most prominent overlay in the app keeps a soft diffused blur and a plain border in Spark Dark — silently exempt from the register every other surface follows. No comment records this as intentional.
- **Why it matters**: Dual-theme polish is positioned as a differentiator, but the surface users stare at most (every confirm/detail dialog) visibly breaks the dark art direction — the kind of inconsistency that reads as "unfinished" in a demo. It's also an undocumented trade-off: a maintainer can't tell whether the soft shadow is a deliberate exception or an oversight.
- **Recommendation**: Swap `shadow-2xl` for `shadow-panel` (so it rides the dark sticker treatment) or add an explicit `dark:` shadow + a one-line comment stating the dialog deliberately stays diffused and why.
- **Effort**: S

## 5. ErrorBoundary hardcodes English — the one shared primitive that isn't bilingual
- **Lens**: 🚀 Business
- **Severity**: Medium
- **Category**: i18n coverage gap / market reach
- **File**: app/_components/ErrorBoundary.tsx:58
- **Observation**: The fallback UI ships literal English strings — "Something went wrong here" (line 58), "{what} couldn't be displayed — the data may be in an unexpected shape…" (line 60), "Try again" (line 68) — and the default `label` ("This panel", line 51) plus all call-site labels are English prose. There is no `useTranslations`, unlike the sibling shared primitives (`ChainEmptyState`, `CompletionCta` take localized strings via props; `ThemeToggle`/`PotentialBadge` use next-intl). The app is explicitly en/cs, so a Czech recruiter who trips a panel crash (the comment cites "a shape-drifted analytics payload") sees an English error in an otherwise-Czech product.
- **Why it matters**: Error states are exactly when a user needs to understand what happened; a language switch there is jarring and erodes the bilingual promise the rest of the app keeps. It's also low-effort to close and removes a visible "half-localized" tell during Czech-market demos.
- **Recommendation**: Move the three strings into an `errors` next-intl namespace and render via `useTranslations` (the class boundary can wrap a small functional fallback that calls the hook), keeping `label` as a localized key from each call site.
- **Effort**: S

---
_Files read in full or part: ~22 of 44 in scope (theme.ts, recipes.ts, globals.css, format.ts, Modal, Badge, SegmentedControl + selection, ScoreDial, ScoreBadge, Meter, PotentialBadge, ThemeToggle, useTheme, useReducedMotion, Skeleton, ErrorBoundary, SectionTitle, ChainEmptyState, CompletionCta, brand.ts, icons/index, opengraph-image, apple-icon) plus adoption greps across `app/`._
