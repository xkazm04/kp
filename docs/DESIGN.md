# KandiDate design system — one product, two moods

This document extracts the design philosophy that emerged on `/landing` (the
"Spark" direction) and turns it into an explicit, dual-theme design system for
the whole app. It is the reference for every new component: **write once,
resolve through tokens, render correctly in both themes.**

## The duality

KandiDate serves two audiences with two temperaments, and the product wears a
different skin for each — same layout, same components, same code:

| | **Studio Light** (default) | **Spark Dark** (experimental) |
|---|---|---|
| Audience | Corporate clients, normality enjoyers | Creative users, early adopters |
| Mood | Calm editorial studio — paper, ink, serif headlines | Sticker-sheet playfulness after dark — deep ink canvas, candy accents, hard offset shadows |
| Canvas | Warm paper `#f7f5ef` | Deep ink `#141b24` |
| Display face | Fraunces (serif, editorial) | Bricolage Grotesque (the landing's display font) |
| Structure | Hairline borders, `rounded-lg`, flat rest state | Drawn 2px outlines, 16px radius, tilted rest states, press-down buttons |
| Shadows | Soft ambient (`0 18px 50px` at 10%) | Hard offset sticker shadows (`5px 5px 0` panels, `3px 3px 0` buttons/marks) |
| Motion | Ease-out entrances | Same entrances with spring overshoot easing |
| Accents | Muted coral / moss / amber | The same hues, lifted and saturated for dark |
| Status | Shipped, stable | Experimental design system; expect tuning |

The two columns are **registers, not palettes** — Spark Dark changes structure
(borders, radius, tilt, shadow geometry, type, easing), not just hue. The
mechanics below are layered so each kind of difference lives at the cheapest
level that can express it.

Activation is one attribute: `data-theme="dark"` on `<html>`. The
`ThemeToggle` in the workspace sidebar flips it, persists the choice to
`localStorage` (`kp-theme`), and defaults from `prefers-color-scheme`. An
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
display, soft shadows, generous paper). Spark Dark turns 1, 3, 4 back up.

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
| `paper` | `#f7f5ef` | `#141b24` | Page canvas |
| `coral` | `#d65a4a` | `#ff7e68` | Action, alerts, brand pop |
| `moss` | `#526b4f` | `#84b27a` | Positive, strong fit |
| `steel` | `#42606f` | `#9db5c3` | Secondary text, neutral data |
| `limewash` | `#dce7d0` | `#2a382b` | Soft green tint fills |
| `dial-stone` | `#8c8779` | `#6e7787` | Gauge tracks |
| `dial-amber` | `#caa54c` | `#e5bd62` | Mid-band score |
| `score-strong/mid/weak/null` | alias moss / dial-amber / coral / steel | (follow automatically) | Rank colors — see `scoreTone()` |

**Remapped neutrals** (stock Tailwind classes that participate in theming):

| Utility family | Studio Light | Spark Dark | Role |
|---|---|---|---|
| `white` | `#ffffff` | `#1d2630` | Raised card/panel surface |
| `stone-50` | stock | `#222d39` | Faintest fill |
| `stone-100` | stock | `#283442` | Subtle fill, hover wash |
| `stone-200` | stock | `#364453` | Hairline borders |
| `stone-300` | stock | `#475665` | Strong borders, dividers |
| `stone-400` | stock | `#647585` | Muted icons |
| `shadow-panel` | soft ambient | `5px 5px 0` near-black | Panel elevation |

**Status scales** are luminance-flipped in dark (`*-50` tints go deep, `*-700`
text goes light): `red-*` (errors), `amber-*` (warnings/holds), `green-*`,
`blue-*` — only the shades the app actually uses are mapped; if you introduce
a new shade, add its dark value to the `[data-theme="dark"]` block.

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
   the title in dark. For arbitrary two-version markup use
   `ThemeSplit({ light, dark })` (`app/_components/ui/ThemeSplit.tsx`): both
   variants render, CSS picks via `.theme-light-only`/`.theme-dark-only`
   (display:contents — no layout box, no hydration flash, server-safe). The
   dormant variant stays mounted, so keep ThemeSplit presentational.
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
  strings — `FactorChart` picks light/dark values from the `DARK` mirror in
  `app/_lib/brand.ts` (the JS copy of the dark token block; keep in
  lockstep). Any new chart follows that pattern.
