# The bar: five patterns for a marketing surface that cannot lie

Written to be **ported**, not admired. Every pattern below is running in this
repo (Next.js App Router, next-intl, node:test, ESLint flat config) with a
`file:line` you can open; each section says what to copy, what it costs, and what
it does NOT catch. Target readers: another Next.js repo — ascent, Adamant.

The problem all five solve: a marketing page is the only surface where **prose
is a promise**, it is published in N languages nobody re-reads, and no compiler,
type system or test suite looks at it. Left alone it drifts from the product in
one direction only — the page keeps the claim, the code loses the feature. This
repo audited its own landing on 2026-08-28 and found six live false claims
(a retired module still promised, a human gate advertised as non-configurable
while two settings turn it off, a two-language claim on a four-language product,
SSO sold as shipped with no SSO code, an authorship detector the product
deliberately does not have, calibration reported as settled when the instrument's
own verdict is `circular`). None of them was a bug. All of them shipped green.

---

## 1. Copy is data, and the lint says so

**Do:** no visible string lives in a component. Every one resolves through the
message catalog; components hold structure only.

- `app/landing/spark/sections/Hero.tsx:34-38` — the CV pile is a `PILE` const of
  `{key, score, color}`; the name, role and verdict come from `pile.<key>.*`.
- `app/landing/spark/PricingSection.tsx:28-33` — `TIER_STYLES` carries icon,
  colour, rotation. Not one word.
- `app/about/page.tsx:20-29` — even `generateMetadata` goes through
  `getTranslations`. The title and description are what a search result shows;
  they are the last thing anyone remembers to localize.

**Enforce, in two layers, because one is structurally blind:**

- `eslint.config.mjs:109-135` runs `i18next/no-literal-string` at **error** for
  `app/landing/**`, `app/about/**`, `app/market/**` in `jsx-text-only` mode.
  Warn-level would have enforced nothing; this directory sat with the rule
  switched **off** for months and accumulated 50 hardcoded strings.
- `scripts/i18n-check.mjs:38-42,78,300-325` greps the same three directories for
  hardcoded `aria-label` / `title` / `placeholder` / `alt`. **The ESLint rule
  reads text nodes and cannot see an attribute** — an untranslated `aria-label`
  is invisible in review and is the only thing a screen-reader user hears.

**Two details that make it survive contact:**

- Things that must NOT be translated are held as **named constants**, never as
  JSX text — the brand wordmark (`app/landing/spark/Wordmark.tsx`), illustrative
  figures, technology names. The lint then can't see them, so you need zero
  per-site disables. A file full of `eslint-disable-next-line` is a rule nobody
  will keep.
- The attribute grep is scoped to directories that are already at **zero**. A
  gate you turn on at zero costs nothing forever; one you turn on at 79 known
  violations goes red on unrelated work and gets deleted.

**Does not catch:** whether the copy is TRUE. That is pattern 2.

---

## 2. Claim-parity tests: the public number equals the enforced number

**The pattern:** for every claim, find the module that has to make it true, and
write a test that reads the **shipped catalog** and the **shipped module** — not
a copy of either. There is then nothing to keep in sync.

- `app/landing/spark/PricingSection.test.ts` — the price list vs
  `app/_lib/billing/plans.ts`. It asserts the rendered tier ids equal the
  sellable plans, that a zero allowance is never advertised (a bullet promising
  what 402s on first use), that each stated figure equals `PLANS[t].limits[m]`,
  and — the sleeper — that **every locale states the same numbers and the same
  number of bullets**, because key-parity compares keys, not array lengths or
  contents, so a tier that lost a bullet in `de` is a different offer, unnoticed.
- `app/landing/spark/AboutCurve.test.ts` — the reduced-motion contract, as a
  guard rather than a doc line, over the whole tree.
- `app/landing/spark/MarketingClaims.test.ts` — the prose claims (added
  2026-08-28). Each test pins the ONE structural fact its claim rests on, so it
  fails when the code moves, not when the wording is edited: the human gate
  against `INTERVIEW_PLAN_DEFAULT` plus the two `getPlanGateForRole(…) === "auto"`
  branches in `app/_lib/automation-run.ts`; a retired module's ban anchored to
  `TENANCY_RETIRED_TABLES`; the language claim against `LOCALES.length`; the
  `/about` phase list against `ABOUT_STEP_KEYS`.
- `app/_lib/trust-posture.test.ts:33` — "the page is not all-green": asserts at
  least three rows are still `partial`/`not_yet`. **The failure mode it guards is
  "everything looks fine", not a rendering bug.** That inversion is the whole
  idea.

**Three things learned the hard way:**

- **Read source when you cannot import.** `node:test` cannot import a `.tsx`, so
  `PricingSection.test.ts:48-54` parses `TIER_STYLES` out of the file. Better
  still: move the vocabulary into a `.ts` the test can import — this repo moved
  the `/about` phase list into `about-art/shared.ts` for exactly that reason.
- **A claim whose honesty lives in a qualifier is false the moment a translation
  drops it.** "Human-approved **by default**" is true; without the hedge it is
  the claim that was just retired. So the test carries a per-locale table of the
  required qualifier (and of the banned denial), and asserts the table's key set
  equals `LOCALES` — adding a locale fails the test instead of silently
  exempting it.
