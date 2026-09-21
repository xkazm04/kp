# English style: kp (source locale)

English is kp's source: `messages/en.json` feeds cs/de/fr through `/i18n-translate`, so a
fix here reaches every locale. This file is the **delta** over the registry's `english`
subject (rule IDs `EN-*`); it cites rules and never restates them. Declared values live in
[`copy-contract.json`](copy-contract.json) and are checked by `npm run copy:check`.

## Declared mechanics

| Mechanic | Declared | Rule | Since |
|---|---|---|---|
| Spelling variant | US | EN-SPELLING | 2026-09-14 (operator, fleet-wide) |
| Em dash | banned in product copy | EN-DASH | 2026-08-12 ([contract.md §5](contract.md)); extended to non-catalog English 2026-09-14 |
| En dash | between numbers only | §5, gated by `i18n:check` | 2026-08-12 |
| Case, headings and buttons | sentence case | EN-CASE, EN-END-PUNCT | 2026-09-14 |
| Double quotes | curly | EN-QUOTES | 2026-09-14 |
| Ellipsis | the `…` character | EN-ELLIPSIS | 2026-09-14 |
| Numbers and currency | English formats, no source-locale residue | EN-SOURCE-RESIDUE | 2026-09-14 |

## House rulings

- **US English** (2026-09-14, operator). At adoption the catalog held 164 US and 34 UK
  forms; the UK forms (`cancelled`, `labour`, `colour`, `programme`...) are migration debt in
  the baseline, not a second standard. No earlier kp ruling declared a variant.
- **No em dash.** See [contract.md §5](contract.md) for the ruling, its reason and the
  recast table. `i18n:check` gates it in every catalog; `copy:check` also covers the English
  that lives outside catalogs (the `/trust` page, `app/_lib/trust-posture.ts`, the setup
  studio's `copy.ts`), where 38 em dashes remained at adoption (baselined). The standalone
  no-data glyph and code comments are out of scope.
- **Sentence case.** Only 2% of heading-class strings were Title Case; there is no declared
  title-case element class. The `report.compare.*` titles are drift (EN-CASE warns).
- **The Czech koruna is `Kč` in Czech only, `CZK` in every other language** (2026-09-14,
  operator). English puts the ISO code before the amount (`CZK 240`, EN-CURRENCY); German and
  French put it after, with a no-break space (`240 CZK`), the form `Intl` renders for those
  locales. Applied the same day to `landing.pricing.*` in en/de/fr (the five
  EN-SOURCE-RESIDUE `Kč` findings are gone from the baseline) and to the Market Pulse map's
  region labels, which formatted with the `cs` default whatever the page language. Pinned by
  `app/landing/spark/PricingSection.test.ts` and `market/regionLabel.test.ts`.
- **Apostrophes:** straight and curly both stand as they are (2026-09-14, operator); not
  declared in the contract, not a finding. At adoption: 651 straight, 102 curly.

## Register and voice

Operator surfaces are functional. End-user surfaces (`apply`, `schedule`, `interview`,
`status`, `offer`, `devcase`, `data`) are warmer (contract.md §7); judge EN-EXCLAIM per
rendered state, not per namespace. `/trust` is English-only by design, and its wording is
load-bearing. Money pages get a full review and a human: `landing.pricing`, `apply`,
`offer`, `/trust`, `legal.*`.

## The gate and its escape hatch

- `npm run copy:check` runs the whole scope against `.ai/copy-baseline.json` and fails only
  on NEW error findings; warnings print. `.githooks/pre-push` runs it on pushes to main
  (hooks wired by `npm install` via `prepare`; `KP_SKIP_GATE=1` skips the whole gate, per
  the hook). It is **not** in CI: the checker is the registry's gitignored `native-copy`
  link, and the hook says loudly when it is absent.
- A deliberate exception is made visible, never bypassed: an intentional string goes into
  the baseline (`copy:check -- --baseline write`) in its own commit whose message says why.
  A rule that is wrong for this catalog is set to `off` under `rules` in the contract, with
  the reason recorded here. Never `--no-verify`.
- Baseline at adoption: 166 fingerprints covering 77 error findings (EN-SPELLING 32,
  EN-DASH 30, EN-SOURCE-RESIDUE 14, EN-SPACING 1) and the warnings. Rewrite the baseline
  after a debt sweep to tighten it.
