# Marketing surfaces — `/`, `/about`, `/market`

The three public, signed-out pages. They share one art direction (Spark: ink
outlines, hard offset shadows, tilt, Bricolage display face) and one set of
chrome conventions, but each answers a different question: *what is this*, *how
does it work*, *what does the market look like*.

These pages are the documented exception to the token rule in
[`docs/design/README.md`](../../design/README.md) — everything under
`app/landing/` is a fixed art direction and uses literal hexes. Nothing else in
the app may.

## Entry points

| Route | Renders | Purpose |
| --- | --- | --- |
| `/` | `app/page.tsx` → `HomeGate` → `app/landing/spark/SparkHome.tsx` → `SparkLanding.tsx` | The landing. Signed-out only; signed-in visitors get the workspace. |
| `/about` | `app/about/page.tsx` → `AboutHome.tsx` → `AboutCurve.tsx` | **About the app**, not about us — a scroll-drawn timeline of the seven pipeline phases. |
| `/market` | `app/market/page.tsx` → `MarketPulse.tsx` → `market/MarketPulseApp.tsx` → `MarketPulseAtlas.tsx` | "Market Pulse" — the Czech job market from open data. |
| `/landing`, `/landing/spark` | redirect stubs | Legacy bookmarks → `/`. |

### Module layout

`SparkLanding.tsx` is the landing's **composition and nothing else**: it renders
the bands in order and owns the single piece of state two of them share (which
feature spotlight is open, because the modal renders at the page root while the
cards that drive it sit inside `FeatureGrid`).

| Directory | Holds |
| --- | --- |
| `spark/sections/` | One module per band: `Topbar`, `Hero`, `Marquee`, `Steps`, `FeatureGrid`, `VoiceTeaser`, `TrustPillars`, `Cta`, `Footer` |
| `spark/previews/` | The nine product mockups a feature card opens, plus `shared.tsx` (the two entrance choreographies and the recurring card/chip/bar shapes) and `index.ts` (the key→icon+body registry) |
| `spark/about-art/` | One illustration per `/about` pipeline phase, plus `shared.ts` |
| `spark/Wordmark.tsx` | The brand lockup, used by all three pages |
| `spark/FeatureSpotlight.tsx` | The modal chrome that frames a preview |

This replaced three files of 615, 640 and 416 lines. The split was not
cosmetic: it is what made the i18n migration tractable, because each preview's
copy could move into `landing.previews.<key>.*` next to the component that
renders it. Nothing in the tree now exceeds ~150 lines except
`market/parts.tsx` (361), which is the next candidate.

All three are `instant = false` (Blocked under Cache Components): they render
under the per-request locale layout, so they cannot be statically prerendered.
All three are listed in `app/_lib/auth/public-routes.ts` and `app/sitemap.ts`.

## Navigation conventions

The three pages share one rule set, so a visitor learns the chrome once.

- **The topbar carries destinations only** — `/about`, `/market`, Sign in.
  In-page section anchors do not belong there: on the landing they competed with
  the links that actually leave the page.
- **In-page sections live in the scroll rail.** `app/landing/spark/SectionRail.tsx`
  is a right-hand rail that stays hidden until you scroll past the hero
  (`REVEAL_AT`), then tracks the section under the viewport's middle band via an
  `IntersectionObserver` and pins its label. Collapsed it is a column of dots;
  hovering or tabbing into the rail opens every label. Labels are always in the
  a11y tree (only their width animates), so it reads as a full nav to a screen
  reader. Sections: `#how`, `#features`, `#voice`, `#trust`, `#pricing`, plus a
  back-to-top control. Shown from `md` up.
- **The language switcher is footer-only.** `LandingLangSwitch` appears once per
  page, in the footer. It used to sit in the `/market` topbar as well; one place
  to change language beats two.
- **`/about` is labelled "About the app"** (`landing.nav.about`,
  `jobMarket.nav.about`) — `O aplikaci` · `Über die App` · `À propos de l'app`.
  The page describes the product's workflow, so it must not read as an
  about-us/company page. The Czech string was previously "O nás".

