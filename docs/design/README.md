# KandiDate design system — one product, two moods

This document extracts the design philosophy that emerged on `/landing` (the
"Spark" direction) and turns it into an explicit, dual-theme design system for
the whole app. It is the reference for every new component: **write once,
resolve through tokens, render correctly in both themes.**

Verified against `app/globals.css` and `app/_components/ui/recipes.ts` on
2026-07-30. This contract is load-bearing: it is quoted by `.claude/CLAUDE.md`
and by the `motionize`, `perfect`, and `prototype` skills.

## The duality

KandiDate serves two audiences with two temperaments, and the product wears a
different skin for each — same layout, same components, same code:

| | **Studio Light** (default) | **Spark Dark** (experimental) |
|---|---|---|
| Audience | Corporate clients, normality enjoyers | Creative users, early adopters |
| Mood | Calm editorial studio — paper, ink, serif headlines | Sticker-sheet playfulness after dark — deep ink canvas, candy accents, hard offset shadows |
| Canvas | Warm cream `#fdf8ee` | Deep ink `#141b24` |
| Display face | Fraunces (serif, editorial) | Bricolage Grotesque (the landing's display font) |
| Structure | Hairline borders, `rounded-lg`, flat rest state | Drawn 2px outlines, 16px radius, tilted rest states, press-down buttons |
| Shadows | Two-layer soft elevation (tight contact + closer ambient) | Hard offset sticker shadows (`5px 5px 0` panels, `3px 3px 0` buttons/marks) |
| Motion | Ease-out entrances | Same entrances with spring overshoot easing |
| Accents | Muted coral / moss / amber | The same hues, lifted and saturated for dark |
| Status | Shipped, stable | Experimental design system; expect tuning |

The two columns are **registers, not palettes** — Spark Dark changes structure
(borders, radius, tilt, shadow geometry, type, easing), not just hue. The
mechanics below are layered so each kind of difference lives at the cheapest
level that can express it.

Activation is one attribute: `data-theme="dark"` on `<html>`. The
appearance control on the workspace sidebar rail
(`app/features/shell/nav/NavRailPreferences.tsx`) flips it, persists the choice
to `localStorage` (`kp-theme`), and defaults from `prefers-color-scheme`. An
inline pre-hydration script in `app/layout.tsx` applies the stored theme
before first paint, so there is no flash.

**`/landing` is exempt — and enforced.** The Spark landing page is a fixed art
direction with literal hexes on purpose (`app/landing/spark/tokens.ts`) — it
must look identical for every visitor and never re-skins with the workspace
theme. It is the *source* of the dark theme's vocabulary, not a consumer of
it. Enforcement: the THEME_INIT bootstrap in `app/layout.tsx` never sets
`data-theme` on `/landing` paths, because the landing isn't fully literal —
its sticker faces use `bg-white`, the very token the dark block remaps — and
its feature spotlights embed workspace UI that must stay in the light
register. If the landing ever gains links into the workspace (client-side
navigation would carry the attribute), revisit with a route-scoped reset.

## The Spark philosophy (extracted from /landing)

What makes the landing feel the way it does — distilled to principles the dark
theme inherits:

1. **Ink outlines and hard shadows.** Nothing floats on blur. Cards are
   stickers: thick borders, opaque offset shadows (`6px 6px 0 #17202a`),
   pressed-down hover states (`translate 2px + shrink shadow`). Depth is
   drawn, not diffused.
2. **A warm canvas, candy accents.** One quiet background (cream there, deep
   ink here) lets a small saturated family do all the talking: coral
   `#d65a4a`, amber `#caa54c`, moss `#526b4f`, limewash `#dce7d0`, steel
   `#42606f`. Color is meaning: coral = act, moss = good, amber = maybe,
   steel = commentary.
3. **Tilt and spring.** Elements rest a degree or two off-axis and settle with
   spring/bounce physics (`type: "spring", bounce: 0.3–0.5`). Hover
   straightens them. Motion always resolves to stillness, and always honors
   `prefers-reduced-motion`.
4. **Interactions reward curiosity.** Hover the CV pile and a score stamps
   down; peek inside a feature card and the live product pops up. Surfaces
   invite touch instead of demanding attention.
5. **The human voice.** Microcopy is warm and honest — "kind pass", "no
   robots in charge", hand-written margin notes. Judgment stays with people;
   the interface says so out loud.
6. **Honest hierarchy.** Display type is loud (extrabold, tight leading), body
   type is friendly, and nothing renders below 14px. Volume contrast, not
   clutter, carries the hierarchy.

Studio Light keeps principles 2, 5, 6 in a quieter register (serif Fraunces
display, soft shadows, generous cream). Spark Dark turns 1, 3, 4 back up.

## How the token system works (Tailwind v4)

`app/globals.css` declares the palette in `@theme`, which Tailwind v4 emits as
CSS variables on `:root`. **Every color utility compiles to a `var()`
reference** — `bg-white` is `background-color: var(--color-white)`,
`border-stone-200` is `var(--color-stone-200)`, `bg-coral/10` is a
`color-mix()` of `var(--color-coral)`. So re-declaring tokens under
`[data-theme="dark"]` re-skins every surface in the app with zero component
changes — including the stock `white`/`stone-*` utilities, which the dark
block remaps to dark equivalents.

### Token map

**Brand tokens** (use these first):

| Token | Studio Light | Spark Dark | Role |
|---|---|---|---|
| `ink` | `#17202a` | `#f4efe3` | Primary text; flips to cream |
| `paper` | `#fdf8ee` | `#141b24` | Page canvas |
| `coral` | `#d65a4a` | `#ff7e68` | Action, alerts, brand pop |
| `moss` | `#526b4f` | `#84b27a` | Positive, strong fit |
| `steel` | `#42606f` | `#9db5c3` | Secondary text, neutral data |
| `limewash` | `#dce7d0` | `#2a382b` | Soft green tint fills |
| `dial-stone` | `#8c8779` | `#6e7787` | Gauge tracks |
| `dial-amber` | `#caa54c` | `#e5bd62` | Mid-band score |
| `score-strong/mid/weak/null` | alias moss / dial-amber / coral / steel | (follow automatically) | Rank colors — see `scoreTone()` |
| `diagram-{live,gate,gap}-{fill,stroke}` | alias limewash / moss / coralwash / coral / stone-100 / dial-stone | (follow automatically) | Architecture-diagram status trichotomy — read by `puml/constants.ts` and the `/diagrams` legend |
| `diagram-gap-text` | `#6b6557` | `#9aa3b2` | Muted label on the gap fill — the one diagram value with no brand counterpart |

**Remapped neutrals** (stock Tailwind classes that participate in theming):

| Utility family | Studio Light | Spark Dark | Role |
|---|---|---|---|
| `white` | `#ffffff` | `#1d2630` | Raised card/panel surface |
| `stone-50` | `#f7f2e9` (warm ramp) | `#222d39` | Faintest fill |
| `stone-100` | `#f1ebdd` (warm ramp) | `#283442` | Subtle fill, hover wash |
| `stone-200` | `#e6ddcc` (warm ramp) | `#364453` | Hairline borders |
| `stone-300` | `#d6cbb4` (warm ramp) | `#475665` | Strong borders, dividers |
| `stone-400` | stock | `#647585` | Muted icons |
| `stone-500` / `stone-600` | stock | **stock (deliberate)** | Muted body text — the text greys stay stock in both themes |
| `stone-800` / `stone-900` | stock near-black | `#d8d2c6` / `#efe9dd` | **Inverted** controls (`bg-stone-900 text-white`) — see below |
| `shadow-panel` | two-layer soft (`0 1px 2px` contact + `0 10px 28px -10px` ambient) | `5px 5px 0` near-black | Panel elevation |
| `shadow-pop` | `4px 4px 0 rgba(23,32,42,.13)` (a hard offset already in light) | `5px 5px 0` near-black | Anchored pop layer — dropdowns, filter/row menus, `Select`, explainer popovers |
| `shadow-overlay` | `0 25px 50px -12px rgb(0 0 0 / .25)` (was stock `shadow-2xl`) | `7px 7px 0` near-black | Floating chrome — Modal, drawers |

Anything that floats gets one of these three — never a stock `shadow-lg` /
`shadow-xl` / `shadow-2xl`. Those inline a literal black `rgba()` blur into the
utility, so they cannot follow `data-theme`: on the dark ink canvas a 10 %-black
diffusion reads as no lift at all, which is exactly the bug the `shadow-overlay`
note below describes. An anchored menu or popover is `shadow-pop`.

`stone-800/900` are the one **inverted** pair: `bg-stone-900 text-white` means
"the opposite of the canvas", so the flip has to invert the *surface* too. Left
unmapped it was the palette's worst bug — the surface stayed stock near-black
while `--color-white` remapped to `#1d2630`, i.e. dark text on a dark
background. This makes the ramp intentionally non-monotone across `400`→`800`:
`stone-500..700` are muted *text*, not surfaces, and stay stock on purpose.

`shadow-overlay` exists because neither `shadow-panel` (too calm to separate a
dialog from the page) nor `shadow-pop` (already a hard offset in *light*, which
is the Spark register) can carry floating chrome. Stock `shadow-2xl` can't
either — it is a literal `rgb()` and can never follow the theme, which is why
Modal was the one surface that missed the dark structural ride.

> **Shadow tokens need an extra hop — don't "simplify" it away.** Tailwind v4
> *inlines* an `@theme --shadow-*` value into the utility it generates
> (`.shadow-panel{--tw-shadow:0 1px 2px …}`) instead of emitting
> `var(--shadow-panel)`. Color utilities do the opposite (`.bg-stone-900{
> background-color:var(--color-stone-900)}`), which is why the palette re-skins
> at all. So for a long time, re-declaring `--shadow-panel` in the dark block
> set a custom property that **no rule on the page ever read**: the whole Spark
> hard-offset shadow register was inert while the stylesheet looked correct.
> Each shadow token therefore points at a second variable
> (`--shadow-panel: var(--panel-shadow)`), with the real values in `:root` and
> `[data-theme="dark"]`, which moves resolution to runtime where the override
> wins. Verify with `grep '\.shadow-panel{' .next/static/chunks/*.css` after a
> build — it must contain `var(--panel-shadow)`, not a literal offset.

**Status scales** are luminance-flipped in dark (`*-50` tints go deep, `*-700`
text goes light): `red-*` (errors), `amber-*` (warnings/holds), `green-*`,
`blue-*` — only the shades the app actually uses are mapped; if you introduce
a new shade, add its dark value to the `[data-theme="dark"]` block. **These four
families are the whole sanctioned set** — `emerald-*` is not one of them; use
`green-*`, which is mapped. `red-400`/`red-500` are the invalid-state cue on
every shared form primitive and are lifted clear of the `red-300` tint on
purpose, so the indicator holds ≥3:1 (WCAG 1.4.11) against the card surface.
`npm run design:check` enforces all of this — see "What enforces this" below.

## The structural register — how dark gets its Spark

Color tokens are only the first of five layers. The others carry what a
palette can't, ordered cheapest-first; **express a theme difference at the
lowest layer that can hold it**:

1. **Tokens** (`@theme` + `[data-theme="dark"]` overrides) — hue, shadow
   *values*, and the display face: `--font-serif` resolves to Fraunces in
   light and **Bricolage Grotesque** in dark, so every `font-serif` heading
   swaps register with zero markup changes.
2. **Structural CSS rides** (`globals.css`, after the dark block) — blanket
   re-geometry that piggybacks on existing class seams so even not-yet-
   migrated surfaces participate: every `.shadow-panel` surface becomes a
   sticker in dark (2px drawn outline, 16px radius, hard offset shadow);
   `animate-tab-in`/`stagger-children` swap to spring-overshoot easing;
   `::selection` flashes amber. These are transitional where they overlap the
   recipe sweep, permanent where they're app-wide physics (easing, selection).
3. **Register-aware recipes** (`app/_components/ui/recipes.ts`) — the `dark:`
   variant is remapped to `[data-theme="dark"]` via `@custom-variant` in
   globals.css, so one recipe string carries both registers: buttons press
   down into their sticker shadow on hover in dark, chips rest a degree
   off-axis and straighten under the cursor. Adopting a recipe buys a
   component both behaviors at once.
4. **Presentational component forks** — when the *markup* differs (extra
   decoration, alternate layout), not just classes. `SectionTitle` is the
   exemplar: plain serif heading in light, hand-drawn amber squiggle under
   the title in dark — the squiggle carries `hidden dark:block`, so CSS, not
   JS, picks the register. For arbitrary two-version markup, render both
   variants and pair the stock Tailwind display utilities with the `dark:`
   variant: `hidden dark:contents` on the dark-only branch, `contents
   dark:hidden` on the light-only one. `contents` produces no layout box, so
   the branch drops out of flex/grid parents cleanly; both branches are in the
   server HTML, so there is no hydration flash. The dormant variant stays
   mounted, so keep anything built this way presentational.

   > There is **no `ThemeSplit` component** and **no `.theme-light-only` /
   > `.theme-dark-only` utility pair**. Earlier revisions of this doc described
   > both; the component was never built and the CSS classes were deleted
   > (a 2026-06-23 shared-UI refactor scan, since untracked) while
   > the instruction to use them survived — markup written against them did
   > nothing in either theme. `hidden dark:contents` / `contents dark:hidden`
   > above is the mechanism that actually works, and it needs no bespoke CSS:
   > Tailwind generates the utility from the class it finds in the source, so
   > it cannot go missing the way a hand-written `globals.css` rule did.
5. **Behavioral forks** — different effects, handlers, chart configs, or
   animation params per theme: `useTheme()`
   (`app/_components/ui/useTheme.ts`), a client hook over the theme store in
   `app/_lib/theme.ts`.

## Data visuals — where the registers split hardest

Tables, matrices, dials and ratings are the workspace's densest surfaces, so
they carry the most distinctive dual treatments. The vocabulary, per Spark
element:

- **The score stamp.** The landing stamps verdicts onto the CV pile; Spark
  Dark does the same to every ranked number. `ScoreBadge` renders as a tilted,
  tone-bordered seal with a hard shadow and the display face (null scores stay
  flat — an absent score is not a verdict). `ScoreDial`'s big readout speaks
  Bricolage (`dark:font-serif`); MatchCard's score already rides the
  `font-serif` flip.
- **Sticker cells.** Browsing the candidate×position matrix in dark "peels"
  the hovered cell — tilt, scale, hard shadow above its neighbors — instead
  of the light register's flat zoom. Schedule chips do the same: the selected
  candidate's chip sits tilted with a sticker shadow (the standalone `rotate`
  property composes with the framer-motion glide).
