# Marketing surfaces — `/`, `/about`, `/market`

The three public, signed-out pages. `/` and `/about` are one site since
2026-09-30: a port of the owner-approved fused prototype
(`.contest/fusion/v1/`, "Spark": cream grounds, ink outlines, hard offset
shadows, Bricolage display face, Caveat notes) into `app/landing/site/`, sharing
one header, phone menu, footer and CTA dock. `/market` keeps the earlier Spark
chrome (`app/landing/spark/`). Each page answers a different question: *what is
this*, *how does it work*, *what does the market look like*.

These pages are the documented exception to the token rule in
[`docs/design/README.md`](../../design/README.md) — everything under
`app/landing/` is a fixed art direction and uses literal hexes. Nothing else in
the app may.

The patterns these pages are built on, written for someone porting them into a
different repository, are in [`docs/marketing/the-bar.md`](../../marketing/the-bar.md).
The site's own conventions (CSS scoping, cascade order, fonts, root state, the
chrome API, adding a band) are in
[`app/landing/site/README.md`](../../../app/landing/site/README.md); read it
before changing anything under `app/landing/site/`.

## Entry points

| Route | Renders | Purpose |
| --- | --- | --- |
| `/` | `app/page.tsx` → `HomeGate` → `app/landing/spark/SparkHome.tsx` (route shell) → `app/landing/site/land/LandingPage.tsx` | The landing. Signed-out only; signed-in visitors get the workspace. |
| `/about` | `app/about/page.tsx` → `app/landing/spark/AboutHome.tsx` (route shell) → `app/landing/site/about/AboutPage.tsx` | **About the app**, not about us — "the line": one sample hire walked down the eight pipeline phases (`ABOUT_STEP_KEYS` in `app/landing/spark/about-art/shared.ts`). The route shell emits `AboutPage` + `SoftwareApplication` JSON-LD (`app/about/about-jsonld.ts`) so crawlers get a typed product page, not only Open Graph title/description, plus a `HowTo` of those eight phases (order-locked to `ABOUT_STEP_KEYS`, step URLs are `#step-0N`) and a two-item `BreadcrumbList` (Home → About the app). `ABOUT_PAGE_MODIFIED` (ISO date, bump with `ABOUT_STEP_KEYS` / `aboutPage.steps`) is `openGraph.modifiedTime` and JSON-LD `dateModified`. |
| `/market` | `app/market/page.tsx` → `MarketPulse.tsx` → `market/MarketPulseApp.tsx` → `MarketPulseAtlas.tsx` | "Market Pulse" — the Czech job market from open data. |
| `/landing`, `/landing/spark` | redirect stubs | Legacy bookmarks → `/`. |

All three are `instant = false` (Blocked under Cache Components): they render
under the per-request locale layout, so they cannot be statically prerendered.
All three are listed in `app/_lib/auth/public-routes.ts` and `app/sitemap.ts`.

### Module layout

The two route shells stay in `app/landing/spark/` (the routes import them); each
imports its page's ordered stylesheet list FIRST (`site/land/styles.ts`,
`site/about/styles.ts`) and renders `MkRoot` > skip link, `Header`, the page,
`Footer`, `CtaDock`. On `/` the `DemoUnavailableNotice` sits outside the root,
because it is drawn with the app's Tailwind utilities, which the site root resets.

| Path | Holds |
| --- | --- |
| `site/chrome/` | Shared by both pages: `MkRoot` (the site root: scope classes, font variables, root state), `Header` + `HeaderShell` (bar, section nav, phone menu), `Footer`, `CtaDock` (the phone/portrait dock), `Ctas.tsx` (`StartCta`, `DemoCta`, `SignIn`: every CTA on both pages), `LangChips` (the real EN/CS/DE/FR switch), `Stepper` (About's page stepper and the scene's), `fonts.ts` / `fontMono.ts`, `glyphs.ts` (`BRAND`, `GLYPH`), `legal.ts`, `rootState.ts` |
| `site/css/` | The prototype's stylesheets, scoped under `.mk.mk` (chrome), `.mk.mk-land` (landing) and `.mk.mk-about` (About), plus `base.css` (user-agent defaults restored inside the root) and `chrome-app.css`. Hand-maintained; order is load-bearing |
| `site/land/` | One server component per band (below), `LandingMotion` (spine, scroll-spy, reveals), `HeroClient`, `ProofStack`, `VoicePlayer`, `HumanGate`, and `art/` |
| `site/land/features/` | The features band: `FeatureRing` (the ring of nine and the scene state), `Scene` (the full-screen scene), `featureData.ts`, `panels/` (one stylised product panel per feature, each with a "Look closer" detailed view) |
| `site/about/` | `AboutPage` (server-rendered chapters), `AboutLine` (the client island: ribbon, gates, stepper, choreography), `steps.ts` (per-step paint and sample data), `art/` (one drawing per phase) |
| `spark/previews/order.ts` | `PREVIEW_KEYS` (the nine features in funnel order, the `PreviewKey` union) and the `#spotlight-<key>` address grammar and walk; pure, pinned by `order.test.ts`, read by the ring |
| `spark/about-art/shared.ts` | `ABOUT_STEP_KEYS`, `aboutStepId`, `aboutStepRailLabel`: the phase list the About page, the JSON-LD and the claims test all read |
| `spark/Wordmark.tsx`, `tokens.ts`, `LandingLangSwitch.tsx`, `sections/LegalRow.tsx`, `market/` | `/market`'s chrome, and `LegalRow` for `/privacy`, `/terms`, `/trust` |

