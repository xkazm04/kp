# Shared UI & Design System — ambiguity-guardian + ui-perfectionist scan

> Total: 5 findings (0 critical, 1 high, 3 medium, 1 low)

## 1. ScoreDial empty-track is a hardcoded light-grey hex that ignores Spark Dark
- **Severity**: High
- **Lens**: ui
- **Category**: theme-token-bypass
- **File**: `app/_components/ScoreDial.tsx:108`
- **Scenario**: A user in Spark Dark opens a report. The hero score dial paints its filled arc segments in tokenized moss/amber/coral (which luminance-flip for dark), but every *unfilled* segment is stroked with the literal `"#e7e5e4"` — a near-white stone. On the dark `#1d2630` card the empty ring glows pale/washed, breaking the dial's register on the single most prominent number in the app.
- **Root cause**: The whole file was deliberately routed through `scoreToneColor()` "so re-toning the scale recolors the arc with no edit here" (lines 26–31), yet the unfilled-track color was left as a raw hex instead of `var(--color-stone-200)`. `stone-200` remaps to `#364453` in dark; the hardcoded value never tracks the theme.
- **Impact**: A visible, theme-wide inconsistency on the flagship verdict visual; also defeats the stated "one edit re-tones every surface" contract for the track.
- **Fix sketch**: Replace `"#e7e5e4"` with `"var(--color-stone-200)"` (or a dedicated `--color-dial-track` token) so the empty ring flips with the register like the filled segments already do. No geometry change needed.

## 2. brand.ts PAPER has drifted from the globals.css token it must mirror
- **Severity**: Medium
- **Lens**: ui
- **Category**: color-source-drift
- **File**: `app/_lib/brand.ts:20`
- **Scenario**: The OG social card, apple-icon, and raw-SVG fills read `PAPER` from `brand.ts` because those stylesheet-less surfaces can't reach the CSS tokens. `PAPER` is `#f7f5ef`, but the live canvas token is `#fdf8ee` (`globals.css:9`). Every generated PNG/SVG that uses the cream renders a subtly different, greyer background than the actual app canvas.
- **Root cause**: `brand.ts` is explicitly "the JS-side mirror of the @theme color tokens… keep these literals in lockstep" (lines 1–18), but the canvas token was retuned to the marketing "warm cream" (`#fdf8ee`, Option C) without updating the JS copy. The other eight literals still match; only `PAPER` is stale.
- **Impact**: Social/share previews and edge-rendered icons look off-brand next to the real UI — exactly the cross-file drift this module was created to prevent.
- **Fix sketch**: Update `brand.ts` `PAPER` to `#fdf8ee` to match `--color-paper`. Consider a tiny test asserting the eight brand literals equal their `@theme` counterparts so the two halves can't silently diverge again.

## 3. Sub-`text-sm` type sizes violate the design system's own "nothing below text-sm" floor
- **Severity**: Medium
- **Lens**: ui
- **Category**: typography-scale
- **File**: `app/_components/LoadStatus.tsx:52`
- **Scenario**: The type scale was deliberately floored — meta/micro were "promoted to 14 (text-sm) — nothing renders below text-sm" (`globals.css:74`). Yet the LoadStatus banner body uses `text-xs` (12px), and the PotentialBadge popover uses `text-xs` for its "transferable" label and skill chips (`PotentialBadge.tsx:75,78`). These render a step below the intended minimum, so error/detail copy is smaller than the rest of the app and inconsistent between the two LoadStatus variants (the pill correctly uses `text-micro`).
- **Root cause**: `text-xs` is a stock Tailwind size outside the app's promoted scale; it slipped in where `text-sm`/`text-micro` was intended.
- **Impact**: Slightly harder-to-read status/detail text and a visible size discontinuity, undermining the "one typographic rhythm" the scale promises — and on a11y-sensitive copy (an outage banner).
- **Fix sketch**: Swap these `text-xs` occurrences to `text-micro` (or `text-sm`) so they honor the floor. Optionally add a lint rule flagging `text-xs` in `app/**` to keep the scale enforced.

## 4. PotentialBadge disclosure can't be dismissed by outside-click/Escape and uses an off-system shadow
- **Severity**: Medium
- **Lens**: ui
- **Category**: disclosure-interaction
- **File**: `app/_components/PotentialBadge.tsx:60`
- **Scenario**: A recruiter clicks the potential chip to see the explanation popover, then clicks elsewhere or presses Escape to move on. Nothing closes it — the only way to dismiss is to click the same chevron again. In a dense candidate list, several stray popovers can stay stacked open. The panel also uses `shadow-lg` (a stock blurred Tailwind shadow) rather than the system's `shadow-panel`/`shadow-pop` tokens, so it never picks up the Spark Dark sticker re-geometry ride and reads foreign in the hard-offset dark register.
- **Root cause**: Unlike the shared `Select`/`Modal`, this popover was hand-rolled with just an `open` boolean and no outside-click/Escape/focus handling, and with a non-token shadow.
- **Impact**: Inconsistent, sticky disclosure behavior versus every other overlay in the system, plus a shadow that breaks the dual-theme look.
- **Fix sketch**: Add a document `mousedown`/`Escape` listener (or reuse the pattern from `Select`) to close on outside interaction, and swap `shadow-lg` for `shadow-panel`/`shadow-pop`. A wider viewport-edge guard on the `w-72 right-0` panel would also prevent clipping.

## 5. ScoreBadge renders the raw score, silently assuming callers pass a clean integer
- **Severity**: Low
- **Lens**: ambiguity
- **Category**: silent-assumption
- **File**: `app/_components/ScoreBadge.tsx:33`
- **Scenario**: `ScoreBadge` prints `{score}` verbatim. Every sibling score surface normalizes first — `Meter` does `Math.round`, `ScoreDial` clamps non-finite and rounds — but ScoreBadge passes the number straight through. A fractional total (`82.6`) renders "82.6" in the pill, and an out-of-range `150` renders "150" (tone still resolves via `scoreTone`, which doesn't clamp the *display*). So the one badge in the score family diverges from the app-wide rounding/clamping the `format.ts` contract otherwise enforces.
- **Root cause**: The component documents its tone mapping but never states the undocumented input contract ("caller must pass a rounded 0–100 integer"), and doesn't defend it the way `ScoreDial`/`Meter` do.
- **Impact**: A malformed or fractional score leaks a jarring "82.6"/"150" onto a hiring surface with no signal it's off — a latent papercut and a break in the family's visual rhythm.
- **Fix sketch**: Render `Math.round(clampPercent(score))` for the non-null branch (reusing the existing `format.ts` helpers), matching `Meter`/`ScoreDial`. Optionally document the 0–100-integer expectation in the component header.
