# Markets: the currency, period and benchmark a workspace's pay figures follow

A workspace runs in one **market**. The market decides the currency a bare pay
figure is denominated in, the pay period it is per, the city an ad without a
location is placed in, the rounding grain and the plausibility ceiling, and
whether kp holds a salary benchmark there at all. Compensation is no longer
Czech by construction: Czech is the default market, not the only one.

There is **no currency conversion anywhere**. A figure is shown in the currency
it was stated in; figures in different currencies are labelled, never converted
or compared (a cohort member quoted in EUR beside CZK members is "Other currency").

## The vocabulary

| id | Currency | Period | Hub | Benchmark |
| --- | --- | --- | --- | --- |
| `cz` (default) | CZK | month | Praha | `cz-ispv-2025` (`data/salary_benchmarks.json` → `markets.cz`) |
| `de` | EUR | month | Berlin | none |
| `gb` | GBP | year | London | none |

Defined twice and pinned together:

- `pipeline/jobfit/market_config.py`: `MARKETS`, `MARKET_IDS`, `DEFAULT_MARKET_ID`,
  `has_benchmark(market)`, `market_for_id(id)`. `BERLIN_MARKET` (`de-berlin`) stays
  the **test** sample whose `salary_benchmarks.json` block is labelled "NOT real
  data"; it is not a product market and cannot be picked.
- `app/_lib/markets.ts`: `MARKET_IDS`, `MarketId`, `isMarketId`, `resolveMarketId`,
  `MARKETS`, `marketSpec`, `NO_MARKET_BENCHMARK`, `salaryWithheldForMarket`.
  Client-safe. `app/_lib/markets.test.ts` reads the Python module and fails when the
  two disagree on an id, a currency, a period, a hub or benchmark presence.

`de` and `gb` carry **empty** `seniority_default_bands` and an empty
`benchmark_source_id` on purpose: the correct configuration for an uncalibrated
market is "emit no number". The ceilings (30 000 EUR/month, 600 000 GBP/year) are
order-of-magnitude sanity bounds, not pay data.

## Where the market lives

