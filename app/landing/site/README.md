# app/landing/site: the public landing (`/`) and About (`/about`)

A port of the approved fused prototype (`.contest/fusion/v1/`, see its FUSION-MAP.md). The prototype
is the design source of truth; this folder reproduces it inside the Next app. Contract for the port:
`.contest/fusion/PORT-PLAN.md`. This file is the conventions the Foundation set; read it before
adding anything here.

## Layout

```
css/        scoped stylesheets (one per prototype sheet) + two hand-written ones (base.css, chrome-app.css)
chrome/     shared by both pages: MkRoot, Header (+HeaderShell), Footer, CtaDock, Stepper, Ctas, LangChips,
            BrandMark, fonts, glyphs (BRAND, GLYPH), rootState (mkRootOf), legal links
land/       the landing: styles.ts (its CSS list), LandingPage.tsx, one file per band, features/
about/      About: styles.ts (its CSS list), AboutPage.tsx, chapters and art
```

Route shells (Foundation-owned, outside this folder): `app/landing/spark/SparkHome.tsx` (landing:
`MkRoot mode="land"` > skip link, Header, `land/LandingPage`, Footer, CtaDock; the
DemoUnavailableNotice sits OUTSIDE the root) and `app/landing/spark/AboutHome.tsx` (About: same with
`about/AboutPage` and the mono font). `app/about/page.tsx` still owns /about's metadata + JSON-LD.
Cross-page links are plain `<a>`, never `next/link`: each page loads its own stylesheet list and a full
navigation keeps one page's CSS off the other.

Bands (props in brackets; every band keeps its section id, the header, footer, skip link and deep
links point at them):

| file | id | owner |
| --- | --- | --- |
| land/Hero.tsx `{ signupOpen }` | `top` | A |
| land/Marquee.tsx | (none: the `.ribbon`) | A |
| land/Proof.tsx | `proof` | A |
| land/features/Features.tsx | `features` (skip link target) | B |
| land/Voice.tsx | `voice` | A |
| land/Human.tsx | `human` | A |
| land/Pricing.tsx `{ signupOpen }` | `pricing` | A |
| land/Enterprise.tsx | `enterprise` | A |
| land/Start.tsx `{ signupOpen }` | `start` | A |
| land/LandingPage.tsx `{ signupOpen }` | `<main id="main">` | A |
| about/AboutPage.tsx `{ signupOpen }` | `<main id="main">`, `top`, `line` (skip link), steps via `aboutStepId(i)`, `end` | C |

## CSS: scopes, weight and order

Every prototype sheet was run through `.contest/fusion/tools/scope-css.mjs` (driver with the fixes
below: `.contest/fusion/scratch/foundation/build-css.mjs`). From now on the files in `css/` are
hand-maintained; the prototype is not regenerated over them.

| sheets | scope | keyframes |
| --- | --- | --- |
| `chrome.css` | `.mk.mk` | `mk-` (none today) |
| `land-*.css` | `.mk.mk-land` | `mkl-` |
| `about-*.css` | `.mk.mk-about` | `mka-` |

- **The chrome scope is doubled on purpose** (`.mk.mk`, not `.mk`): every scope then adds the same
  weight (two classes), so the prototype's own specificity decides, and ties fall to source order,
  exactly as with the prototype's `<link>` order. With a single `.mk` the page sheets out-weighed the
  chrome by one class and several rules flipped (e.g. `p { margin: 0 }` beat `.menu-langs`).
- **Order is load-bearing.** `land/styles.ts` and `about/styles.ts` import every sheet in the
  prototype's order and are imported FIRST by the route shells. Landing: base, chrome, chrome-app,
  land-*. About: base, about-* (tokens ... a1), chrome, chrome-app, about-chrome. New sheet: add it to
  the right styles.ts at its place. **Never import a scoped sheet from a band component.**
