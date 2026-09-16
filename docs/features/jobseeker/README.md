# Job seeker — `/me`

> Status 2026-09-16: **under construction** on branch `spark/candidate-jobseeker`.
> This file is the doc-sync anchor for the module (`scripts/docs/feature-doc-map.json`);
> each work package fills its section in the same commit as the code.

The seeker-side of kp: the person running the install is looking for a job rather
than hiring. They reach `/me` by choosing "I'm looking for a job" on the first-run
Welcome step. Design record: the Spark vault idea `candidate-jobseeker` (2026-09-16);
dependency decision: [ADR 0009](../../architecture/decisions/0009-one-html-parser-for-owner-consented-acquisition.md).

## Entry points

| Surface | Path | Gate |
| --- | --- | --- |
| Thin shell (rail: brand mark, four links, appearance + language) | `app/me/layout.tsx` | `isOperator()` else 404; not in `PUBLIC_PAGES`, so the fail-closed proxy walls it when a password is set |
| Profile & CV studio | `app/me/page.tsx` | WP2 |
| Jobs feed + posting detail + fit dialog | `app/me/jobs/**` | WP5 |
| Sources (three tiers, acknowledgement) | `app/me/sources/**` | WP5 |
| Scans (shared scheduler registry) | `app/me/scans/**` | WP5 |
| API | `app/api/jobseeker/**` | operator-gated + `requireOperator` in every handler |

## Wire vocabulary

One file, `app/_lib/jobseeker/types.ts`: preferences, profile, sources (tiers A/B/C,
adapters, pause reasons, run outcomes), the extraction-rules DSL, postings + the feed
projection, dialogs and their artifacts, the Studio turn/reply shapes, the scan
summary. Every package imports from it; nothing redeclares it.

## Data model

Four workspace-scoped tables (all in `TENANCY_SCOPED_TABLES`, each with a colocated
`*-tenancy.test.ts`): `jobseeker_profiles`, `jobseeker_sources`, `jobseeker_postings`,
`jobseeker_dialogs`. DDL in `app/_lib/db/core.ts`; stores in `app/_lib/db/jobseeker-*.ts`.

## Keyless behaviour (product property)

- Dialog turns come from `pipeline/jobfit/jobseeker_cli.py`; without a provider the
  scripted `deterministic_turn` answers with `source: "deterministic"` and a
  `fallbackReason` — never an empty reply.
- Every harvested posting is structured deterministically and scored by the existing
  matcher; the LLM deep-dive runs only for the shortlist and is skipped keyless with
  `deepDiveSkipped: "no_provider"`.
- Under `KP_OFFLINE` every source returns `offline` before any egress.

## LLM use cases

`cv_polish`, `fit_dialog`, `extraction_rules` (Settings → Models section "Job search");
the deep-dive reuses `jd_ingest` and `match_reasoning`.

## Error codes

`JOBSEEKER_*` in `app/_lib/api-response.ts` (one STORE code, thirteen REFUSAL codes);
every code has four catalog entries under `errors.*`.

## Scheduler

`app/_lib/scheduler-jobs.ts` is the registry of named clock jobs, and since WP4a
the clock loop (`instrumentation-node.ts`), `/api/automation/schedule` and
`SchedulerControl` iterate it instead of naming jobs. `jobseeker_scan` is
registered there: 720 min (twice a day — a board changes on a human cadence),
`defaultEnabled: false`, `fanOut: "per-workspace"`, `requiresVerifiedRun: true`.
That last flag is the gate: the route refuses `POST { job: "jobseeker_scan",
enabled: true }` with `JOBSEEKER_SCAN_UNVERIFIED` (409) until `scheduler_runs`
holds one `ok` row for the job (`hasVerifiedRun`), and the panel renders the
toggle disabled with `pipeline.scheduler.unverified` as its title. Disabling and
re-timing are never gated — only arming is. The clock's handler for the job is a
**WP4c placeholder**: a claimed run records `{ skipped: "not_wired" }` with status
`skipped`, which does not verify the job (only `ok` does). WP4c replaces it with
the real per-workspace source scan and the manual "scan now" door whose first
success is what arms the timer. Pinned by `app/_lib/scheduler-jobs.test.ts` and
`app/api/automation/schedule/route.test.ts`.

