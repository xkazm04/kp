# Fixes — Med/Low sweep (2026-06-10)

> The campaign's close-out pass over the unclaimed Medium/Low backlog (the
> prior campaign's W15/W16 pattern). 7 items picked for value-per-effort,
> weighted toward seams this campaign's own waves opened.
> Gates per fix: catalogs JSON-valid where touched, tsc 0, unit 657, lint clean.
> Sweep verification: full `npm run build` PASS + `test:python` 500 OK.

## Shipped

1. **RES4** (`a50435f`) — the detected archetype rides the report's
   Add-to-pipeline ref (was hardcoded null while ArchetypeBanner announced it
   on the same page; the null had acquired real cost — rubric selection, the
   screening wave's unknown-archetype audit).
2. **RES3** (`5b5d2c2`) — history filters by recorded disposition (Any /
   Advance / Hold / Pass / Undecided). Seam from the filter bar predating the
   disposition column by one wave.
3. **ANA4** (`7e7c556`) — "Where candidates come from": per-origin
   total/interview/hired/hire-rate, origin derived from each entry's earliest
   event kind (applied/matched/added). No migration; respects the ANA2 window.
4. **ANA5** (`69feb54`) — decision-log attribution chips + kind select
   (allow-listed server-side against the shared decision-attribution map;
   keyed-remount restarts the infinite scroll) and CSV exports on the filtered
   log + the byRole table; new chrome `print:hidden`.
5. **PIPE3** (`c5bb281`) — two-way board URL sync (filter edits write back to
   the same `?q/?quick/?stage` params W9's ANA1 hydrates — closing that
   commit's explicit deferral; typing debounced, clicks immediate) + Copy-link
   on saved-view pills built from a CLEAN query string.
6. **SHELL6** (`23d606a`) — live-refresh spans browser windows via a
   feature-detected BroadcastChannel mirror; zero call-site changes, every
   existing caller (including the W9 attention badges) inherits it.
7. **SHELL4** (`df200d3`) — `g`+key tab chords (mnemonics DERIVED from
   NAV_GROUPS — a future tab gets a chord for free) + a `?` reference overlay;
   suppressed while typing and under any open dialog (`isAnyModalOpen()` now
   exported from Modal's stack).

## Deliberately NOT pursued (still open in INDEX.md)

The remaining Med/Low backlog after this sweep, for a future session's
judgment — none are blocked, all are scoped in their reports:
- **i18n tail** (13 items) — belongs to the unrun Waves 3/4, not a sweep.
- **Heavier M items needing their own session**: DEC2 advance-lead-reject-rest
  batch, PIPE2 drag-and-drop, PIPE4 owner+Mine filter, AUTO4/AUTO5 policy
  config + per-candidate pause, SCH2/SCH3 booking lifecycle, SCOR4 per-stage
  analyze progress (the bug-hunt CV#7 deferral), SCOR5 probe briefs, VOX2/VOX3
  invite funnel + rehearsal, PROF4/PROF5/PROF6, CV2, APP2/APP3, MAT4,
  DEVP4, DEVO4/DEVO6, SIM5/SIM6.
- **Lows judged below the line**: GH6 evidence link verification (network
  verification machinery for a Low), DEVS6, PREP4, MAT3 link half, RES4 is
  done, DEC6-class calibration items.

## Patterns worth keeping (→ harness-learnings)

1. **A sweep's best targets are the seams the campaign itself opened** — five
   of seven items here existed because two correct findings shipped in
   different waves (filter bar before disposition; hydration before
   write-back; attribution map before its filters).
2. **Derived mnemonics/chords beat hand-listed ones** (SHELL4): deriving from
   the canonical NAV_GROUPS means a new tab can't ship without a shortcut.
3. **A same-name channel never receives its own posts** (SHELL6) — the
   BroadcastChannel mirror needs no origin-dedup; the existing debounce
   coalesces the rest.
