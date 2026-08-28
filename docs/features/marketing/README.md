# Marketing surfaces — `/`, `/about`, `/market`

The three public, signed-out pages. They share one art direction (Spark: ink
outlines, hard offset shadows, tilt, Bricolage display face) and one set of
chrome conventions, but each answers a different question: *what is this*, *how
does it work*, *what does the market look like*.

These pages are the documented exception to the token rule in
[`docs/design/README.md`](../../design/README.md) — everything under
`app/landing/` is a fixed art direction and uses literal hexes. Nothing else in
the app may.

The patterns these pages are built on, written for someone porting them into a
different repository, are in [`docs/marketing/the-bar.md`](../../marketing/the-bar.md).

## Entry points

| Route | Renders | Purpose |
| --- | --- | --- |
| `/` | `app/page.tsx` → `HomeGate` → `app/landing/spark/SparkHome.tsx` → `SparkLanding.tsx` | The landing. Signed-out only; signed-in visitors get the workspace. |
| `/about` | `app/about/page.tsx` → `AboutHome.tsx` → `AboutCurve.tsx` | **About the app**, not about us — a scroll-drawn timeline of the pipeline phases (`about-art/shared.ts` `ABOUT_STEP_KEYS`). |
| `/market` | `app/market/page.tsx` → `MarketPulse.tsx` → `market/MarketPulseApp.tsx` → `MarketPulseAtlas.tsx` | "Market Pulse" — the Czech job market from open data. |
| `/landing`, `/landing/spark` | redirect stubs | Legacy bookmarks → `/`. |

### Module layout

`SparkLanding.tsx` is the landing's **composition and nothing else**: it renders
the bands in order and owns the single piece of state two of them share (which
feature spotlight is open, because the modal renders at the page root while the
cards that drive it sit inside `FeatureGrid`).

| Directory | Holds |
| --- | --- |
| `spark/sections/` | One module per band: `Topbar`, `Hero`, `Marquee`, `Proof`, `FeatureGrid`, `VoiceTeaser`, `TrustPillars`, `Cta`, `Footer` |
| `spark/sections/FeatureCardArt.tsx` | The nine feature cards' watermarks — one traced from each preview |
| `spark/trust-art/` | The four Responsible-AI demonstrations the `#trust` band switches between, plus `shared.tsx` (the fixed stage and the `cycle()` loop helper) and `index.ts` (the key→accent+body registry) |
| `spark/useStillMotion.ts` | `prefers-reduced-motion` as an external store — the SSR-safe replacement for framer's hook |
| `spark/previews/` | The nine product mockups a feature card opens, plus `shared.tsx` (the two entrance choreographies and the recurring card/chip/bar shapes) and `index.ts` (the key→icon+body registry) |
| `spark/about-art/` | One illustration per `/about` pipeline phase, plus `shared.ts` — which owns `ABOUT_STEP_KEYS`, the phase list `AboutCurve` derives its rows AND its spine from |
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

### What the landing's bands argue, in order

`Topbar · Hero · Marquee · Proof · FeatureGrid · VoiceTeaser · TrustPillars ·
PricingSection · Cta · Footer`.

**No two coloured bands repeat, and no two neighbours match.** Cream hero →
coral marquee → steel proof → limewash features → cream voice → **moss trust**
→ amber pricing → cream CTA/footer. Cream is the page ground, so the bands that
declare no background of their own (voice, CTA, footer) sit on it; every band
that *does* paint one uses a different brand hue. `#trust` was cream, directly
below the cream voice teaser, which meant the section boundary did not read as a
boundary at all. Moss and ink were the two unused hues; ink is unusable as a
ground here, because the whole Spark idiom is ink outlines and `6px 6px 0 ink`
shadows, and both vanish against it. Adding a band means picking the remaining
hue, not reusing one.

- **The hero sells automation, not detection.** `landing.hero.*` leads on the
  pipeline running itself — ad to offer, with the operator reviewing only the
  calls that matter. It used to open on *"Did the candidate write it, or the
  model?"*, which is a real differentiator but a second-order one: it needs a
  paragraph of setup before it lands, so the page opened on a worry instead of
  on the value. That story keeps its home in the `#proof` band directly below,
  where it has room to argue. Two CTAs — start, and watch the demo; the third
  ("hear it interview") was an in-page jump to `#voice` competing with the two
  that actually start something, and the scroll rail already navigates the page.
- **There is no "how it works" band.** Three generic steps between `#proof` and
  `#features` re-told the funnel that `/about` tells properly, as a scroll-drawn
  eight-phase timeline. The landing no longer carries the short, worse version;
  `landing.steps.*` and `landing.nav.how` are retired from all four catalogs.
