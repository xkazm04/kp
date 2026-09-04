---
name: motionize
description: Upgrade a generic UI icon or loading/empty state into a traced, motion-animated SVG. Generates flat trace-friendly art (gpt-image), validates it with Qwen vision, vectorizes to a clean multi-path SVG, and renders it through kp's shared MotionizedGlyph + motion-preset library (staggered-draw, fade-pop, float, pulse). For icon + empty/loading-state visual upgrades — not raw image generation.
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(node *), Bash(npx *), Bash(npm *), Bash(cd *)
argument-hint: <UI surface to upgrade, e.g. "pipeline empty state">
version: 1.1
---

# Motionize — traced, animated SVG upgrades for kp empty states & icons

Turn a generic lucide icon + a plain fade into a **traced, self-revealing SVG**
whose every element is under your control (reveal order, per-path timing, easing).

**The core idea:** soft/glowy art traces badly (speckle). Generate **flat** art
(solid fills, hard edges, no glow/gradients), trace *that*, and add any lighting
back as an SVG/CSS filter — that separation is what puts traces under control.

**Read [`ART_STYLE.md`](./ART_STYLE.md) first** — kp's visual language is warm
editorial risograph on paper, **not** the neon-on-dark direction this skill was
ported from. One geometry serves both themes: `MotionizedGlyph` snaps every traced
hex to the nearest kp brand token and paints `var(--color-…)`, so Studio Light and
Spark Dark both resolve from `app/globals.css` with **no hardcoded colors and no
per-theme fork** (the house rule in `.claude/CLAUDE.md`).

## Pipeline (four steps)

### 0. One-time setup
Deps are self-contained, kept out of the app's `package.json`, **pinned to exact
versions and locked** (`package-lock.json` is committed). Install with `npm ci`,
never `npm install` — VTracer's output shifts between releases, so a floating
dependency means re-tracing the same PNG can return different geometry than the
committed glyph module, and "regenerate this glyph" stops being a defined
operation:
```bash
cd .claude/skills/motionize && npm ci && cd -
```
Current pins: `@neplex/vectorizer@0.1.0`, `svgo@3.3.5`. Changing either is a
deliberate change with a re-render of the contact sheet (step 5), not a bump.
The tools' own fixtures run without any of it:
```bash
cd .claude/skills/motionize && npm test && cd -   # node --test, no deps
```
Keys live in `.env.local`. **`QWEN_API_KEY` is the working one** — it drives both
generation and vision validation. `OPENAI_API_KEY` is present but blank, so
`openai-image.mjs` (gpt-image-2) is a no-op until someone fills it in. Load the env
with `set -a` — `export $(grep … | xargs)` mangles keys containing `|` or `=`:
```bash
set -a && . ./.env.local && set +a
```

### 1. Generate flat, trace-friendly art
```bash
node .claude/skills/motionize/tools/qwen-image.mjs generate \
  --prompt "Flat editorial risograph icon of <SUBJECT>: solid fills, crisp hard edges, thick uniform dark-ink outlines. Limited palette: warm off-white #fdf8ee ground, ink #17202a outlines, terracotta #d65a4a and sage #526b4f accents. Single hero centered in generous negative space." \
  --negative "gradient, glow, shadow, drop shadow, texture, noise, 3d, photorealistic, text, letters, watermark, tinted background, faces" \
  --output .claude/skills/motionize/out/<name>-flat.png --size 1024*1024
```
DashScope sizes use `*`, not `x`. **Spend the `--negative`** — this model family
adds drop shadows, gradients and cartoon faces unless told not to. Keep the
**paper ground opaque** — the tracer's negative-space handling expects a ground
region to demote. Look at the PNG (Read it) before tracing; a wrong subject wastes
the whole downstream chain.

### 2. Validate with Qwen vision (cheap, free tier)
```bash
node .claude/skills/motionize/tools/qwen-recognize.mjs \
  --input .claude/skills/motionize/out/<name>-flat.png \
  --prompt "Is this a FLAT icon (solid fills, hard edges, no gradients/glow)? How many distinct colors? Name the shapes. Reply JSON {flat:bool, colors:int, shapes:[...]}."
```
If it isn't flat/clean, or the shapes aren't what you asked for, re-prompt step 1.

