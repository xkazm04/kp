---
name: prototype
description: Iteratively prototype a UI surface through directional variants behind a tab switcher, then consolidate and refactor the winner. Use when the user wants to master a component/page they consider a pillar of the app (visual appeal, creativity, UX clarity).
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Agent
---

# Prototype — Directional Variant Workflow (kp)

A disciplined A/B prototyping loop for refining a UI surface. Start from a named file (or a new surface), produce radically different **directional** variants behind a tab switcher, let the user prune/fuse across rounds until one direction wins, then consolidate + refactor. The guardrails below exist to cut the number of rounds needed.

This is the kp-tuned copy of the workflow. It replaces the generic examples with kp's actual design system, token vocabulary, reference surfaces, and commands.

---

## When to use

The user says things like "help me master this component", "prototype ideas on top of X", "this is a pillar of the app and I want it to be amazing", "design an experience with me", or "iterate until we reach an amazing result". The request carries an **open direction** and a **visual quality bar**, not a specific change list. A *new* surface (a page that doesn't exist yet) is in scope too — you just skip "verify the rendered file" and scaffold the switcher fresh.

## When NOT to use

- Fixed-scope requests ("change the button color to coral") — just edit.
- Bug fixes.
- Non-visual code (business logic, API routes, the pipeline, the DB layer).
- User asks for "three layouts" but wants them all shipped — that's a build task, not prototyping.

---

## kp house rules that override the generic workflow

1. **Dual theme is non-negotiable.** Every surface ships in **Studio Light** (default) AND **Spark Dark** (`[data-theme="dark"]` on `<html>`, flipped by `ThemeToggle`). Read `docs/design/README.md` before building UI. **Never hardcode colors** (`bg-[#...]`, inline `style` colors, rgba shadows) outside `app/landing/` — that folder is the only exemption. Verify every variant in both themes before you call a round done (toggle in the sidebar footer).
2. **Compose from recipes, don't retype Tailwind.** Recurring surfaces come from `app/_components/ui/recipes.ts` (`PANEL`, `PANEL_ACCENT`, `CARD_PAD`, `PAGE_HEADER`, `EYEBROW`, `TITLE_DISPLAY`, `INTRO`, `FIELD`, `CHIP`, `CHIP_TOGGLE`, `BTN_PRIMARY`, `BTN_SECONDARY`, `BTN_GHOST`, `STAT`, `TOGGLE_GROUP`, `KBD`, …). Behavioral primitives live in `app/_components/` (`Modal`, `Badge`, `ScoreBadge`, `SegmentedControl`, `Skeleton`, `Toast`). **Import these — do not hand-roll selects, toggles, modals, badges, or empty states, and don't copy a baseline's hand-rolled version forward.** If the baseline uses a raw element, upgrade it in the variants.
3. **Express a theme difference at the cheapest layer that holds it:** token → a `dark:` variant in a recipe (the `dark:` variant follows `data-theme`, not the OS) → markup fork via a CSS-swapped component like `app/_components/ui/SectionTitle.tsx` → behavioral fork via `useTheme()` (`app/_components/ui/useTheme.ts`). Never a JS fork where CSS suffices.

---

## Coordination

kp is normally a single-CLI-session repo — there is no `active-runs.md` ledger to register in. Two lightweight rules still apply:

1. **Don't clobber unrelated local edits.** If a file shows as `M` in `git status` and it isn't part of your prototype scope, do not write to it. Stage per-file with `git add <path>` — never `git add -A`/`.`/`-u`.
2. **Atomic commits per round.** One commit per round of variants, one per pruning decision, one per consolidation. Only commit when the user asks (repo convention). The per-round history is the record of what was tried.

If the user is running multiple sessions and asks for isolation, offer a worktree (`git worktree add .claude/worktrees/prototype-<name> -b wt-prototype-<name>`), but don't default to it.

---

## Step 0: Collect the starting surface

If the user already named a concrete path or an unambiguous surface in the same turn (e.g. "SimBar", "the Organization page"), use it. Otherwise ask **one short question** and wait:

> "Which surface should I prototype on? Paste a path (e.g. `app/features/sub_pipeline/PipelineTab.tsx`) or name the page."

Don't guess from vibes — picking the wrong file wastes whole rounds. If the surface is new (doesn't exist yet), confirm the target folder and the feature it belongs to, then go straight to Phase 2.

