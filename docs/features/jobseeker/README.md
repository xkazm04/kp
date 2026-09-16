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

- The CV import's draft step (`/api/profile/draft` -> `profile_draft_cli`) degrades to `pipeline/jobfit/cv_draft.py` when no provider can serve (no key, `KP_OFFLINE`, a refused route): taxonomy skill terms, the years / city / seniority readers and the language aliases produce a thin, `self_declared` profile, and the CLI answers `source: "deterministic"` so the page can say what read the CV.
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
re-timing are never gated — only arming is. The clock's handler for the job
(`JOB_HANDLERS.jobseeker_scan` in `instrumentation-node.ts`) fans out over
`listWorkspacesWithEnabledSources()` — every workspace with a profile AND an enabled,
unpaused source; the ONE cross-workspace query in the seeker stores, tagged
`-- tenancy:global`, ids only — and runs `runJobseekerScan(ws, {trigger: "clock"})`
sequentially under one 8-minute budget. It answers `null` (no row) when no workspace
qualifies and `ok` with `{workspaces, matched, deepDived, blocked, collapsed, skipped}`
otherwise. The FIRST `ok` row can only come from the manual door (`POST
/api/jobseeker/scan` → the `jobseeker_scan` task), which records `ok` when at least
one source ran and the run completed, `skipped` when no source is enabled. Pinned by
`app/_lib/scheduler-jobs.test.ts` and `app/api/automation/schedule/route.test.ts`.

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
stated (`raw.salary` first, then a currency-anchored regex; the stated units always travel
on `Job.salary_currency` / `Job.salary_period`, so a **foreign currency** is a
`salary_not_comparable:` note with no band — never a converted number — while an **hourly**
rate is read as `salary_period="hour"` with no band, and a **yearly** figure in the market's
own currency is restated ×12 for the BAND only, noted `salary_period_converted:year->month`,
so the seeker is never told "posting states no pay" about an ad that stated its pay),
`min_years_experience` from "N+ years/let/Jahre/ans", languages from the
taxonomy alias table plus de/fr ad-side forms. `posting_structure_cli.py` takes
`[{id, raw}]` and answers `{jobs, notes}` (one bad posting is skipped and named; exit 2 for
malformed input).

## Profile and CV studio

**Entry.** `/me` (`app/me/page.tsx`, server: reads the seeker's row once and hands it
to `app/features/jobseeker/ProfilePage.tsx`). The shell is `app/me/layout.tsx`: brand
mark, four links (`MeNav.tsx`, active state from the pathname), the appearance +
language preferences, a `TranslatedErrorBoundary` around the page, no Companion dock;
the rail is `print:hidden`. A seeker arrives here from the first-run wizard's **intent
fork** (`docs/architecture/app-structure.md`, "shell/setup/"): "I'm looking for a job"
skips company/team/pipeline/companion and `finish()` routes to `/me`.

**Import** (`ProfileImport.tsx`): drop a CV (the shared `AnalyzeFileDropZone`, same
8 MB / PDF·DOCX·TXT·MD contract) → `POST /api/extract-text` → `POST /api/profile/draft`
(the recruiter-side `profile_draft`, so a seeker's profile IS the `CandidateProfileV2`
the matcher scores) → `PUT /api/jobseeker/profile { profile, cvSourceText }`. The
three stages tick as a checklist; every refusal renders from its code
(`useErrorMessage`). The summary (`ProfileSummary.tsx`) shows what was read (name,
role family, years, skills, location, languages, education) and **what could not be
read** as a list of gaps to fill, never a score.