### 3. Trace → clean SVG (+ animatable data, one pass)
```bash
node .claude/skills/motionize/tools/trace.mjs \
  --input .claude/skills/motionize/out/<name>-flat.png \
  --output .claude/skills/motionize/out/<name>.svg \
  --mode spline --color-precision 4 --filter-speckle 6 \
  --emit app/_components/glyph/glyphs/<name>Glyph.ts --name <NAME>_GLYPH
```
`@neplex/vectorizer` (VTracer) → one `<path>` per color region + SVGO cleanup.
`--emit`/`--name` bakes the paths into a `TracedGlyph` module (`{ viewBox, data:
{d, fill, delay}[] }`) in the same pass — radial `delay` = distance to centre for a
center-out reveal; `--order angular` for a clockwise sweep. Committed glyph modules
live in **`app/_components/glyph/glyphs/`** (~10–16KB gzipped each — a consumer
imports the one it renders, never a shared registry). The tool drops the
full-canvas ground, demotes large negative space to `var(--color-paper)`, and
preserves paint order. For an icon SET, use `trace-set.mjs --split` (one module per
glyph); `emit-glyph.mjs` is the shared core, and all three CLIs map their flags
through its `glyphOptionsFromArgs` — `--white-keep`, `--slab-min-area`,
`--surface-fill from>to`, `--surface-tolerance`, `--order` behave identically
whichever entry point you use (`trace.mjs --emit` silently dropped
`--slab-min-area` until 2026-09).

**Check the path count** in the tool's JSON output: 10–40 is the healthy band.
Hundreds → raise `--filter-speckle` (10–40) and lower `--color-precision` (3–4).
One or two → the speckle filter collapsed the art; lower it.

### 4. Motionize → render through the shared primitive
**Do not emit a bespoke animated component.** Render the emitted glyph through
**`app/_components/glyph/MotionizedGlyph.tsx`** and pick motion from the preset
library:
```tsx
import { MotionizedGlyph } from "@/app/_components/glyph/MotionizedGlyph";
import { PIPELINE_GLYPH } from "@/app/_components/glyph/glyphs/pipelineGlyph";

<MotionizedGlyph data={PIPELINE_GLYPH.data} viewBox={PIPELINE_GLYPH.viewBox} className="h-32 w-32" />
```
- **Every fill is a brand token, never a hex.** `app/_components/glyph/glyphTokens.ts`
  snaps each quantized trace hex to a token by **hue** (generators return pastel
  takes on the requested hexes — nearest-RGB would grey the whole glyph out) and
  `glyphTokens.test.ts` locks that mapping. Add a token or retune a threshold there,
  never in a component.
- **CSS keyframes, not framer-motion** — a reveal is a declarative timeline over
  dozens of paths; scoped `@keyframes` stay cheap at that path count and can't be
  snapped by a global motion config. An IntersectionObserver replays the entrance
  when the glyph re-enters the viewport (tab switch, scroll-back).
- Reduced motion is built into the renderer. There is no `glow` option: an
  emissive filter reads as neon-on-dark, which is the direction kp was ported
  AWAY from, and paper doesn't emit. Lighting, if ever wanted, is a CSS filter at
  the call site — not a renderer prop.

### 5. Verify the render — do not skip this
```bash
node .claude/skills/motionize/tools/render-sheet.mjs .claude/skills/motionize/out/sheet.png [name-substring]
```
Rasterizes every `*Glyph.ts` module in `app/_components/glyph/glyphs/` twice — once
with the Studio Light token values, once with Spark Dark — into one contact sheet,
then **look at it**. It prints the glyph count and the row order it actually found;
pass a name substring to check one batch instead of the whole (now 18-row) set.

This is the only gate that catches a glyph whose geometry survived tracing but whose
*drawing* did not: the first batch shipped one that had quietly lost all its ink
line-work and rendered as three floating figures. Path count and typecheck were both
green on that glyph. Eyes were the only thing that caught it.