## Localization

Every visible string on all three pages resolves through i18n — the `landing`,
`aboutPage` and `jobMarket` namespaces in `messages/{en,cs,de,fr}.json` —
**including the page titles and descriptions**, which `/about` and `/market`
build in `generateMetadata` via `getTranslations` (the pattern
`app/jds/[slug]/page.tsx` established). Those were the last hardcoded English on
these pages, and they are the copy a search result and a shared link show.

Three things deliberately do **not** go through the catalog, and each is held as
a named constant rather than JSX text so the lint can tell them apart from copy:

- the **brand wordmark** — `spark/Wordmark.tsx` owns the one spelling of
  "KandiDate"; a brand name must never reach a message catalog;
- **illustrative figures** in the product mockups (`AXIS` in `SalaryPreview`,
  `FIGURE` in `about-art/OfferArt`) and the fictional candidate names, which
  ride into sentences as `{name}` placeholders;
- **technology names** (Java, Spring, SQL, REST) — a Czech reader looks for
  "Java", not a translation.

One case runs the other way: the voice **spotlight**'s two transcript lines stay
Czech in every locale, because they are the evidence for the note above them
("yes, it speaks Czech too"). The voice **teaser** on the page body follows the
reader's language, because it shows *an* interview, not specifically a Czech
one. Both are commented at the source and in the message keys.

### Enforcement

- `npm run i18n:check` — key parity across all four locales, ICU validity, and
  a grep for hardcoded `aria-label` / `title` / `placeholder` / `alt` in these
  three directories. That grep exists because the eslint rule below reads
  **text nodes only** and structurally cannot see an attribute — an untranslated
  `aria-label` is invisible in review but is the only thing a screen-reader user
  hears. The directories are at zero, so they are sealed.
- `i18next/no-literal-string` runs at **error** for `app/landing/**`,
  `app/about/**` and `app/market/**`. Until this pass the rule was switched
  **off** for `app/landing/**` — a carve-out from when that directory held
  throwaway rebrand prototypes. The prototype was promoted to the real public
  face and the carve-out was never revisited, so it was silently ignoring 50
  hardcoded strings on the app's most-visited pages.

## Market Pulse data model

`/market` reads one committed snapshot, `data/market_pulse.json`, through the
single seam `app/landing/spark/market/data.ts`. Nothing is fetched at request
time.

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

### Building

| Command | Needs | Rewrites |
| --- | --- | --- |
| `npm run market:build` | Pumper on `:8088` (counts) **and** `data.mpsv.cz` (pay) | The whole snapshot |
| `npm run market:earnings` | `data.mpsv.cz` only | The salary layer of the committed snapshot, in place — counts untouched |
| `npm run market:apply` | — | Feeds `reference_salaries` back into `data/salary_benchmarks.json` for the jobfit anchors |

`market:earnings` exists because the pay layer has no Pumper dependency, so it
can be refreshed from anywhere. Both scripts share the same aggregation module,
so a full rebuild cannot regress to advertised pay.

Both validate, and both warn loudly on the failure that matters: a national
median below 35 000 Kč means a salary field is reading adverts again. `market:earnings`
additionally asserts Prague is the highest-paid region.

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

`isFigure()` in `data.ts` is the single gate — `Number.isFinite`, not a null
check, because `Math.min()` of an empty array is `Infinity` and the ratios
downstream become `NaN`. `heatColor`/`salaryColor`/`regionScale` clamp
non-finite input (`heatColor(NaN)` used to destructure `undefined` and throw,
taking the whole map down client-side).

Two families carry no data at all and so never render: `product_project` has no
ISPV occupation coverage (`apply-market-salaries.mjs` documents the same gap),
and `momentum` is `0` across the board until consecutive snapshots differ —
`MomentumBadge` treats `0` as "no change measured", not as an increase.

## Known gaps

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