The old Spark landing and About (`SparkLanding`, `sections/*` except `LegalRow`,
`previews/*` except `order.ts`, `FeatureSpotlight`, `PricingSection`,
`SectionRail`, `AboutCurve`, `about-art/*Art.tsx`, `trust-art/*`,
`useStillMotion`) were retired with the port; git history has them.

### What the landing's bands argue, in order

`Hero · Marquee · Proof · Features · Voice · Human · Pricing · Enterprise ·
Start`, inside `<main id="main">`, with the shared header above and footer
below. Every band keeps a section id that the header nav, the phone menu, the
spine and the footer point at: `#top`, `#proof`, `#features`, `#voice`,
`#human`, `#pricing`, `#enterprise`, `#start` (the marquee has none: nothing
links to it). The skip link jumps to `#features`.

- **Hero (`#top`) sells automation, not detection.** `landing.hero.title` is the
  headline; its emphasis becomes the prototype's "autopilot" switch, which runs
  a pile of three sample CVs through scoring and stops at a human gate. Two CTAs
  (`StartCta`, `DemoCta`), a "Run it yourself" link to the self-hosted card, and
  "How Jana got 87", which opens the score scene (`#spotlight-score`).
- **Marquee:** today's eight claims (`landing.marquee`), CSS-scrolled, read once
  by a screen reader, stopped under reduced motion.
- **Proof (`#proof`):** the work-sample argument (`landing.proof.*`): three
  pillars scrolling past a sticky stack of three stylised plates.
- **Features (`#features`): the ring of nine.** Nine medallions on one ring in
  funnel order (`PREVIEW_KEYS`: inbox, score, rediscover, voice, cases,
  schedule, salary, offer, gates). Each is a button named
  "*Feature*, *n* of 9. Opens its own scene." Hover or focus names it in the
  ring's centre; a click opens its **scene** (below). The heading and all nine
  names are in the server HTML.
- **Voice (`#voice`):** "It talks to people", with a call card whose sample
  transcript (`landing.voice.transcript`) replays bubble by bubble on demand, all
  at once under reduced motion.
- **Human (`#human`): the human gate, demonstrated.** Replaces the old
  four-tab `#trust` band. A gate rail on which a sample candidate is scored and
  then waits for a person to sign, and "what may run unattended" switches that
  obey the real rule: screening and offer may be delegated, a rejection never
  (`landing.trust.human.body` carries the "by default" qualifier the claims test
  requires). Then the four compliance pillars as chips and the legal line.
- **Pricing (`#pricing`): the price list, re-skinned.** See below.
- **Enterprise (`#enterprise`):** the org-scale capabilities from
  `landing.pricing.enterprise.capabilities`, each marked as in the repository,
  delivered by us, or planned (a trailing "(planned)" in any locale becomes the
  dashed planned tag), the three sourced recruiting-time figures, and "Talk to
  sales" as today's mailto (`salesContactHref`).
- **Start (`#start`):** the closing CTA pair (`landing.cta.*`).

Page-level motion lives in `LandingMotion`: the **spine** (a fixed rail on wide
desktops with one stop per band and the sample candidate's card travelling down
it), the header nav's scroll-spy (`.is-cur`), and the reveals (`.rv` → `.rv.in`,
a translate, never an opacity).

### The scene: one feature, full screen, and an address

A medallion opens a full-screen **scene** in the feature's own colours
(`site/land/features/Scene.tsx`): its medallion art, name, one-line pitch, body
(`landing.features.<key>.body`), the stylised product panel, and three pins.
"Look closer" swaps in the panel's detailed view (one level deeper).

- **A modal dialog** named by the feature title (`role="dialog"`,
  `aria-modal`). It opens with a circle wipe from its opener, focus moves to the
  title, the page behind goes inert and stops scrolling, Tab cycles inside (plus
  the phone CTA dock), Escape goes one level up (Look closer → scene → closed),
  and closing returns focus to the medallion. It is portalled into the site root,
  never inside a revealed band (a transformed ancestor would contain it).