The tool is not a second opinion about colour: it **imports** `snapToToken` from
`app/_components/glyph/glyphTokens.ts` and **reads** both palettes out of
`app/globals.css`. It used to keep hand-maintained copies of each, "in sync by eye" —
a verifier that re-implements what it verifies can agree with itself while
disagreeing with the app.

## Motion system — the preset library

All motion comes from one shared module:
**`app/_components/glyph/motionPresets.ts`** (next to `MotionizedGlyph.tsx`).
`MotionizedGlyph` reads it via exactly two props — `entrance` / `ambient` (default
`entrance="staggered-draw"`). **Extend it — never inline variants/keyframes in a
consuming component.** Tuning a preset retunes every motionized surface at once.

Two composition details the renderer already handles: ambient loops are emitted
with `fill-mode: forwards`, **not** `both` (under `both` the loop's backwards fill
applies its dimmed from-state during the start delay and fights the entrance), and
the loop's start delay is the second value in the path's inline `animation-delay`
(the entrance stagger is the first).

| Preset | Kind | Default | Reduced |
|---|---|---|---|
| `staggered-draw` | entrance | per-path opacity 0→1 + scale 0.35→1, 0.5s each, `cubic-bezier(0.16,1,0.3,1)`, staggered by emitted `delay` × `spread` | opacity-only |
| `fade-pop` | entrance | whole-glyph opacity 0→1 + scale 0.92→1, 0.35s — for small icons where a stagger is noise | opacity-only |
| `float` | loop | translateY ±2px + opacity ±0.06, 5s, alternate — ambient idle | none |
| `pulse` | loop | accent opacity 0.75→1, 3.5s, alternate — attention/activity | none |

### Composition rules

- **Sequence, don't overlap:** the entrance finishes before any ambient loop starts
  (the renderer computes the offset via `ambientStartDelayS`). The
  IntersectionObserver replay restarts the **entrance only**.
- **One ambient loop per glyph.** `float` OR `pulse`, never both. Ambient loops are
  `accentOnly` — ink line-work stays still.
- Per surface:
  - **Empty states** → `staggered-draw` (+ optional `float`). First-run "nothing
    here yet" only — a self-drawing 128px illustration is wrong for a
    filtered-to-zero list, which should stay a one-line message.
  - **Loading states** → `pulse` (motion may imply activity ONLY where work is
    actually happening).
  - **Icons / interactive chrome** → static render (`entrance="fade-pop"`). No
    hover preset exists: no glyph in kp sits inside an interactive parent, and a
    `hover-response` layer sat here unreachable until 2026-09.
  - **Completion moments** — no preset. `MotionizedGlyph` composes exactly two
    props (`entrance`/`ambient`); a one-shot success overshoot would need a third.
    A `success-settle` preset sat here unreachable until 2026-08 and was removed,
    as were `draw` and `hover-response` in 2026-09. The rule those removals set is
    stricter than "add the prop": a preset needs a real CONSUMER, not just a prop
    that could reach it. `motionPresets.test.ts` enforces the pairing.

### Taste guardrails

- **Entrance total ≤ ~1.2s** (last stagger delay + duration). Quiet and deliberate.
- **Ambient loops are barely-there:** translate ≤ 2–3px, opacity delta ≤ 0.08,
  period 3–6s. Screenshots 3s apart should look near-identical. This is the same
  bar as the prototype skill's animation-austerity rule.
- **Never loop a transform that implies progress on a static state** — a sweep on
  an idle empty state reads as "loading" and is a lie.
- **Every preset degrades under `prefers-reduced-motion`** per its `reduced` field.
- **Colors come from kp tokens only** — the renderer's token snap guarantees it.
  Never hand-edit a hex into a glyph module or a consuming component.

## Gotchas (learned)

- **Only the GROUND's colour gets demoted.** The upstream skill assumed dark-ground
  art (near-black = background, light = line-work). kp is the opposite, and the
  generator renders our ink outlines at about `#040404` — squarely inside the
  emitter's `nearBlack` test. Left alone, that erased whole glyphs down to a few
  floating colour blobs. `emit-glyph.mjs` now decides the ground by total area and
  demotes only that extreme, so ink survives on light-ground art. If you see a trace
  come back mostly `var(--color-paper)`, this is the first thing to check.