- **Tables lead with the display face.** A global ride gives `thead` the
  serif token (→ Bricolage in dark); hovered `tbody` rows get a coral marker
  stroke in the left margin — the "finger on the pile" — and `.border-b`/
  `.border-t` section rules go dashed like the landing's transcript dividers.
- **Charts fork on `useTheme()`.** Bar/dial fills already flip via the
  `score-*` tokens, but recharts chrome (grid, ticks, tooltip) needs literal
  strings — `FactorChart` picks light/dark values from the `LIGHT` and `DARK`
  mirrors in `app/_lib/brand.ts` (the JS copies of the two token blocks, keyed
  by role: `SURFACE`/`FILL`/`GRID`). Any new chart follows that pattern; both
  mirrors are pinned to `globals.css` by `design:check`, so neither half can
  drift the way the light half had.
- **Inline SVG paints `var()`, not the `brand.ts` literals.** A presentation
  attribute (`fill`, `stroke`) is parsed as CSS, so `fill="var(--color-paper)"`
  resolves per theme with no `useTheme()` fork — that is how `MotionizedGlyph`
  gives one traced geometry both registers. The bare constants (`PAPER`, `INK`,
  …) are the **Studio Light half** of each token and belong only to the
  stylesheet-less renderers (`opengraph-image`, `apple-icon`) and to the
  chart chrome that needs a literal string. Importing them into a themed
  component ships a light-mode drawing into Spark Dark: the results empty-state
  vignettes (`app/_components/results/shared.tsx`) pinned `PAPER`/`INK` that way
  and rendered a cream sheet on a `#141b24` card, with the magnifier handle —
  the one stroke drawn on the card ground rather than on a filled shape —
  at 1.04:1 against it.

  Found a **second** time on 2026-08-29, in the PlantUML diagram renderer
  (`app/_components/puml/`): its `C` palette imported `MOSS`/`CORAL`/`INK`/`PAPER`/…
  and its status trichotomy held six hand-copied hexes (one byte-identical to
  `--color-coral`, which is how a copy announces itself), so every architecture
  diagram painted a near-white gap box onto the `#141b24` canvas — in the shapes
  **and** in the legend that explains them. Note what did NOT catch it: importing
  `brand.ts` puts a literal under the lockstep gate, so the file looked compliant
  while shipping a light-only drawing. **Lockstep is not theming** — it proves a
  literal matches its Studio Light token, not that the surface flips. The fix was
  the rule above: paint `var()`.