- **A feature card is title + body over its own watermark.** Each of the nine
  cards renders `sections/FeatureCardArt.tsx` — line art traced from the mockup
  that card opens (`score` is ScorePreview's dial, `schedule` its slot grid with
  the picked cell filled, `inbox` five doors funnelling into one tray), plus a
  corner wash in that card's accent. The leading icon tile and the trailing
  "peek inside" line both went: the icon reappears in the spotlight header the
  card opens, and `features.hint` above the grid already says every card peeks —
  so both spent card space repeating something a scroll away, while making all
  nine cards look alike. The art is `aria-hidden`, inert, and sits at ~12%
  opacity so it reads as watermark, never as content; `fill="#fff"` on a white
  card is invisible by design, knocking holes in the line art the way a
  sticker's paper does so overlapping shapes stay legible.

### The Responsible-AI band demonstrates, it does not assert

`#trust` was four static cards in a row — icon, heading, paragraph. Four
paragraphs of compliance prose side by side is the least-read furniture on any
B2B page, and none of it was evidence: "human in the loop" as a sentence is
exactly as believable as a competitor's identical sentence. It is now **one
frame with four tabs below it**, each opening a demonstration of the claim it
names (`spark/trust-art/`):

| Tab | What it shows |
| --- | --- |
| `human` | `HumanLoopArt` — a candidate token rides the rail through intake and scoring on its own, then **stops** at a gate whose barrier is down, and moves only after a stamp lands with a person's name on it. Three toggles below answer the buyer's real follow-up — *which* steps may run unattended. Two flip; `reject` is locked, because "by design, not by a setting" has to survive contact with the setting. |
| `oversight` | `OversightArt` — the EU AI Act's own four-rung risk ladder, with a marker dropping onto the rung hiring occupies, then the three duties that rung obliges. |
| `gdpr` | `GdprArt` — the record stays redacted until the consent stamp lands. `erase` is a **live button**: it shreds the record on screen and offers a restore. `see` and `review` are chips, not controls — a button that pretended to file a human-review request would be the one dishonest pixel on the page. |
| `audit` | `AuditArt` — three sealed decisions linked by their hashes; something edits the middle one, its hash changes, and the link after it snaps. Only the *edited* block's hash crossfades: the others did not change, and what fails downstream is the link, not their digest. Below it, the calibration chart. |

Conventions worth keeping:

- **One fixed stage height per breakpoint** (`ArtStage`), because the tabs sit
  *below* the frame — a panel that resized would move the control the reader is
  about to click. Sized to the tallest story in the longest locale; the stage
  uses `grid-cols-[minmax(0,1fr)]` so the track can shrink below its content's
  min-content width instead of shouldering the frame open on a phone.
- **Every story is one `duration` with `times` as fractions of it** (`cycle()`
  in `trust-art/shared.tsx`). No timeline object: elements mount together and
  stay in lockstep, which is what keeps the stamp landing on the same beat as
  the barrier lift.
- **The tab strip is the WAI-ARIA tabs pattern** — `role="tablist"` with a
  roving tabindex, arrows/Home/End moving selection and focus together. The
  active pill slides via a shared `layoutId`.
- **recharts is lazy** (`trust-art/CalibrationChart.tsx` behind `next/dynamic`,
  the same lazy-boundary split `app/_components/FactorChart.tsx` uses). It is
  the one genuinely quantitative claim on the marketing page, and it must not
  cost every visitor who never opens the tab a chart library. Its `YAxis` is
  pinned to `[0, 100]`: both series are percentages, and recharts would
  otherwise fit the domain to the data and exaggerate the very gaps the panel
  exists to show are small.
- **Reduced motion goes through `useStillMotion`, never framer's hook.** See
  the module comment: framer's answer is wrong during SSR, so branching markup
  or initial styles on it fails hydration and re-renders the whole page on the
  client — for the visitors who asked for less work. The hero's confetti did
  exactly that. Framer's hook also reads the query exactly once into `useState`
  and never re-reads it, so a component on it ignores the preference being
  turned on mid-session.
  `spark/AboutCurve.test.ts` now enforces both halves over the whole
  `app/landing/` tree: no file may import framer's `useReducedMotion`, and any
  file containing a `repeat: Infinity` loop must gate it. Four pre-existing
  holdouts are listed in that test's `KNOWN_FRAMER_HOOK_HOLDOUTS` — see
  Known gaps.

## Navigation conventions

The three pages share one rule set, so a visitor learns the chrome once.

- **The topbar carries destinations only** — `/about`, `/market`, Sign in.
  In-page section anchors do not belong there: on the landing they competed with
  the links that actually leave the page.
