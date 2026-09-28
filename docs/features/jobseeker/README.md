# Job seeker — `/me`

> Status 2026-09-16: **under construction** on branch `spark/candidate-jobseeker`.
> This file is the doc-sync anchor for the module (`scripts/docs/feature-doc-map.json`);
> each work package fills its section in the same commit as the code.

The seeker-side of kp: the person running the install is looking for a job rather
than hiring. They reach `/me` by choosing "I'm looking for a job" on the first-run
Welcome step. Design record: the Spark vault idea `candidate-jobseeker` (2026-09-16);
dependency decision: [ADR 0009](../../architecture/decisions/0009-one-html-parser-for-owner-consented-acquisition.md).

## Entry points

**The module is OFF unless the install sets `KP_JOBSEEKER=1`** (read only in
`app/_lib/jobseeker/enabled.ts`; kp is open source and a recruiting team's install must not
carry a personal job-search tool by default). Off, `/me/**` and `/api/jobseeker/**` answer
exactly as an unknown route (a `proxy.ts` rewrite after the auth gate, with matcher entries so
the dotted `cv.pdf` / `cv.md` paths are gated too; the layout also calls `notFound()`), the
first-run wizard shows no "looking for a job" option, and the `jobseeker_scan` clock job is
neither run nor listed.


| Surface | Path | Gate |
| --- | --- | --- |
| Gate + error boundary (no chrome of its own) | `app/me/layout.tsx` | `isOperator()` else 404; not in `PUBLIC_PAGES`, so the fail-closed proxy walls it when a password is set |
| **The flow — "The Sieve"** (arrive → CV → you → what you want → the sieve → worth your evening → weigh → sources) | `app/me/page.tsx` → `app/features/jobseeker/sieve/SieveFlow.tsx` | server-first; `?open=<postingId>` lands on the Weigh step |
| Old addresses | `app/me/jobs/page.tsx` → `/me#s-evening`, `app/me/jobs/[id]/page.tsx` → `/me?open=<id>#s-weigh` | redirects |
| Custom boards, ATS by slug, extraction rules | `app/me/sources/**` (inside `SieveSideFrame`) | the flow's Sources step links here |
| Scan history + the clock | `app/me/scans/**` (inside `SieveSideFrame`) | |
| The designed CV at real size (pickers + A4 sheet; also what the PDF route prints) | `app/me/cv/print?template=&accent=` | |
| API | `app/api/jobseeker/**` | operator-gated + `requireOperator` in every handler |

## The flow — `/me` ("The Sieve")

**The step rail follows the content.** Steps 2 "Your CV" and 3 "You" are one section
(`#s-cv`), so they light as one joined pair (`railSection()`). Below 860px the step strip is
opaque and its measured height (`--sv-strip-h`, a ResizeObserver in `SieveFrame`) is part of
every section's scroll margin, so an anchor jump never hides a heading. The rail lights the
section just under the strip, and a rail click keeps its step lit until the reader scrolls,
touches or types.


**Landing-grade chapters (2026-09-28).** The owner asked for /me to be as representative
as the landing and /about: visual quality, motion, snap scrolling, a composition per
section. The flow now reads as eight chapters, token-driven in both registers:

- **Chapter heads** (`ChapterHead.tsx`): a large outlined numeral in the accent beside the
  head (decoration, `aria-hidden`), the eyebrow in the landing's hand (Shantell Sans, loaded
  for /me only as `--font-me-hand` in `app/me/layout.tsx`, with JetBrains Mono as
  `--font-me-mono`), the title at display scale. Small labels are sentence case, never
  letter-spaced caps.
- **Surfaces**: chapters alternate paper and a soft tint (`data-surface="tint"`), the sieve
  sits on a dot-grid stage (`"stage"`); on a desktop tall enough, each chapter is one
  screen high.