- **A walk.** The scene's stepper (the chrome `Stepper`, `variant="scene"`) has
  nine dots and two arrow buttons named for their neighbours ("Previous:
  Verified work samples"); ArrowLeft / ArrowRight step too, wrapping. The count
  reads "05 of 09".
- **An address.** An open scene is `/#spotlight-<key>` for the nine
  `PREVIEW_KEYS`. Arriving at or navigating to that hash opens it; stepping
  `replaceState`s the hash (a scrubber, not nine Back steps); closing puts back
  whatever hash was there before (`hashAfterClose`), never a dead
  `#spotlight-*`. Path and query are untouched, so `/`'s canonical URL and
  hreflang alternates are too. Any in-page link to `#spotlight-<key>` opens a
  scene with no code of its own (the hero's "How Jana got 87"). The grammar and
  walk are `spark/previews/order.ts`, pinned by `order.test.ts`; the browser half
  by `e2e/landing.spec.ts`.

### Pricing: today's price list in the prototype's band

`site/land/Pricing.tsx` draws the prototype's pricing band (the dark
self-hosted "door" beside three paper plans, drawn emblems, the "open source"
ribbon, the packs line, the jump to `#enterprise`) over **today's price list**:
every name, price, cadence, USD line, bullet and button label is
`landing.pricing.tiers.*`, and the tier table `TIER_STYLES` has the same shape
as the retired `PricingSection`'s (self-hosting first, `external` = leaves for
the repository). `PricingSection.test.ts` reads it out of this file's source and
pins it to `app/_lib/billing/plans.ts` (see
[The claims are pinned](#the-claims-are-pinned-not-proofread)).

- The self-hosted card's CTA is a link to the repository (`sourceRepoHref()`);
  the hosted tiers' are `StartCta` with the plan, which carries it into the href
  (`/signup?plan=…` or `/login?plan=…`), into the credential-less workspace entry
  and into the `landing_cta_click` analytics payload (`{ placement: "pricing",
  plan }`).
- One deliberate difference from the catalog: the self-hosted card's models
  bullet is the prototype's vendor-free wording
  (`siteLand.pricing.selfhostModels`). The self-hosted tier is not metered, and
  the test pins that no other bullet is replaced.
- The enterprise block that used to sit under the price grid is now its own
  `#enterprise` band.

## Navigation conventions

Both pages share one header, menu, footer and dock (`site/chrome/`), so a
visitor learns the chrome once. `/market` keeps its own.

- **The header** (`<header id="bar">`) carries the brand (to `#top` on `/`, home
  from `/about`), the section nav (`landing.nav.sections` "Page sections": Proof,
  Features, Voice, Human gate, Pricing, About), the language chips, Sign in, and
  the two CTAs. It turns solid with a blur once the page has scrolled 40px, and
  is always solid on `/about`.
- **Phone navigation is one disclosure.** Below the header's breakpoint the
  "Menu" button (renamed "Close" while open, `aria-expanded` in step) opens a
  full-screen panel: the same destinations (on `/about` they link back into the
  landing's bands, `/#pricing`, and About is marked `aria-current="page"`), the
  source link, Sign in, and the language line with the chips. Focus moves into
  the panel, Escape closes it and returns focus to the button, and any link in it
  closes it (the shared `useDialogA11y`, non-modal). The panel is a sibling of
  the header, never inside it: the header's backdrop-filter would contain it.
- **The phone / portrait dock** (`CtaDock`) pins the two CTAs to the bottom edge
  below 1100px wide, or on any window no wider than 5:4 (`max-aspect-ratio: 5/4`).
- **About's stepper** (`Stepper`, `variant="page"`) is fixed at the bottom of
  `/about`: one dot per phase plus arrows named for the neighbouring phase; a
  signed gate marks its dot.
- **Language:** the EN/CS/DE/FR chips are the real locale switch (they write
  `NEXT_LOCALE` through the same server action as `LandingLangSwitch`, then
  refresh), in the header, the phone menu and the footer; every instance reads
  the active locale from the server, so they agree.
- **Every public footer carries the legal row** — `/privacy`, `/terms`,
  `/trust`. On `/` and `/about` it is the site footer's "Legal" nav
  (`site/chrome/legal.ts`); `/market`, `/privacy`, `/terms` and `/trust` render
  the shared `spark/sections/LegalRow.tsx`. A product that captures candidate
  PII exposes its policies from its front door; `/trust` is the evidence page
  behind the landing's verified-hiring claims.
- **`/about` is labelled "About the app"** (`landing.nav.about`,
  `jobMarket.nav.about`) — `O aplikaci` · `Über die App` · `À propos de l'app`.
  The page describes the product's workflow, so it must not read as an
  about-us/company page.
- **Cross-page links are plain `<a>`**, never `next/link`: each page loads its
  own stylesheet list, and a full navigation keeps one page's CSS off the other.

### `/about`: the line

`site/about/AboutPage.tsx` renders the hero (the route as one LCD, `#top`), the
eight step chapters (`#step-01`…`#step-08` via `aboutStepId`, inside `#line`,
the skip-link target), and the finale (`#end`: the seal, the receipts tape, two
CTAs), all server-rendered. `AboutLine` (client) adds the ribbon drawn as far as
the reader has scrolled with the sample candidate's pawn at its tip, the human
gates (signing one lights its node, feeds the tape, marks the stepper dot), the
scroll-spy that sets the page colour, Replay, and a skippable intro. Under
reduced motion it is the calm version: the whole line drawn, every gate waiting.
Copy is today's `aboutPage.steps.*` (eyebrow, title, body) plus the prototype's
notes, gates and labels in `siteAbout.*`. The earlier per-step copy-link control
was not part of the prototype and did not survive the port.

### Reduced motion

- The site animates in CSS and gates it with `@media (prefers-reduced-motion)`
  in its scoped sheets; client islands read the query through `matchMedia`
  (`useMedia` in `site/land/features/panels/kit.tsx`, the matchMedia checks in
  `HeroClient`, `VoicePlayer`, `LandingMotion`, `AboutLine`). Reduced motion: the
  hero starts fully scored with no intro, reveals are in place, the marquee
  stops, the scene opens without its wipe, About draws the whole line.
- **Never framer's `useReducedMotion`.** It answers `null` during SSR and reads
  the query once into `useState`, so markup branched on it fails hydration and
  ignores a mid-session change. `app/landing/spark/landing-motion.test.ts` walks
  the whole `app/landing/` tree: no file may use framer's hook (two `/market`
  holdouts, see Known gaps) and any `repeat: Infinity` framer loop must be gated.

## Localization

Every visible string on all three pages resolves through i18n — the `landing`,
`aboutPage` and `jobMarket` namespaces, plus the port's four (`siteChrome`,
`siteLand`, `siteFeatures`, `siteAbout`) in `messages/{en,cs,de,fr}.json` —
**including the page titles and descriptions**, which `/about` and `/market`
build in `generateMetadata` via `getTranslations`. The port reuses the existing,
already-translated keys wherever the copy is verbatim today's (`landing.*`,
`aboutPage.*`, `pricing`), so the claims tests keep reading the same keys; only
copy the prototype introduced (labels, notes, stepper text, captions) is new.

