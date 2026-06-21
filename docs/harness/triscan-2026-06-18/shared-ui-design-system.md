# Shared UI & Design System — Tri-Lens Scan
> Total: 5
> Severity: 0 Critical / 3 High / 2 Medium / 0 Low
> Lens: 2 bug / 3 ui / 0 biz

## 1. ScoreDial renders "NaN" and mislabels a non-finite score as "Excellent"
- **Lens**: 🐛 Bug Hunter
- **Severity**: High
- **Category**: NaN / clamp guard in core score visual
- **Value**: impact 7/10 · effort 2/10 · risk 2/10
- **File**: `app/_components/ScoreDial.tsx:75-91` (and `app/_lib/format.ts:84-86`)
- **Scenario**: A score arrives as `NaN` (a missing/garbled pipeline total, a `parseFloat` of an absent field, a divide-by-zero average). `ScoreDial` does `const clamped = clampPercent(score)`.
- **Root cause**: `clampPercent` deliberately passes `NaN` through unchanged (documented at format.ts:81-82 — "callers guard it separately"), but `ScoreDial` does NOT guard. `bandIndex(NaN)` fails every `<=` comparison and falls through to `return 4`, so `activeBand` = "Excellent". `useCountUp` returns `Math.round(eased * NaN)` = `NaN`, and the reduced-motion path returns `target` (NaN) directly. The big readout shows literal "NaN" and the `aria-label` announces "Score NaN out of 100, Excellent".
- **Impact**: The most prominent verdict surface shows a broken number AND silently upgrades a junk score to the top band — actively misleading, not just ugly. The dial is reused across results/matrix/JD pages, so any one bad payload defaces a hero element.
- **Fix sketch**: In ScoreDial, derive `const safe = Number.isFinite(score) ? clampPercent(score) : 0;` and use `safe` for `displayed`, `activeIndex`, and the aria-label (a non-finite score is "Early"/0, consistent with `scoreTone`'s "null" tier). Optionally render the em-dash chip like ScoreBadge does for a null score.

## 2. ScoreDial band LABEL uses 40/55/70/85 cutoffs that disagree with the readout color's 50/75 tone
- **Lens**: 🎨 UI Perfectionist
- **Severity**: Medium
- **Category**: Token / threshold consistency across score surfaces
- **Value**: impact 5/10 · effort 3/10 · risk 3/10
- **File**: `app/_components/ScoreDial.tsx:35-41, 84` vs `app/_lib/format.ts:328-342`
- **Scenario**: A score of 45 paints the central number in `scoreToneColor(scoreTone(45))` = **coral (weak)**, while `bandIndex(45)` = 1 so the label underneath reads **"Developing"**. A score of 50 reads label "Developing" but tone "mid". The number's color and its word say two different things in the same component.
- **Root cause**: The readout was migrated to the canonical `scoreTone` (50/75) — see the comment at lines 79-84 — but the five aesthetic arc bands keep their own 40/55/70/85 split AND drive the textual `activeBand.label`. So the *label* (band-derived) and the *color* (tone-derived) ride different cutoffs.
- **Impact**: Subtle erosion of trust on the brand's signature score widget: a recruiter sees a coral-red number labeled "Developing". Colorblind users rely on the label, which now contradicts the only other signal.
- **Fix sketch**: Either derive the displayed label from `scoreTone` (map strong/mid/weak/null → a word) so label and color share one source, or document the bands as purely decorative and stop sourcing the human-readable label from `bandIndex`. Keep the 5-band arc art; just don't let it name the verdict.

## 3. Badge `info`/`caution`/`critical` text tones risk sub-AA contrast on their tint backgrounds
- **Lens**: 🎨 UI Perfectionist
- **Severity**: Medium
- **Category**: Contrast / a11y of the shared semantic badge system
- **Value**: impact 5/10 · effort 3/10 · risk 2/10
- **File**: `app/_components/Badge.tsx:25-31`
- **Scenario**: The badge is the ONE semantic chip used app-wide (confidence, fit tier, code-review status, provenance, interview verdict). `info` = `bg-blue-50 text-blue-700`, `caution` = `bg-amber-100 text-amber-700`, `positive` = `bg-moss/15 text-moss`. At `text-sm` the moss-on-moss/15 and blue-700-on-blue-50 pairs sit near the 4.5:1 AA floor; `bg-moss/15` is an alpha tint over whatever surface is behind it (white panel vs paper vs a colored row), so effective contrast varies by context and is not guaranteed.
- **Root cause**: Tones were picked for hue harmony, not measured against WCAG on each theme. The `/15` and `/10` alpha fills make the actual background indeterminate, and dark-theme remaps (globals.css:108, 131-153) change both fg and bg without a contrast re-check.
- **Impact**: The badges carry meaning by color + label, so this isn't catastrophic (label always present — good), but low-contrast text on the most-reused chip is a recurring polish/a11y gap across every screen.
- **Fix sketch**: Measure each tone pair in both themes; bump the foreground shade (e.g. `text-blue-800`, `text-amber-800`) or solidify the tint (`bg-moss/15` → an opaque `--color-*-tint` token) where a pair misses 4.5:1. One edit in `TONE_CLASS` re-tones every badge.

## 4. SegmentedControl arrow-key navigation has no `aria-activedescendant`/focus-roving edge when value is unmatched, and pill animation can orphan
- **Lens**: 🐛 Bug Hunter
- **Severity**: High
- **Category**: Keyboard a11y / focus-roving correctness
- **Value**: impact 6/10 · effort 3/10 · risk 3/10
- **File**: `app/_components/SegmentedControl.tsx:62-68, 96-124`
- **Scenario**: When `value` matches no option (the documented dev-error path), `hasSelection` is false: no button has `aria-checked={true}` and the `motion.span` pill is hidden — correct. BUT `focusIndex` falls back to 0, so option 0 is the tab stop while `aria-checked` is false on it too. A keyboard user tabs in, presses Arrow, and `move()` immediately fires `onChange(options[idx].value)` — selecting a value on the *first* arrow press rather than moving a roving focus and committing on selection. Combined with `aria-checked` all-false, a screen reader announces a radiogroup with "0 of N selected" yet the first arrow silently mutates app state.
- **Root cause**: `move()` couples focus movement and selection (`onChange` + `.focus()`), which is the correct APG radiogroup pattern *only when one option is already selected*. In the unmatched/empty case it turns the first arrow into an unannounced commit; the layout pill also can't animate from a hidden state, so the first selection pops in with no shared-layout transition.
- **Impact**: An off-taxonomy `value` (model drift, a stale persisted enum) degrades the control to a state where keyboard interaction commits a value the user didn't intend to pick, with weak SR feedback. The radiogroup is the app's canonical single-select toggle, so the bug surfaces wherever a bad value flows in.
- **Fix sketch**: When `!hasSelection`, treat the first Arrow as *select option 0* explicitly (or render a neutral focus state) rather than blindly `onChange`; ensure the pill mounts at the newly-selected index without a from-hidden jump (e.g. seed `layout` so the spring animates from the button box). Keep the dev warning.

## 5. ErrorBoundary fallback copy is hardcoded English while the rest of the design system is next-intl localized
- **Lens**: 🎨 UI Perfectionist
- **Severity**: High
- **Category**: i18n consistency / brand trust of the failure surface
- **Value**: impact 6/10 · effort 4/10 · risk 2/10
- **File**: `app/_components/ErrorBoundary.tsx:51-69`
- **Scenario**: A Czech-locale user hits a panel render error. The recoverable fallback renders "Something went wrong here", "… couldn't be displayed — the data may be in an unexpected shape", and "Try again" — all hardcoded English, while neighboring primitives (ThemeToggle, PotentialBadge, LanguageSwitcher) all pull strings via `useTranslations`.
- **Root cause**: `ErrorBoundary` is a class component (required for `getDerivedStateFromError`) and `useTranslations` is a hook, so it was left un-localized rather than wiring messages through props. The `label` prop is also free English text from call sites.
- **Impact**: The error state is exactly where a user's trust is most fragile, and it breaks the bilingual design-system promise (this app explicitly ships dual-locale). An English error panel in a Czech workspace reads as broken/unpolished — a brand consistency gap on a high-reuse primitive (it wraps every tab body).
- **Fix sketch**: Pass localized strings in as props (`title`, `body`, `retryLabel`) from a thin client wrapper that calls `useTranslations`, or render the fallback via a small functional child that the class delegates to. Add an `errors` namespace to the message catalogs and have the workspace shell supply them.