- **Leader emphasis scales with the canvas.** Subtle washes that work on
  cream (`bg-moss/5`) vanish on dark — the comparison table's leader column
  upgrades to `/15` plus a moss edge stroke in dark. When a highlight relies
  on a faint tint, give dark an explicit louder variant.

### Rules for dual-theme components

1. **No literal color values** outside `app/landing/`. No `bg-[#...]`,
   `text-[#...]`, inline `style={{ color: "#..." }}`, or rgba shadows. If a
   color has no token, it doesn't exist yet — add a token.
2. **Reach for brand tokens first** (`ink`, `paper`, `steel`, `coral`…), then
   the remapped neutrals (`white`, `stone-*`). Both re-skin; brand tokens
   carry meaning.
3. **`text-white` is theme-relative.** It means "surface-colored text on an
   accent background" (it flips dark in dark mode, which is correct on the
   brightened accents). Never use it expecting literal white.
4. **Prefer the shared recipes** in `app/_components/ui/recipes.ts` (PANEL,
   CHIP, BTN…) over re-typing class strings — that's the "write once, apply
   multiple times" seam: restyle a recipe once and every consumer follows in
   both themes, structure included.
5. **Fork at the right layer** (see "The structural register"): token if it's
   a value, `dark:` recipe variant if it's classes, a `SectionTitle`-style CSS
   swap (or the `.theme-*-only` utilities) if it's markup, `useTheme()` only
   if it's behavior.
   Don't reach for a JS fork when CSS can express the difference.