**What ended a hop** is classified in `importOutcome.ts` (`classifyExtract` /
`classifyDraft` / `classifySave` → one closed vocabulary: `coded · noTextLayer ·
transport · unknown`; fixtures in `importOutcome.test.ts`), and the page only paints
it. That splits three failures the first hop used to render identically: a coded
refusal (`EXTRACT_TEXT_UNREADABLE`, resolved in the reader's language), a PDF that
extracted cleanly to nothing — `200 {text: ""}`, a scan with no text layer, whose
remedy is its own sentence (`me.import.errNoTextLayer`) — and a body that was not
JSON at all, which is transport and says nothing about the file. Transport has ONE
sentence in the whole module, `me.common.unreachable` — the same one `FailureNotice`
paints on the feed, the sources and the scans (the import's own near-duplicate,
`me.import.errTransport`, was removed): which hop failed does not change what a reader
whose server is unreachable has to do about it.

**What read the CV** is disclosed. `POST /api/profile/draft` answers
`source: "llm" | "deterministic"` (from `profile_draft_cli`); on `deterministic` both
the drafting stage line and the saved summary carry an amber `NOTICE("amber")` —
`me.profile.readWithoutAi{Title,Body}` — saying no model was configured or reachable,
that skills are exactly as the CV states them, and where to add a model. It has no
column: the import writes it to `sessionStorage` under `kp-me-draft-source:<profileId>`
(`rememberDraftSource` / `recallDraftSource`, read through `useSyncExternalStore` so
the server snapshot is `null`), so it survives a reload of `/me` for the tab's life and
a fresh tab claims nothing rather than claiming stale. The summary also lists the skill
claims as chips whose `title`/`aria-label` name their `provenance`
(`me.profile.skillSelfDeclared` for `self_declared` — a claim the CV made is never
presented as one the app checked).

`POST /api/profile/draft` answers by CODE like the rest of the family:
`INTAKE_TEXT_REQUIRED` (400, the one deliberate refusal — empty text, the same code
the dialog door uses) and `safeJsonError(..., "PROFILE_DRAFT_FAILED")` for the rest,
at the engine's own status. Its row in `app/api/error-response-contract.test.ts` is
deleted rather than lowered.

**The CV studio** (`CvStudio.tsx`) is the Studio kit's first seeker variant
(`app/_components/studio`, `ns="me"`): zones `chat | sheet` (`kp-me-cv-cols`, chat
pinned), the plane is `CvSheet.tsx` (the polished Markdown through
`app/_components/Markdown`, the unreadable blocks, per-suggestion before/after with
**Apply**, which sends the ordinary message `me.cv.applyMessage`), the composer carries
`StudioVoiceBar` (`kp-me-auto-speak`). A closed dialog reopens read-only.

| Door | Method | What |
| --- | --- | --- |
| `/api/jobseeker/profile` | GET / PUT | the seeker's row; PUT merges a preferences patch through `app/_lib/jobseeker/profile.ts` (`parsePreferencesPatch`: unknown fields dropped, a floor without currency is not a floor) |
| `/api/jobseeker/dialogs` | GET `?profileId=` / POST `{kind, lang}` | list; create with the **deterministic** opening turn (`runJobseekerOpening`) |
| `/api/jobseeker/dialogs/[id]` | GET | one dialog (the client re-reads after a `moved`) |
| `/api/jobseeker/dialogs/[id]/message` | POST `{message}` | one exchange → `DialogReply`; CAS `appendDialogTurns` → 409 `JOBSEEKER_DIALOG_MOVED`; on `done` the artifact's preferences merge into the profile and `cvMarkdown` becomes `cvPolishedMd`. Empty body → `INTAKE_TEXT_REQUIRED` (the existing generic "nothing to send"); oversized is cut at 4 000 chars |
| `/api/jobseeker/cv.md` | GET | `text/markdown`, `Content-Disposition: attachment; filename="cv.md"`; 404 until a polished CV exists |
| `/me/cv/print` | page | the polished CV at 210 mm with `window.print()` |

Limiters (pinned in `app/api/rate-limit-contract.test.ts`): profile 60/10 min,
dialog create 30, message 30 (after the 404/409/400 refusals, before the spawn),
export 60.

**Engine.** `app/_lib/jobseeker-run.ts` spawns `pipeline/jobfit/jobseeker_cli.py`
(`--input-json`; `JOBSEEKER_DIALOG_TIMEOUT_MS = 120 s`, opening 30 s, `buildLlmConfigEnv`
on turns only) and coerces the reply at the boundary (`coerceDialogReply`: reply capped,
malformed cards dropped, an artifact that does not match its kind → null, `source` ∈
`llm | deterministic`). `pipeline/jobfit/jobseeker.py` (`CV_POLISH_PROMPT_VERSION =
"cv-polish-v1"`, use case `cv_polish`) is a calm career editor that elicits preferences
one or two at a time (decision cards for work modes and seniority) and critiques the CV
**grounded** in `soft_signals.build_soft_signal_panel` + `authenticity.authenticity_checks`;
a suggestion is kept only when its `before` is a sentence that occurs in the source.
`done` = places-or-countries + salary floor WITH currency + ≥1 target, confirmed on a
read-back.

**Keyless.** `deterministic_turn` is scripted slot-filling in en/cs/de/fr (locations →
salary floor, parsing "60 000 Kč měsíčně" / "60k CZK" / "3000 EUR/month" and re-asking
once for a missing currency, never guessing → titles → work modes card → seniority card →
read-back → confirm), template suggestions from the same critics, and `reflow_cv`: a
sectioned Markdown re-flow where **no source line is lost** — every non-empty line lands
in `cvMarkdown` or in `unreadable` (pinned by
`pipeline/jobfit/tests/test_jobseeker_dialog.py`). A locale outside the four is
disclosed as `fallbackLang`. The `fit` kind is the section below.

## Scan and scoring

`app/_lib/jobseeker/scan.ts` — `runJobseekerScan(workspaceId, {trigger, signal?,
onProgress?, deps?})` → `ScanSummary`. Four phases, every dependency injected
(`ScanDeps`; `defaultScanDeps` binds the stores, `politeFetch`, `adapterFor` and the
Python runner in `python-cli.ts`), so `scan.test.ts` runs the whole pipeline over fixture
adapters and a scripted runner with no network, no interpreter and no DB
(`KP_JOBSEEKER_SCAN_SPAWN=1` opts the two deterministic CLIs into real spawns).

| Phase | What runs | Bound |
| --- | --- | --- |
| Acquire | `reconcileSource` per enabled, unpaused source, creation order; a `blocked`/`collapsed` source is paused by reconcile and the scan moves on | `SCAN_LIMITS { maxRefs: 300, maxDetailFetches: 60 }` per source; 8-min wall budget (`SCAN_WALL_BUDGET_MS`) joined with the caller's signal — stops BETWEEN sources, and a source not reached is recorded `skipped` / `wall_budget`, never omitted |
| Structure | `listPostingsNeedingStructure` (job_json NULL) → `posting_structure_cli` → `setPostingStructure(id, job, "deterministic")` | one spawn per 200 |
| Match | `listPostingsForMatching(ws, {upToDateVersion, profileUpdatedAt})` → `match_cli --profile-json --preferences-json --jobs <empty corpus> --jobs-json <postings> --limit n` → `setPostingMatch` with `match_version = "jobseeker-match-v1"` | one spawn per 500; the seed corpus is replaced by an empty one so only the seeker's postings rank |
| Deep-dive | `listDeepDiveCandidates({threshold, limit: maxPerScan})` (match_total ≥ `preferences.deepDive.threshold`, live, `reasoning_json IS NULL`, best first) → `deepDivePosting` | `deepDive.maxPerScan`; stops at the FIRST keyless answer |

**Matching is incremental.** The match phase asks the store only for the rows that still
owe a score: `listPostingsForMatching(workspaceId, {upToDateVersion, profileUpdatedAt})`
skips a row whose `match_version` is the current `MATCH_VERSION` **and** whose
`matched_at` is at or after the profile's `updated_at`. Everything else comes back —
never matched, nulled by a content change (`upsertPosting` clears `job_json`/`match_*`
when the content hash moves), scored under an older matcher, or scored before the seeker
last edited their profile or preferences. The predicate is written as positive "still
owes a score" cases rather than a `NOT (...)`, because a `NOT` over a NULL column yields
NULL and would drop exactly the never-matched rows. `ScanSummary.matched` counts rows
scored THIS run and the optional `skippedUpToDate` counts the rows that were already
current, so a re-scan that changed nothing reports `matched: 0, skippedUpToDate: N` and
spawns `match_cli` zero times instead of re-scoring the whole dataset. The deep-dive
shortlist is unaffected: it selects on `match_total` and `reasoning_json`, not on
freshness.

KO'd postings are NOT scored 0: the matcher returns only survivors (`meta.koFiltered`,
aggregated `meta.koReasons`), so a posting that failed the hard filter stays unmatched
(`match_total NULL`, sorted last) and the count goes to the server log.