- **`:root` / `html` / `body` rules landed on the root** (`<MkRoot>`): tokens, background, type,
  overflow. Document-level behaviour that does nothing on a div (smooth scroll, scroll padding under
  the header, About's scroll snap, the canvas colour) is re-stated on `html:has(.mk.mk-land|about)` in
  `base.css`. A `body { overflow-x: hidden }` became `clip` (hidden would make the root a scroll
  container and break `position: sticky`).
- **User-agent defaults are restored inside the root** (`base.css`): the prototype was drawn against
  the browser's stylesheet; the app loads Tailwind preflight and a coral focus ring. They are
  `revert`ed under `.mk` at one-class weight, so any scoped prototype rule wins. Consequence: **do not
  use Tailwind utility classes inside the root**; they would fight the reset. Anything drawn with the
  app's utilities (DemoUnavailableNotice) renders outside the root.
- **Renamed while scoping** (the TSX must emit the new names):
  - B/3 mocks' root class `.mk` is now **`.mock`** (`class="mock mk-voice"`, `"mock mk-detail mk-voice-d"`);
    `.mk` is the site root. The inner `mk-*` classes and `--mk-*` tokens are unchanged.
  - About s3-intake `.gs.gd` is now **`.gs.g-dim`** (`.gd` is the Gigs workspace root, loaded on `/`).
  - The scene's `#scPrevT, #scNextT` phone rule is now `.sc-nav .st-lbl` (what `<Stepper>` renders).
  - About's `.legal` is `.legal:not(.foot .legal)` (in the prototype it lost to the footer's rule).
- **Class-name collisions with the app's CSS**: `ring` is also a Tailwind utility (box-shadow),
  neutralised in base.css; `sr-only` matches Tailwind's with the same effect. Every other app sheet is
  scoped under its own root (`.gd`, `.sv`, `.ob-*`, `.k-*`), so no other prototype class collides.
- Fonts: `--f-disp`/`--f-display` -> `var(--font-mk-disp)` (Bricolage, opsz axis), `--f-body` ->
  `--font-mk-body` (Figtree), `--f-hand` -> `--font-mk-hand` (Caveat), `--f-mono` -> `--font-mk-mono`
  (JetBrains Mono, About only). Loaded with next/font in `chrome/fonts.ts` / `chrome/fontMono.ts`,
  latin + latin-ext. The landing has no `--f-mono` (as in the prototype; mocks-fuse maps it to body).
  **No generated fallback face**: every face sets `adjustFontFallback: false` (webpack) AND a manual
  `fallback` of the first family of the prototype's stack (Turbopack ignores the first and only drops
  its metric-adjusted `local(Arial)` face when given the second). Without that the Arial face caught the
  → ← ▶ glyphs Figtree lacks, and arrowed buttons / the stepper came out ~2px wider than the prototype.
  The font-family list therefore reads `Figtree, "Segoe UI", "Segoe UI", ...` (first family twice; harmless).