- **Prove non-vacuity.** Paste the old, false strings back into one catalog and
  confirm the suite goes red before you commit. A claim test that passes against
  a lie it was written to catch is worse than none.

---

## 3. SSR-safe reduced motion as an external store

`app/landing/spark/useStillMotion.ts` — 42 lines, `useSyncExternalStore`, server
snapshot `false`.

**Why not framer's `useReducedMotion`:** the server has no media query, so it
answers "motion is fine" during SSR and the truth only after mount. Anything that
branches its **markup** or its **initial inline styles** on that answer hydrates
against HTML the server did not produce, and React throws the whole tree away and
re-renders on the client — the most work possible, for precisely the visitors who
asked for less. This repo's hero did it: `{!reduce && CONFETTI.map(…)}` dropped
five spans and took the page down. Framer's hook also reads the query exactly
**once** into `useState` and never re-reads it, so a visitor who turns the
preference on mid-session keeps a 26-second infinite scroll running until reload.

**The rule that follows: gate the `animate` prop, never the markup.** The
reduced version is then a *stopped* animation, not a missing element —
`Marquee.tsx:25`, `Hero.tsx:102,217`, `AboutCurve.tsx:159`.

**Make it a guard, not a doc line.** `AboutCurve.test.ts:67-92` walks the whole
`app/landing/` tree: no file may import framer's hook, and any file containing
`repeat: Infinity` must mention a gate. Pre-existing holdouts live in a named
`KNOWN_FRAMER_HOOK_HOLDOUTS` set with a comment saying **the list must only ever
shrink** — a ratchet beats a clean-up ticket. It strips comments before matching
(`code()` at `:40`), because one file names `repeat: Infinity` only to explain
why it uses a CSS keyframe instead.

---

## 4. The marketing doc has a "Known gaps" section that names false copy

`docs/features/marketing/README.md` ends in **Known gaps**, and the entries are
not "todo: polish": they name the exact message key that is lying, quote it, and
cite the code that contradicts it. Two of the six claims fixed on 2026-08-28 had
been sitting there, correctly diagnosed, waiting for someone to do the
four-catalog edit.

**Why this is worth more than it looks.** A gap you have written down in the
doc a future agent reads at task start is a gap that gets fixed. A gap you
noticed and did not write down is a gap that gets *re-discovered* — at the cost
of the whole audit, again. It also inverts the incentive: a "Known gaps" section
that is empty reads as suspicious, so nobody is tempted to keep it empty.

**Rules that keep it honest:** every entry cites a real path; anything
forward-looking goes to `docs/concepts/` or the backlog, never into a feature
doc; and when a gap is fixed, the entry is **replaced by what replaced it** — the
sections above the gaps list now describe the parity tests that closed them.

---

## 5. `/trust` — a posture page with "Not yet built" rows

`app/_lib/trust-posture.ts` (the data) + `app/trust/TrustContent.tsx` (the
presentation, a server component). Article by article: `enforced` / `partial` /
`not_yet`, each with a summary "a non-engineer can check us on" and, when it is
not enforced, a plainly stated `gap`.

**The argument, from that file's own header:** competitors publish "EU AI Act
compliant" as a badge, and a procurement reviewer knows a badge is unfalsifiable.
**A page that admits three gaps is worth more to a serious buyer than one that
admits none, and it is the only version you can defend when they ask for
evidence.** `byWeakestFirst()` sorts `not_yet` first — a trust page that opens
with its strongest row is a sales page; the reader's question is "what is
missing", so answer it first. `postureSummary()` puts the counts above the
detail so nobody comes away thinking every row is green.

**Port it as:** data module (pure, no DB, no server imports) + tests + a dumb
renderer. The data module is reviewable as text; the tests
(`app/_lib/trust-posture.test.ts`) assert the *shape of the honesty* — every
article cited not paraphrased, every non-enforced row naming a gap, at least
three rows outstanding, the disclaimer refusing to claim certified conformance.
This page is deliberately **English-only** (`TrustContent.tsx:1-12`): machine
translation is the wrong tool for text where "enforced in code" versus "partial"
is load-bearing, and one language you can stand behind beats four you cannot.

---

## Bonus: band composition, because layout drifts too

Two rules from `docs/features/marketing/README.md:50-64,142-168`, both cheap and
both the kind of thing that decays silently:

- **No two coloured bands repeat, and no two neighbours match.** Name the page
  ground, and let bands that declare no background sit on it. Adding a band means
  picking a hue nobody has used, not reusing one — the trust band was cream
  directly under a cream band, and the section boundary did not read as a
  boundary at all.
- **The topbar carries destinations only; in-page anchors live in a scroll rail.**
  Every rail label stays legible at rest (inactive at 55% opacity, active at
  full) — you cannot pick a destination you cannot read. The rail is positioned
  against the **content column**, not the viewport edge, so it does not lie over
  the content on a 1440px laptop. Its clicks use `replaceState`, not `pushState`:
  a scrubber must not bury the referring page under five back-presses.