The `market` phase of the tiered decision config (`app/_lib/decision-config-schema.ts`
`MarketRule` / `MARKET_DEFAULT`, validated by `validateMarketRule`). A team's own
choice wins, else the org baseline, else `cz`. It reuses the `decision_config` table,
which is already workspace-scoped (`TENANCY_SCOPED_TABLES`), exported `org_shared`,
and holds no personal data (nothing to erase) — no new table, no new column, no
restart. (The role band's own unit, below, IS two new columns on `jobs`.) `app/_lib/workspace-market-tenancy.test.ts` pins that one team's market
never reaches another.

- Read: `app/_lib/workspace-market.ts` — `getWorkspaceMarketId(ws)`,
  `getWorkspaceMarket(ws)`, `marketSpawnEnv(ws)` (`{ KP_MARKET }`).
- Door: `GET /api/workspace/market` (any session; `{ market, markets }`) and
  `PUT /api/workspace/market` `{ marketId }` (operator + `team:manage`; refusals
  `WORKSPACE_MARKET_INVALID`, `WORKSPACE_MARKET_SAVE_FAILED`). Writes the session
  workspace's own (team) row.
- UI: Settings → Workspaces, the current workspace's detail panel
  (`app/features/settings/workspace/WorkspaceMarket.tsx`). It states what changes,
  what kp cannot estimate in a benchmark-less market, and that nothing stored is
  converted. Editable with `team:manage` even while the multi-workspace lock is on.
- Client read: `app/_lib/use-workspace-market.ts` (`useWorkspaceMarket()`, one fetch
  per page load, default market until it lands; the picker invalidates it).

## How it reaches the pipeline

The TS side resolves the market once per request and passes it down. Formatters
take the currency and period as arguments; there is no global mutable currency
(`format.ts` `APP_CURRENCY` stays the default market's currency). Every spawned CLI
that prices, parses or reasons about pay receives `KP_MARKET` in `opts.env`
(`{ ...buildLlmConfigEnv(), ...marketSpawnEnv(ws) }`); `market_config.py` resolves
`ACTIVE_MARKET` from it **at import**, once per process, and the pipeline never reads
the DB for it. An unknown id logs to stderr and stays on `cz`.

Spawn sites that carry it: CV analysis (`analyze-run.ts`, whose cache key gains a
`market` field for a non-default market only), cohort compare, JD build's market
salary (`jd-build-run.ts`), JD/ad ingest and normalize (`job-ingest.ts` via its
callers: `jd-ingest.ts`, `/api/jobs/ingest`, `/api/jds/[slug]`, its `ingest-job` and
`revisions`), campaign, automation tasks (offer draft, letters), group evaluation,
winnability, match, matrix.

## What a market without a benchmark does

The honest degraded path (registry: recruiting
`compensation-banding-and-market-honesty` → `refuse-to-quote-an-uncalibrated-market`):

| Surface | Behaviour in `de` / `gb` |
| --- | --- |
| `taxonomy.role_band` / `role_benchmark` | `None` — never another market's figures (the old lookup fell back to the active market's roles). The role-family vocabulary is still the default market's, so classification works. |
| JD/ad normalize | no defaulted `salary_band`; the hub is the market's (`Berlin`, `London`). |
| `market_salary_cli` (JD builder) | 0–0 band, `absence: "no_market_benchmark"`, empty summary (it lands in the candidate-facing JD), `period` for a non-month market. JD ledger card: "No benchmark for this market". |
| CV analysis salary estimate | withheld (`pipeline.withhold_uncalibrated_salary`): an empty band in the market's units plus the coded finding `salary_no_market_benchmark`; the analysis prompt says there is no anchor. Salary tab: a stated absence instead of a 0–0 gauge. |
| Cohort salary dimension | absent with reason `noMarketBenchmark` — left out of the comparison, never rated as a 0 midpoint; the ledger's "why" line says so. A role band the ad states is read in the market's currency and period. |
| Winnability | `belowMarket: null` and `marketAbsence: "no_market_benchmark"` (never a clean "not below market"). |
| Offer draft | no default bands, so `recommended` is null and the draft waits at `offer_review` for a person. A recruiter's manual draft is denominated in the market's currency. |
| Agent-fit budget | no suggestion: its only anchor is a fixed CZK→USD rate. |

Bands a job ad or a candidate **states** are still shown and compared, in the
currency they were stated in.

## A role band carries its own unit

A role's salary band is stored WITH the unit it was set in: `jobs.band_currency`
(ISO-4217) and `jobs.band_period` (`month` / `year` / `hour`), beside
`jobs.salary_min` / `salary_max`. Changing the market converts nothing and relabels
nothing: a band keeps the currency and period it was set in.

| Store | Before | After |
| --- | --- | --- |
| `jobs.salary_min/max` + `payload_json.salaryBand` (the role band) | bare numbers, read in the CURRENT market | `band_currency` + `band_period` columns, stamped at write |
| `jds.analysis_json.salary` (the JD builder's grounded band) | `currency` + `period` (`market_salary_cli`) | unchanged; the JD re-sync stamps THIS unit onto the role, not the current market |
| `offers.currency` + `offers.salary` (one figure, not a band) | currency stamped from the market at draft | unchanged; no period column (`offers-store.ts`, the market's period by construction) |
| `jobseeker_postings.salary_currency/period` | already carried both | unchanged (candidate-side module) |
| `payload_json.salaryCurrency/salaryPeriod` | the AD's raw statement, not the band's unit | unchanged |

- **Write.** Every production caller of `insertJob` stamps the band through
  `withBandUnit(job, unit)` (`app/_lib/salary-band.ts`): the workspace's market
  (`getWorkspaceMarket(ws)`), or for a JD re-sync the grounded band's own unit
  (`groundedJdUnit`). `app/_lib/db/job-band-unit.test.ts` scans the callers; an
  unbanded one is listed with its reason. A job with no band stores no unit.
- **Migration.** Two additive ALTERs in `app/_lib/db/core.ts`. The backfill
  (`backfillTenantScope`, every boot, only unstamped rows that hold a band) stamps
  **CZK/month**: the market setting shipped in `166bc9557` and no band could have
  been written in another unit before it, and the seed corpus is Czech by
  construction. Verified 2026-11-10 on every database on the build machine: no
  `decision_config` row for the `market` phase existed. A server that was running
  when the columns arrived must be **restarted** before it writes jobs (its
  prepared statements predate the columns).
- **Read.** `getJob`, `listJobsPage` and `getJobsByIds` decorate `bandCurrency` /
  `bandPeriod` from the columns. `bandUnitOf(job)` is the reader (an unstamped band
  is CZK/month, the backfill's rule); `isSameBandUnit` is the one comparability
  predicate (currency AND period); `bandInOtherUnit(job, market)` says the band was
  set in another unit than the workspace's.
- **A band in another unit** is shown in its own unit with a label, never converted,
  and left out of every comparison that assumes one currency, with a stated reason:

| Surface | Behaviour |
| --- | --- |
| Jobs table | the cell adds "CZK/mo · set in another market, not converted" under the band (`jobs.table.bandOtherUnit`); the header still names the market's unit |
| Posting preview | the salary line is printed in the band's own unit |
| Cohort salary dimension | the band is marked `otherUnit` and not rated against; members are rated against the cohort median, and the criterion says the band is not compared (`criteria.salaryCohortBandOtherUnit` / `salaryBandOtherUnit`) |
| Manual offer draft | no midpoint and no `salaryMin/Max` from the band; the draft carries `bandAbsence: "band_other_currency"` and waits for a typed figure |
| Winnability | the route passes `bandCurrency` / `bandPeriod`; `winnability.py` refuses: `belowMarket: null`, `currencyComparable: false`, `bandAbsence: "band_other_currency"` (`BAND_OTHER_CURRENCY` on both sides) |
| Group evaluation | the compare spawn gets no band, and a candidate's expectation is shown to it only in the band's own currency |
| Decision card salary rail | plotted only when the expectation shares the band's OWN currency (`peer-context` `salaryBandCurrency`) |

## The Czech regression bar

With the default market every output is byte-identical: `KP_MARKET` is unset in
every fixture, eval and test; the CV analysis prompt was compared before/after
(identical, grounded and ungrounded); `market_salary_cli` adds no key for `cz`; the
analysis cache key is unchanged for `cz`; the posting unit message renders
"CZK / month" / "Kč / měsíc" as before. `pipeline/jobfit/tests/test_market_vocabulary.py`
runs the switch in a child interpreter, the way the app does.

## Known gaps

- The band's own unit does not yet reach: the matcher's salary eligibility flag
  (`matching.py` `_salary_flag`, fed by `listCorpusJobs`; a band in another unit is
  still read in the market's units there), the group-evaluation modal's band label
  (`groupEvalSalaryScale.ts`), the compact match band label (`matchTypes.ts`), the
  coach's band text (`jobsCoachSalary.ts`, which also shows nothing for a refused
  verdict) and the demo simulation's offer.
- Not yet market-aware: the guided simulation's demo offer (Czech seed data by
  construction), the posting
  translation's source render (`job-translate-run.ts`), the analytics money panels,
  the background `policy-pass` (market-agnostic today), the jobseeker module (a
  candidate-side product with its own currency parsing) and gigs (USD/EUR gig
  budgets, a different concept).
- Market Pulse (`/market`) is Czech public data by nature and stays Czech.