`deepdive.ts` — `deepDivePosting(posting, profile, {lang, signal, workspaceId, deps})`,
three spawns per posting: `jobs_cli ingest --job-id <postingId>` (use case `jd_ingest`;
the model re-structures the ad → `job_source = "llm"`), then a re-match of ONLY that
posting through `matchChunk` (deterministic; a KO here leaves the earlier score in place
rather than silently demoting a card the seeker saw), then `reasoning_cli --profile-json
--jobs <one-job corpus> --job-id` (use case `match_reasoning`) → `setPostingReasoning`.
Re-match after model structuring IS done: it is one deterministic spawn and it is what
makes the indexed total and the eligibility flags reflect the richer Job.

**Keyless is a decision.** There is no TS-side provider oracle, so the first step is the
probe: `jobs_cli`'s "No LLM provider available" refusal (`isNoProviderError`) or a
`source: "deterministic"` rationale both end the shortlist with `deepDiveSkipped:
"no_provider"` — one cheap spawn per scan, never `maxPerScan` of them. A deterministic
rationale is never persisted (`reasoning_json IS NOT NULL` means deep-dived, and storing
the template would freeze the row out of an upgrade). No profile → `sources: []`,
`deepDiveSkipped: "no_profile"`, nothing spent.

The manual door is the `jobseeker_scan` task kind (`app/_lib/tasks.ts`: `tenancy:
"scoped"`, label `tasks.kind.jobseekerScan`, budget class `agent`, dedupe = one scan per
workspace in flight, no outcome table — `/me/scans` renders the `scheduler_runs` row).
Offline scans are NOT refused: acquisition answers `offline` per source and the stored
postings are still structured and matched.