A page's `openGraph` / `twitter` **replace** the root layout's (Next merges
metadata shallowly), so `/about` extends the parent's resolved objects —
`generateMetadata(_props, parent)` spreads `(await parent).openGraph` and
`.twitter` under its own title and description. `e2e/public-pages.spec.ts` pins
the tags against `/`. `/market`, `/privacy`, `/terms` and `/trust` still return a
bare `openGraph` and have the same gap.

`/about` also returns `keywords` from `aboutPage.meta.keywords` so the explainer
does not inherit the root layout's landing bag. `about-jsonld.test.ts` pins the
assignment.

Three things deliberately do **not** go through the catalog, and each is held as
a named constant rather than JSX text so the lint can tell them apart from copy:

- the **brand** — `BRAND` in `site/chrome/glyphs.ts` (and `spark/Wordmark.tsx`
  on `/market`) owns the one spelling of "KandiDate"; a brand name must never
  reach a message catalog;
- **sample data** — the invented candidates and signer (Jana N., Petr K.,
  Alex T., M. Horáková: `site/land/art/samples.ts`,
  `site/land/features/sample.ts`, `site/about/steps.ts` `SAMPLE`), which ride
  into sentences as `{name}` placeholders, and the illustrative figures;
- the arrow and play **glyphs** (`GLYPH`, always `aria-hidden`), and
  **technology names** — a Czech reader looks for "Java", not a translation.

### Enforcement

- `npm run i18n:check` — key parity across all four locales, ICU validity, and
  a grep for hardcoded `aria-label` / `title` / `placeholder` / `alt` in these
  directories. That grep exists because the eslint rule below reads **text
  nodes only** and structurally cannot see an attribute. `app/landing` is
  sealed.
