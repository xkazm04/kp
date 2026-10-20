# App-surface contests: take the app, invent the idea

A design contest on an app surface (a practical screen redesigned with the marketing site's
creative, layered, animated philosophy) used to start from a blank page. Every seat invented its own
fonts, type steps, buttons and panels; the winner then had to be re-skinned into the app, and each
port drifted a little further from the last. This page is the rough guide a seat gets instead: what
the app already has and a prototype takes as given, and what stays entirely free.

**The Overview is the reference.** Hiring > Overview ("The Orbit, Lit", ported 2026-09-30) is the
worked example of a contest winner that took the app's vocabulary and still looks like nothing else
in it. When in doubt, look at how it did it (the file list is at the end).

The staged form of this page, the real tokens as plain CSS and the components as class recipes, is
the `app-kit/` pack (`scripts/contest/app-kit-pack.mjs`, staged per `.claude/contest/config.md`).

## Take from the app

**Fonts, and which register wears which.** Body text is Inter in both themes. The display face is
one variable, `--font-serif`: **Fraunces** in Studio Light, **Bricolage Grotesque** in Spark Dark.
There is no third family. A "hand-lettered" note is the display face in the register's hand (italic
serif in light, bold and a degree or two off-axis in dark), not a script font.

**Type steps, and the floor.** `display 36 / h2 22 / h3 16 / body 16 / meta 14 / micro 14`; meta is
uppercase, 600, tracked 0.08em. Nothing renders below 14px, at any density. Hierarchy is a size step
or a weight, never a fade and never smaller type. One hero numeral per surface may go past the scale
(the Overview's waiting count is twice the display step); a second one is not a hero.

**The palette is roles, not colours.** Coral acts and means "needs you" (never a stage tone); moss is
good and positive; the dial amber is "maybe" and late; steel is commentary and quiet text; ink on
paper; limewash and coralwash are the two soft tints; the warm stone ramp draws rules and fills; red,
amber, green and blue exist only in the shades the dark theme maps. A prototype paints through the
variables (`var(--color-coral)`), never a literal, so the same file renders both themes.

**Two registers, never averaged.** Studio Light is calm: hairline rules, 8 / 12px radii, a soft
two-layer panel shadow, no tilt, an ease-out. Spark Dark is playful: 2px drawn outlines, 12 / 16px
radii, hard offset sticker shadows, a degree or two of tilt, a springy overshoot. They differ in
structure, not only in hue; a design that only has one of them is half a design.

**Components: the recipes, the kit, the scene layer.** Paint single elements with the recipes
(`PANEL`, `BTN_PRIMARY` / `BTN_AFFIRM` / `BTN_SECONDARY` / `BTN_GHOST`, `CHIP`, `EYEBROW`, `FIELD`,
`KBD`); compose a surface from the kit (`PageHead`, `Section`, the figure, `ListRow`, `DataTable`,
`Button`, `ChipRow`, `Mark`, `ReadingPane`; docs/design/README.md "Composition kit"). The scene layer
(`app/_components/kit/scene`) holds what a drawn, layered surface needs and two winners already built:

| Need | Part |
|---|---|
| a surface you walk into, level by level | `LevelFrame`, `LevelTrail`, `LevelTransition`, `KeyHints`, the `levelReduce` stack |
| the state of a thing that can be set up and fail | `ConditionMark` (live, wait, reach, fail, off, unknown), `NamePlate` |
| "needs you, worst first" | `NeedsList` / `NeedsItem` |
| a queue beside the figure it describes | `QueueCard`, `Wires` (+ `wireFor`), `Halos`, `HandNote`, `LitGround` |

**The level pattern.** A push opens a level over the current one; a pop returns; the breadcrumb
jumps (and a back button names where it goes); a sideways step (the next channel) keeps the level.
A level opens as a circle growing from the thing that was touched (760 ms) and closes back onto it
(560 ms). Esc goes one level up and yields to an open dialog, a focused field and an open reading
pane. The opened level's heading takes focus; the trail is announced. Covered levels stay mounted,
so what was typed survives the trip down and back. The URL is an inbox that lands you, never a log
of where you clicked.

**The honesty vocabulary.** Absence is "—" with its reason, never 0; "unknown" means not read, never
a guess; "live" needs evidence (a sent row, a heartbeat), not configuration. Delivery says `sent`,
`queued` or `failed`, never a green lie. The machine proposes and a person decides, and the surface
says which one produced what the reader is looking at. An empty region shows the thing itself,
named and unfilled, not a skeleton.

**Keyboard and motion.** Every control is reachable and named; nothing is hover-only (a tooltip is a
real element that also shows on focus); no bare-letter shortcut at a surface's top (the workspace
owns `g` chords and `?`); a level may answer its own row keys (`j` / `k` in a list, digits for its
chips, as the ledger and the lanes do), yielding inside fields and inside the `g`-chord window. Motion belongs to a state change and tells what changed: an arrival, a morph, a flight of the
same marks from one level to the next. No ambient loops, no drift, no geometry that moves on hover;
a halo may breathe only while the reader points at what it marks. Under reduced motion every part
shows its final frame, or cross-fades, and drops the transform instead of shortening it.

## What stays free

The **metaphor** (a district of buildings, an orbit, a post office at night), the **illustration**
and any drawn art for the idea (SVG that colours through classes, `currentColor` and the variables),
the **composition** of the screen, the **story the motion tells**, **which** token roles dominate
the palette (a moss-and-limewash dial, a steel night), and the **density strategy**. The app gives
the words the design is spoken in; what is said with them is the contest.

## What every prototype must still do

Run on **real-shaped data** (staged from the app; anything invented is marked synthetic); show
**honest absence**; work from the **keyboard**; put **nothing behind hover only**; render **both
themes** from the variables (link `tokens.css`, flip `<html data-theme="dark">`); keep every word
as text a translator can reach (no copy baked into images).

## How the two winners applied it

**The Overview ("The Orbit, Lit"): the reference.** It took the kit's `Button` for every link, the
figure's serif numeral for counts, the type steps (its one hero numeral is the declared exception),
the `--k-*` radii and lines of both registers, and the honest totals ("—" with the reason when the
job list failed). What it invented, and kept: the orbit folded small as the page's figure on a lit
ground, the queues wired to the rings their people stand on, halos that breathe while pointed at,
the margin notes in the register's hand, and the flight of the same dots into the opened orbit.
Files: `app/features/hiring/pipeline/orbit/overview/` (`OrbitOverview.tsx`, `OverviewQueue.tsx`,
`OverviewWires.tsx`, `OverviewDial.tsx`, `orbitOverview.css`), its scene parts in
`app/_components/kit/scene/` (`QueueCard`, `Wires`, `Halos`, `HandNote`, `LitGround`,
`wireGeometry.ts`), and its parity with the Overview it replaced in
`docs/features/pipeline/README.md` ("Parity with the Overview it replaced").

**Channels ("The Night Post").** It took the kit's `Mark` shapes for every condition, `Button` and
`KitSurface` inside its levels, the `KBD` recipe for its key hints, and the delivery truth the app
already computes (`commsVerdict`, `receiverHealth`). What it invented: the plumbing as a district
you walk into, its buildings drawn once and coloured by state in both registers, and the circle
wipe between levels. The level machinery it built is now the scene layer's (`LevelFrame`,
`LevelTrail`, `LevelTransition`, `KeyHints`, `levelStack.ts`, `ConditionMark`, `NamePlate`,
`Needs`); the district, its art and its words stay in `app/features/hiring/channels/night/`
(contract: `night/README.md`; parity: `docs/features/comms/README.md`, "Parity with the retired kit
view").
