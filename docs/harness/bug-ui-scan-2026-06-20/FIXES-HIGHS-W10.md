# High Fix Wave 10 — week-grid table + voice-interview audio a11y

> 4 a11y findings closed in 2 commits (week-grid table semantics + 3 voice-interview gaps).
> Baseline preserved: tsc **0**, `next build` ✓, unit **1019/1019**, i18n parity (2827 keys).

## Commits

| Commit | Finding(s) | Fix |
|---|---|---|
| `78e07d4` | scheduling #2 | The week calendar was a CSS-grid of `<div>`s — SR got a flat stream of ~55 buttons with no day/time relationship and the time column was untied to cells. Added ARIA `role="table"` + row / columnheader / rowheader / cell over the existing grid (no `<table>` rewrite), labeled the table + time column, and made the horizontally-scrolling region keyboard-focusable. |
| `a5cd284` | voice #1, #2(aria-busy), #3 | (1) **Mic-permission**: an `awaitingMic` sub-state now shows "Allow microphone access in your browser's prompt" instead of a frozen "Connecting…" (the #1 first-call confusion). (2) **aria-busy** is derived from `isBusy` (was hardcoded to `connecting`, so `ending` wasn't announced). (3) **De-spam**: the live status pill was a `role="status"` live region toggling "AI speaking"↔"Listening" every turn, spamming the SR output the transcript `role="log"` already carries — now visual-only (the low-frequency phase pill keeps `role="status"`). |

## Deferred with reasons
- **Voice #2 audio mute/volume + autoplay-failure fallback** (the `<audio hidden>`): a mute on
  a load-bearing voice-interview channel is a product decision, and the autoplay-failure
  recovery cue needs catching the `play()` promise rejection and a "tap to enable audio"
  affordance — more involved than the in-scope a11y fixes. The `aria-busy` half of #2 IS done.
- **Voice #3 speaker-label prominence** — the "You / Interviewer" caption is a low-contrast
  micro-label; the *competing-live-region* half (the real spam) is fixed; making the caption
  more prominent is a visual/design tweak left for a polish pass.
- **Scheduling #1 (50 un-bookable slots)** — a *functional* dual-system bug (the recruiter grid
  offers hourly times the candidate engine rejects), not a11y; out of scope for this wave.

## Pattern catalogue additions
39. **A CSS-grid of `<div>`s needs ARIA grid/table roles to be navigable non-visually.** Add
    `role="table"`/`row`/`columnheader`/`rowheader`/`cell` over the layout — no `<table>` rewrite —
    so the spatial structure is conveyed and headers associate with cells.
40. **Don't run two competing live regions.** A `role="log"` transcript + a `role="status"` pill
    that both update per turn double-announce — pick ONE as the live channel; make the other a
    visual-only cue.
41. **A long async permission wait needs its own sub-state.** "Connecting…" that conflates
    "asking the OS for the mic" with "dialing the provider" reads as frozen — surface an
    actionable "grant the mic" hint while the prompt is open.
