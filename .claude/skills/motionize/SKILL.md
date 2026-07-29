---
name: motionize
description: Upgrade a generic UI icon or loading/empty state into a traced, motion-animated SVG. Generates flat trace-friendly art (gpt-image), validates it with Qwen vision, vectorizes to a clean multi-path SVG, and renders it through kp's shared MotionizedGlyph + motion-preset library (draw, staggered-draw, fade-pop, float, pulse, hover-response, success-settle). For icon + empty/loading-state visual upgrades — not raw image generation.
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(node *), Bash(npx *), Bash(npm *), Bash(cd *)
argument-hint: <UI surface to upgrade, e.g. "pipeline empty state">
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
Deps are self-contained, kept out of the app's `package.json` (already installed;
re-run if `node_modules/` is missing):
```bash
cd .claude/skills/motionize && npm install && cd -
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
glyph); `emit-glyph.mjs` is the shared core.

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
- Reduced motion and the optional emissive `glow` filter are built into the
  renderer. `glow` reads best in Spark Dark and is usually **wrong** in Studio
  Light — paper doesn't emit.

### 5. Verify the render — do not skip this
```bash
node .claude/skills/motionize/tools/render-sheet.mjs .claude/skills/motionize/out/sheet.png
```
Rasterizes **every** committed glyph twice — once with the Studio Light token values,
once with Spark Dark — into one contact sheet, then **look at it**. This is the only
gate that catches a glyph whose geometry survived tracing but whose *drawing* did
not: the first seven-glyph batch shipped one that had quietly lost all its ink
line-work and rendered as three floating figures. Path count and typecheck were both
green on that glyph. Eyes were the only thing that caught it.

## Motion system — the preset library

All motion comes from one shared module:
**`app/_components/glyph/motionPresets.ts`** (next to `MotionizedGlyph.tsx`).
`MotionizedGlyph` reads it via `entrance` / `ambient` / `hover` props (default
`entrance="staggered-draw"`). **Extend it — never inline variants/keyframes in a
consuming component.** Tuning a preset retunes every motionized surface at once.

Two composition details the renderer already handles: ambient loops are emitted
with `fill-mode: forwards`, **not** `both` (under `both` the loop's backwards fill
applies its dimmed from-state during the start delay and fights the entrance), and
the loop's start delay is the second value in the path's inline `animation-delay`
(the entrance stagger is the first).

| Preset | Kind | Default | Reduced |
|---|---|---|---|
| `draw` | entrance | `pathLength` stroke trace, 0.9s, ease-out — **stroke/`--mono` traces ONLY** (on fills it traces the boundary, messy) | opacity-only |
| `staggered-draw` | entrance | per-path opacity 0→1 + scale 0.35→1, 0.5s each, `cubic-bezier(0.16,1,0.3,1)`, staggered by emitted `delay` × `spread` | opacity-only |
| `fade-pop` | entrance | whole-glyph opacity 0→1 + scale 0.92→1, 0.35s — for small icons where a stagger is noise | opacity-only |
| `float` | loop | translateY ±2px + opacity ±0.06, 5s, alternate — ambient idle | none |
| `pulse` | loop | accent opacity 0.75→1, 3.5s, alternate — attention/activity | none |
| `hover-response` | hover | scale 1→1.03, 0.18s — a `transition` on the group, not an animation | no transform |
| `success-settle` | oneshot | scale 1→1.12→1 overshoot, 0.42s, `cubic-bezier(0.34,1.56,0.64,1)` — fires once on completion, never loops | opacity-only |

### Composition rules

- **Sequence, don't overlap:** the entrance finishes before any ambient loop starts
  (the renderer computes the offset via `ambientStartDelayS`). The
  IntersectionObserver replay restarts the **entrance only**.
- **One ambient loop per glyph.** `float` OR `pulse`, never both. Ambient loops are
  `accentOnly` — ink line-work stays still.
- **`hover-response` layers on anything** (a transition on the wrapper `<g>`).
- Per surface:
  - **Empty states** → `staggered-draw` (+ optional `float`). First-run "nothing
    here yet" only — a self-drawing 128px illustration is wrong for a
    filtered-to-zero list, which should stay a one-line message.
  - **Loading states** → `pulse` (motion may imply activity ONLY where work is
    actually happening).
  - **Icons / interactive chrome** → static render + `hover-response`.
  - **Completion moments** → `success-settle`, one-shot, gated on the real event.

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
- Run `npx tsc --noEmit` after wiring; verify both themes with the sidebar
  `ThemeToggle`.