6. **Check both themes** before shipping a new surface — toggle in the sidebar
   footer. Pay attention to anything with images, charts, or fixed-color SVG.
7. **Score colors only via `score-*` tokens / `scoreTone()`** — never re-pick
   rank hues by hand.

## What enforces this

For a long time: nothing. The law above was stated in prose, `eslint.config.mjs`
carried a single custom rule (about i18n), and neither CI nor `.githooks/pre-push`
had ever read `app/globals.css`. It cost something real — `brand.ts` declared
`PAPER = "#f7f5ef"` while the canvas token had moved to `#fdf8ee`, so every
stylesheet-less light surface (OG card, apple-icon, raw SVG fills) painted a
cream the app no longer used, and nothing could have noticed.

Three gates now run in **CI** (`.github/workflows/ci.yml`) and in the **pre-push
hook**:

| Gate | Where | Checks |
|---|---|---|
| Lockstep | `npm run design:check` | Every literal in `app/_lib/brand.ts` equals its `--color-*` declaration, in **both** blocks. A constant whose token doesn't exist fails rather than being skipped, so a new one is covered automatically. |
| Shade parity | `npm run design:check` | Every `-(red\|amber\|green\|blue\|stone\|…)-N` utility used outside `app/landing/` has a `[data-theme="dark"]` value. |
| No literal color | `npm run lint` | `no-restricted-syntax` bans six-digit hex and inline `rgb()/rgba()` in `app/**`. AST-based, so it sees strings and template chunks but not comments. The four selectors live in `DESIGN_LAW_SELECTORS` and are RESTATED in every later `no-restricted-syntax` block that matches `app/**` (flat config replaces a rule's options, it never merges them) - from 2026-08 until 2026-09-01 they were silently off for the whole ui/import layer for exactly that reason; the exemptions (`DESIGN_LAW_EXEMPT_LIB` / `_UI`) get trailing blocks that carry everything but these four. The hex end-anchor is a lookahead, not ``: Tailwind spells a space as `_`, a word character, so `#d6d3d1_0px` inside an arbitrary value had no boundary to find. |

Both live in [`scripts/design/check-design-tokens.mjs`](../../scripts/design/check-design-tokens.mjs)
and `eslint.config.mjs`. **Neither is ever relaxed to make a change pass.** An
exemption is a path in the eslint `ignores` list or an entry in the script's
`SHADE_ALLOW` map, and each one carries its reason inline. Today's exemptions:

- `app/landing/**` — the fixed art direction, the design law's one stated carve-out.
- `app/_lib/brand.ts` — the mirror itself; its literals are pinned by the lockstep gate.
- `app/_components/glyph/glyphs/**` — traced glyph *source* data, never painted:
  `MotionizedGlyph` runs every fill through `snapToToken()` and emits `var(--color-*)`.
  That promise is now **verified**, not assumed:
  [`glyphData.test.ts`](../../app/_components/glyph/glyphs/glyphData.test.ts) asserts every
  emitted fill is a 6-digit hex the snap can parse (or a `var(--color-*)` it already
  resolved) and that the token it lands on is declared in **both** theme blocks. Without
  it, a regeneration emitting `#abc`, `#rrggbbaa` or `rgb(…)` would fall through the snap
  untouched and paint a literal colour past both gates.
- `app/_components/puml/**` — diagram-only primitive tints (cylinder, cloud, sticky
  note) with no CSS-variable equivalent. Its brand-mirroring half imports `brand.ts`;
  the diagram has no dark register yet.
- `app/_dev-inspector/**` — dev-only devtools chrome, deliberately fixed so it stays
  readable while you debug the theme itself.
- `app/**/*.test.{ts,tsx}` — hexes are inputs/expectations for the color sanitizers.
- `stone-500` / `stone-600` — muted body text; the text greys stay stock in both themes.

## Shared recipes — write once, apply multiple times

`app/_components/ui/recipes.ts` holds the canonical class strings for the
recurring surfaces — `PANEL`, `PANEL_SUNKEN`, `SECTION`,
`CARD_PAD`, `DIVIDER`, `PAGE_HEADER`, `EYEBROW`, `TITLE_DISPLAY`, `INTRO`,
`META_LABEL`, `CHIP`, `CHIP_QUIET`, `CHIP_TOGGLE`, `STAT`/`STAT_LABEL`/
`STAT_VALUE`, `BTN_PRIMARY`/`BTN_SECONDARY`/`BTN_GHOST`, `ICON_STICKER`,
`FIELD`, `TOGGLE_GROUP`, `KBD` — alongside the existing shared primitives
(`Badge`, `Modal`, `SegmentedControl`, `Skeleton`, `Defer`). New components
compose recipes instead of re-typing the classes; adoption is broad across
`app/features/**` (confirmed by grep on 2026-07-30 — 30+ call sites use
`CHIP`/`CHIP_TOGGLE`/`PANEL_SUNKEN` alone). Existing call sites migrate
opportunistically — touch a file, adopt the recipe.

Why constants, not components: the recipes are pure class vocabularies with no
behavior, so a `string` keeps JSX shape unchanged, works on any element
(`section`, `button`, `Link`), and adds zero runtime. Patterns that *do* carry
behavior (modal focus trap, segmented control keyboard nav) stay components.

Two additions from the 2026-09-03 rail pass: `railTile(isActive)` is the
icon-over-label rail tile shared by the section buttons and the Feedback door
(`railIconBtn` stays for rail chrome), and `--color-white-fixed` is the one
deliberately theme-invariant surface, a real white in both registers, for
third-party artwork only (a tenant's uploaded logo) - `white`/`paper` remain the
role tokens for KandiDate's own surfaces.

A `TABLE` recipe is not yet formalized — `AnalyticsTab`'s tables are still
hand-rolled. See `docs/concepts/visual-uplift-plan.md` for the open rollout
checklist.

## Type & motion (shared by both themes)

- Type scale: `display 36 / h2 22 / h3 16 / body 16 / meta+micro 14` — nothing
  below 14px. Serif (Fraunces) for display in the workspace; the landing owns
  its own loaded-on-page fonts **and its own, larger scale** (below).
- **The marketing pages run one notch larger.** `.spark-type` in
  `app/globals.css` redefines `--text-xs … --text-xl` (+~2px each: xs 14, sm 16,
  base 18, lg 20, xl 22, meta 16) for everything inside it. Tailwind v4 compiles
  `text-sm` to `font-size: var(--text-sm)`, so overriding the token on an
  ancestor re-scales every utility in the subtree — the shift lives in one rule
  instead of ~180 hand-typed classes, and new Spark markup inherits it. Only the
  font size is overridden; the stock `--text-*--line-height` values are unitless
  ratios, so leading follows. `text-2xl` and up are deliberately untouched — the
  display headings were never the problem. Applied at the page root by
  `SparkHome`, `AboutHome` and `MarketPulse` via `TYPE_SCALE`
  (`app/landing/spark/tokens.ts`). The workspace is unaffected.
- **The illustrated cards go one notch further.** `.spark-type-art`
  (`ART_TYPE_SCALE`) nests inside the page scale and adds another +2px: xs 16,
  sm 18, base 20, lg 22, xl 24 — and unlike the page scale it *does* move
  `text-2xl`/`3xl`/`4xl` (26/32/38), because inside a card a display size is a
  score dial or a salary figure, not a section heading. It re-states absolute
  values rather than deriving them, so nesting it inside itself is idempotent
  (the /market demand grid does exactly that). Rationale: the /about step art
  and the /market data cards are miniatures of product UI, built at product
  sizes, and once the page scale moved they read a full step smaller than the
  prose beside them. Opt in per card container: `StepRow`'s art column in
  `AboutCurve`, every block in `market/parts.tsx` plus the three inline card
  groups in `MarketPulseAtlas`.
- Motion vocabulary: `animate-fade-in`, `animate-tab-in`, `stagger-children`,
  `animate-slide-in`, `animate-drawer-in`, `animate-arrive-in`, `reveal-quiet`
  — all reduced-motion aware. See `docs/design/loading-choreography.md` for
  the tab-entrance/data-arrival contract these compose into. Dark theme may
  lean on spring entrances more, but always through these shared classes.
- **Presence (exit) motion is framer-motion, not CSS.** A CSS keyframe can only
  animate an element that is still mounted, so anything that must fade *out* —
  a self-hiding strip, a toggled panel, a swapped pane — wraps in
  `AnimatePresence` gated on `useReducedMotion` (`app/_lib/useReducedMotion.ts`).
  The reference set is `app/features/hiring/pipeline/PipelineMotion.tsx`
  (`Fade` / `Collapse` / `FadeSwap` / `FadeInline`) alongside the segmented-control
  standard in `AnalyzeWorkspace.tsx`. Two rules such a wrapper must keep: render
  **no** DOM while hidden (an empty wrapper inside a `space-y-*` stack leaves a
  permanent gap), and let the component that decides it has nothing to show own
  the wrapper itself — a parent cannot animate out what has already returned null.
- Focus: the global coral double-ring resolves through `paper`/`coral` tokens,
  so it adapts to both themes automatically; `forced-colors` fallback restores
  a system outline.
- **Tailwind's own `animate-spin` / `animate-pulse` are gated centrally**, not
  per call site. Tailwind ships them with no reduced-motion behaviour, so they
  ran against the OS preference wherever a call site forgot
  `motion-reduce:animate-none` — which was 41 spins and 9 pulses. One unlayered
  rule in the `prefers-reduced-motion: reduce` block of `app/globals.css` now
  covers every current and future site. The two differ on purpose: a **pulse
  stops** (a shimmer carries no information), a **spin slows to 3s** rather than
  freezing (it does carry information — "work in flight" — and a frozen spinner
  reads as a hung app). Unlayered beats Tailwind's `@layer utilities`, so no
  `!important` is needed; verified against the built CSS chunk, not the
  stylesheet source. A call site that wants a hard stop still writes
  `motion-reduce:animate-none`, which wins inside the layer.

### Loading gaps are named, except when naming them is noise

The app's waiting state is a quiet reserved box (`reveal-quiet` + a min-height), never a
shimmering skeleton — and it used to be `aria-hidden`, so a screen-reader user reached a silent
empty region with no way to tell *still loading* from *this section is empty*, which is the one
distinction the box exists to draw for sighted readers.

`app/_components/ui/LoadingGap.tsx` is that box with a name (`role="status"`, an `sr-only`
label, `aria-busy`). The visual is unchanged. The rule for which gaps use it:

| Shape | Treatment | Why |
| --- | --- | --- |
| A box standing in for a **whole view or panel body** | `<LoadingGap>` | The wait is the reader's whole experience of that region; it is a status. |
| An **inline shimmer** for one value inside an already-rendered row (`inline-block h-4 w-24 …`) | stays `aria-hidden` | Decoration. The row already says what is there, and one "Loading" per cell is far worse than silence. |
| **Several gaps mounting at once** below a heading that already rendered | one status on the section, not one per panel | Five simultaneous announcements are noise, and noise in a live region is worse than silence. |

**Honest limit, stated on the component:** this makes the wait *discoverable*, not
*announced-on-arrival*. The region unmounts when content replaces it, and a live region that
disappears cannot announce what took its place; that needs a stable region owned by the section.

Adopted across the Analytics tab (8 sites). ~80 block-level gaps elsewhere in `app/` still use
the bare `aria-hidden` form — fix-as-you-touch, not a migration.

### Accessible names on shared primitives

- `Badge` sets `role="img"` + `aria-label` **only** when a token mapper supplies
  an `ariaLabel` richer than the visible text; otherwise it sets neither. It
  used to put `aria-label` on the bare `<span>`, which maps to `role="generic"`
  — ARIA *prohibits* `aria-label` there, so the richer labels were not required
  to be announced at all. Not `role="status"`: that is an implicit live region
  and these badges render statically in lists.
- `Modal` exposes exactly one close control. The scrim is a `<div>` with an
  `onClick`, not a `<button>` — as a button it was a focusable phantom tab stop
  inside the focus trap, an invisible duplicate of the header X. Escape-to-close
  lives in `useDialogA11y` and is unaffected.
- **No shared primitive may hardcode an `aria-label`.** The eslint i18n rule
  runs in `jsx-text-only` mode and structurally cannot see an attribute; its
  `jsx-only` mode can, but also flags every message key passed to `t()` inside a
  JSX expression (measured: 159 false positives on the already-graduated file
  set), so extending it is not viable. `npm run i18n:check` greps
  `app/_components/**/*.tsx` for literal `aria-label="…"` and fails instead.

## Public landing (status: BUILT, NOT LAUNCHED)

The marketing landing (`app/landing/spark/SparkHome` — hero, pricing tiers, trust
story, voice teaser, the `/api/demo` CTA, en/cs i18n) **is served publicly at `/`**.
The gate is server-side: `hasEnteredWorkspace()`
(`app/_lib/auth/home-gate-server.ts`) decides per request whether `/` renders the
landing or the dashboard — the real signed session in password mode, the readable
entry marker in open mode. Anonymous visitors get the landing server-rendered, so it
is crawlable (`app/robots.ts`, `app/sitemap.ts`) with no landing↔dashboard flash.
`/landing` is a redirect stub to `/` for stale bookmarks.

The marketing bands (`/`, `/about`, `/market`) are `max-w-7xl` (80rem), not the
`max-w-6xl` the workspace uses — the larger `.spark-type` scale needs the extra
measure. /about's timeline runs the full `max-w-7xl` too, and its step art caps at
`max-w-lg` (was `max-w-md`) so the card-scale type has room; /market's two narrow
editorial sections went `max-w-4xl` → `max-w-5xl`. One
consequence to know about: `SectionRail` parks in the gutter at
`50% + 40rem + 0.5rem` and falls back to a viewport-edge overlay when the gutter
can't hold it, which now happens below ~1592px viewport instead of ~1464px.

> Corrected 2026-07-30. This section previously said the landing was dev-only,
> gated by a client `HomeGate` at `app/_lib/auth/devAuth.ts` with
> `DEV_GATE = NODE_ENV !== "production"`. That file no longer exists — the gate
> moved server-side and the landing went public. The launch-readiness caveats
> below still apply and are worth re-reading in that light.

This is deliberate, not a bug: the landing is **not launch-ready** —
- pricing / "Talk to sales" CTAs dead-end at the operator password box (no
  signup/checkout/contact route),
- `/` inherits off-brand "Salary Estimator" SEO/OG metadata and there's no
  sitemap/robots,
- there is no first-party social proof.

**To launch:** gate `/` on the real auth cookie (`isOperator`) instead of the
dev-only localStorage flag so signed-out prod visitors get `SparkLanding` and
signed-in operators get the dashboard — AND first close the CTA / SEO / social-proof
items above (see the 2026-06-25 ambiguity+business scan,
a 2026-06-25 landing/marketing ambiguity scan, since untracked).

## Corrections applied against the live code (2026-07-30 verification)

The original document (written when Studio Light shipped) described a warm
paper canvas of `#f7f5ef` and a floaty `0 18px 50px` panel shadow. Both were
superseded by the "Option C" visual-uplift pass (see
`docs/concepts/visual-uplift-plan.md`): the canvas is now the marketing's
cream `#fdf8ee` (`app/globals.css:9`), and `--shadow-panel` is a two-layer
soft elevation (`app/globals.css:42`). This document has been corrected to
match; the table above reflects the live tokens, not the original ship.