---

## Phase 1: Verify the actually-rendered component

**Don't trust the filename.** The file the user named may not be what renders.

1. Read the named component.
2. Grep for JSX usage (`<{Name}\b`) and imports (`from ['"].*{Name}['"]`).
3. If it has **zero JSX usages**, it's a library/re-export file. Find the one that renders — in kp, most feature views are tabs mounted in `app/features/Workspace.tsx` (the `navActive === "…" ? <XTab /> : null` ladder), and deep-link pages reuse them. Server-rendered token pages live under `app/<route>/[token]/`.
4. **Confirm in one sentence** before proceeding: "The named file re-exports helpers; the rendered surface is X — prototyping on X. OK?"

For a brand-new surface, skip to Phase 2 and note where it will mount (which tab in `tabs.ts` + `Workspace.tsx`, or which route).

---

## Phase 2: Scaffold the tab switcher

Goal: a top-of-surface tab strip that lets the user A/B between variants without forking call sites.

1. Rename the current exported function to `{Name}Baseline` (internal, same file) — or, for a new surface, just create the host.
2. Re-export the original name as a wrapper that holds a `variant` state, renders a small labelled tab strip (label + 1-line subtitle each), and delegates the body to the active variant. Every variant takes the **same Props** the surface already uses — consumers stay untouched.
3. Keep the baseline as the default tab so nothing changes on load.
4. Prefer the shared `SegmentedControl` (`app/_components/SegmentedControl.tsx`) for the switcher if it fits; otherwise a ~15-line strip is fine. The scaffold is throwaway — don't over-engineer it.

---

## Phase 3: Generate 2 **directional** variants

### 3a. Ground the variants in kp's actual quality bar (do this every time, in order)