## Sources and politeness

Acquisition is owner-consented (ADR 0009 §3). Every adapter fetches through ONE door,
`app/_lib/jobseeker/fetch/politeFetch.ts`, whose state is keyed by host:

| Concern | Behaviour | Where |
| --- | --- | --- |
| Offline | `KP_OFFLINE` → `offline` before any network; every adapter halts with zero fetch calls | `politeFetch.ts`, `adapters.test.ts` |
| robots.txt | Fetched once per host, cached 24 h; groups for `*` and `kp-jobseeker`, longest-match Allow/Disallow with `*`/`$`, `Crawl-delay` honoured; unreachable/404 = allow (logged once); 5xx = `outage` for the host for 1 h | `fetch/robots.ts` |
| Spacing | `max(Crawl-delay, 2 s) + jitter`, jitter = FNV-1a(sourceId) % 700 ms; ONE in-flight request per host, queued | `spacingFor`, `withHostSlot` |
| Identity | `user-agent: kp-jobseeker/1.0 (+https://github.com/xkazm04/kp; owner-operated)`, `accept` per adapter, `accept-language` from the call | `USER_AGENT`, `DEFAULT_ACCEPT` |
| Bounds | 15 s timeout, 2 MB body cap (`outage`/`too_large`), http(s) only, ≤ 5 redirects followed by hand so a cross-host hop re-checks the new host's robots | `FETCH_TIMEOUT_MS`, `MAX_BODY_BYTES` |
| Classification | 401/403/429 → `blocked`; a 200 whose HTML carries one of six documented bot-wall signatures (`INTERSTITIAL_SIGNATURES`) → `blocked`; 404/410 → `gone`; 5xx/timeout/network → `outage`; disallowed path → `robots_disallowed` | `classifyStatus`, `looksLikeInterstitial` |
| Retry | Never for `blocked`. The fetcher retries nothing; the scan runs again next tick | — |

`blocked` is a relationship signal: `reconcileSource` (`app/_lib/jobseeker/reconcile.ts`)
stops the source at the first denial, records `blocked` and pauses it (`pausedReason:
"blocked"`); only the owner resumes it (PATCH `{resume: true}`). A source that fetched fine
but yielded nothing recognisable is `collapsed` (paused as `collapsed`), never a green run
with zero rows. Postings are marked absent (`markAbsent`, two misses → `gone`) only after a
COMPLETE successful pass — a truncated (`maxDetailFetches` reached), failed or stopped run
says nothing about who is gone. `SourceRunSummary.reason` is the closed set
`RECONCILE_REASONS`: `blocked · offline · shape_changed · required_rule_miss ·
robots_disallowed · source_outage · source_gone · config_invalid · adapter_error`.

### Tiers and the catalog

`app/_lib/jobseeker/sources-catalog.json` is the research record: per source `tier`,
`adapter`, `kind`, `robotsSummary`, `termsQuote` (a clause SUMMARY, paraphrased where the
original is Czech/Slovak — `termsUrl` is where to verify), `cadenceNote`, `refusedReason`
for tier C, and `checkedOn`. `sources-catalog.ts` types it and adds `termsHash =
sha256(termsQuote)`; a changed summary re-asks the owner because
`JobseekerSource.acknowledgedTermsHash` no longer matches.

- **A** — EURES (attribution "Data: EURES / European Labour Authority" on every posting),
  MPSV open data, and eight ATS vendors' public endpoints (Greenhouse, Lever, Recruitee,
  Teamtailor, Personio, Workable, Ashby, SmartRecruiters — each needs a company slug;
  `atsDiscover(slug, fetch)` probes all eight once).
