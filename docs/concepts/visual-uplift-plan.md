Status: **partially implemented.** Phase 0, Phase 1, and "Option C" (cream
canvas + composition foundation) shipped and are now simply part of the live
design system — see `docs/design/README.md` for the current token/recipe
state. Everything below Option C (Phase 2 onward) is the **remaining,
unimplemented rollout** — a proposal for follow-up work, not a description of
shipped behavior. Verified against `app/_components/ui/recipes.ts` and a
sample of feature files on 2026-07-30: `TABLE` is confirmed still absent from
`recipes.ts` (AnalyticsTab tables are still hand-rolled), consistent with
Phase 2 being unfinished. The rest of the per-item checklist below was not
individually re-verified — treat each unchecked box as "as of the last edit
to this plan," not as a live fact, and re-check the referenced file before
picking up an item.

---

# Visual uplift — closing the marketing ↔ dashboard gap

**Goal:** the dashboard interior should feel as designed as the Spark marketing
pages, without sacrificing data clarity. Grounded in three audits (design-system
inventory, dashboard weak-spot audit, marketing-portability analysis).

**Diagnosis.** The foundation is strong (tokens + recipes + dual-theme). The gap
is (1) an identity mismatch — the marketing is *Spark in a light register*, but
the dashboard's default **Studio Light** is deliberately calm; the dashboard's
Spark match is its **Dark** theme (already ~95% aligned) — so the gap lives in
**light**; and (2) consistency debt (ad-hoc spacing, surface hierarchy, washed
accents, hand-rolled chips/buttons, divergent tab headers).

**Chosen direction: Option C (aggressive).** Adopt the marketing's warm **cream
canvas + drawn-line** identity as the light theme, plus a systematic composition
pass — one spacing rhythm, ruled headers, generous padding, white panels
floating on cream. Marketing character (borderlines, dividers, paper warmth)
brought in at a *subtle* level, never literal stickers on data. The Option A
token/recipe groundwork below still applies underneath.

**Guardrails:** no hardcoded color outside `app/landing/`; everything resolves
through tokens and works in BOTH themes; don't load the hand font app-wide;
don't touch the `paper` token; never tilt/sticker-ize data-dense surfaces;
verify both themes before finishing.

---

## Phase 0 — Formalize the system  ✅ done
Levers: `app/globals.css`, `app/_components/ui/recipes.ts`.
- [x] `PANEL_SUNKEN` now `bg-stone-50` (was the near-invisible `bg-paper/40`).
- [x] New recipes: `PANEL_ACCENT`, `STAT` / `STAT_LABEL` / `STAT_VALUE`,
      `CHIP_TOGGLE(isActive)`, `BTN_GHOST`, `ICON_STICKER`.
- [ ] Declare the spacing rhythm in the design doc (section `space-y-6`,
      intra-panel `space-y-3`, eyebrow→title `mt-1`, title→intro `mt-2`) —
      convention only.
- [ ] `TAB_HEADER` wrapper + `TABLE` (th/tr/td) recipes (added when Phase 2
      needs them). **Confirmed still absent from `recipes.ts` as of
      2026-07-30.**

## Phase 1 — Studio Light confidence  ✅ done (propagating)
Token/recipe-level, so it lifts ~94 surfaces at once.
- [x] `--shadow-panel` (light) → two-layer soft elevation (contact + close
      ambient) instead of a floaty 50px blur. Auto-applies to every PANEL.
- [x] `--shadow-pop` token added (light: low-opacity offset; dark: full Spark
      offset) — for accent surfaces via `PANEL_ACCENT` / `STAT`.
- [x] `BTN_PRIMARY` light tactility — faint resting offset that presses in on
      hover (0.5px); dark keeps the harder press.
- [x] Serif display voice brought inside via `STAT_VALUE` (Fraunces numbers).
- [ ] Audit/strengthen typographic hierarchy + label casing across tab headers
      (rolls into Phase 2).

## Phase 1 — demo applied  ✅ (PipelineTab, the data-heavy exemplar)
- [x] `StatChip` → `STAT` recipe (serif value + pop shadow + crisp meta label).
- [x] Quick-filter + stage chips → `CHIP_TOGGLE` (was hand-rolled ×3).
- [x] "Screen all" button → real contrast (`border-coral bg-coral/10`, was the
      vanishing `border-coral/40 bg-coral/5`).

---

## Option C — cream canvas + composition  ✅ done (global foundation)
- [x] `--color-paper` → marketing cream `#fdf8ee` (canvas); white panels now
      float on it. Dark unaffected (overrides paper + the stone ramp).
- [x] Warm neutral ramp (`stone-50/100/200/300`) so borders/dividers/fills read
      as drawn warm lines, at ~stock lightness (no contrast/density change).
- [x] Shell content area → `bg-paper` (was `bg-white`) + roomier padding
      (`px-4 py-8 … lg:px-8`) in Workspace + WorkspaceShell.
- [x] Composition recipes: `SECTION` (space-y-8), `CARD_PAD` (p-5), `DIVIDER`,
      `PAGE_HEADER` (ruled, generously spaced).
- [x] PipelineTab recomposed onto the system (ruled PAGE_HEADER, SECTION rhythm,
      title-trio spacing) — the exemplar.

## Phase 2 — Roll composition across tabs  ⏳ open (not re-verified item-by-item)
- [ ] **Headline:** unify tab structure — header above, content in panels on
      cream. Fix the "whole tab in one white card" pattern (originally
      `JobsTab.tsx:78`, now `app/features/library/jobs/JobsTab.tsx` post
      the app-structure refactor — re-check the line); adopt `PAGE_HEADER` +
      `SECTION` everywhere.
- [ ] Migrate invisible `bg-paper`/`bg-paper/40` wells → `PANEL_SUNKEN` (now
      `bg-stone-50`, distinct from the cream canvas) — AnalyticsTab, DecisionsTab
      (now `app/features/insights/analytics/`, `app/features/hiring/decisions/`).
- [ ] Standardize card padding on `CARD_PAD`; section rhythm on `SECTION`.
- [ ] Unify tab headers on one treatment; settle "tabs are NOT wrapped in an
      outer panel" (Pipeline pattern wins) — fix `JobsTab.tsx:78`.
- [ ] Swap hand-rolled chips/toggles → `CHIP_TOGGLE`; cancel/tertiary → `BTN_GHOST`.
- [ ] Ad-hoc empty wells → `PANEL_SUNKEN` (`PipelineTab.tsx:1030`, AnalyticsTab funnel).
- [ ] Standardize form-control height (h-9) via `FIELD` (filter-bar misalignment).
- [ ] `TABLE` recipe across AnalyticsTab tables (`:363`, `:602`). **Recipe
      confirmed not yet added.**
- [ ] Accent surfaces (verdict/score banners, CTAs) → `PANEL_ACCENT`.

## Phase 3 — Contrast & accessibility  ⏳ open
- [ ] Accessible status-surface token pairs; route alerts through `Badge` tones
      (the `amber/10`-on-`amber/40` and `coral/5` fills fail luminosity contrast —
      `AnalyticsTab.tsx:239`, etc.).

## Phase 4 — Selective delight (low-risk zones only)  ⏳ open
- [ ] `ICON_STICKER` on feature/empty/verdict marks.
- [ ] Consistent `stagger-children` entrances; optional `useScrollReveal`.
- [ ] Tilt only on non-data callouts (empty states, verdict banners).

## Deferred (cost/benefit)
- Hand font app-wide (payload); warm cream canvas override — no longer
  deferred, this shipped as Option C (see above); token fragmentation risk
  noted at the time is now resolved by the warm neutral ramp.
