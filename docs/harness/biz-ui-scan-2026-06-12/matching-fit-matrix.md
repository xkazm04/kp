# Biz+UI Scan — Candidate-Job Matching & Fit Matrix (2026-06-12)

> Total: 5 (1H/3M/1L)
> Net-new only. Verified shipped since 06-10 (not re-flagged): reasoning `--lang` threading (reasoning_cli.py:34, reasoning-run.ts:29-43), matrix KO blocker names (matrix_cli.py:99-100, MatrixTab.tsx:63-73, messages/en.json:2005), min-fit/column-sort, bulk shortlist, CSV export, JobCompare, table `scope` a11y. Weight persistence + matrix weight parity (06-10 #4) and the `?job=` deep-link highlight (06-10 #3) remain open and are NOT repeated below.

## 1. Let the Match tab and Explain fit see recruiter-ingested jobs, not just the demo corpus
- **Lens**: business_visionary
- **Severity**: High
- **Category**: functionality
- **File**: `pipeline/jobfit/match_cli.py:44`
- **Scenario**: A recruiter ingests their own JD (job-ingest writes "matchable Job rows", `app/_lib/job-ingest.ts:10`) and publishes it; the Fit Matrix scores every candidate against it because `/api/matrix` passes full DB job records to Python (`app/api/matrix/route.ts:54,94` `--jobs-json`). But when they open the Match tab and rank jobs for a candidate, that position never appears — at any rank. Clicking the role's matrix cell deep-links to Match (`MatrixTab.tsx:197`), which auto-runs and silently returns a ranking that omits the exact role they clicked.
- **Root cause**: `/api/match` spawns `match_cli` with only `inputArgs + --limit + --weights` (`app/api/match/route.ts:38-49`) and `match_cli.py:44` does `jobs = load_corpus(args.jobs)` — the static seed file `data/seed_jobs/jobs.normalized.json` (`matching.py:765`). Same hole in `reasoning_cli.py:42-45`: it looks up `--job-id` in `load_corpus()` only, so reasoning for a DB-ingested job raises `job not found` (while `reasoning-run.ts:53` happily builds a cache key from the DB record via `getJob`). The matrix and automation rematch both already solved this (`automation-run.ts:140-142` writes the live corpus and passes `--jobs`).
- **Impact**: The tool's core ranking surface works only for demo seed jobs. For the single-tenant recruiter's *real* openings — the monetizable use case — Match is blind, and the matrix→match journey breaks trust: the grid says "72, strong" while the ranking implies the role doesn't exist. If 06-10 #3 ("role was filtered out" note) ships on top of this, it will assert a falsehood for every ingested job.
- **Fix sketch**: In `/api/match` (and the reasoning runner), mirror the matrix route: fetch the DB jobs (`getJobsByIds`/`listCorpusJobs` per the rematch precedent), write them to the workdir, and pass a new `--jobs-json` to `match_cli`/`reasoning_cli` that augments the corpus exactly like `matrix_cli.py:53-57` (overrides win on id collision). Add the corpus fingerprint to the reasoning cache key (precedent: `computeCorpusFingerprint` in `automation-run.ts:121`).

## 2. Make "Explain fit" reason about the score the recruiter is looking at after a re-rank
- **Lens**: business_visionary
- **Severity**: Medium
- **Category**: functionality
- **File**: `pipeline/jobfit/reasoning_cli.py:46`
- **Scenario**: Recruiter applies a MAT1 weight override ("Skills-first") and the list re-ranks — a card now reads 72 / strong. They click "Explain fit". The verdict comes back reasoning about a *different* number: "Promising fit … with a few addressable gaps", because reasoning re-scored the pair at the archetype baseline (say 68 / promising).
- **Root cause**: `reasoning_cli.py:46` calls `score_job(candidate, job)` with no `weights`, and the explain task params carry none (`MatchCard.tsx:61` — `{ ...matchRef, jobId, label, lang }`). The verdict wording is pinned to `fit_tier_for(total)` of that baseline total (`match_reasoning.py:175,198-204`) and the LLM prompt embeds the baseline `match.total` (`match_reasoning.py:67-74`). `matching.py:172-174` explicitly promises "the prose can't contradict the badge" — the MAT1 weights seam re-opened that contradiction whenever the re-weighted total crosses the 70/55 tier cutoffs. The reasoning cache key (`reasoning-run.ts:49-55`) has no weights axis either, so even an English/Czech pair of sessions shares one baseline verdict regardless of weighting.
- **Impact**: The most-quoted artifact on the page (verdict/strengths/gaps) can name a different fit tier than the badge beside it, exactly when the recruiter has invested effort in tuning — quietly discrediting both the sliders and the reasoning.
- **Fix sketch**: `Results.tsx` already holds the applied vector (`candidate.weights` rides every MatchResponse, `MatchTypes.ts:103`); thread it into the explain task params, forward as `--weights` on `reasoning_cli` (copy `match_cli.py:33-52`'s arg contract; `resolve_weights` clamps server-side), pass into `score_job(..., weights=resolved)`. Add a `weights` axis to `reasoningCacheKey` only when the vector differs from baseline so existing cache entries stay valid.

## 3. Stop mixing English scorer prose into the Czech match surface
- **Lens**: ui_perfectionist
- **Severity**: Medium
- **Category**: user_benefit
- **File**: `app/features/sub_match/MatchShared.tsx:209`
- **Scenario**: A Czech recruiter (cs locale, fully translated chrome, now even a Czech LLM verdict) runs a thin match. They read: "**3 pozice** neprošlo — většinou proto, že *required a language not in the profile*." (cs.json:1374 interpolates the server's English clause). The "Proč toto rozpětí:" line shows "Early-career: thinner, less-verifiable track record"; "Předpoklady:" is followed by English sentences; and the score-breakdown legend says "Skills / Career / Personal" while the WeightsPanel two lines up labels the *same* dimensions in Czech.
- **Root cause**: Four deterministic-scorer strings are rendered raw from Python English: KO clause labels `_KO_REASON_CLAUSES` (`matching.py:669-675`) in `KoReasonList` (`MatchShared.tsx:209`) and `KoReasonsNote` (`MatchShared.tsx:259`, `reason: reasons[0].label`); confidence drivers (`matching.py:543-558`) in `MatchCard.tsx:172` and the band tooltips; assumptions (`matching.py:647-662`) in `Results.tsx:183`; `ScoreDimension.label` from the registry (`matching.py:417,422`) in `ScoreBreakdown`/`JobCompare` legends (`MatchShared.tsx:190`, `JobCompare.tsx:90`) — while `WeightsPanel.tsx:14-17,44` localizes the same dims via `match.dims.*`. The KO keys are already stable and already localized elsewhere (`matrix.ko.*`, `match.shared.koHint.*` — en.json:1375, 2005), so the Match tab is the one surface still printing the English `label`.
- **Impact**: The exact sentences a recruiter copies to hiring managers and candidates are half-English in a product whose differentiator is being a bilingual Czech-market tool. It also makes the en/cs catalogs lie about coverage.
- **Fix sketch**: KO labels: localize by `KoReason.key` exactly as `MatrixTab.tsx:63-73` does (the catalog section exists; drop the server `label` from rendering). Breakdown labels: render via the existing `match.dims.*` keys off `d.key` (archetype-aware mapping already in `WeightsPanel.dimKeysFor`). Drivers/assumptions: mint stable keys at birth in Python (the documented KoReason pattern, `matching.py:209-215`) with params (counts, levels), and resolve through the catalog client-side; keep `detail` English as debug payload.

## 4. Show existing pipeline placements on Match results (the matrix already does)
- **Lens**: business_visionary
- **Severity**: Medium
- **Category**: user_benefit
- **File**: `app/features/sub_match/Results.tsx:41`
- **Scenario**: A candidate is already at Interview stage for "Backend Engineer". The recruiter re-runs Match for them (or arrives via the matrix deep-link): every card — including Backend Engineer — shows a neutral "+ Pipeline" button. Clicking it appears to succeed ("✓ In pipeline") but actually no-ops via the dedupe (`db.ts:2672-2697` returns `created: false`; the UI never distinguishes). Nothing on the ranking says "you're already running this race."
- **Root cause**: `Results.tsx:41` seeds `added` as an empty session-local set and `sub_match` never reads placements; the data exists and is cheap — `pipelinePlacements()` (`db.ts:3038`) is already fetched on every matrix response (`app/api/matrix/route.ts:68`) and rendered as ring + stage initial (`MatrixTab.tsx:530-534,580-582`). The two ranking surfaces disagree about the single most decision-relevant overlay.
- **Impact**: Recruiters re-shortlist people already in process (bulk "Shortlist top 5" happily ticks them), and the Match list can't answer "which of these strong fits is actually new?" — the question that decides what to do next with a ranking. The silent no-op add also misreports a "re-add" of a rejected candidate (the dedupe re-activates a terminal entry, `db.ts:2690-2695`, with no UI hint that this is a reconsideration).
- **Fix sketch**: On result load (or alongside the match POST), fetch placements for the candidate (`GET /api/pipeline` filtered client-side, or expose `pipelinePlacements()` keyed by `candidateId|jobId` — the matrix shape). Seed `added` from active placements and render the matrix's stage chip vocabulary (`STAGE_INITIAL` + `inPipelineStage` strings) on `MatchCard`; exclude placed roles from `addableMatches` so bulk-select counts stay honest.

## 5. Restore design-token compliance in the matrix distribution strip and blocked-cell hatch
- **Lens**: ui_perfectionist
- **Severity**: Low
- **Category**: ui
- **File**: `app/features/sub_matrix/MatrixShared.tsx:11`
- **Scenario**: In Spark Dark, blocked cells dominate a real pool's grid — and each one is filled with bright light-grey diagonal stripes (`#d6d3d1`, the *light* stone-300) over the remapped dark `bg-stone-100` (`#283442`), turning the quietest cells in the legend into the loudest pixels on screen. Under each column header, the best/median/strong row and the "no fits" note render at 10px in both themes.
- **Root cause**: `BLOCKED_CELL` (`MatrixShared.tsx:10-11`) hard-codes the hex inside an arbitrary `repeating-linear-gradient`, bypassing the var-based neutral remap that makes every other stone-* surface flip (`globals.css:115-123`, "Mapped onto the same ink-blue ramp"); the dark register comment explicitly requires new shades to route through tokens (`globals.css:124-126`). `ColumnStats` uses `text-[10px]` (`MatrixShared.tsx:35,52`) below the documented type floor — `globals.css:54`: "Meta/micro promoted to 14 (text-sm) — nothing renders below text-sm." The same file's cells otherwise honor the system (dark sticker hover ride at `MatrixTab.tsx:568-571`).
- **Impact**: The dark theme's signature surface (the data grid the DESIGN.md "Data visuals" ride targets) reads broken rather than re-skinned, and the MAT2 stats — recruiter-facing numbers — are the least legible text in the app, below WCAG-comfortable sizes the system already standardized away.
- **Fix sketch**: Swap the literal hex for the token: `[background-image:repeating-linear-gradient(45deg,var(--color-stone-300)_0px,var(--color-stone-300)_1px,transparent_1px,transparent_5px)]` (flips automatically; light value unchanged). Promote the stats line and "no fits" note to `text-sm`/`text-meta` with `leading-none` kept — the 84px column width already accommodates 14px digits (`MatrixTab.tsx:496`).

---
## Cross-checks performed
- Prior reports read: feature-scout 06-10 (4 findings) and 06-08 (6 findings), plus ui-bug-scan 06-08 (4 findings) — all verified against current code; shipped items listed in the header note, open items (weights persistence, deep-link highlight) not re-flagged.
- Finding 1: grep `--jobs|jobs-json` across `app/` — only `api/matrix/route.ts:94` and `automation-run.ts:142` pass DB jobs to Python; `/api/match` and the reasoning runner never do; `match_cli.py:44`/`reasoning_cli.py:42` load the seed corpus only.
- Finding 2: explain task params at `MatchCard.tsx:61` carry no weights; `reasoning-run.ts` args (35-43) and cache key (49-55) weight-blind; `reasoning_cli.py:46` scores baseline.
- Finding 3: cs.json fully translates the surrounding sentences (cs.json:1374,1398,1426) — the English fragments are exclusively server-supplied; `matrix.ko.*` keys exist in both catalogs.
- Finding 4: grep `pipeline|placements` in `sub_match/` — POST-only; no placement read anywhere in the Match tab.
- Finding 5: grep `text-\[10px\]` — exists elsewhere (control/page.tsx, AnalysisSummaryModal) but those are out of context; the hard-coded gradient hex is unique to `MatrixShared.tsx`.