- **B** — startupjobs.cz, prace.cz, profesia.sk, cocuma.cz (sitemap + JSON-LD JobPosting)
  and jobs.cz (no sitemap, no JSON-LD → authored rules). robots.txt permits the pages; the
  terms forbid automated processing. Enabling needs `PATCH {enabled: true, acknowledge:
  true}` — otherwise 409 `JOBSEEKER_SOURCE_NOT_ACKNOWLEDGED` carrying the `termsHash`.
- **C** — LinkedIn, Indeed, StepStone: listed with `refusedReason`, never fetched; POST
  and PATCH answer 403 `JOBSEEKER_SOURCE_REFUSED`. A host outside the catalog is tier B.

### Adapters (`app/_lib/jobseeker/adapters/`)

`SourceAdapter = { name, detailFetches, discover(ctx) → AsyncIterable<PostingRef>,
detail(ref, ctx) → RawPosting | null }`; `adapterFor(name)` in `registry.ts` covers every
`SOURCE_ADAPTERS` name; `hostForAdapter(adapter, config)` derives the politeness host.
Feeds (EURES, MPSV, the ATS APIs except SmartRecruiters) carry the body in the listing and
complete `detail` from the ref's `hint` with no fetch. `mpsvBulk.ts` reads the ~184 MB file
as a STREAM through `jsonArrayStream.ts` (an incremental, quote/bracket-aware JSON array
reader — never the whole file); the daily delta file's URL could not be confirmed offline,
so `config.url` overrides the full-file default. `boardSitemapJsonld.ts` walks a sitemap
(index → children, capped at `maxRefs`) and maps `schema.org/JobPosting` (title,
hiringOrganization, jobLocation, `jobLocationType: TELECOMMUTE`, datePosted, baseSalary →
`RawPosting.salary`, description via `htmlToText`, identifier) — no JSON-LD → `<title>` +
readable text. `boardRules.ts` runs the source's rules over `config.listingUrls`
(`{page}` placeholder, `maxPages`). Limits: `AdapterLimits { maxRefs: 500, maxDetailFetches:
60 }` per source per run (the `PULL_LIMITS` precedent).

### API (`app/api/jobseeker/sources/**`, all `requireOperator()` → limiter → body)

| Route | Verb | Does | Limiter |
| --- | --- | --- | --- |
| `/api/jobseeker/sources` | GET | `{catalog, sources}` | — |
| `/api/jobseeker/sources` | POST | create from `{catalogId, config?}` or `{adapter, config, host?}`; tier C → 403 | `jobseeker-sources-write` 60/10 min |
| `/api/jobseeker/sources/[id]` | PATCH | `{enabled?, acknowledge?, pause?, resume?, rules?, rulesBaseline?}`; tier B gate 409; rules 400 `JOBSEEKER_RULES_INVALID` | same bucket |
| `/api/jobseeker/sources/[id]/preview` | POST | `{rules?, url?}` → politeFetch + dry run → `{outcome, perRule, items ≤ 5, baseline}`; writes nothing; offline 503, blocked 423 | `jobseeker-preview` 10/10 min |
| `/api/jobseeker/sources/[id]/rules/propose` | POST | fetch → `reduceHtmlForAuthoring` → `extraction_rules_cli` → validate → dry run; writes nothing | `jobseeker-rules-propose` 10/10 min |

A request on an unknown source id answers a bodiless 404 (see Known gaps).

## Rules DSL

`ExtractionRule` (types.ts): `field ∈ RULE_FIELDS`, `locator {kind, expr, attr?}`,
`cardinality one|many`, `pick first|last|fail`, `post[]`, `required`. Model-as-author,
engine-as-extractor (ADR 0009 §2): rules are proposed once per page shape from the REAL
reduced markup and run deterministically on every scan by `app/_lib/jobseeker/rules/engine.ts`
— the only consumer of `linkedom`.