- **In-page sections live in the scroll rail.** `app/landing/spark/SectionRail.tsx`
  is a right-hand rail that stays hidden until you scroll past the hero
  (`REVEAL_AT`), then tracks the section under the viewport's middle band via an
  `IntersectionObserver`. Sections: `#proof`, `#features`, `#voice`, `#trust`,
  `#pricing`, plus a back-to-top control. Shown from `lg` up.
  - **Every label is legible at rest** — inactive entries at 55% opacity, the
    active one at full. The rail used to collapse to bare dots with only the
    active label pinned, which made it a scroll-position *readout* rather than a
    nav: you cannot pick a destination you cannot read. Opacity alone carries
    the state, so nothing reflows as you scroll.
  - **It is positioned against the content column, not the viewport edge:**
    `left: min(calc(50% + 36rem + 0.5rem), calc(100% - 9.25rem))`. Open labels
    make the rail ~8.9rem wide, and the bands are `max-w-6xl` (72rem) — so a
    plain `right-5` laid it over the third feature card on a 1440px laptop. The
    first term parks it just past the content's right edge; the `min()` clamps
    it back onto the viewport below ~1480px, where no gutter exists and an
    overlay is the only option.
  - **Clicks glide, they do not cut.** `scrollToSection` calls
    `scrollIntoView({ behavior: "smooth" })` (`"auto"` under `prefers-reduced-motion`)
    and updates the hash with `replaceState`, not `pushState` — the rail is a
    scrubber, not a trail of destinations, so it must not bury the referring
    page under five back-presses. The `href="#id"` stays as the no-JS fallback.
- **The language switcher is footer-only.** `LandingLangSwitch` appears once per
  page, in the footer. It used to sit in the `/market` topbar as well; one place
  to change language beats two.
- **The landing footer carries the legal row** — `/privacy`, `/terms`, `/trust`
  (`landing.footer.{privacy,terms,trust}`). A product that captures candidate
  PII exposes its policies from its front door; `/trust` is the evidence page
  behind the hero's verified-hiring claims (public since 2026-08-05, was
  noindexed). All three are in `app/sitemap.ts` and the public-routes
  allow-list.
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
- `app/landing/spark/PricingSection.test.ts` (the price list) and
  `app/landing/spark/MarketingClaims.test.ts` (the prose claims) — see
  [The claims are pinned, not proofread](#the-claims-are-pinned-not-proofread).
  Both read the shipped catalogs and the shipped enforcing module, so there is
  nothing to keep in sync.
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

## The claims are pinned, not proofread

Everything on these pages is a promise a prospect can hold the product to, and
it is published in four languages on a page nobody re-reads. `PricingSection.test.ts`
has always pinned the price list to `billing/plans.ts`. **`MarketingClaims.test.ts`
now does the same for the prose claims** — each test pins the ONE structural fact
its claim rests on, so it fails when the code moves rather than when the wording
is edited:

| Claim | Pinned to |
| --- | --- |
| the human gate is the DEFAULT, and delegable | `INTERVIEW_PLAN_DEFAULT` is human on every step and round; `automation-run.ts` still has its two `getPlanGateForRole(…) === "auto"` branches and no rejection branch |
| no page promises onboarding | `TENANCY_RETIRED_TABLES` still lists the onboarding tables; the ban then sweeps the whole `landing` + `aboutPage` namespaces, per locale |
| the language claim | `LOCALES.length` — the numeral, read the way the pricing test reads a price |
| SSO is not sold as shipped | no SAML/OIDC implementation in `_lib/auth/*`; the capability must carry a "(planned)" marker in every locale and the blurb must not name it |
| `/about` walks every phase | `aboutPage.steps` key order equals `ABOUT_STEP_KEYS`, each eyebrow states its own 1-based position, and the hero states the phase count |

Two of those need a per-locale table in the test (the "by default" qualifier and
the "(planned)" marker), because **a claim whose honesty lives in a qualifier is
false the moment a translation drops it**, and key-parity cannot see that. The
tables' key sets are asserted equal to `LOCALES`, so adding a locale fails the
test rather than silently exempting it.

## Known gaps

- **`app/_lib/trust-posture.ts`'s Art. 14 row still carries the old absolute.**
  It reads "No candidate is rejected, advanced or offered by the machine alone",
  which is the sentence `landing.trust.human.body` was corrected off on
  2026-08-28 — `screeningGate: "auto"` auto-ratifies a held review
  (`auto_advanced`) and `offerGate: "auto"` extends a drafted offer unattended
  (`offer_auto_extended`, `automation-run.ts`). `/trust` is owned by its own
  goal and its posture rows were deliberately left untouched here; the same
  correction is owed there, and `MarketingClaims.test.ts` does not reach it.
- **`HumanLoopArt`'s "What may run unattended" panel lists screening /
  scheduling / rejection.** The real per-stage gates are screening and offer;
  rejection is the one that cannot be delegated, and it is the one the panel
  draws as a locked toggle. The demonstration is now arguing a slightly
  different shape from the paragraph beneath it. Art change, not copy.
- **`landing.trust.art.audit.calibration.note`** ("the bars line up, so the
  number means what it says") is the same settled-calibration assertion that
  `trust.audit.body` was softened off. It is demonstration copy inside a
  stylised chart rather than a claim in a paragraph, so it was left; if the
  panel is next revised, soften it to match the body.
- Four landing components still read reduced motion through framer's hook
  against the rule above: `spark/SectionRail.tsx`, `spark/FeatureSpotlight.tsx`,
  `spark/market/parts.tsx` and `spark/market/CzMap.tsx`. The first three branch
  only `initial`/`layoutId` inside a client-only subtree; `CzMap` branches
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