### API (`app/api/jobseeker/{scan,postings}/**`, all `requireOperator()` → limiter → work)

| Route | Verb | Does | Limiter |
| --- | --- | --- | --- |
| `/api/jobseeker/scan` | POST | `startTask("jobseeker_scan", {trigger: "manual", workspaceId})` → 202 `{taskId}` | `jobseeker-scan` 6/10 min |
| `/api/jobseeker/postings` | GET | `?status=&minTotal=&sourceId=&sort=total,posted,seen&cursor=&limit=` (1..100, default 50) → `{rows: JobseekerPostingSummary[], nextCursor}`; keyset cursor; no `status` = the live feed; a value outside its vocabulary → 400 `APPLY_SELECTION_INVALID` `{field}` | `jobseeker-postings` 120/10 min |
| `/api/jobseeker/postings/[id]` | PATCH | `{status, dismissReason?, note?}` → `setPostingStatus`; `dismissed` requires a `DISMISS_REASONS` reason (400 `APPLY_SELECTION_INVALID` `{field, options}`); `gone` is refused (the scan's verdict); unknown id → 404 `POSTING_NOT_FOUND`; answers `{posting}` (summary) | `jobseeker-postings-write` 120/10 min |
| `/api/jobseeker/postings/[id]/deepdive` | POST | `?lang=` → `deepDivePosting` synchronously (maxDuration 120) → `{posting, source, reasoning, fallbackReason}`: `llm`/`null` (persisted), or 200 `deterministic` with `fallbackReason` `template` or `no_provider` and `reasoning` null when the template was empty (`deepdive-route.test.ts`); no profile → 409 `JOBSEEKER_PROFILE_MISSING` | `jobseeker-deepdive` 20/10 min |

Codes are reused, not minted: `APPLY_SELECTION_INVALID` is the existing generic "not one
of the options offered" refusal, `POSTING_NOT_FOUND` the existing "that job posting could
not be found". Store additions: `getPostingSummary`, `listPostingsNeedingStructure`,
`listDeepDiveCandidates` (postings), `getWorkspaceJobseekerProfile` (profiles — the scan
has no session, so it reads the workspace's newest profile),
`listWorkspacesWithEnabledSources` (sources, global, see Scheduler).

## Feed, fit dialog, sources UI

**Feed** (`/me/jobs`, `app/me/jobs/page.tsx` → `app/features/jobseeker/JobsFeed.tsx`).
The server page reads the CHAIN FACTS (a profile exists · a source is enabled · a scan
ever ran) and the source labels; the client feed reads `GET /api/jobseeker/postings`
(keyset cursor, "Load more" appends, a filter change starts over). Filters: status
(live · new · shortlisted · applied · dismissed), min fit (any/50/65/80), source, sort
(best fit · newest posted · last seen). A card (`PostingCard.tsx`) leads with the fit
total + the shared `FitTierBadge`, then confidence band, eligibility chips
(`EligibilityChips.tsx`: `flag` amber, `ok` moss, `unknown` neutral, the detail as
title), source + last seen, status; actions shortlist / "I applied" (opens the source
URL in a new tab, then PATCHes `applied`) / dismiss (`DismissPicker.tsx`: a reason from
`DISMISS_REASONS`, required, plus an optional note) / restore. An unscored posting
says "Not scored", never 0. **Empty states are chain-aware**
(`feedModel.ts: resolveFeedEmptyState`, pinned by `feedModel.test.ts`): the FIRST
missing link wins: no profile → link to `/me`; no enabled source → **one click to first
results** (`EnableEuresButton.tsx`, below) beside the link to `/me/sources`; no scan yet
→ "Scan now" (`ScanNowButton.tsx` over `useScanTask.ts`,
which polls `GET /api/tasks/[id]` because /me mounts no TasksProvider); scanned but
nothing above the min fit → says how many rows the filter dropped; nothing live → scan
again or check Dismissed.

**One click to first results** (`EnableEuresButton.tsx`). A seeker who has just imported
a CV was three pages from a scored feed. EURES is the one source that needs no
deliberation — tier A, the European Labour Authority's own vacancy API, rights-clean
with attribution and NO acknowledgement — so the `no_sources` state offers "Enable EURES
for CZ" and the button does the whole chain: it READS `GET /api/jobseeker/sources` first
and enables the existing EURES row rather than duplicating it (the POST creates a row
every time; there is no upsert), then `PATCH {enabled: true}`, then `useScanTask.start()`
with its progress inline. The PARENT IS TOLD LAST: `onEnabled()` flips the feed's chain
and unmounts the empty state with it, so it fires only when the scan TASK reaches a
terminal state — not when `start()` resolves, which only means the POST returned a task
id with the whole scan still ahead — and not at all when the start was refused, because
then the notice and its Retry are the only thing left to act on. The button's progress
line, its `startError` and its EURES Retry therefore stay on screen for the whole run;
a busy flag (its own plus `scan.starting || scan.active`) still forbids a second submit,
and the chain is idempotent, so a Retry re-runs it safely. The countries come from the CHAIN (`app/me/jobs/page.tsx` passes
`preferences.countries`) because the button has to name them before it is pressed;
`feedModel.ts: euresCountries` defaults an empty list to `cz` — the EURES search takes
location codes and an empty list is a query for nothing — and the button then WRITES that
default through `PUT /api/jobseeker/profile` before scanning, so the sentence on the
button is what the scan actually does. A link beside it goes to the preferences that own
the choice, and every refusal renders through `FailureNotice` from its code.

**Failure is spelled apart from empty** (`FailureNotice.tsx` + `apiFailure.ts`). One
block serves all three seeker surfaces: a `NOTICE("critical")` with `role="alert"`, the
sentence resolved by CODE, and a Retry that re-issues exactly the request that failed
(busy while it runs) — the filters, the sort and the scroll position survive it. Three
rules hold around it: a BROKEN CHAIN is answered without a request at all
(`feedModel.ts: shouldFetchRows` — no profile or no enabled source means the page
already knows what it will show, so a failed read can never be painted as an empty
feed), a failure and an empty state are never rendered together, and the page's chrome
stays — `/me/sources` keeps the Add form and whatever tiers it already holds, `/me/scans`
keeps the "Scan now" door, the clock and the history, and its SECOND read (the source
list) fails on its own with its own line above the per-source table rather than leaving
the table to print opaque ids unexplained. `classifyApiFailure(res, body)`
(`apiFailure.test.ts`) separates a TRANSPORT fault (the fetch threw, or the body was not
JSON — a dev server that is not running answers an HTML 404) from a coded REFUSAL and a
`*_FAILED` STORE fault; only transport gets `me.common.unreachable`, because "the feed
could not be loaded" is not what a reader whose server is down needs to read.

**Detail** (`/me/jobs/[id]`, `app/me/jobs/[id]/page.tsx`). A SERVER page over the
store (`getPosting`; there is no `GET /api/jobseeker/postings/[id]`), handing the client
a projection (`postingView.ts`: body text, skill lists, breakdown, confidence,
eligibility, reasoning; never the raw JSON-LD or the structured Job). The ad renders
as plain paragraphs, never as HTML. Pay is compared with the seeker's floor through
`compareSalary` (`feedModel.ts`): `salaryBandPosition` ONLY when `isSameCurrency` and
the periods agree, else "not comparable (X vs Y)"; an unstated pay is unknown, never
low. **Known gap:** the Python salary FLAG now restates a month↔year difference ×12
(`matching._salary_flag`, matching README §7), so a CZK/year posting reads `ok`/`flag`
on the chip while this TS panel still calls the same posting "not comparable" on the
period alone — `compareSalary` owes the same ×12. The match section: `ScoreDial`, tier, confidence, breakdown bars, matched /
missing / unproven skills, eligibility with details. Reasoning shows when deep-dived;
else a "Deep-dive" door (`POST /api/jobseeker/postings/[id]/deepdive`, WP4c). The door
answers `{source, reasoning, fallbackReason}` and the page turns that into ONE word,
`diveOutcome()` in `postingView.ts` (`postingView.test.ts`): `llm` (persisted, and the
only answer that triggers `router.refresh()`), `no_provider` and `template` (both
honest keyless states, both rendering the fixed-template note, with the template text
under it when one arrived and the note alone when it did not), `failed` (the only
failure). A keyless deep-dive is therefore never an error and never a silent no-op.
"Discuss fit" opens the fit studio; "I applied" / dismiss as on the feed. All THREE of
this page's failures — the status write, the deep-dive, opening the dialog — render the
same `FailureNotice` the other seeker surfaces do, classified through
`classifyApiFailure`, each with a Retry that re-issues its OWN request: the deep-dive
re-POSTs, "Discuss fit" re-creates, and a failed status move re-PATCHes the write the
reader last asked for (the PATCH alone — the source tab "I applied" opens is a side
effect of the first click, not of a retry). `usePostingActions` still returns
`{code}` only, so a transport fault on that hop resolves to the action's fallback
sentence rather than to `me.common.unreachable`; the two hops this page owns classify
fully. The write notice keeps its dismiss (`usePostingActions.clearError`) through
`FailureNotice`'s optional `onDismiss`.

**The fit verdict lives on the posting, not only in the overlay.** The page reads the
latest CLOSED fit dialog for the row — `latestFitDialogForPosting(postingId, workspaceId)`
in `app/_lib/db/jobseeker-dialogs.ts` (workspace-bound, `kind = 'fit'`, `status =
'closed'`, newest first; `jobseeker-dialogs.test.ts`) — and renders its artifact under the
match: the verdict word, the applied door when the verdict is `apply` and the posting is
not applied yet, the gaps with severity, the cover note with its copy control and the
questions to ask. The regions are the SAME components the studio's sheet uses
(`FitVerdictRow`, `FitArtifactSections`, exported from `FitSheet.tsx`). Settling a verdict
inside the overlay updates this panel without a reload: `FitStudio` calls `onDone(artifact)`
on the closing turn (`CvStudio`'s twin, which re-reads the profile).

**Fit dialog (UC3)** (`FitStudio.tsx` + `FitSheet.tsx`): the Studio kit's second seeker
variant, CvStudio's twin in composition (`ns="me"`, zones `chat | fit`,
`kp-me-fit-cols`, the shared `kp-me-auto-speak`). Created with
`POST /api/jobseeker/dialogs {kind: "fit", postingId}`; the open one for the posting is
resumed. The create and message routes read `fitTurnContext`
(`app/_lib/jobseeker-fit-context.ts`): a compact posting projection, the stored
MatchResult and the seeker's last ten dismissals (reason + title) ride every turn, so a
mid-conversation dismissal is seen. The sheet: verdict, gaps with severity + mitigation,
the cover note (Markdown, copy control with a visible failure state), questions to ask;
a verdict of `apply` offers "Mark applied", and the closing turn hands the artifact to
the posting page through `onDone` so the verdict outlives the overlay. Engine:
`pipeline/jobfit/jobseeker.py`
(`FIT_PROMPT_VERSION = "fit-dialog-v1"`, use case `fit_dialog`), a candid coach that
reasons only from the posting, the match, the profile and the dismissals ("you
dismissed 3 recent postings for pay; this one states no pay"). **Hypothesis, not
verdict:** every gap cites its source, a posting sentence or a match field
(`missingSkills`, `unprovenSkills`, `eligibility.<key>`), names a benign reading beside
the risk, and rides the wire with the citation inside `mitigation` (`Cited: …`); the
coerce step drops a model gap with no grounded `source`. **Keyless twin**
(`deterministic_fit_turn`, four locales): the opening states the fit and offers the top
three gaps as a choice card; each pick answers one gap (statement · benign reading ·
mitigation · citation); after two gaps, on "decide", or when nothing stands out, the
verdict card (apply · skip · undecided); a verdict closes the dialog; the cover note is
at most four sentences of profile facts (`fit_cover_note`), written on `apply` or on
request. Pinned by `pipeline/jobfit/tests/test_jobseeker_dialog.py::FitDialogTest`
(verdict in ≤ 6 turns, every gap cited, dismissals in `build_fit_prompt`, four
openings).

**Sources** (`/me/sources`, `SourcesPage.tsx` + `SourceCard.tsx` + `RulesAuthoring.tsx`
+ `AddSourceForm.tsx`). Three sections from `GET /api/jobseeker/sources`. Tier A cards:
label, host, kind, enable toggle (`role="switch"`), last run outcome, pause reason +
since when, resume. Tier B cards add robots summary, the terms clause summary with its
URL and our cadence; the toggle is the ACKNOWLEDGEMENT door: the first enable answers
409 `JOBSEEKER_SOURCE_NOT_ACKNOWLEDGED` with `termsHash`, the card shows the block
(DevPublishConfirm's shape: `alertdialog`, three enumerated reasons, the checkbox FIRST
in focus order, the CTA disabled until ticked) and re-sends `{enabled: true,
acknowledge: true}`; a hash that differs from `acknowledgedTermsHash` says the terms
changed. Tier C rows: label + `refusedReason`, no control. Boards get a "Preview" /
"Rules and preview" panel: `POST …/preview` renders the per-rule verdict table and the
first items; `board_rules` adds "Author rules" (`POST …/rules/propose`, marked AI /
without AI) and "Save rules" (`PATCH {rules, rulesBaseline}`), offered only after a
preview that passed. Catalog entries not yet added appear in their tier with "Add"
(`POST {catalogId}`); the form adds an ATS by vendor + company slug (`{adapter, config:
{slug}}`) or a board by host (tier B by rule). Every refusal renders from its code.

**Scans** (`/me/scans`, `ScansPage.tsx`). Reads `GET /api/automation/schedule` and
filters `jobs[]` to `jobseeker_scan`: the toggle (disabled with
`pipeline.scheduler.unverified` as its title until `verified`; the route refuses the
write with `JOBSEEKER_SCAN_UNVERIFIED`), the cadence as 6 h / 12 h / 24 h (a stored
interval outside the three snaps to the nearest for display), last run, "Scan now"
with live progress, and the run history unrolled per source from the stored
`ScanSummary` (outcome word + new / changed / absent + reason); `blocked` / `collapsed`
in amber with the pause reason and a link to `/me/sources`, because only the owner
clears those. `SchedulerJobRow` is not reused (free minutes field, policy-pass history).

**e2e.** `e2e/jobseeker-keyless.spec.ts` is declared against the throwaway DB (feed
empty state = `no_profile`, three tiers, tier C without a control, tier B toggle →
acknowledgement with the CTA disabled until ticked, scans toggle locked) and is NOT in
`KEYLESS_SPECS`: enrolling it means the ci.yml step and `.claude/CLAUDE.md` in the same
change (`keyless-e2e-pin.test.mjs`), which this package does not touch.

## Known gaps

- Everything above marked with a work-package number is not built yet. WP5 (feed, detail,
  fit dialog, sources, scans) is built; the MeNav badge (a count of new postings) is not:
  the feed response carries no total, so the count would be a second list read per paint.
- `/me/jobs/[id]` reads the store directly; a `GET /api/jobseeker/postings/[id]` would let
  the page become a client reader like the other three, but nothing needs it yet.
- `ScanSummary` has no `koFiltered` / `structured` counts and `RECONCILE_REASONS` has no
  `wall_budget`: the scan logs the KO count and records an unreached source with
  `reason: "wall_budget"` (a string the type allows) — both are counter-proposals for
  `types.ts`, not silent edits.
- A posting-specific not-found code (`JOBSEEKER_POSTING_NOT_FOUND`) does not exist; the
  postings routes reuse `POSTING_NOT_FOUND`, whose sentence fits.
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