- **Motion is CSS scroll-driven** (`animation-timeline: view()`, `sieve.css` "snap +
  motion"): heads rise in, the want cards and the top five are dealt in on a stagger, the
  Weigh dial draws its arc, a reading line runs under the top bar and the rail's connector
  fills in the accent to the chapter being read (`--sv-progress`). Everything sits inside
  `@supports` and `prefers-reduced-motion: no-preference`, so an unsupporting browser or a
  still reader gets the finished page, and reveals touch LEAF elements only - a transform
  on a container would capture a fixed overlay inside it.
- **Proximity snap** on the flow page only (`SieveFrame snap` → `data-snap`), desktop only:
  a chapter that comes to rest near the top settles onto it, a long one scrolls freely.
- **Per chapter**: Arrive is a hero (the Sieve drawn as a picture of itself, `SieveArt.tsx`,
  postings raining into a meshed funnel with the gates named in the hand; the drop as the
  landing's sticker; the promise in numerals; three stops on a drawn line). Your CV + You
  get a paper-on-desk CV and a ringed portrait with a hairline fact strip. What you want is a
  bento with icon chips (titles and languages span two). The sieve's stage wears the
  sticker. Worth your evening deals the top five as a tilted hand of sticker cards, #1 in the
  accent. Weigh shows the score as a dial (`ScoreDial.tsx`: the arc is the score, the soft
  arc the band) and gives a posting's long title the full width. Sources are three doors,
  each coloured along its top edge.

Promoted on 2026-09-25 from the design contest `me-seeker-flow` (winner A/2, "The
Sieve"; the owner chose it over the more spectacular runner-up for its balance of wow and
practicality). The owner's brief for the contest: the module worked, but it was a wall
of sentences; the flow must be graphical and effortless. The contest arena, the winner's
source and the promotion's style contract live under `.contest/arena/me-seeker-flow/`
(git-ignored).

**One scrolling page, eight numbered stops on a left rail** (`SieveFrame.tsx`). Each
stop carries its live count and, from the sieve on, a bar that narrows as the sieve
works (found → through → worth your evening → decided). A stop not reached yet is a
dashed gap in place — "not reached" and "nothing there" never render alike. The rail's
foot holds the house `RailPreferences` (appearance, language). Below 860 px the rail
becomes a sticky horizontal strip.

| Step | Component | What it does |
| --- | --- | --- |
| 1 Arrive | `StepArrive.tsx` | the real import (extract → draft → save, `importOutcome.ts` classifies each hop) as a three-stage checklist; folds to one line once a CV is in. The privacy line says what happens: nothing goes to a job board, and reading the CV may use the AI model this install is set up with (else the built-in parser); replacing a CV says scores stay until the next scan |
| 2–3 Your CV → You | `StepYou.tsx` | the CV text beside the person read out of it; on first view per CV per session the phrases the reading used light up and FLY into the portrait (`readCv` finds them on word boundaries, one flight per key). Skill tiles: size = level, SHAPE = provenance (solid work · half side project · ring study · dashed italic + STATED tag). "No AI read this" is one calm line when the draft came from the fixed parser. **Polish my CV** opens the existing `CvStudio` overlay |
| 4 What you want | `StepWant.tsx`, `WantCard.tsx`, `wantModel.ts`, `useWantSave.ts` | six cards in two layers (`WantCard`): a VIEW stating the value large (places, the floor with its period, titles and target fields, work modes, level, languages) or "—" with why it is empty, the whole card one button; a click opens the EDIT layer, whose controls (pins + country codes, slider + exact amount + currency + period, title tokens + removable target fields, three mode toggles, the four-stop level, languages with a level picker) work on a DRAFT and save once on Done; Cancel / Esc drop it. Text typed but not added counts on Done. A draft is never overwritten by a save's echo: before this, a currency picked with no amount (or an amount with no currency) saved "no floor" and snapped back. Done refuses an amount with no currency and says why; 0 is "no floor". Only the changed fields are sent, `PUT /api/jobseeker/profile { preferences, preferencesReplace: true }`, one save at a time in commit order, the step showing its own values until none is in flight. Languages seed from the CV and save `preferences.languages`, which the designed CV prints instead of the CV's own block (`cvDocument.ts`); an untouched Done on the CV's list stores nothing. Languages do not change the ranking. The step says scores move on the next scan and offers Scan now |
| 5 The sieve | `StepSieve.tsx` | every posting a dot, poured through named layers: held at the door (source off or paused), one layer per hard gate (most-catching first; a two-gate posting ringed on the first, ghosted on the second), waiting for a score, then the scored field piled by score. Counters tick as dots land; a decision or a source switch MOVES dots. Each layer opens a list where a gated row states what it would have scored — never a zero. The funnel line under the stage names every step its numbers take, the merged duplicates included (`SieveFacts.folded`, the twins below): "1248 found → 76 caught by gates → 59 duplicates merged → 1113 scored" - without that step the live run's line read 1248 − 76 = 1113 |
| 6 Worth your evening | `StepEvening.tsx` | lift skills (missing most often across the top 20 open), the skyline (every scored posting: bar = confidence band, line = score; drag or Shift+arrows to pick a range), the top five as cards, and the whole list with search / tier / mode / status / sort. A "Your direction" filter over the list (on by default when a target title is stated and a row matches; it says how many postings it hides; the top five stay the sieve's own ranking and carry a bullseye when they match the target); the skyline is a keyboard slider; a profile with no skill claims says its scores come from field and level only, with "drop a fuller CV" / "polish". The same job listed once per place (EURES files a multi-region vacancy per region) is ONE row - same source, title and employer (`sieveModel.ts` `twinKey`), the best-scored copy kept, "+N more places" on it; a row with no employer is never folded. A posting whose ad lists no requirements (`skillsStated: false`, from the structured job's `requirements`) is scored 0 on skills by the matcher - its pinned rule (`test_scoring_contract.py` `UnmeasuredIsNotAPerfectFitTest`) - so it shows "—" in place of that total, with its score on what WAS measured (career + personal in their own weights, `directionTotalOf` in `db/jobseeker-postings.ts`, never a rank key). It never takes a top-five place on the skills 0: open ones are listed apart above the list (`sieveModel` `unmeasured`), the stated direction first |
| 7 Weigh | `StepWeigh.tsx` | one posting via `GET /api/jobseeker/postings/[id]`: band gauge, the contribution stack, skills with provenance, the settled fit conversation (gaps, questions, cover-note draft) or a door to `FitStudio`, the deep read, the ad; the five checks, pay against the floor in one currency (`compareSalary`), where it came from. A sticky decide bar: Apply opens the ad first and only then offers "I applied", Let go asks why (`DISMISS_REASONS`), Undo; keys A / S / D decide, J / K walk the list the seeker is looking at. A direction chip ("Matches your target: …" / "In your target field" / "Your past field: …", from `targetAlignment`), "was n" beside a score a deep-dive replaced (`previousTotal`), and a note when the written read predates the last profile change (`reasoningStale`); the cover-note draft survives a reload, per posting (sessionStorage, per viewer) |
| 8 Sources | `StepSources.tsx` | three lanes (tier A one tap; tier B a lock until the site's clause is acknowledged in a modal — checkbox first, CTA disabled until ticked, a changed clause re-asks; tier C refused, no control). Each card says what the source put in the sieve, or how many wait at the door while it is off |

**Everything is derived, nothing is counted** (`sieveModel.ts`, pinned by
`sieveModel.test.ts`): held / gated / waiting / scored, the top five, gate order and
lift skills are re-derived from the rows on every render, so a decision moves the rail,
the sieve and the ranking together. The rows are the postings route's `status=all`
view paged to the end (`useSieveData.ts`); the summary projection carries the as-if
score, the gate sentences (only for gates the vocabulary knows) and the matched skills
with provenance for exactly this.

**The style is the winner's, fused with kp's tokens** (`sieve/sieve.css`, scoped under
`.sv`, class names kept from the winner). Every colour resolves through `app/globals.css`
tokens, so Spark Dark repaints the flow with no second block; the display face is kp's
serif (Fraunces, Bricolage after dark); the one kp law applied over the winner is the
14px type floor. The controls wear named recipes (`sieve/sieveRecipes.ts`, the
`SV_*` constants), which is also how another surface borrows the Sieve's pill, tile or
switch. The promotion was held to the winner with the contest skill's style contract:
22 roles, 0 deviations beyond the accepted fusion classes (font family and colour via
tokens, the 14px floor, text-driven widths).

**Keyless**: the flow never needs a model. The import degrades to the fixed parser and
says so; the deep read answers with the fixed template and says so; the fit conversation
and the CV studio run their deterministic twins.

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

- The designed CV (below) needs no model at all: `cvDocument.ts` is deterministic, and a server with no headless browser answers the PDF route with 503 `JOBSEEKER_PDF_UNAVAILABLE` while the page offers print -> Save as PDF, which carries the same layout.
- The CV import's draft step (`/api/profile/draft` -> `profile_draft_cli`) degrades to `pipeline/jobfit/cv_draft.py` when no provider can serve (no key, `KP_OFFLINE`, a refused route): taxonomy skill terms, the years / city / seniority readers and the language aliases produce a thin, `self_declared` profile, and the CLI answers `source: "deterministic"` so the page can say what read the CV. Roles are split at their date lines inside experience sections (`dated_roles`: "Role — Org (dates)", an education range is never a job, a blank line or an ALL-CAPS label ends a role), and `years_experience` is the stated figure, else the UNION of the dated intervals (overlaps count once, a backwards range is dropped). The location is read only from the header, which ends at the first section heading.
- PDF text keeps a two-column template's reading order (`pipeline/jobfit/extractors.py`, `_page_text`): when a vertical gutter no fragment crosses is PROVEN, with text on both sides, the wider column is read first and the sidebar after it; otherwise pypdf's own order stands. Before this, a sidebar CV imported with its section labels above the name and an email glued onto the URL beside it.
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

`JOBSEEKER_*` in `app/_lib/api-response.ts` (one STORE code and the REFUSAL codes, `JOBSEEKER_PDF_UNAVAILABLE` the newest);
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
| Credentials | An optional `authorization` header value (the gig adapters' official APIs: GitHub, Kaggle, HackerOne, Upwork) is sent only to the host the request started on - a cross-host redirect drops it, and robots.txt never carries it. No job-seeker adapter sets one | `PoliteFetchOptions.authorization`, `politeFetch.test.ts` |
| Bounds | 15 s timeout, 2 MB body cap (`outage`/`too_large`), http(s) only, ≤ 5 redirects followed by hand so a cross-host hop re-checks the new host's robots | `FETCH_TIMEOUT_MS`, `MAX_BODY_BYTES` |
| Classification | 401/403/429 → `blocked`; a 200 whose HTML carries one of six documented bot-wall signatures (`INTERSTITIAL_SIGNATURES`) → `blocked`; 404/410 → `gone`; 5xx/timeout/network → `outage`; disallowed path → `robots_disallowed` | `classifyStatus`, `looksLikeInterstitial` |
| Retry | Never for `blocked`. The fetcher retries nothing; the scan runs again next tick | — |
| Egress | Every job-seeker fetch is vetted by `app/_lib/jobseeker/fetch/egress.ts` (public-host string gate + resolve-and-reject over every A/AAAA address). Preview and rules/propose take a `url` only on the source's recorded host (or a subdomain) and public (400 `JOBSEEKER_RULES_INVALID` / 403 `JOBSEEKER_SOURCE_REFUSED`); creating a source vets the host and every config URL and refuses tier C. At scan time the transport is `egressGuardedFetch`: a URL on a non-public host (a sitemap `<loc>`, a rule-extracted link) is never requested and reads as `blocked`; every redirect hop, robots.txt's included, goes through the same hopGuard. `KP_OFFLINE` never resolves a hostname | `fetch/egress.ts` |
| robots.txt bounds | At most five redirects, each vetted by the hopGuard (a refused hop reads as "no policy published"); the body is read to at most 512 KiB; patterns are matched by a linear wildcard matcher (RFC 9309 `*` / `$`), never a regex | `fetch/robots.ts` |
| Stream deadlines | In stream mode (the MPSV bulk file) the 15 s timeout ends when headers arrive; the body is then bounded by 20 s idle and 120 s total. A stalled file ends the run as `source_outage` with "stream_timeout: N records read, M kept" | `politeFetch.ts` |

`blocked` is a relationship signal: `reconcileSource` (`app/_lib/jobseeker/reconcile.ts`)
stops the source at the first denial, records `blocked` and pauses it (`pausedReason:
"blocked"`); only the owner resumes it (PATCH `{resume: true}`). A source that fetched fine
but yielded nothing recognisable is `collapsed` (paused as `collapsed`), never a green run
with zero rows. Postings are marked absent (`markAbsent`, two misses → `gone`) only after a
COMPLETE successful pass — a truncated (`maxDetailFetches` or `maxRefs` reached, whether
reconcile or the adapter stopped), failed or stopped run, or one where a detail page hit an
outage (not a 404/410), says nothing about who is gone. There is no cursor: the next run
starts from the top, so a source with exactly `maxRefs` live postings never marks anything
absent. Only an undecided row (`new` / `shortlisted`) moves to `gone`; applied and dismissed
rows keep their status and show the absence as `goneAt`, and a re-seen row keeps its
decision. `SourceRunSummary.reason` is the closed set
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

**A company board's config names the company under the adapter's own key**
(`companyConfig.ts`): Greenhouse `token`, Lever `site`, Ashby `board`, Workable
`subdomain`, the rest `company`. Both UI forms used to send `{ slug }`, which no adapter
reads, so every company board added from /me failed its create with 400; the create route
now moves a legacy `slug` onto the right key, and the label reads either (found by the live
e2e, 2026-09-28).

**Whole-board feeds read up to the fetcher's ceiling** (`WHOLE_BOARD_MAX_BYTES`, 16 MB).
A per-company ATS feed is one document holding every open job with its description:
measured live, Anthropic's Greenhouse board is 9.0 MB and OpenAI's Ashby board 14.5 MB,
both past the 2 MB page cap, so a scan recorded the AI companies' own boards as outages.

**A stand-in where the employer goes is no employer** (`employer.ts`, in the six market
languages: "siehe Beschreibung", "see description", "viz popis", "confidential"…). The live
run's best target match read "AI Engineer (w/m/d) at siehe Beschreibung", and the twin fold
(same source, title and employer) would merge two employers' ads that both said it. It is
null from `rawPosting` on, and read as null from a row stored before - a whole stand-in
only, never a word inside a name.

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
else onsite only when the ad STATES the office ("on-site", "v kanceláři", "vor Ort",
"sur site"); an ad that says nothing leaves it unstated and records `work_mode` in
`defaulted_fields`, so the work-mode gate never knocks out a remote-only seeker on it), seniority from the TITLE only, `role_family` via `classify_role_family`,
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
taxonomy alias table plus de/fr ad-side forms (a stem of four letters or more must
START a word: "ital" read "digital" as Italian until 2026-09-25). `posting_structure_cli.py` takes
`[{id, raw}]` and answers `{jobs, notes}` (one bad posting is skipped and named; exit 2 for
malformed input).

## Profile and CV studio

**Entry.** `/me` is the flow (above): the import is its Arrive step (`StepArrive.tsx`),
what was read is its "You" step (`StepYou.tsx`), and the CV studio opens over it from
**Polish my CV**. A seeker arrives here from the first-run wizard's **intent fork**
(`docs/architecture/app-structure.md`, "shell/setup/"): "I'm looking for a job" skips
company/team/pipeline/companion and `finish()` routes to `/me`.

`POST /api/extract-text` returns `text`, `charCount`, and `pageCount` (`null`
for TXT/MD/DOCX). A PDF with pages but no text layer can therefore be identified
as a scan, while the existing empty-text refusal still handles it in the import UI.

**Import** (`StepArrive.tsx`): drop or choose a CV (the `upload-constraints` contract:
8 MB, PDF·DOCX·TXT·MD) → `POST /api/extract-text` → `POST /api/profile/draft` (the
recruiter-side `profile_draft`, so a seeker's profile IS the `CandidateProfileV2` the
matcher scores) → `PUT /api/jobseeker/profile { profile, cvSourceText }`. The three
stages tick as a checklist; every refusal renders from its code inside `FailureNotice`,
which offers the retry. **What was read** is the You step: name, the role the seeker
aims at (their first target title, else the role family), the archetype, where they
live, years, education, languages and field as fact cards, the skills as the provenance
mesh, and the experience the skills were read from as a timeline. The two CANONICAL enum
fields - role family and education level - resolve through `useEnumLabel`
(`enums.family.*`, `enums.education.*`), so the seeker never sees a wire value like
`software_engineering`. What the CV studio could not place, and its edit suggestions,
come from the newest `cv_polish` dialog's artifact and are said as "not polished yet"
until one exists — never as "nothing unreadable". The keyless twin
(`pipeline/jobfit/cv_draft.py`) drops the taxonomy's role WORDS — backend, frontend,
fullstack, developer, engineer, architect, vývoj — from the skill claims it writes
(they say what a person is, not what they can do, and every job title in the history
fires them) while still letting them vote on `role_family`.

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
`source: "llm" | "deterministic"` (from `profile_draft_cli`); on `deterministic` the You
step carries one calm line (`me.sieve.you.noAi`): no AI model read this CV, skills are
exactly as it states them. It has no column: the import writes it to `sessionStorage`
under `kp-me-draft-source:<profileId>` (`rememberDraftSource` / `recallDraftSource`,
read through `useSyncExternalStore` so the server snapshot is `null`), so it survives a
reload of `/me` for the tab's life and a fresh tab claims nothing rather than claiming
stale. A `self_declared` skill claim is drawn dashed and italic with a STATED tag, and
its tile's accessible name says "Stated only" — a claim the CV made is never presented
as one the app checked.

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

**The planes are exemplars that arrive.** An empty plane is not a skeleton
(`docs/design/surface-doctrine.md` 1): `CvSheet` draws the intake studio's own
`AtelierExemplar` over four named sections (`me.cv.section.*`) each holding a bracketed
slot (`me.cv.slot.*`), and `FitSheet` — whose headings are already real — draws one
bracketed `SlotLine` per waiting region (`me.fit.slot.*`). The brackets belong to the
COMPONENT, never the catalog: ICU MessageFormat reads `<word>` as a tag.

Suggestions and gaps render through the intake studio's `ArrivalList` over a delta from
`useSheetArrival.ts` (a flat-row twin of `useArrivalDelta`, which diffs a RoleBrief), so
a turn's new rows cascade in on the shared stagger and every row already on the plane
keeps its element. Both studios' chrome lines — the degraded notice, the stand-in
language, a send failure — are `NOTICE(...)` inside the shared `Fade`; the failure is
`critical` with `role="alert"`, never a hand-painted red string. The Markdown columns
carry `max-w-prose`, and the cover-note copy control announces through a SIBLING
`role="status"` span rather than an `aria-live` on the button itself.

| Door | Method | What |
| --- | --- | --- |
| `/api/jobseeker/profile` | GET / PUT | the seeker's row; PUT merges a preferences patch through `app/_lib/jobseeker/profile.ts` (`parsePreferencesPatch`: unknown fields dropped, a floor without currency is not a floor) |
| `/api/jobseeker/dialogs` | GET `?profileId=` / POST `{kind, lang}` | list; create with the **deterministic** opening turn (`runJobseekerOpening`) |
| `/api/jobseeker/dialogs/[id]` | GET | one dialog (the client re-reads after a `moved`) |
| `/api/jobseeker/dialogs/[id]/message` | POST `{message}` | one exchange → `DialogReply`; CAS `appendDialogTurns` → 409 `JOBSEEKER_DIALOG_MOVED`; on `done` the artifact's preferences merge into the profile and `cvMarkdown` becomes `cvPolishedMd`. Empty body → `INTAKE_TEXT_REQUIRED` (the existing generic "nothing to send"); oversized is cut at 4 000 chars |
| `/api/jobseeker/cv.md` | GET | `text/markdown`, `Content-Disposition: attachment; filename="cv.md"`; 404 until a polished CV exists |
| `/api/jobseeker/cv.pdf` | GET | `?template=studio|signal|folio|classic|editorial|sidebar|compact&accent=ink|navy|cobalt|teal|moss|tangerine|coral|plum` -> `application/pdf`, `attachment; filename="<name>-cv.pdf"`; 404 `JOBSEEKER_PROFILE_MISSING` without a profile; 503 `JOBSEEKER_PDF_UNAVAILABLE` when no browser is installed or the render failed (cause in the server log) |
| `/me/cv/print` | page | `?template=&accent=[&tailor=&compact=&objective=]` - the designed CV at real size (`CvDesigner` mode `page`), tailored when `tailor` names a target; the header is print-hidden, so `window.print()` and the PDF route both carry only the sheet |

Limiters (pinned in `app/api/rate-limit-contract.test.ts`): profile 60/10 min,
dialog create 30, message 30 (after the 404/409/400 refusals, before the spawn),
export 60, PDF 20 (`jobseeker-cv-pdf`, before the profile read and the render).

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

## The designed CV

The CV the seeker dropped, laid out as a page and taken away as a PDF, keyless. The
"Polish my CV" conversation above rewrites the WORDS with a model; this is the LAYOUT,
and it needs none.

| Piece | Path | What |
| --- | --- | --- |
| Document builder | `app/features/jobseeker/cv/cvDocument.ts` | pure: profile + preferences + CV text -> `CvDocument` (name, headline, contacts, summary, roles with bullets, the CV's own skill groups with levels, education, languages, `lang`, `improvements`) |
| Sheet | `app/features/jobseeker/cv/DesignedCv.tsx` + `cv.css` | one markup, three templates (`sidebar`, `editorial`, `compact`), four accents; hook-free, so the server print page and the client preview render the same component |
| Designer | `app/features/jobseeker/cv/CvDesigner.tsx` (`cvRecipes.ts`) | layout thumbnails, accent dots, the tidied-wordings list, Download PDF; mode `inline` (the flow) or `page` (`/me/cv/print`) |
| PDF renderer | `app/_lib/jobseeker/cv-pdf.ts` | headless Chromium (optional `playwright-core`) prints `/me/cv/print` with the stylesheet's own A4 `@page` |
| Route | `app/api/jobseeker/cv.pdf/route.ts` | see the doors table above |

**Where it shows.** Step 2 of the flow (`StepYou.tsx`) gains an "As dropped | Designed"
switch over the CV column. As dropped stays the default because the flight starts from it,
and the switch is held while the flight runs. Designed shows the real A4 sheet scaled to
the column (laid out at 210 mm and transformed, so line breaks match the PDF), `inert`,
with the pickers above it and a link to the full page. The layout and accent are
remembered per browser (`localStorage` `kp-me-cv-design`) and, on the page, in the URL.

**What "better expressed" means, and does not.** Deterministic and listed, never silent.
Canonical tool names (NextJS -> Next.js, Postgres -> PostgreSQL, Langchain -> LangChain,
lower-case acronyms), a small misspelling dictionary (Continous -> Continuous), a hyphen the
line wrap left open ("prototype-to- production"), a lower-case sentence start, and a line
that opens with the role's own title ("QA Engineer (SOAP, Cypress) - Legal web app" under
the "QA Engineer" entry reads "Legal web app (SOAP, Cypress)", `withoutRoleHead`). A verb is
never raised ("Responsible for" stays). Lines a CV lists without full stops stay separate
bullets: a line closing a parenthesis before a capitalised line is two items, not one
wrapped sentence (`bulletsOf`). Each change is an `improvements` row the designer
lists ("12 wordings tidied"). A word that is also prose ("the rest of the team", "soap")
stays prose unless a technical neighbour makes it the acronym ("Rest/Graph", "rest API").
No claim, number or date is invented: dates are only typeset (en dash, two-digit month).

**Reading.** Contacts come only from the header (the lines before the first section
heading), so a date range is never a phone. An ALL-CAPS label below the header is a skill
group of the CV's own ("LLM RELATED" -> "LLM Related"); with no groups, the profile's claims
form one group, strong first. "(senior)"-style levels become 1-3 pips and the word stays in
the text layer for a parser. Roles with bullets come first, earlier one-line roles form a
compact list after them. The DOM order is header -> experience -> side on every template,
so a text-order parser (an ATS) reads the name, then the work.

**Language.** Section headings follow the language the CV is WRITTEN in (`cvLanguageOf`,
stop-word counts over en/cs/de/fr), not the reader's UI locale: an English CV opened in
the Czech product keeps English headings. They live in `CV_HEADINGS`, as document
content, not in the UI catalogs.

**Paper, not UI.** The sheet is theme-INVARIANT: `--color-cv-*` in `app/globals.css`,
declared identically in both theme blocks (the `white-fixed` precedent), and set in points
with Fraunces/Inter pinned (not `--font-serif`, which turns into Bricolage after dark). The
designer's chrome around it is ordinary themed UI with the 14px floor. `cv.css` uses a
NAMED page (`@page cv`), so a stylesheet still loaded after navigation never re-margins
another page's printout. The first page bleeds to the top edge. Every page keeps a 10 mm
foot and a continuation page a 10 mm head. In print the sidebar's tint is a fixed box, so
it runs the full height of page two.

**The CV's own lines, even after an AI draft.** On the model path the draft's role text
is a paraphrase (a real CV lost "TypeScript" and every date). `sourceRoleOf` finds each
role in the CV text by its employer (the nth mention for an employer held twice), takes
the dates on or beside that line and the lines under it up to the next role, heading or
dated line, and the sheet sets those verbatim; the draft text is the fallback only when
the employer is not found. The headline compares folded, so "MICHAL KAŽDAN" is never read
back as the headline of "Michal Každan".

**Held to a written standard.** The sheet follows the registry subjects
`recruiting/cv-content-construction` and `recruiting/cv-presentation-and-parseability`
(forged 2026-09-26 from outside research; branch `forge/cv-construction` in the registry).

*What the sheet says* (`cvContent.ts`, pure). A verb never raises the claim (the old
"Responsible for -> Owned" rewrite is gone); self-descriptors in the seeker's own text become
owner questions and are never deleted from their words. Bullets are ranked by the outcome
ladder (a stated number > a stated scale > a before/after > action and object) and budgeted by
recency: 6 for the current role, 4 within ten years, 2 older, one line past 15 years or off
target (`CvRole.compact`); a role is never deleted, and bullets over budget are held back
(`trimmed`, never printed; the designer lists them per role under "lines held back for length"). Skills are evidenced-first and capped at 15, with a level WORD, never
pips; a skill no role shows, and a soft-skill list, becomes an owner question. Languages carry
their CEFR level when stated. Bold is at most 2 terms per role, never in the skills list.
Non-job evidence (projects, thesis, courses, certifications) becomes a dated `projects`
section; the tailored sheet keeps only the ones that speak to the target. Dates are typeset per
market ("present" / "dosud" / "heute" / "aujourd'hui"). No photo, birth date or marital
status is ever emitted, and a "PERSONAL DETAILS" block is never read as skills. The owner
questions (`no_outcome`, `missing_metric`, `listed_only`, `self_descriptor`) are shown only in
the designer, each quoting the line it is about.

*The model's rewrites are screened* (`pipeline/jobfit/jobseeker.py`, `cv-polish-v3`). Every
suggestion's REPLACEMENT is checked against the record (the CV text plus what the seeker said
in the dialog): a new number, a skill term from the ad, or a raised title or verb turns it into
a question (`kind: "question"`, never applied - the sheet shows "A question for you" instead
of Apply); a new proper noun, a self-descriptor or a less specific line is dropped. A full
redraft from the model is only read as line proposals. Accepted edits are recorded as
`applied` on the polish artifact (carried into a new conversation) and applied by
`buildCvDocument({ acceptedEdits })` - in the /me preview, `/me/cv/print` and the PDF alike;
an edit applies only while its original line is still in the CV.

*How it looks and parses* (`DesignedCv.tsx`, `cv.css`, `cvQuery.ts`). Seven templates,
presented in the designer as two groups with a schematic of each page. One column:
`studio` (the default since 2026-09-28 - the landing's look: the name in Bricolage under a
short accent bar, a soft accent glow in the top corner, the headline in the accent, headings
as a small accent square plus the word, skills inline with the level word in grey),
`signal` (technical: dates and the contact line in JetBrains Mono, a timeline rail down the
dated entries drawn with a border and a background dot, skills as a two-column spec sheet),
`folio` (editorial: a masthead rule, a Fraunces name, the summary as a serif lede, en-dash
bullets), `classic` and `editorial`. Two columns, opt-in with the single-column PDF offered
beside them: `sidebar` and `compact`. Eight accents (`--color-cv-*`, identical in both theme
blocks): ink, navy, cobalt (the default), teal, moss, tangerine, coral, plum. A saved design
from before carries its version: `v: 3` reads a v2 `classic` or `navy` - the old defaults,
indistinguishable from a choice - once as unchosen; every other saved pick is kept.

*The sheet has faces of its own* (`public/fonts/cv/`, built by
`python scripts/cv/build-cv-fonts.py` from the official OFL sources, checksummed; `--check`
verifies the committed files are a rebuild). The product's next/font faces are variable and
split per script, which Chromium's PDF writer embeds as Type 3 fonts with a font switch at
every diacritic: the operator's own exported CV read back "Každan" and "Česká Spořitelna"
broken apart in both pypdf and PyMuPDF (pypdf kept 0 of 4 diacritic words whole). Static,
single-file Latin + Latin Extended instances (Inter, Fraunces, Bricolage, JetBrains Mono -
410 kB) embed as TrueType: the same CV now keeps every one whole in both extractors.
Reading order on every template: head -> summary -> experience -> projects -> education ->
skills -> languages; each entry is one line, "Title - Employer" with the dates at its end;
nothing that carries text is positioned and headings are not letter-spaced (both had made the
PDF text read out of order). Four type sizes only (`--cv-*`): body 10-11pt, dates at body size
in ink, name 22-28pt. Page budget (`cvPageBudget.ts`): one page under three years of
experience, two otherwise, a last page under a third full is sparse; the designer reports it
and suggests one-line roles - type never shrinks. Page two repeats the name in its head
margin. The designer also shows "How a parser reads it" (the sheet's reading order). The PDF is
named `First-Last-CV.pdf`, titled "Name - CV" and tagged (`cv-pdf.ts`).

*Checked, not asserted.* `npm run cv:roundtrip` (a dev tool: Chromium + PyMuPDF) renders five
synthetic reference CVs (short, long, career change, Czech diacritics, two pages) in every
template, extracts each PDF in content order (pypdf) and by position (PyMuPDF), and asserts
the name leads, each entry stays contiguous and nothing is lost; the checker itself runs in
`test:unit` (`cvRoundTrip.test.ts`). It sets the sheet in the shipped faces (the fonts are
inlined into its page). Measured 2026-09-28: `studio`, `signal`, `folio`, `classic` and
`editorial` pass every reference in both extractors, Czech included; `sidebar` and `compact`
fail by position - hence opt-in.

**Tailored to a target** (`cvTailor.ts`, pure). The designer's "Tailor for" row lists the
seeker's `targetTitles`; picking one REORDERS AND EMPHASISES, never adds a word. The summary
leads with its most target-relevant sentence (every sentence verbatim); roles keep their
date order (reordering history reads as hiding it) and inside each role the relevant bullets
lead, with up to two demanded terms per bullet in bold; skill groups and items go
relevant-first, nothing removed. The CV's own headline stays - a target title never stands
in for a missing one, because under the name it reads as a title held. An optional objective
line ("Seeking: AI Engineer roles", in the CV's language) states the direction as sought.
`compactOffTarget`, offered only when the sheet runs over one A4 page, sets a role with
nothing relevant as one line, in place. Every move is a `tailor` improvement, listed apart
from the tidied wordings.
**Demand** is what that market asks for: the union of `matchedSkills` + `missingSkills` over
postings whose `targetAlignment.state` is `target` at that title, most asked first and
order-independent (summaries cap each list at 6 per posting). With no such posting yet, a
built-in list per target kind (AI/ML/LLM, frontend, backend, full-stack, QA - mirroring
`target_titles.py`) stands in, and the designer says so. **Coverage** ("Your CV shows 9 of
the 14 skills AI Engineer postings ask for", where each shows, the missing ones named) is
designer chrome for the seeker and is never printed.
`/me/cv/print` and `GET /api/jobseeker/cv.pdf` take `&tailor=<index>&compact=1&objective=0`
(`cvQuery.ts`, one parser for all three readers); the print page reads the seeker's
postings through `listJobseekerPostings` (a store failure falls back to the built-in list).

**The PDF.** The route renders the print page in a headless Chromium with the requester's
own cookies. The page may reach only that ONE origin (every other request is aborted),
and the origin is never the Host header: `KP_PDF_ORIGIN` when set, else `127.0.0.1` on
`PORT` or the request's port. Renders queue one at a time. `playwright-core` is loaded
lazily and listed in `serverExternalPackages`. It is a dev dependency today, so a pruned
production install answers `JOBSEEKER_PDF_UNAVAILABLE` and the page falls back to print.
To enable server PDFs there, install `playwright-core` and a Chromium build. Measured
locally: about 3 s a render, text selectable, 1-2 A4 pages for a ten-year CV (the
compact template fits it on one).

Tests: `app/features/jobseeker/cv/cvDocument.test.ts` (a synthetic two-column CV: header,
contacts, roles, bullets, groups, improvements, no invented numbers, prose-vs-acronym) and
`app/_lib/jobseeker/cv-pdf.test.ts` (origin never from Host, cookie parsing, no browser ->
unavailable, only the app origin reachable, browser always closed).

## Across sessions: the CV archive and the seeker's working state

Everything the pipeline produces already lives in SQLite (profile, preferences, postings,
scores, dialogs, deep-dives). Three things did not, and now do:

- **A CV already read is remembered** (`jobseeker_cvs`, `app/_lib/db/jobseeker-cvs.ts`).
  Every import is recorded per seeker by the sha256 of its extracted text with whitespace
  folded. Before drafting, `POST /api/jobseeker/cvs/reuse` checks the hash: on a hit the
  stored draft is applied with NO model call, and Arrive says so ("Read before on <date> -
  reused, no AI call") with "Read it again", which forces a fresh draft. The import's last
  hop is `POST /api/jobseeker/cvs` (`importCv` in `importOutcome.ts`); a failed reuse check
  simply drafts.
- **Earlier CVs can be picked again.** Arrive lists them (newest use first; up to 30 per
  seeker, least recently used dropped beyond that) with "Use this one" ->
  `POST /api/jobseeker/cvs/[id]/use`, which writes the profile through the same function an
  import does (`makeJobseekerCvActive`). `GET /api/jobseeker/cvs` returns metadata only - no
  text, no draft, no hash. Another seeker's id answers 404 `JOBSEEKER_CV_NOT_FOUND`.
- **Design choices and cover notes follow the seeker** (`jobseeker_ui_state`,
  `GET/PUT /api/jobseeker/ui-state`): the designed-CV choices and one cover-note draft per
  posting (8000 chars each, 200 kept), saved debounced with retry (`serverDraft.ts`). Browser
  storage is only the first paint; an edit the server never confirmed is re-sent, not
  overwritten; a failed save says "Not saved yet - retrying" and keeps the text. The print
  page stays URL-first. A malformed body answers 400 `JOBSEEKER_REQUEST_INVALID`.
- Both tables are tenancy-scoped (workspace + seeker) and are erased by the seeker's own
  door (below), not by candidate erasure.

**Delete everything about me.** `DELETE /api/jobseeker/profile` with `{"confirm":"erase"}`
(any other body: 400 `JOBSEEKER_REQUEST_INVALID`; 5 per 10 minutes per IP) runs
`eraseJobseekerData` (`db/jobseeker-profiles.ts`) - one IMMEDIATE transaction, every
statement bound to the workspace: the seeker's UI state, dialogs, CV archive and profile
row, and - when no other seeker profile is left in the workspace - every
`jobseeker_postings` row (their match, reasoning, triage and notes are all about this
seeker; the ads return on the next scan). `jobseeker_sources` (config) is kept. The door is
a quiet link in the /me footer behind a `ConfirmDialog` (`EraseMeDoor.tsx`); on success it
clears every `kp-me-` browser key and reloads. A scan already running is not cancelled
(importing the task hub put the route over its import budget): it can match nothing new
without a profile, but a match it computed before the erase can still land on a row.

## Direction and markets

A seeker's CV says where they have been; `targetTitles` / `targetRoleFamilies` say where
they are going. A career changer (years as an analyst, one year of AI work, aiming at
AI Engineering) used to be ranked by the past. Now:

- **The matcher reads the direction, never as evidence.** `transform.apply_preferences`
  carries the targets onto `MatchCandidate`; `score_career`'s family term, when a target
  is stated, is 1.0 for a title hit, 0.75 for a target family, 0.35 otherwise - the CV's
  own past family included. The seniority term is unchanged, and the skills dimension
  never reads targets: direction is a preference fit, not a claim of possession
  (registry: candidate-archetype-routing, skill-adjacency-and-normalization). Early-career
  profiles apply the same term to the family part of their fit slot. With no target,
  scores are byte-identical (pinned) and the recruiter path never passes preferences.
- **Title matching** (`pipeline/jobfit/target_titles.py`): whole-word, case- and
  diacritic-folded, level words (Senior/Lead/Junior) and parentheticals ignored, a small
  curated alias table (AI / ML / LLM / GenAI engineer; frontend; backend; full-stack; QA).
  A posting is credited to the stated title whose own words it carries before one it
  reaches only through a synonym: "AI Engineer" + "Machine Learning Engineer" are one
  alias group, and a "Machine Learning Engineer" posting names the second (the live run of
  2026-09-28 had credited all 178 target hits to whichever was stated first).
  Target families = the stated ones plus the families the stated titles route to.
- **`MatchResult.targetAlignment`** = `{state: target|family|past|none, matchedTitle,
  targetFamilies, pastFamily}`, absent when no target is stated (empty fields are
  dropped from the dump, so read a missing `matchedTitle` like null). A KO'd row's as-if
  result carries it too. The posting summary and `GET /api/jobseeker/postings/[id]`
  project it as `targetAlignment`. `MATCH_VERSION` is `jobseeker-match-v4`.
- **Measured** on a synthetic 8-year analyst/QA/frontend + 1-year AI consultant with
  target "AI Engineer": AI Engineer 55 -> 69, Senior AI Engineer (LLM) 64 -> 77, IT
  Business Analyst 75 -> 61, QA Engineer 52 -> 52. The same profile routed as
  `career_switcher` still ranks the analyst posting first (transferable-skill credit
  fills its skills slot); /me saves every seeker as experienced, so that path is not
  reached today.
- **Targets come only from the seeker.** The CV studio no longer seeds the CV's own
  role family into `targetRoleFamilies` (it used to, invisibly, steering fetches back
  to the past). Rows seeded before this change keep the value; What you want shows
  every target field as a removable chip, so the seeker can see and drop it.
- **The CV studio tailors toward the first target** (`CV_POLISH_PROMPT_VERSION =
  "cv-polish-v2"`): the persona gets a tailoring block with the hard rule "never add a
  skill, employer, date, number or responsibility the CV does not contain", and the
  keyless path adds grounded `lead` / `move_up` / `transfer` / `gap` suggestions in
  en/cs/de/fr, every `before` a verbatim source line.
- **Acquisition lets the market in.** The adapters' local location filter
  (`adapters/shared.ts` `matchesLocations`) keeps a posting when no place is named, its
  location is unknown, its city matches, its country is one the seeker named, or it
  states remote and the seeker has not ruled remote out. The title filter
  (`matchesTargets`) matches target TITLES as folded whole words; role families alone
  never discard a posting (the matcher ranks).
- **EURES never scans for nothing.** With no country the adapter stops before any
  request (`config_invalid`, detail `config_missing_countries`). Both EURES doors - the
  feed's one-click button and the Sources card - write the derived default country first
  (`app/features/jobseeker/euresDoor.ts`), and the card says which countries it searches.
- **Arbeitnow** (`adapters/arbeitnow.ts`, tier A, key-less): German, UK and French
  editions of one public API, at most 4 pages of 250 per scan, filtered locally (no
  search parameter), attribution "Jobs via Arbeitnow.com" plus each posting's own URL as
  the link-back its terms ask for; country only from the `.co.uk`/`.fr` edition domains,
  never a salary. Remotive was evaluated and NOT added: its robots.txt disallows
  `/api/*` in a second `User-agent: *` group.
- **Measured live (2026-09-25), and fixed from it.** A real career-change run (an
  analyst-to-AI CV, target "AI Engineer", Praha + cz/de/at/nl, remote or hybrid) found
  four acquisition defects no unit test could see:
  - EURES reads a keyword as ANY of its words: "AI Engineer" searched EVERYWHERE and sorted
    by date answered 454,121 vacancies and the first 300 were cooks and cleaners. With
    stated titles the search is now title-scoped and `BEST_MATCH`-sorted (eures.ts
    `euresRequestBody`); the same scan then held 158 target postings of 296.
  - EURES answers `locationMap: {"CZ": ["CZ010"]}`, not the `locations[]` the adapter
    read, so every posting was stored with no country and no place. Now the country
    comes from the map and a Czech NUTS-3 code is named ("CZ010" -> Praha); other markets
    carry the country, no guessed place.
  - An Arbeitnow page is 2.23 MB (250 postings with full descriptions), past the
    fetcher's 2 MB cap, so the source failed `too_large`. `PoliteFetchOptions.maxBytes`
    raises the cap for one known API (clamped to 16 MB); Arbeitnow asks for 8 MB.
  - The MPSV title filter read 39,644 Czech vacancies against the literal words "AI
    Engineer" and kept none. Stated titles now expand through ONE alias table,
    `pipeline/jobfit/target_title_aliases.json`, read by the matcher
    (`target_titles.py`) and the adapters (`app/_lib/jobseeker/targetAliases.ts`) alike,
    with the same job in cs/de/fr ("AI vývojář", "KI-Entwickler", "Ingénieur IA").
- **robots.txt groups combine** (RFC 9309 §2.2.1): several groups naming the same agent
  are one group, and the politest Crawl-delay among them binds (`fetch/robots.ts`
  `groupFor`). Reading only the first `*` group had treated that Remotive API as allowed.

## Scan and scoring

**A scan's failures are on the record.** `ScanSummary.failures` lists each failed phase
(structure / match / deepdive) as `{chunks, of, code}` - failed units out of attempted and
the first failure's code, the raw error in the server log - and `koFiltered` counts what
the hard gates removed. A deep-dive killed because the scan stopped (the wall budget, or the
caller) is the scan ending, said by its `aborted` phase - not an engine failure (the live run
had recorded it as "deepdive: 1 of 10 failed"). A run whose structure or match phase failed completely is stored
as `error`, so it does not verify the clock; a partial failure stays `ok`.
`SourceRunSummary.truncated` marks a pass that hit `maxRefs` or the detail budget (the
history shows "partial read"). While a source is read the task reports
"<host> · done of total" detail progress; phase messages are the closed
`SCAN_PROGRESS_PHASES`. The history shows "N caught by gates" and "N already current".

**A deep-dive keeps its trace.** A re-match that moves the total keeps `previous` in
`match_json` (summary: `previousTotal`); the rationale is written with the seeker's
preferences (`reasoning_cli --preferences-json`, the same `apply_preferences` as the
matcher) and stamped `reasonedAt`; a rationale older than the profile's last change is
`reasoningStale`, and the next scan re-dives it after every never-dived posting.

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
| Match | `listPostingsForMatching(ws, {upToDateVersion, profileUpdatedAt})` → `match_cli --profile-json --preferences-json --jobs <empty corpus> --jobs-json <postings> --limit n --include-blocked` → `setPostingMatch` for survivors, `setPostingBlocked` for the KO'd tail, both with `match_version = "jobseeker-match-v2"` | one spawn per 500; the seed corpus is replaced by an empty one so only the seeker's postings rank |
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

**A filtered posting names its gate and is stamped, never scored 0.** The seeker's own
preferences are KO inputs — `workModes` becomes `preferred_work_modes` and `seniority`
overrides the profile's (`transform.apply_preferences`) — beside the profile's languages
and education. `matchChunk` passes `--include-blocked`, so `match()` also returns every
posting the KO filter removed as `blocked: [{jobId, koKeys, koDetails, result}]`, `result`
being the MatchResult scored AS IF the gate were lifted (its KO-mirrored eligibility flag
reads `flag` — the only way those three chips can ever light up on `/me`). `readBlocked`
drops an id outside the chunk and filters `koKeys` to `KO_REASON_KEYS` (`types.ts`); an
entry left with no known key stays unstamped and is re-matched next scan.
`setPostingBlocked` stores `match_json = {blocked: {koKeys, koDetails}, asIf: <MatchResult>}`
with `match_total` and `fit_tier` NULL — the sort column, the `minTotal` filter and the
deep-dive shortlist all read `match_total`, so an as-if score never ranks — and stamps
`match_version`/`matched_at`, so the next unchanged scan counts the row in
`skippedUpToDate` instead of re-sending it (it used to be re-sent every scan). **Re-check,
not lock:** the UPDATE carries `AND job_json IS NOT NULL`; a content change after the
list (`upsertPosting` NULLs `job_json`) makes it `changes === 0`, and a stale verdict is
never stamped over new content. The KO count still goes to the server log
(`ko_filtered`). `MATCH_VERSION` moved to `jobseeker-match-v2` so every row stored under
v1 is re-matched once and gains its verdict. The recruiter `/api/match` never passes the
flag, and without it `MatchResponse.blocked` is absent from the dump (byte-identical).

`deepdive.ts` — `deepDivePosting(posting, profile, {lang, signal, workspaceId, deps})`,
three spawns per posting: `jobs_cli ingest --job-id <postingId>` (use case `jd_ingest`;
the model re-structures the ad → `job_source = "llm"`), then a re-match of ONLY that
posting through `matchChunk` (deterministic; a KO here leaves the earlier score in place
rather than silently demoting a card the seeker saw), then `reasoning_cli --profile-json
--jobs <one-job corpus> --job-id` (use case `match_reasoning`) → `setPostingReasoning`.
Re-match after model structuring IS done: it is one deterministic spawn and it is what
makes the indexed total and the eligibility flags reflect the richer Job. It is stamped
with the time its inputs were read (the scan's `inputsAt`, or the call's start), like the
scan's own matches, so a preferences edit saved mid-dive still re-matches the row. Every
dive write (structure, match, reasoning) re-checks the content hash it read: if the
posting changed mid-dive nothing is written over the new ad (outcome `moved: true`). The
deep-dive route uses the caller's own profile, not the workspace's newest. A preference
merge from a dialog uses `mergePreferencePatch` inside the IMMEDIATE transaction, so an
empty list never erases a stated one.

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

**Big boards converge over passes.** A scan stops at its 8-minute wall budget and the next
one resumes where it stopped (structured rows persist). Structuring was the slow part:
the taxonomy's whole-token matcher recompiled a regex per term per posting (about 1.5 s a
posting on an AI company's long ad); with its patterns cached and an exact substring
pre-filter it is about 0.09 s (`pipeline/jobfit/taxonomy.py`, docs/features/matching). A
live scan of 1,259 postings (EURES + Anthropic + OpenAI + ElevenLabs + Cohere + Hugging
Face + Arbeitnow) still took three passes before the speed-up; the flow reads the whole
dataset in pages of `POSTINGS_PAGE_MAX` (500) so a large sieve loads in three requests,
not thirteen (the list's 120/10 min limit had locked a seeker out after nine reloads). The
sieve's pour spreads over at most 1.8 s however many dots fall, and a layer's counter ends
on the layer's true count, not on the dots drawn (a capped layer of 946 read "360").

### API (`app/api/jobseeker/{scan,postings}/**`, all `requireOperator()` → limiter → work)

| Route | Verb | Does | Limiter |
| --- | --- | --- | --- |
| `/api/jobseeker/scan` | POST | `startTask("jobseeker_scan", {trigger: "manual", workspaceId})` → 202 `{taskId}` | `jobseeker-scan` 6/10 min |
| `/api/jobseeker/postings` | GET | `?status=&minTotal=&sourceId=&sort=total,posted,seen&cursor=&limit=` (1..100, default 50) → `{rows: JobseekerPostingSummary[], nextCursor, newSince}`; keyset cursor; no `status` = the live feed; `newSince` = `{count, anchorAt}` derived from the seeker's feed anchor, `null` when there is none; a value outside its vocabulary → 400 `APPLY_SELECTION_INVALID` `{field}` | `jobseeker-postings` 120/10 min |
| `/api/jobseeker/postings/[id]` | GET | one posting's summary; 240/10 min per IP (`jobseeker-posting-read`) |
| `/api/jobseeker/postings/[id]` | PATCH | `{status, dismissReason?, note?}` → `setPostingStatus` (a `gone` row is refused, 400 `APPLY_SELECTION_INVALID` `{field: "status", options: []}`); `dismissed` requires a `DISMISS_REASONS` reason (400 `APPLY_SELECTION_INVALID` `{field, options}`); `gone` is refused (the scan's verdict); unknown id → 404 `POSTING_NOT_FOUND`; `applied` stamps `applied_at` (and leaving `applied` clears it), so the card can say when the SEEKER acted instead of when the crawler last looked; answers `{posting}` (summary) | `jobseeker-postings-write` 120/10 min |
| `/api/jobseeker/profile/seen` | POST | `{at, id}` — the ordering tuple of the newest row the feed RENDERED (`at` must be a canonical ISO instant, a `toISOString` round-trip, else 400 `APPLY_SELECTION_INVALID` `{field: "at"}`) → `advanceFeedAnchor` (monotonic; an older tuple is a no-op) → `{anchor}`; no profile → 404 `JOBSEEKER_PROFILE_MISSING`; a malformed tuple → 400 `APPLY_SELECTION_INVALID` `{field}` | `jobseeker-feed-seen` 120/10 min |
| `/api/jobseeker/postings/[id]/deepdive` | POST | `?lang=` → `deepDivePosting` synchronously (maxDuration 120) → `{posting, source, reasoning, fallbackReason}`: `llm`/`null` (persisted), or 200 `deterministic` with `fallbackReason` `template` or `no_provider` and `reasoning` null when the template was empty (`deepdive-route.test.ts`); no profile → 409 `JOBSEEKER_PROFILE_MISSING` | `jobseeker-deepdive` 20/10 min |

Codes are reused, not minted: `APPLY_SELECTION_INVALID` is the existing generic "not one
of the options offered" refusal, `POSTING_NOT_FOUND` the existing "that job posting could
not be found". Store additions: `getPostingSummary`, `listPostingsNeedingStructure`,
`listDeepDiveCandidates` (postings), `getWorkspaceJobseekerProfile` (profiles — the scan
has no session, so it reads the workspace's newest profile),
`listWorkspacesWithEnabledSources` (sources, global, see Scheduler).

## Feed, fit dialog, sources UI

**Feed** — now the flow's "Worth your evening" step (`StepEvening.tsx`, see "The flow").
It reads every row once (`GET /api/jobseeker/postings?status=all`, paged to the end by
`useSieveData.ts`) and sorts, filters and ranges on the client: the list is the
seeker's own few hundred rows, and the skyline, the top five and the rail all need the
whole set. The old ledger (`JobsFeed.tsx`, `PostingRow.tsx`, `FeedEmptyState.tsx`) was
removed with it; `/me/jobs` redirects to `/me#s-evening`. The chain-aware empty states
live on in the sieve step: no profile → "not reached", no enabled source → the one-click
EURES door beside "Choose sources", no scan yet → Scan now, a scan that found nothing →
says so. `data-empty-state` stays on the gap box.

**"New since your last visit"** is derived from ONE durable anchor per profile, never a
maintained counter. `jobseeker_profiles.feed_seen_at` + `feed_seen_id` hold the ordering
TUPLE the keyset pager already uses — `(first_seen_at, id)` — and the count is one
comparison over it (`countJobseekerPostingsNewSince`), so the header count, the divider
and the rail badge cannot disagree. The rules:

- **It only moves when the reader demonstrably saw a settled feed.** The tuple is the
  newest row the page actually RENDERED (`feedModel.ts: renderedAnchor` — not row 0: the
  feed sorts by fit, so the newest arrival is rarely at the top), and a failed or
  still-loading page advances nothing (async-ui-states: a failure is not a read).
- **It never moves backwards.** `advanceFeedAnchor` puts the comparison in the UPDATE's
  `WHERE`, so a late beacon, a second tab, or a tuple from a page rendered minutes ago is
  `changes === 0` — and the store answers the anchor as it STANDS, not the one it was
  asked for (`jobseeker-profiles.test.ts`).
- **It advances on departure and on acknowledgement**: `visibilitychange` → hidden and
  `pagehide` send `POST /api/jobseeker/profile/seen` by `sendBeacon` (a `keepalive` fetch
  where the beacon is missing or refuses), and a "Mark all as seen" control does the same
  deliberately.
- **It deliberately does NOT touch `updated_at`.** That column is what the scan's
  incremental matcher compares stored scores against; reading the feed is not a change to
  the inputs a score was computed from, and bumping it would re-score the dataset on every
  visit.
- **A first visit is quiet.** No anchor answers `newSince: null` — not `{count: 0}` — so
  there is no badge and no divider until there is something to be behind on.

The count is stated in the Evening step's head beside "Mark all as seen", and every row
newer than the anchor carries a "New" chip; the anchor advances from the scored rows the
flow rendered (`SieveFlow.tsx`, `renderedAnchor`).

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
button is what the scan actually does. The two-clause paragraph that explained EURES —
what it is, that it is rights-clean, which countries the first scan reads — now rides ON
the control as a `Tooltip` (surface-doctrine §1: no sentence occupies layout on a surface
whose job is to name one next step); only the link to the preferences that own the
country choice stays in the flow, because a destination cannot live inside a label
surface. The progress line is `NOTICE("info")` and the unreachable caveat `NOTICE("amber")`
— both were hand-typed status colors beside the recipe written for them — and every
refusal renders through `FailureNotice` from its code.

**Failure is spelled apart from empty** (`FailureNotice.tsx` + `apiFailure.ts`). One
block serves all three seeker surfaces: a `NOTICE("critical")` with `role="alert"`, the
sentence resolved by CODE, and a Retry that re-issues exactly the request that failed
(busy while it runs) — the filters, the sort and the scroll position survive it. Three
rules hold around it: a BROKEN CHAIN is answered without a request at all
(no profile or no enabled source means the page
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

**Detail** — now the flow's Weigh step (`StepWeigh.tsx`); `/me/jobs/[id]` redirects to
`/me?open=<id>#s-weigh`. It reads `GET /api/jobseeker/postings/[id]` → `{ view, fit,
source }`: `view` is `postingDetailView` (`postingView.ts`: the body as text, the skill
lists with the seeker's provenance per matched skill, the breakdown, the confidence with
its drivers, the eligibility, early-career openness, the reasoning — never the raw
JSON-LD or the structured Job), `fit` is the latest CLOSED fit dialog's artifact
(`latestFitDialogForPosting`, workspace-bound), `source` the tier and host.
A filtered posting shows its gates, the engine's sentence per gate (only for gates the
vocabulary knows — `koDetails` stays index-aligned with `koKeys`) and "with the gate
lifted it would score N", never a gauge. The ad is plain text, folded away; the deep read
(`POST .../deepdive`) answers keyless with the fixed template and says so. Status moves
are the PATCH door; Apply opens the ad in a new tab and only then offers "I applied —
mark it". Settling a verdict in `FitStudio` updates the step without a reload.

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
+ `AddSourceForm.tsx`). SERVER-FIRST like `/me` and `/me/jobs`: `app/me/sources/page.tsx`
reads `sourcesCatalog()` + `listJobseekerSources(ws)` and hands them down as `initial`,
so the header and the three tiers paint on the first frame; the client re-reads the same
GET in the background and owns every write. There is no skeleton branch — the page used
to mount empty and flash three grey cards on every navigation. The Add form opens from
the header's primary action as a `Collapse`, not from a panel below the tiers. Three
sections from `GET /api/jobseeker/sources`, each ONE panel of hairline-parted LEDGER
rows (`ProfileRosterRow` density, `hover:bg-paper/70`, a trailing action cell) rendered
through `ArrivalList` + `sourceArrival.ts` — the rows cascade once on first paint and
after that only a source that was just added animates. The tier's explanation rides on
an `IconAction` beside its heading instead of a `max-w-prose` paragraph under each of
the three (surface-doctrine §1). Tier A rows:
label, host, kind, the `SourceSwitch` (`role="switch"`, the ONE on/off control this
module has — the recruiter panel's `SchedulerJobRow` toggle is the unrecipe'd literal it
replaces), last run outcome, a `Badge tone="caution"` "Paused" pill whose reason is its
tooltip, resume. Tier B rows fold robots summary, the terms clause summary with its URL
and our cadence behind a disclosure (`Collapse`), force-opened whenever the
acknowledgement block is up; the switch is the ACKNOWLEDGEMENT door: the first enable answers
409 `JOBSEEKER_SOURCE_NOT_ACKNOWLEDGED` with `termsHash`, the card shows the block
(DevPublishConfirm's shape: `alertdialog`, three enumerated reasons, the checkbox FIRST
in focus order, the CTA disabled until ticked) and re-sends `{enabled: true,
acknowledge: true}`; a hash that differs from `acknowledgedTermsHash` says the terms
changed. Tier C rows: a muted ledger row with a `Badge tone="neutral"` "Refused" pill whose
`refusedReason` is its tooltip, no control. Boards get a "Preview" /
"Rules and preview" panel: `POST …/preview` renders the per-rule verdict table and the
first items; `board_rules` adds "Author rules" (`POST …/rules/propose`, marked AI /
without AI) and "Save rules" (`PATCH {rules, rulesBaseline}`), offered only after a
preview that passed — with the precondition on a `Tooltip`, not a `title=`. The per-rule
table goes through the shared table kit (`ColumnHead` + `useTableSort` + `TableStatus`
+ `STICKY_HEAD`), and the well is `PANEL_SUNKEN`. Catalog entries not yet added appear in their tier with "Add"
(`POST {catalogId}`); the form adds an ATS by vendor + company slug (`{adapter, config:
{slug}}`) or a board by host (tier B by rule). Every refusal renders from its code.

**Scans** (`/me/scans`, `ScansPage.tsx`). SERVER-FIRST: `app/me/scans/page.tsx` builds
the `jobseeker_scan` job view itself (`ensureRegisteredSchedule` for the registry's own
defaults, `listRuns(5, …, {workspace})`, `hasVerifiedRun`) plus the source labels the
history names, and hands them down as `initialJob` / `initialSources` / `initialLabels`,
so the clock frame and the run list paint on the first frame instead of a grey panel
whose shape did not mirror them. The client re-reads `GET /api/automation/schedule` and
`GET /api/jobseeker/sources` in the background and owns every write; it
filters `jobs[]` to `jobseeker_scan`: the toggle (disabled with
`pipeline.scheduler.unverified` as its title until `verified`; the route refuses the
write with `JOBSEEKER_SCAN_UNVERIFIED`), the cadence as 6 h / 12 h / 24 h (a stored
interval outside the three snaps to the nearest for display), last run, "Scan now"
with live progress, and the run history unrolled per source from the stored
`ScanSummary` (`ScanRunTable.tsx` — `ColumnHead` + `useTableSort` + `TableStatus` +
`STICKY_HEAD`, `nums` on the body cells; outcome word + new / changed / absent +
reason); `blocked` / `collapsed` are a `Badge tone="caution"` with the pause reason in
its tooltip and a link to `/me/sources`, because only the owner clears those. Every red
or amber line on both pages is now `FailureNotice` (an error), `NOTICE()` (a caveat) or
a `Badge` (a state) — no surface writes its own `text-red-700`. `SchedulerJobRow` is not reused (free minutes field, policy-pass history).

**e2e.** `e2e/jobseeker-keyless.spec.ts` is declared against the throwaway DB (the flow
opens on the Arrive drop, the sieve is "not reached" before a CV, `/me/jobs` lands on the
flow, the Sources step's three lanes with tier C carrying no control, a tier-B lock →
acknowledgement with the checkbox focused and the CTA disabled until ticked, the scans
toggle locked) and is NOT in
`KEYLESS_SPECS`: enrolling it means the ci.yml step and `.claude/CLAUDE.md` in the same
change (`keyless-e2e-pin.test.mjs`), which this package does not touch.

## The live end-to-end run

`KP_ME_LIVE_CV=/path/to/cv.pdf npm run e2e:me-live` (`scripts/e2e/me-live.mjs` +
`e2e/jobseeker-live.spec.ts`) walks the whole flow with the owner's real CV: a FRESH
database (`data/kp-me-live.sqlite`) on an isolated `next dev` (KP_EMPTY=1, so the
`.next-empty` distDir; it refuses, naming the holder, when that lock or the port is taken),
the CV read, the wants typed through the cards (Praha + CZ/DE/AT/NL/PL, AI Engineer / LLM
Engineer / Machine Learning Engineer, remote + hybrid), the three open feeds and AI
companies' public boards switched on (tier A only - it never accepts a tier-B board's
terms), a real scan repeated until nothing waits for a score (at most five passes in an
hour), then the ranking, one target match opened and shortlisted, and every section
photographed in both themes on a desktop and a phone. The report and screenshots land in
`test-results/me-live/` (git-ignored); nothing personal is asserted or printed. It is
outside `KEYLESS_SPECS` and CI by design: it needs a CV, the network and most of an hour.

## Known gaps

- The seeker's erasure does not cancel a scan already running (see "Delete everything about me").
- With two seeker profiles in one workspace, the postings are shared and no column says whose triage a row carries, so one seeker's erasure leaves the postings alone.
- A deep-dive whose posting changed mid-dive writes nothing (`moved: true`), but POST `/deepdive` still answers `source: "llm"` and the scan counts it in `deepDived`; the client contract has no "moved" state.
- Regex locators: a nested quantifier (`(a+)+`, `(?:x*)*`, `(a+){2,}`) is refused at validation and a stored one is a miss at run time; one locator collects at most 1000 matches per page.
- The designed CV's "better expressed" is deterministic tidying only; rewording bullets with a model is the CV-polish conversation's job and does not yet feed the designed sheet (its output is Markdown).
- Everything above marked with a work-package number is not built yet. WP5 (feed, detail,
  fit dialog, sources, scans) is built, as the flow's steps.
- The "New" chip compares against `newSince.anchorAt` alone — the anchor's id half is not
  on the wire — so a posting first seen in the very same millisecond as the anchor row is
  marked new. The COUNT is the server's and compares the full tuple.
- The top five cards do not yet flag a posting whose fit conversation settled (the
  winner's "guided" badge): the summary row does not carry that fact.
- Editing "What you want" saves at once but does not re-score: the scores on screen are
  from the last scan, and the step says so beside Scan now.
- The rail shows no "new since your last visit" badge any more; the count lives in the
  Evening step's head.
- `fitTurnContext` (`app/_lib/jobseeker-fit-context.ts`) passes the stored `match_json`
  verbatim, so for a filtered posting the fit coach receives `{blocked, asIf}` and reads
  no `eligibility`/`missingSkills` from it — the same empty context it had when a KO'd row
  carried no match at all. Passing `asIf` (plus the gate) would let the coach name the
  blocking gate; not done in the change that stored the verdict.
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