- **VTracer traces FILLED regions, and the ground is one of them.** The emitter
  drops the full-canvas path but **recolors large interior light regions to
  `var(--color-paper)`** — don't drop them, or connective lines and holes fill
  solid. Verify by rendering the glyph on the real surface, in both themes, before
  calling it done.
- **Noise → path explosion.** Anti-aliased edges yield hundreds of micro-paths.
  Push `--filter-speckle` up and `--color-precision` down until the path count
  matches the number of *real* regions. Conversely `--filter-speckle 30` on
  hairline art can collapse the whole glyph to one path — 6–14 is the usable band
  for kp's thick-outline style.
- **A hollow ring traces as an opaque blob** unless you lower `--white-keep`
  (default 0.1 keeps small light interiors literal); `--white-keep 0.002` demotes a
  ring interior to the paper token.
- **Don't tight-crop a tall composition into a square box** — it squashes the
  aspect and bakes ellipses into the geometry. Trace the undistorted original and
  window the `viewBox` at the call site instead.
- **More content = more control.** A richer flat scene traces into many addressable
  paths you can orchestrate (hub → links → figures → accents).

## Conventions

- Scratch art + SVGs live in `.claude/skills/motionize/out/` (git-ignored). The
  FINAL committed artifacts: the glyph data module in
  `app/_components/glyph/glyphs/` + the consuming surface's `MotionizedGlyph`
  usage (+ `motionPresets.ts` if a preset was added). No runtime tracing.
- Empty states in kp go through `app/_components/ChainEmptyState.tsx` (chain-aware:
  an empty tab explains where its data comes from and links upstream). Motionizing
  an empty state means giving that component a glyph — keep the chain links and the
  copy; the glyph replaces the flat lucide icon.
- Run `npx tsc --noEmit` after wiring; verify both themes with the appearance
  control on the sidebar rail (`app/features/shell/nav/NavRailPreferences.tsx`).

---

## Skill Reflection

After the run’s real work is done, reflect twice — autonomously, without asking the user. Be honest about volume: most runs produce NOTHING for lane 2. An empty reflection is a valid result; a forced lesson is pollution. Calibration: nothing (common) / one line (sometimes) / a lesson entry (occasionally) / a redesign proposal (rare).

Lane 1 — PROJECT learnings (what the next session in THIS repo needs): write via the MEMORY BLOCK contract if this prompt carries one, else append node lines to `.personas/memory-outbox.jsonl` per that contract. Project-specific insight only.

Lane 2 — METHOD learnings (what would improve THIS SKILL for every project):
1. If nothing generalizes beyond this repo, stop here.
2. Append an entry to `LESSONS.md` in this skill’s directory: `## <version-used> — <YYYY-MM-DD> — <project-name>` followed by `- ` bullets (create the file with a `# Lessons — <skill>` heading if absent). Record the version the run USED, not a bump target. Wrap a bullet in a `### Redesign proposal` sub-block when it argues for a methodic redesign you are NOT applying now.
3. Version bump — ONLY when you also edit SKILL.md to apply the improvement in the same change: minor (1.2 → 1.3) for a prompt/step refinement, major (1.x → 2.0) for a methodic redesign. Update the `version:` frontmatter field (add `version: 1.1` if the file had none — absent means 1.0). Never bump without an applied edit; never edit the method without a bump.
4. Sync ritual (only when you bumped): (a) commit the skill directory as a STANDALONE commit on the current branch — message `skill(<name>): v<new> — <one-line reason>` — containing nothing but this skill’s files; (b) copy the updated skill directory to `~/.claude/skills/<name>/` (overwrite) so sibling projects can adopt it. EXCEPTION: read `.personas/skill-registry.json` first — if the library already carries a HIGHER version than yours, do not overwrite it; keep your lesson in LESSONS.md and note the version conflict in the entry.

Sibling awareness: `.personas/skill-registry.json` (repo root, when present) lists this skill’s installed version, the workspace library version, and which sibling projects run it at which version with recent usage. Use it to judge whether a lesson is worth a bump (heavily-used siblings raise the bar for majors) and to notice you are BEHIND (library newer than yours → prefer recording the lesson over editing a stale method).