| Locator | Resolves | Value |
| --- | --- | --- |
| `css` | `querySelectorAll(expr)` | `textContent`, or `attr` |
| `regex` | one capture group over the raw HTML, global | group 1 |
| `jsonld` | a dotted path into the page's `JobPosting` object (`@graph` flattened) | scalar or array |
| `pointer` | an RFC 6901 pointer into the first `<script type="application/json">` | scalar or array |

Post ops: `trim`, `text` (strip tags + entities), `absUrl` (against the page URL),
`number` (thousands separators handled), `date` (ISO, `d. m. yyyy`, RFC 2822; relative
phrases are NOT guessed → null). Items are column-oriented: each `many` rule is a column,
item *i* zips the *i*-th value of every column, a `one` rule broadcasts; the preview is
where a misaligned column shows up. `validateRules` (`rules/dsl.ts`) refuses what the engine
cannot run and enforces the identity invariants: a `url` rule exists and is required; an
`externalKey` rule, when present, is required; one rule per field; a regex compiles with
exactly one group.

Verdicts per rule: `hit`, `miss-required`, `miss-optional`, `ambiguous` (a `one` rule that
matched several with `pick: fail`). `isCollapsed(perRule, rules, baseline)` — any required
rule at 0, or any rule at 0 whose `rulesBaseline` was ≥ 5 — is the SHAPE condition that
makes a run `collapsed`; the baseline is the preview's per-field match counts, which PATCH
requires beside the rules. `reduceHtmlForAuthoring(html)` is the model's input: scripts
(except JSON-LD / `application/json`, truncated), styles, comments and SVG dropped, the
first three of any run of repeated siblings kept with a count note, selector-relevant
attributes only, ~40 kB cap. `pipeline/jobfit/extraction_rules_cli.py` (use case
`extraction_rules`) returns `{rules, source: "llm"|"deterministic", fallbackReason,
reasoning}`; keyless, the twin proposes url/title/externalKey rules from the page's largest
anchor group.

### Deterministic structuring

`pipeline/jobfit/posting_structure.py` turns every `RawPosting` into the matcher's `Job`
with no model: work mode (`TELECOMMUTE` → remote, else remote/hybrid regexes in cs/en/de/fr,
else onsite), seniority from the TITLE only, `role_family` via `classify_role_family`,
requirements = taxonomy skill terms (whole-token) tagged `must_have` when they sit under a
requirements header (požadujeme / requirements / Anforderungen / exigences …) and
`nice_to_have` otherwise or when the line says "výhodou / is a plus", a salary only when
stated (`raw.salary` first, then a currency-anchored regex; hourly dropped; a currency or
period the active market cannot compare is a `salary_not_comparable:` note, never a
converted number), `min_years_experience` from "N+ years/let/Jahre/ans", languages from the
taxonomy alias table plus de/fr ad-side forms. `posting_structure_cli.py` takes
`[{id, raw}]` and answers `{jobs, notes}` (one bad posting is skipped and named; exit 2 for
malformed input).

## Profile and CV studio

_WP2._

## Scan and scoring

_WP4._

## Feed, fit dialog, sources UI

_WP5._

## Known gaps

- Everything above marked with a work-package number is not built yet.
- No `JOBSEEKER_SOURCE_NOT_FOUND` refusal code exists yet; the sources routes answer an
  unknown id with a bodiless 404 (an unregistered code would fail `i18n:check`, English
  prose is never rendered). Adding the code means the registry plus four catalog entries.
- The MPSV daily delta file's URL is unconfirmed; the full file is the default and is
  streamed, but a 12-hourly scan still downloads ~184 MB per run until `config.url` points
  at the delta.
- `termsQuote` in the catalog is a paraphrased summary with the clause reference, not a
  verbatim quotation; verify against `termsUrl` before relying on it in a dispute.
- `test:e2e`, `test:python:gate` and `test:eval:ci` are not run by the spark; owed
  before the branch merges.