- **Leader emphasis scales with the canvas.** Subtle washes that work on
  paper (`bg-moss/5`) vanish on dark — the comparison table's leader column
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
   a value, `dark:` recipe variant if it's classes, `SectionTitle`-style CSS
   swap or `ThemeSplit` if it's markup, `useTheme()` only if it's behavior.
   Don't reach for a JS fork when CSS can express the difference.
6. **Check both themes** before shipping a new surface — toggle in the sidebar
   footer. Pay attention to anything with images, charts, or fixed-color SVG.
7. **Score colors only via `score-*` tokens / `scoreTone()`** — never re-pick
   rank hues by hand.

## Shared recipes — write once, apply multiple times

`app/_components/ui/recipes.ts` holds the canonical class strings for the
recurring surfaces (panel, sunken panel, chip, buttons, eyebrow, field…),
alongside the existing shared primitives (`Badge`, `Modal`,
`SegmentedControl`, `Skeleton`). New components compose recipes instead of
re-typing the classes; existing call sites migrate opportunistically — touch a
file, adopt the recipe.

Why constants, not components: the recipes are pure class vocabularies with no
behavior, so a `string` keeps JSX shape unchanged, works on any element
(`section`, `button`, `Link`), and adds zero runtime. Patterns that *do* carry
behavior (modal focus trap, segmented control keyboard nav) stay components.

## Type & motion (shared by both themes)

- Type scale: `display 36 / h2 22 / h3 16 / body 16 / meta+micro 14` — nothing
  below 14px. Serif (Fraunces) for display in the workspace; the landing owns
  its own loaded-on-page fonts.
- Motion vocabulary: `animate-fade-in`, `animate-tab-in`, `stagger-children`,
  `animate-slide-in`, `animate-drawer-in` — all reduced-motion aware. Dark
  theme may lean on spring entrances more, but always through these shared
  classes.
- Focus: the global coral double-ring resolves through `paper`/`coral` tokens,
  so it adapts to both themes automatically; `forced-colors` fallback restores
  a system outline.

## Tokenization scan (2026-06-11) — the migration work-list

A full sweep of `app/` (excluding `app/landing/`) found the codebase already
very clean on literal colors and heavily repetitive on recipes:

| Recipe | ~Count | Recipe constant |
|---|---|---|
| Panel/card (`rounded-lg border border-stone-200 bg-white p-* shadow-panel`) | 94 | `PANEL` |
| Meta label (`text-meta uppercase text-steel`) | 101 | `META_LABEL` |
| Secondary bordered button/pill (`border-stone-200 … hover:border-coral/40`) | 64 | `BTN_SECONDARY` / `CHIP` |
| Section header trio (eyebrow / serif display / steel intro) | 55 | `EYEBROW` + `TITLE_DISPLAY` + `INTRO` |
| Empty state / quiet well (`bg-paper` tints) | 18 | `PANEL_SUNKEN` |
| Border-only chip | 11 | `CHIP` |
| Quiet filled chip (`bg-stone-100`) | 10 | `CHIP_QUIET` |
| Input/select/textarea (ad-hoc across ~72 files) | — | `FIELD` (standardize during sweep) |

Exemplar conversions shipped with this commit:
`app/features/sub_interview/InterviewSimTab.tsx` (panel, header trio, both
buttons, sunken well) and `app/_components/voice/InterviewSidebar.tsx`
(panel, meta label).

Literal-color offenders outside `/landing`: only two arbitrary rgba shadows
in `app/features/simulation/SimBar.tsx:84,94` — acceptable for that fixed
overlay effect, but candidates for a `--shadow-bar` token during the sweep.

Stock-palette dependency (what the dark block must keep covering):
`stone-200` ≈516, `white` ≈434, `stone-100` ≈156, `stone-300` ≈75,
`stone-50` ≈24, `stone-400` ≈8, plus status shades `red-50..700`,
`amber-50..900`, `green-50..800`, `blue-50..700` (exact shades listed in the
override block).

## Follow-up roadmap

1. ~~Dark palette + toggle~~ (shipped with this document).
2. Recipe adoption sweep: migrate high-traffic features tab-by-tab to
   `recipes.ts` using the work-list above (mechanical; each migration shrinks
   the surface a future restyle must touch).
3. Standardize form field styling on `FIELD` (currently ad-hoc in ~72 files).
4. Tokenize the two SimBar rgba shadows; audit fixed-color SVGs/charts as
   they're touched.
5. Promote recurring *behavioral* patterns (icon tile, empty state, section
   header) into components once their recipe form stabilizes.
6. Consider Shantell Sans for dark-register hand-written annotations (the
   landing's margin notes) — needs a lazy-load story before app-wide use.