- `app/landing/spark/PricingSection.test.ts` (the price list, read out of
  `site/land/Pricing.tsx`) and `app/landing/spark/MarketingClaims.test.ts` (the
  prose claims) — see
  [The claims are pinned, not proofread](#the-claims-are-pinned-not-proofread).
  Both read the shipped catalogs and the shipped enforcing module, so there is
  nothing to keep in sync.
- `i18next/no-literal-string` runs at **error** for `app/landing/**`,
  `app/about/**` and `app/market/**`.

### Keyless behaviour

Nothing on `/` or `/about` calls a model or reads the database: every
demonstration (the hero's scoring, the human gate, the voice transcript, the
scene panels, About's gates) is local, scripted sample data, labelled as such on
the page ("sample", "stylised illustration"). "Watch the live demo" is a
navigation to `/api/demo`, which either mints the open-deploy demo or returns to
`/?demo=unavailable&code=…`, which `DemoUnavailableNotice` explains.

## Market Pulse data model

`/market` reads one committed snapshot, `data/market_pulse.json`, through the
single seam `app/landing/spark/market/data.ts`. Nothing is fetched at request
time.
The map accepts `?region=CZ010&metric=salary` links. The route validates both
values against the committed snapshot before rendering, and map exploration
replaces those parameters in the current URL while preserving unrelated query
parameters and the fragment. Browser history navigation restores the selected
region and metric.

### The rule: counts and salaries come from different sources

This is the load-bearing distinction on the page, and getting it wrong is what
made the numbers indefensible before.

| Layer | Source | Meaning |
| --- | --- | --- |
| Vacancy counts (national, per region, per family, per occupation) | ÚP ČR vacancy register via Pumper `mpsv-vpm` | Real counts of real open postings |
| **All salary figures** | ISPV earnings survey + its regional RSCP cut, fetched directly from `data.mpsv.cz` | What people are **paid** |
| JD reference cards | `mpsv-vpm/vacancy_samples` | Advertised pay, labelled as such ("From X") |

An **advertised** salary is a statistic about adverts, not about pay. Reading
the regional/national/sector medians off ÚP postings produced a national median
of 29 000 Kč and put **Prague last at 24 100 Kč** — below every other region, in
the highest-paying city in the country. Two biases stack: employers advertise
the bottom of their band, and the ÚP register skews to service and manual roles,
most of all in Prague.

On the ISPV/RSCP earnings basis the same figures read 44 200 Kč nationally with
Prague top at 53 600 Kč. Cross-checked against ČSÚ *Struktura mezd zaměstnanců
2025* (national median 44 337; Prague 52 793; Karlovarský 40 932) the derivation
agrees within ~1.5 % and the ranking matches. ČSÚ publishes the authoritative
per-region median, but only as XLSX behind a per-edition GUID URL; RSCP is
stable JSON on the same host kp already pulls its codelists from, needs no new
dependency, and is the same underlying survey — so the pipeline uses RSCP and
treats ČSÚ as the validation reference.

Figures are **workplace-based**: a region reflects what employers there pay, not
what residents earn (Prague is lifted by commuters). The footer copy says so.

### Aggregation

`scripts/lib/market-earnings.mjs` is the one place that turns ISPV rows into
page figures.

- ISPV publishes one pre-summarised row per occupation × sphere (its own median,
  quartiles, deciles) plus the headcount behind it (`pocetZamestnancuMzda`).
- A regional figure is therefore a **headcount-weighted quantile over
  occupations**, not a mean of medians. The mean is dragged up by a few tiny,
  very-well-paid occupations and lands near the *average* wage — 60 700 Kč for
  Prague instead of a defensible 53 600 Kč.
- `p25`/`p75` are the weighted **median of the occupations' own Q1/Q3 columns**
  ("what the typical occupation's quartiles look like"), not a quartile of
  quartiles, which would double-count dispersion.
- `org_types` pay comes from ISPV's `sfera`: `MZDOVA` → private, `PLATOVA` →
  public. Staffing agencies have **no** counterpart in the survey — an agency is
  who posts a job, not a sphere of the economy — so that tile carries its real
  opening count and no pay figure.
- The advertised medians are not deleted; each moves to `advertisedMedian` /
  `meta.advertised_national_median`. The offered-vs-actual spread is a genuine
  signal, it is just not "median salary".
- That advertised figure is **captured once and never re-derived**
  (`captureAdvertised` in `refresh-market-earnings.mjs`): an existing key always
  wins, `null` included. `market:build` already writes both layers, so a snapshot
  it produced holds earnings in `medianSalary` — re-deriving
  `advertisedMedian = round100(medianSalary)` on a later `market:earnings` run
  read the earnings number and stamped it over the advert (Prague 24 100 → 53 600,
  spread zero) and nulled the agency tile's 25 500, whose `medianSalary` is null.
  The derivation survives only to migrate a legacy snapshot that carries no
  `advertisedMedian` at all.

### Building

| Command | Needs | Rewrites |
| --- | --- | --- |
| `npm run market:build` | Pumper on `:8088` (counts) **and** `data.mpsv.cz` (pay) | The whole snapshot |
| `npm run market:earnings` | `data.mpsv.cz` only | The salary layer of the committed snapshot, in place — counts untouched |
| `npm run market:apply` | — | Feeds `reference_salaries` back into `data/salary_benchmarks.json` for the jobfit anchors |

`market:earnings` exists because the pay layer has no Pumper dependency, so it
can be refreshed from anywhere. Both scripts share the same aggregation module,
so a full rebuild cannot regress to advertised pay.

Both validate on the failure that matters: a national median below 35 000 Kč
means a salary field is reading adverts again. `market:earnings` additionally
asserts Prague is the highest-paid region. `market:build` validates the snapshot
**before** writing it (`validateSnapshot()` in `scripts/build-market-pulse.mjs`)
and, on any problem, refuses to overwrite `data/market_pulse.json` and exits 1 —
so the documented `market:build && market:apply` chain cannot re-level every
shipped salary band from a broken feed. `--force` writes anyway, deliberately.

A full rebuild now records `meta.unmapped_occupations` and
`meta.unmapped_vacancies`: CZ-ISCO codes and vacancy counts for which no explicit
prefix matched `data/czisco-role-map.json`. The display still uses the map's
default family, while these counts reveal how much of that family came from a
fallback.

`validateSnapshot()` refuses a rebuild when the default-family fallback covers
more than 10% of national vacancies, or when the share is absent. The mapping
needs review before publishing a snapshot that would misclassify that much
demand; `--force` remains the explicit override.

#### Rebuild cadence — sixty days, by hand

Nothing rebuilds the snapshot automatically; there is no cron, no CI job, no
scheduled workflow. An owner runs `market:build` / `market:earnings`. The page
carries the consequence rather than hiding it: past `STALE_AFTER_DAYS` (60, in
`app/landing/spark/market/data.ts`) the hero prints the snapshot's age instead of
leaving the date to be noticed. Sixty days is therefore the contract those
scripts owe. `market:apply` makes no network call, so it used to re-level every
shipped salary band from whatever committed snapshot it was handed. It now reads
`meta.generated_at` with the same UTC date math as the page (`assertFresh` in
`scripts/lib/market-earnings.mjs`) and **exits 1** when the age is ≥ 60 days,
naming the rebuild (`npm run market:build && npm run market:earnings`). `--force`
writes anyway and prints that sentence as a warning — the same override
`market:build` already uses when `validateSnapshot()` rejects a feed.

#### Network contract — a build that cannot hang, and refuses offline

Every GET the market scripts make runs through `fetchJson()` in
`scripts/lib/market-earnings.mjs`, which is the seam both properties hang off:

- **`FETCH_TIMEOUT_MS` = 20 s**, applied as an `AbortSignal.timeout` on every
  request (Pumper's five exports, the three MPSV codelists, both ISPV files).
  A bare `await fetch(url)` has no timeout at all — an endpoint that accepts the
  connection and then says nothing hangs the build until a human notices. The
  failure now names the budget it exceeded rather than surfacing `AbortError`.
- **`KP_OFFLINE` refuses before the socket is touched**, and says why: the
  snapshot is committed, so an air-gapped install
  (`docs/architecture/self-hosting.md` §7) needs no rebuild. `market:build`
  additionally refuses once up front rather than letting six parallel fetches
  each reject with the same sentence. Truthiness matches `isOffline()` in
  `app/_lib/offline.ts` (`1`/`true`/`yes`/`on`).

Both are pinned by `scripts/__tests__/market-fetch.test.mjs` (7 checks, no
network — the fetch is injected), which runs in `npm run test:docs`.

### Gaps are hidden, never stated

The page never prints a placeholder where a figure should be. Where the survey
has no number, the element is dropped:

- region card: the median tile disappears and the vacancy count takes the full
  width (the `p25`–`p75` line was already conditional);
- occupation list: the money cell goes blank but keeps its column width;
- salary field guide: families without a median are filtered out; the junior/lead
  footer only prints the ends that exist;
- org tiles: no pay figure → the opening count becomes the headline;
- JD cards: a floor with no ceiling reads "From X", not a bare figure; the
  employer/region line disappears when both are absent;
- map legend: no values behind the metric → no legend (it used to render the
  literal words "Infinity" and "NaN", including into its `aria-label`);
- hero freshness: a missing percentage drops the clause rather than publishing
  "0% posted in the last 90 days".

### Money names its currency, and the survey names its vintage

Every figure on `/market` is CZK read by an audience in four languages, so the
formatters in `market/data.ts` take the READER's locale and go through `Intl`:

| Helper | cs | en | de | fr |
| --- | --- | --- | --- | --- |
| `fmtCzk(81800, l)` | `81 800 Kč` | `CZK 81,800` | `81.800 CZK` | `81 800 CZK` |
| `fmtCzkShort(28600, l)` | `28,6 tis. Kč` | `CZK 28.6K` | `28.600 CZK` | `28,6 k CZK` |
| `fmtCompact(117000, l)` | `117 tis.` | `117K` | `117.000` | `117 k` |

The compact form used to be hand-rolled — `"28,6 tis."`, a Czech abbreviation
with a hard-coded comma decimal and **no currency**, printed in every locale on
the map legend, the region ranges, every salary band and every job-ad range. The
`cs` column is byte-identical to what the hand-rolled versions produced (which is
why `regionLabel.test.ts` compares whole strings unchanged), and `MARKET_LOCALE`
is the fallback when `Intl` refuses a tag rather than a thrown `RangeError`
during render. `data.test.ts` pins the currency in all four locales and the
`—` degradation for `null`/`NaN`/`±Infinity`.

Provenance the snapshot always carried and the page never showed:

- the **basis and vintage** — `salary.subtitleDated` states *gross monthly* and
  the `meta.ispv_period` survey year, so a reader cannot take a 2025 gross figure
  for this year's net (no period in the snapshot → the undated sentence, never a
  guessed year);
- the **sample size** behind each band — `reference_salaries[].employees_k`,
  rendered as "based on N employees surveyed". A band drawn from 117 000
  surveyed employees and one drawn from 4 000 are not the same claim;
- the **age of the snapshot** — it is committed, not fetched, so past
  `STALE_AFTER_DAYS` (60) the hero prints how old it is instead of leaving the
  date to be noticed. Rebuild cadence is an owner decision, not a schedule:
  nothing rebuilds `data/market_pulse.json` automatically today.

`isFigure()` in `data.ts` is the single gate — `Number.isFinite`, not a null
check, because `Math.min()` of an empty array is `Infinity` and the ratios
downstream become `NaN`. `heatColor`/`salaryColor` clamp non-finite input
(`heatColor(NaN)` used to destructure `undefined` and throw, taking the whole map
down client-side). `regionScale` returns null for a region with no figure, and the
map fills it with the same neutral as a region absent from the snapshot: it used
to answer 0.5, which the ramp painted as an ordinary mid-scale salary.

Two families carry no data at all and so never render: `product_project` has no
ISPV occupation coverage (`apply-market-salaries.mjs` documents the same gap),
and `momentum` is `0` across the board until consecutive snapshots differ —
`MomentumBadge` treats `0` as "no change measured", not as an increase.

## The claims are pinned, not proofread

Everything on these pages is a promise a prospect can hold the product to, and
it is published in four languages on a page nobody re-reads. `PricingSection.test.ts`
pins the price list to `billing/plans.ts` (it reads the tier table out of
`site/land/Pricing.tsx`, and pins that the band replaces no bullet but the
self-hosted models line). **`MarketingClaims.test.ts` does the same for the
prose claims** — each test pins the ONE structural fact its claim rests on, so it
fails when the code moves rather than when the wording is edited:

| Claim | Pinned to |
| --- | --- |
| the human gate is the DEFAULT, and delegable | `INTERVIEW_PLAN_DEFAULT` is human on every step and round; `automation-run.ts` still has its two `getPlanGateForRole(…) === "auto"` branches and no rejection branch |
| no page promises onboarding | `TENANCY_RETIRED_TABLES` still lists the onboarding tables; the ban then sweeps the whole `landing` + `aboutPage` namespaces and the port's `siteChrome`, `siteLand`, `siteFeatures`, `siteAbout`, per locale |
| the language claim | `LOCALES.length` — the marquee's numeral, read the way the pricing test reads a price, and the phone menu's "Four languages" line (`siteChrome.menu.languages`), read through a per-locale number-word table |
| SSO is not sold as shipped | no SAML/OIDC implementation in `_lib/auth/*`; the capability must carry a "(planned)" marker in every locale and the blurb must not name it |
| `/about` walks every phase | `aboutPage.steps` key order equals `ABOUT_STEP_KEYS`, each eyebrow states its own 1-based position and carries the "·" the short step names are cut from, and the hero states the phase count. `site/about/steps.ts` re-exports the list as `STEP_KEYS` and `AboutPage` renders off it. The same list is the HowTo JSON-LD on the route shell (`HowTo.step.length === ABOUT_STEP_KEYS.length`, names from the catalog titles). `ABOUT_PAGE_MODIFIED` on the route shell is the last-reviewed stamp for that list. |

Two of those need a per-locale table in the test (the "by default" qualifier and
the "(planned)" marker), because **a claim whose honesty lives in a qualifier is
false the moment a translation drops it**, and key-parity cannot see that. The
tables' key sets are asserted equal to `LOCALES`, so adding a locale fails the
test rather than silently exempting it.

**End to end**, keyless specs in the CI subset cover these pages.
`e2e/landing.spec.ts` covers `/`: the landing-not-workspace gate, the skip link,
axe on the whole page and band by band, axe on each of the nine scenes, the
medallions' names, a scene's focus contract (focus in, Tab kept inside, Escape
back to the medallion), the `/#spotlight-<key>` address and its walk, the phone
menu, and the demo CTA's refusal. `e2e/public-pages.spec.ts` covers the OTHER
indexed surfaces — axe on `/about`, `/trust`, `/privacy`, `/terms` and `/market`
against a per-page, per-rule `A11Y_HOLDOUTS` map, plus `/about`'s legal row,
phone disclosure, share tags and JSON-LD. `e2e/locale-smoke.spec.ts` checks that
a `cs` cookie paints the anonymous landing in Czech, the port's new namespaces
included. Both axe gates audit under reduced motion once every finite animation
has ended, and record contrast debt **node by node**: each recorded node is
asserted to STILL fail, so a fixed one turns the suite red until its entry is
deleted.

What they record today (measured 2026-09-30, 1280x800 and 390x844):

- `/`: one node, the hero's "worth a call" verdict (`.c-petr > .verdict`, gold
  `#a8842b` on `#fffdf7`, 3.44:1).
- the scenes: four of nine (inbox 3.98:1, rediscover 3.15:1, voice 3.22:1,
  salary 2.71:1) paint their crumbs, count and one-line pitch in the feature's
  soft tint on its own ground; rediscover's dimmed "earlier applicant" rows and
  the voice and salary panel captions (and salary's body copy) as well.
- `/about`: none. Its old entry (36 white step badges on the old art colours)
  went with the old page.
- `/trust`, `/privacy`, `/terms`: the coral `EYEBROW` at 3.65:1 on cream, one
  node each. `/market`: none.

Every `/` and scene finding is byte-identical in the approved prototype: they are
art-direction values the port reproduced on purpose, so deepening them is an
owner decision, like the coral eyebrow. The specs are named one by one in
`.github/workflows/ci.yml`; adding a spec there is the decision.

## Known gaps

- **`app/_lib/trust-posture.ts`'s Art. 14 row still carries the old absolute.**
  It reads "No candidate is rejected, advanced or offered by the machine alone",
  which is the sentence `landing.trust.human.body` was corrected off on
  2026-08-28 — `screeningGate: "auto"` auto-ratifies a held review
  (`auto_advanced`) and `offerGate: "auto"` extends a drafted offer unattended
  (`offer_auto_extended`, `automation-run.ts`). `/trust` is owned by its own
  goal and its posture rows were deliberately left untouched here; the same
  correction is owed there, and `MarketingClaims.test.ts` does not reach it.
- **Contrast below AA on the hero's middle verdict and in four of the nine
  scenes** (listed above), kept because the prototype draws them that way.
- **Catalog keys the retired components read are still in all four catalogs**
  (`landing.previews.*` except what the scene panels reuse, `landing.trust.*` of
  the retired tabs, `aboutPage.nav.*`, `aboutPage.footer.*`, …). They were left
  while the port's translations were in flight; retire them in one pass, in all
  four locales, once nothing is writing to the catalogs.
- Two landing components still read reduced motion through framer's hook
  against the rule above: `spark/market/parts.tsx` and `spark/market/CzMap.tsx`.
  `parts.tsx` branches only `layoutId` inside a client-only subtree; `CzMap` branches
  `initial={reduce ? false : { opacity: 0 }}` on a server-rendered node, which is
  the inline-style hydration mismatch the rule exists to prevent.
- `data/market_pulse.json` region vacancy counts sum to ~35 200 against a
  national total of ~38 600: postings with no `kraj` are unattributed. The hero
  states the true national figure; the map cannot be reconciled to it.
- `jd_references` items all ship `skills: []` — the Pumper sample feed never
  populates them. The JD subtitle no longer promises skills, and the unused
  `jobMarket.jd.skills` key has been retired.
- `StatTile` and `MomentumBadge` in `market/parts.tsx` are exported but unused
  since the Atlas variant won the prototype round; `jobMarket.stats.*` and
  `jobMarket.variants.*` are correspondingly unreachable copy.
- RSCP is annual and `ispv-zamestnani` is quarterly, so regional and national
  bands can drift up to a period apart. Both currently report `2025`.
- ČSÚ's authoritative per-region XLSX is not ingested; if the ~1.5 % gap ever
  matters, that is the upgrade, and it needs an XLSX parser plus an annual
  re-scrape of the product page for the new GUID URL.