1. **Read `docs/design/README.md`** and skim `app/globals.css` for the live token set. Use the **brand tokens first** (`ink`, `paper`, `steel`, `coral`, `moss`, `limewash`, `dial-*`, `score-*`), then the theme-remapped neutrals (`white`, `stone-50..400`) and the mapped status shades (`red`/`amber`/`green`/`blue` — only shades already in the `[data-theme="dark"]` block; add the dark value when introducing a new one). Raw `bg-violet-500/15` / `text-amber-300` (a shade with no dark mapping) is a tell.
2. **Read the recipe catalog** `app/_components/ui/recipes.ts` before building any widget, and check `app/_components/` for a behavioral primitive before hand-rolling one. Canonical swaps: dropdown → don't use a raw `<select>` (OS-styled options ignore the theme); toggle/segmented → `SegmentedControl` or `TOGGLE_GROUP`; text field → the `FIELD` recipe; badge/pill → `Badge`/`ScoreBadge`/`CHIP`; surface → `PANEL`/`PANEL_ACCENT`; page chrome → `PAGE_HEADER`/`EYEBROW`/`TITLE_DISPLAY`/`INTRO`.
3. **Mine one or two sibling surfaces that exemplify the bar.** Strong kp references: `app/features/sub_analyze/AnalyzeWorkspace.tsx` (the segmented-control motion standard — framer shared-layout pill + AnimatePresence crossfade, reduced-motion gated), `app/features/sub_pipeline/PipelineTab.tsx` (dense dashboard), the guided `app/features/simulation/` bar/spotlight, and the `app/landing/` art direction (Spark Dark's origin — drawn outlines, sticker shadows, tilt, Bricolage display face). **If the user names an inspiration surface, treat it as authoritative** and mine it even if filenames don't match.
4. **Extract three things from each reference:** (a) *layout shape* (header band + panels + footer?); (b) *motion language* (what animates on mount vs. never; is there decorative SVG?); (c) *typography + data patterns* (what's `font-serif text-display`/`text-h2`, where uppercase-tracked `text-meta` labels are used, how status is shown via tokens/`Badge`).

Skip this and round 1 gets thrown away wholesale. Spend the tool calls.

### 3b. Directional variants

The critical word is *directional*. A variant is not "baseline with spacing tweaked" — it's a completely different **mental model** for the same data. Good directional pairs for kp:

- **editorial / identity** (brand-forward, `font-serif` display headings, monogram, warm roster) + **console / ledger** (data-dense admin table, invite row, role selects, status column)
- **journey / narrative** (linear step-by-step, one decision per screen) + **cockpit / dashboard** (everything visible at once, dense panels)
- **guided footer bar** (persistent bottom stepper, the SimBar lineage) + **spotlight wizard** (centred overlay, vertical rail, one step per screen)

Each variant earns its name by carrying a **single central metaphor** through layout, typography, motion, iconography, and copy voice.

Deliverables per variant:
- File: `{Name}{Variant}.tsx` in the same folder (a short domain-named folder like `sub_organization/` or `setup/` for a new surface).
- A short header comment: the metaphor + why it differs from baseline.
- Reuse shared primitives and recipes — don't reinvent form widgets.
- Degrade gracefully for the edge cases the baseline handles (empty lists, loading, error, locked/permission states).
- **Prefer data-concrete symbols over abstract markers.** Real recruitment data (a candidate's match score via `ScoreBadge`, a role's seniority chip, a pipeline stage, a locale flag) beats a coloured presence dot. The user scores a variant partly on "does this encode *real* data the user already cares about?"
- **Design for extraction.** Name sub-components (`OrgIdentityCard`, `MemberRow`, `StepRail`) that could live elsewhere — a monolithic `.tsx` with no extractable pieces may be killed on reusability grounds even if it looks good.
- **Answer "what am I working with?" and "what did I gain?" in round 1.** If the user is picking nouns (members, roles, candidates), the affordance must show the meaningful facts they'd need to decide (role, last-active, status) — not a name + decorative icon. If the surface produces a result, each result must carry signal about why it matters.

**Two variants in round 1. Not three.** More = analysis paralysis; the user picks a direction by round 2 anyway.

---

## Phase 4: Iterate by subtraction and fusion

After round 1 the user will usually reject one outright, pull a strong element from one into another, or give specific feedback on the leader.

- **Rejection → delete immediately** (file, import, tab entry). Dead code distracts future rounds.
- **Fusion → extract the strong element, merge into the keeper at the position specified, delete the source.** The live tab count should shrink round-over-round — a good signal.
- **Specific feedback → apply inside the chosen variant.** Do NOT spawn a new variant for a fix; the user asked for refinement, not more options.
- **Add a new variant only when explicitly asked** ("create a new variant with X direction").
- **Hoist shared pieces mid-prototype, not only at refactor time.** The moment two variants render the same structure, extract the shared sub-component and let both import it — waiting doubles every later tweak.

End each round with an **explicit menu** of what changed, then ask for the next move. Don't auto-advance.

---

## Phase 5: Declare the winner and consolidate

Triggers: "this is the one", "promote X to default", **"set X as the production baseline"**, "X becomes our go-to". The last two authorise cleanup beyond the prototype variants.

1. Stop iterating.
2. Make the winner the default tab, OR remove the switcher entirely and render only the winner.
3. Delete non-winner variants from disk and imports. If the trigger was "production baseline"-strength, extend cleanup to *legacy variants on the same surface* the user is now willing to cut — ask once if unsure; never delete silently.
4. Run `npm run typecheck` (`npx tsc --noEmit`) to confirm no dangling references.
5. **Do NOT refactor here** — refactor is a separate, explicit request. Premature refactor destroys diff visibility while the user is still evaluating.

Exit with: one file/component, typecheck clean, both themes verified, the user can reload and see the winner live.

---

## Phase 6: Refactor (only on request)

When the user asks (e.g. "split into files, max ~200 LOC each, under a subfolder"):

1. **Mirror a sibling folder** first. kp features live under `app/features/sub_<domain>/`; match the neighbours' conventions (co-located `.tsx`, a `constants.ts`/`types.ts` if the domain has them, a `.test.ts` for pure logic).
2. Split by responsibility, most-valuable-to-extract first: **types** → **pure helpers** → **hooks** → **leaf components** (cards, chips, rows) → **pane components** → **main orchestrator** (state + layout only) → optional barrel.
3. LOC cap is a guideline, not a rule (~200 is a useful forcing function).
4. `Grep` for every import site before moving anything — don't assume one consumer. In kp the consumer is usually the `dynamic(() => import(...))` line in `Workspace.tsx` plus any deep-link page.
5. Keep sibling re-exports (shared constants/helpers used elsewhere) stable.
6. Typecheck once at the end.

---

## Guardrails (learned the hard way)

### Watch for external reverts
Linters, format-on-save, or a concurrent session can revert writes. After a significant Write, watch the next tool result for `Note: <file> was modified…` markers that contradict your change; if so, re-apply (don't re-argue). Reverts accumulate — if the user says "something reverted my progress", grep to enumerate what's missing, then re-apply the whole round's wiring (import + type + tab entry + render branch) in one batch.

### Don't touch files outside the prototype scope
Apply edits as tight, single-line diffs so unstaged work is preserved. A file shown as `M` that you didn't intend to change is a red flag.

### Typography is a recurring quality axis
Lean toward `text-base`/`text-body` for readable copy. Reserve `text-meta` / `text-xs` for uppercase tracking-wide labels only. Never use pixel-valued arbitrary sizes (`text-[10px]`) in a shipped variant — that's prototype-grade. **Brighter, not muted:** promoting copy means removing opacity muting too (`text-steel` → `text-ink`, `font-normal` → `font-medium`), not just bumping size.

### Animation austerity
Always-on motion reads as noise and gets rejected. Avoid in shipped variants: `repeat: Infinity` / `infinite`, SVG `<animateMotion>`/scan lines/drifting particles, ambient rotations, and `hover:-translate-y-*` on cards (moving geometry on hover reads as aggressive). Welcome: entry fades (once on mount), hover-gated colour/shadow/border transitions, click-gated state transitions, `AnimatePresence` for specific mount/unmount. kp already has a house motion standard — the framer shared-layout pill + reduced-motion gate in `AnalyzeWorkspace.tsx`; match it. Rule of thumb: if the user would see the animation after leaving the screen idle, cut it.

### framer-motion on SVG `cx`/`cy`/`r` — animate transforms instead
Animating raw `animate={{ cx, cy, r }}` on a `motion.circle` can render `"undefined"` mid-mount and throw DOM errors. Wrap position in a `motion.g` and animate `x`/`y` (children stay `cx={0} cy={0}`); for a size pulse keep static `r` and animate `scale`. Safe to animate directly: `strokeDashoffset`, `pathLength`, `opacity`, and any transform.

### Don't use `useMemo` for side effects
`useMemo(() => { …setX() }, deps)` is wrong — it sets state during render. Use `useEffect`. Before each variant-write/consolidation, grep your own output for `useMemo\(.*set[A-Z]`.

### Reduced motion + i18n
Gate every animation behind `motion-reduce:` (or a reduced-motion check) — kp does this everywhere. Prototype copy can be plain English; the `nav` catalog falls back to the English label for a not-yet-translated tab, so a new nav entry works without a translation. Ship-quality consolidation should thread `useTranslations` and clear the `i18n:check`/eslint-plugin-i18next warnings, but incremental i18n warnings are acceptable *during* prototyping.

---

## Signals the iteration is converging

**Green:** tab count decreasing (2 → 1); feedback shifting from "wrong direction" to "tweak this specific thing"; the user names the winning metaphor positively; the user gives layout-level specifics (rail width, stacking, keyboard nav).

**Red → reset direction:** wholesale rejection round after round; the user restates the baseline as their preference; variants are being asked to back-port features the baseline already has.

---

## Exit checklist

- [ ] Winner is the default rendered component.
- [ ] All non-winner variants deleted from disk, imports, and tab configs.
- [ ] `npm run typecheck` clean on touched files (pre-existing unrelated errors ignored).
- [ ] Both themes verified (Studio Light + Spark Dark) — no hardcoded colors outside `app/landing/`.
- [ ] Lint audited — incremental typography/spacing/i18n warnings acceptable; 0 errors.
- [ ] Consumer import paths still resolve (grep the old filename → zero references).
- [ ] If refactored: subfolder mirrors a sibling, barrel/exports stable, file sizes within budget.

When every box is checked, summarize the journey in 1–2 sentences (which metaphor won, what it does differently) — that line is what the user quotes in the PR/changelog.