- **Prefixed before standard.** Where a sheet pairs `-webkit-X` with `X`, write the prefixed one FIRST.
  In the other order Next's lightningcss folds the pair into the `-webkit-` declaration alone, which
  Chromium does not parse (the header's `.bar.is-stuck` blur computed `none` until this was fixed).
- Keyframes used from JS or inline `style` must use the prefixed name (`mkl-rise`, `mka-fadeup`).

## Longer locales

English is the design; cs/de/fr must fit it without changing it. Display lines that can outgrow their room get
their em width from `land/headlineFit.ts` (a Bricolage advance table, no browser needed) as a CSS variable, and the
CSS sets them smaller only past the threshold (`--h1-em`/`--h1-unit` hero, `--fh-em` ring heading, `--rn-em`
hovered name, `--st-em` scene title, `--seal-em` About's stamp, `--hh-em` About's phone title).
`land/headlineFit.test.ts` pins that English never reaches a threshold. Header breakpoints are per locale
(`:lang(fr|de)` in `css/chrome.css`); body labels wrap (`text-wrap: balance`) instead of clipping.

## Root state (what the prototype kept on `<html>` / `<body>`)

`<MkRoot>` is the prototype's `<body>`. It is `div.mk.mk-land|mk-about[data-mk-root][data-page]` and
carries: `js` (added on mount by MkJsFlag; gates `.js .rv`, About's arrival choreography),
`data-intro="run"` (landing) and `is-intro` (About) on arrival. The page's client code toggles state
on it through `mkRootOf(el)` (`chrome/rootState.ts`), from an effect or handler, never in render:
landing `data-intro` -> `done`; About `is-intro` off, `reduced`, `is-leaving`, `is-arriving`, the
`--sc` / `--sc-hi` colour. `document.documentElement.style.overflow = "hidden"` (the scene's scroll
lock) still goes on the real `<html>`.

Fixed overlays (the feature scene): `position: fixed` is contained by any ancestor with a transform,
filter or backdrop-filter (`.rv` reveals use `translate`; `.bar.is-stuck` has a backdrop-filter).
Render an overlay where no such ancestor exists (a direct child of `<main>` or a portal into
`mkRootOf(...)`), never inside a revealed band.

## Chrome API

- `Header({ page, signupOpen })`, `Footer({ page })`, `CtaDock({ signupOpen, placement })`: server
  components, rendered by the route shells only. Header nav `.is-cur` (scroll-spy) is the landing's to
  toggle (`.bar .nav a[href="#proof"]`), as the prototype's app.js did.
- `StartCta({ signupOpen, placement, plan?, arrow?, className?, children? })`: every "Start hiring
  free" / "Start free" / "Pick Starter" on both pages. An `<a href="/signup|/login">` that first tries
  the credential-less entry (today's hero behaviour). Look = `className` (`btn btn-lg primary`, ...).
  Tracks `landing_cta_click` with `{ placement }`, plus `plan` when one is given (the pricing tiers),
  as the retired pricing band did; `land/art/TrackedLink.tsx` sends the same shape for plain links.
- `DemoCta({ play?, className?, children? })`: every "Watch the live demo". `/api/demo`, as today. The
  prototype's demo overlay is not ported.
- `SignIn({ className? })`, `LangChips()` (the real EN/CS/DE/FR switch), `BrandMark()`.
- `Stepper(props)`: presentational, controlled. `variant="page"` = About's fixed `.stepper`,
  `variant="scene"` = the landing scene's `.sc-nav`. Props: `ariaLabel`, `dotsLabel`,
  `steps: { label, signed? }[]`, `active` (outside the range = none), `onSelect`, `onPrev`, `onNext`,
  `prevLabel?` / `nextLabel?` (neighbour names beside the arrows; buttons are then named
  "Previous: X"), `prevDisabled?`, `nextDisabled?`, `count?` (page variant phone line), `id?`.
  Wired in two places: `about/AboutLine.tsx` (page variant) and `land/features/Scene.tsx` (scene).
- `GLYPH` (arrows, play) and `BRAND` (spelling, "K") in `chrome/glyphs.ts`: render them as
  expressions, never as JSX text.

## i18n

No literal user-visible string in TSX: text nodes, `aria-label`, `alt`, `title`, `placeholder`, SVG
`<text>`/`<title>`/`<desc>` (eslint `i18next/no-literal-string` at error + `scripts/i18n-check.mjs`
seal `app/landing`). Sample names and brand come from named constants; `.ts` art modules take
translated strings from `t`. Reuse existing keys when the copy is verbatim today's (`landing.*`,
`aboutPage.*`, `pricing`, `language.*`); new copy goes to your namespace (`siteChrome` Foundation,
`siteLand` A, `siteFeatures` B, `siteAbout` C) via the English fragment in `.contest/fusion/i18n/`
and `node .contest/fusion/tools/upsert-ns.mjs en <ns> <fragment>`. Never edit `messages/*.json` by hand;
cs/de/fr are the translation phase's (until then a Czech visitor sees the key path for new keys).

## Adding a band

1. `land/<Band>.tsx`, default export, server component; interactive parts in small `"use client"`
   children (reduced motion via `useMedia` in `land/features/panels/kit.tsx` / matchMedia; every effect
   returns its cleanup; never framer's `useReducedMotion`, `app/landing/spark/landing-motion.test.ts`).
2. Keep the prototype's markup and class names; the scoped CSS already styles them.
3. New CSS: a `css/land-<name>.css` scoped under `.mk.mk-land`, added to `land/styles.ts` in order.
4. Place it in `LandingPage.tsx` in the prototype's order.

## Comparing against the prototype

The dev server the operator runs: `http://localhost:3000` (never start another). A fresh Playwright
context has no cookies, so `/` is the landing. Prototype from disk:
`file:///C:/Users/kazda/kiro/kp/.contest/fusion/v1/index.html` / `about.html`.

- `python .contest/fusion/scratch/foundation/shots.py <tag>`: header / footer / phone menu screenshots
  of both pages and the prototype at 1280x800, 1920x1080, 390x844, plus console errors, page errors,
  horizontal scroll, header class after scroll, menu after Escape.
- `python .contest/fusion/scratch/foundation/probe.py 1280 800 land ".sel" ...`: computed-style diff
  (font, size, box, colours, shadow) of the same selectors on app vs prototype. Differences in the
  font-family list are only next/font's fallback face.
- Look at the images side by side; keep your own scratch in `.contest/fusion/scratch/<you>/`.
