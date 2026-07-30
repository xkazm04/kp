# Motionize — Art-Style Philosophy (kp)

The shared visual language for kp's motionized empty states, icons, and loading
surfaces. Read this before generating so every traced glyph belongs to the same
world. Inspiration + memory, not a rigid spec.

kp is **not** the neon-on-dark app this skill came from. Do not port that art
direction. kp ships **two themes from one geometry** (see `docs/design/README.md`):

- **Studio Light** (default) — calm, editorial, warm paper, ink line-work.
  Fraunces serif display, quiet shadows. This is what corporate clients see.
- **Spark Dark** (`[data-theme="dark"]`) — playful sticker-sheet: drawn outlines,
  hard offset shadows, tilt, Bricolage display face.

## The aspiration (master descriptor)

> **Editorial risograph print, screen-printed on warm paper.** Flat confident
> shapes, thick ink outlines, a small warm palette, generous negative space.
> Human and hand-set, not corporate-vector; quiet and composed, never busy.

Generate for **Studio Light** — light warm ground, ink line-work, 2–3 accents.
Dark comes free at render time (below), so never generate a second dark twin.

## Palette — snap to kp brand tokens, never hexes

The traced art is generated in the **Studio Light** token values, and
`MotionizedGlyph` snaps every quantized hex to the nearest brand token, painting
`var(--color-…)`. That is what satisfies the house rule in `.claude/CLAUDE.md`
("never hardcode colors") and what makes Spark Dark automatic.

| Role | Token | Light value (generate with this) |
|---|---|---|
| Ground / negative space | `--color-paper` | `#fdf8ee` |
| Line-work / ink | `--color-ink` | `#17202a` |
| Accent — action, alert, energy | `--color-coral` | `#d65a4a` |
| Accent — growth, positive signal | `--color-moss` | `#526b4f` |
| Accent — data, structure, calm | `--color-steel` | `#42606f` |
| Accent — attention, score-mid | `--color-dial-amber` | `#caa54c` |
| Soft fill / tint | `--color-limewash` | `#dce7d0` |
| Muted structure | `--color-dial-stone` | `#8c8779` |

**Use at most 3 of the accents in one glyph**, plus ink and paper. More than that
and the snap gets ambiguous and the glyph reads as clip-art.

Prompt the palette literally by hex — the model lands near enough, and the snap
does the rest:

> …limited palette: warm off-white `#fdf8ee` background, dark ink `#17202a`
> outlines, terracotta `#d65a4a` and sage `#526b4f` accents…

## Light / dark — one geometry, zero overrides

Geometry is identical across themes; only the resolved token values change. Do
**not** emit `[data-theme="dark"]` rules per glyph, do not read `useTheme()`, and
do not generate a dark-optimised source. If a glyph reads badly in Spark Dark, the
fix is the *token assignment* (e.g. a large ink slab that should be
`--color-dial-stone`), not a theme fork.

The tracer sends full-canvas and large negative-space regions to
`var(--color-paper)`, so the ground follows the theme for free.

## Composition

- **Single hero in negative space.** One idea per glyph — a pipeline that hasn't
  started, a calendar with nothing on it. Radial/centered framing, 1:1.
- **Thick uniform outlines, solid fills, hard edges.** No gradients, no glow, no
  soft shadow, no texture in the raster — glow is an SVG filter afterwards, and in
  kp it is usually *not wanted* (Studio Light doesn't emit).
- **Depict kp's actual nouns**: candidates, job cards, a pipeline rail, a decision
  fork, a calendar slot, a matrix grid, a chart. A generic "empty box" glyph is a
  wasted surface — the empty state should teach what would be here.
- Aim for **10–40 real regions**. Fewer traces to a blob; more traces to speckle.

## Motion (how it reveals)

- **Radiate, don't snap.** Center-out radial delay (default) or a clockwise sweep
  (`--order angular`). ~0.8–1.2s total.
- **Opacity always; transform when allowed** — reduced motion keeps the cross-fade.
- **Empty states are idle.** `staggered-draw` entrance, optional `float`. Never
  `pulse` on an idle surface: it implies work that isn't happening.
- Ambient loops must survive kp's animation-austerity rule (see the prototype
  skill): if the user would notice it after leaving the screen idle, it's too much.

## Consistency checklist

- Warm paper ground, ink line-work, ≤3 brand accents. ✔
- Single hero in negative space; radial framing; 1:1. ✔
- Flat raster — no glow/gradient baked in. ✔
- Every fill resolves to a `var(--color-…)` token (no hex in the component). ✔
- Verified in **both** Studio Light and Spark Dark. ✔
- Reveal radiates, is quiet, and degrades under reduced motion. ✔
