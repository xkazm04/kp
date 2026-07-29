---
run: 2026-07-20-cases-scoring
character: jana-sourcer
journey: jd-to-shortlist
cert_level: L1
verdict: L1-conditional
language: cs
grounding: 2/8
time_saved_min: 45
time_saved_confidence: low-medium
baseline_min: 780
branch: vibeman/ambiguity-ui-wave1
scope: read-only; sourcing/matching half (JD -> pool -> ranked shortlist)
headline: "Does the shortlist rank ability or presentation?"
---

# Jana Horáková × Z inzerátu k odůvodněnému shortlistu — L1 (theoretical)

## Surface model

The journey has **two different axes**, and only one of them is Jana's.

**Axis A — candidate → many jobs (Match tab).** Not Jana's direction, but it owns
the reasoning machinery, so it is modelled here for contrast.

| Affordance | Backing code |
|---|---|
| Source toggle (profile / analysis) | `app/features/sub_match/MatchTab.tsx:168` |
| Candidate `<Select>` | `app/features/sub_match/MatchTab.tsx:182` |
| "Run matching" button | `app/features/sub_match/MatchTab.tsx:225` → `runMatch` `:117` → `runMatchFor` `:88` → `POST /api/match` `:97` |
| Route | `app/api/match/route.ts:30`; input resolved by `writeMatchInput` `:38` → `app/_lib/match-input.ts:87` → `resolveMatchInput:44`; **full raw profile payload handed to Python** (`match-input.ts:60`) |
| Live corpus hand-off | `app/api/match/route.ts:48` `listCorpusJobs(workspaceId)` → `--jobs-json` `:52` (an ingested job ranks, not just seed) |
| Weight override (MAT1) | `app/api/match/route.ts:58-64` → `--weights` |
| Python entry | `pipeline/jobfit/match_cli.py` → `matching.match()` `pipeline/jobfit/matching.py:967` |
| **"Explain fit"** (the reasoning) | `app/features/sub_match/MatchCard.tsx:138-141` → `startTask("reasoning", …)` `:69` → `app/_lib/reasoning-run.ts:43` → `pipeline.jobfit.reasoning_cli` `:96` → `pipeline/jobfit/match_reasoning.py:311` |
| Reasoning source disclosure | `app/features/sub_match/MatchShared.tsx:151` — renders `sourceLlm` vs `sourceRuleBased` (+ `cachedSuffix`) |
| Degrade seam | `app/_lib/reasoning-run.ts:115` — `if (!meterAllows("ai_candidates")) args.push("--no-llm")`; deterministic result deliberately left uncached `:131` |

**Axis B — one job → ranked candidates (Jobs tab). This IS `jd-to-shortlist`.**

| Affordance | Backing code |
|---|---|
| "Score candidates" button | `app/features/sub_jobs/RecruiterCandidates.tsx:133` |
| Route | `app/api/jobs/[id]/candidates/route.ts:9` |
| Pool build | `route.ts:20` → `app/_lib/candidate-pool.ts:76` `buildCandidatePool` (v2 profiles cap 100 `:33`, saved analyses cap 60 `:34`) |
| Empty-state | `route.ts:23` — `"No saved candidates yet."` |
| Ranking spawn | `route.ts:31` → `app/_lib/recruiter-run.ts:22` `rankPoolForJob` → `pipeline.jobfit.recruiter_cli` `:32`, `--job-json` `:36` |
| Ranker | `pipeline/jobfit/recruiter.py:50` `rank_candidates_for_job` → `matching.score_job` `:60`; sort `:89`; fairness-track grouping `:93` |
| Row decoration (sourcing state) | `route.ts:44-55` (`inPipeline`, `outreachSent`) |
| Honest pool cap signal | `route.ts:58` `poolTruncated` ← `candidate-pool.ts:26` |
| Row render | `RecruiterCandidates.tsx:479` `ScoreBadge`, `:497` `FitTierBadge`, `:561-569` matched-skill chips **with provenance badge**, `:570-574` missing-skill chips, `:577-581` first assumption |
| Rediscovery ("why now") | `app/features/sub_jobs/RediscoverPanel.tsx` → `app/api/jobs/[id]/rediscover` → `app/_lib/rediscover.ts:1`; prior-depth ordering `app/_lib/rediscovery-rank.ts:26,38` |

**The scorer itself** (`pipeline/jobfit/matching.py`), which is what the headline
question turns on:

- Layer A KO gates — `ko_filter:294` (seniority floor `:321`, education `:326`, languages `:331`, work-mode `:341`; fail-closed on unknown archetype `:310`).
- Layer B, three dimensions weighted per archetype (`pipeline/jobfit/archetypes.json` — BAU `skills .50 / career .35 / personal .15`):
  - `score_skills:405` — per-requirement best `skill_match_score`, normalised `acc/total_w` `:451`.
  - `score_career:455` — `role_family` equality + seniority proximity.
  - `score_personal:496` — language coverage blended with **whole-word keyword overlap between the candidate's own traits+skills and the ad text** `:520-535`.
- `skill_match_score` — `pipeline/jobfit/taxonomy.py:860`, taxonomy hierarchy discounted by `provenance_weight` `:904`.
- Total — `_weighted_total:805`; banding `fit_tier_for:84`; confidence band + named drivers `_confidence:723`.

## Grounding audit

For the **JD→shortlist ranking surface** (Axis B), the real context the score
*should* use vs what actually reaches the scorer:

| # | Context the score should use | Reaches the scorer? | Evidence |
|---|---|---|---|
| 1 | The real JD (title, must/nice requirements, seniority, languages) | **YES** | `route.ts:31` passes the DB job → `recruiter-run.ts:36` `--job-json`; requirements consumed at `matching.py:409` |
| 2 | The candidate's full profile (skills + per-skill provenance) | **PARTIAL** | v2 profiles: full raw payload (`match-input.ts:60`, `transform.py:121-126,148`). Analysis-derived: flattened to a **6-field stub with no provenance** (`candidate-pool.ts:47-73`) |
| 3 | Verified artifacts (GitHub repos, portfolio, demo links) | **NO** | `work_links` declared `matching.py:123` but referenced ONLY at `match_reasoning.py:64`; zero uses in any `score_*` function |
| 4 | Checkable work history (roles, dates, what they shipped) | **NO** | `experience_highlights` `matching.py:122` → only `match_reasoning.py:63` |
| 5 | Prior pipeline outcomes for this candidate | **NO** (base score) | grep of `outcome\|hired\|prior_pipeline` over `matching.py`/`recruiter.py`/`transform.py` → zero hits. Present only in *rediscovery ordering*: `rediscovery-rank.ts:38` |
| 6 | CV authenticity / AI-generation / keyword-stuffing screen | **NO** | `pipeline/jobfit/authenticity.py:43` `authenticity_checks` is imported only by `pipeline/jobfit/pipeline.py:10`, called at `:293` (analysis trust ledger). Never by `matching.py` |
| 7 | ČS brand / process / comp band context | **NO** | no reference in the ranking chain |
| 8 | The recruiter's own prior decisions / calibration | **NO** | no reference in the ranking chain |

**Grounding: 2/8** for the ranking surface (1 full + 1 partial + 6 absent).
The *reasoning* surface (Axis A only) scores better — 4/8, since it additionally
receives `experienceHighlights` and `workLinks` (`match_reasoning.py:63-64`) —
but those are passed as **unfetched strings**; nothing dereferences a repo URL.

Additional grounding seam: for BAU candidates the reasoning prompt does **not**
receive skill provenance at all — `skillProvenance` is added only inside the
early-career branch (`match_reasoning.py:66,71`). The narrative for Jana's
experienced majority has no evidence-quality signal to reason from.

## Reachability

Resolved **before** judging, per rubric.

- Jana is an internal user; per `uat/characters/jana-sourcer.md:103` her binding is Channels / Match / Jobs. `app/features/tabs.ts` has **no per-role nav gating**, so reachability reduces to "dev gate on + fixture present".
- **Reachable:** Match tab, Jobs tab + `RecruiterCandidates` scan, `RediscoverPanel`. All findings below are inside this set.
- **Fixture-conditional:** `route.ts:23` returns `"No saved candidates yet."` when `buildCandidatePool` is empty — with only `seed_jobs_csas.py` and no `seed_candidates.py`/`seed_pipeline.py`, the entire shortlist is an empty state. Per the journey file `:44-46` that is an empty-state finding, not a pass. L2 must preflight this.
- **Scope-noted, not scored on narrative quality:** if no Gemini/Claude key is present, `reasoning-run.ts:115`-adjacent paths and `match_reasoning.py:326` return the deterministic template. Per `uat/journeys/jd-to-shortlist.md:61`, structure is judged, prose is not.
- **Out of set:** candidate token pages, Dev, Billing. Nothing below is attributed there.

No finding in this report is `unreachable`.

## Findings

```json
[
  {
    "id": "cs-jana-01",
    "journey": "jd-to-shortlist",
    "character": "jana-sourcer",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "dimension": "trust",
    "title": "The entire match score is computable from the candidate's own self-written text — no verified input reaches the scorer",
    "expected": "A shortlist rank blends what a candidate claims with what can be checked (artifacts, work history, prior pipeline outcomes).",
    "got": "All three scored dimensions read self-reported fields only. skills = claimed skill strings vs JD requirement strings; career = self-stated role_family + seniority; personal = keyword overlap of the candidate's own words against the ad. The two evidence-bearing fields the model DOES carry (work_links, experience_highlights) are declared on MatchCandidate but referenced by nothing in the scoring path.",
    "evidence": [
      "pipeline/jobfit/matching.py:405 score_skills — claimed skills vs requirement strings",
      "pipeline/jobfit/matching.py:455 score_career — self-stated role_family + seniority only",
      "pipeline/jobfit/matching.py:496 score_personal — candidate's own words vs ad text",
      "pipeline/jobfit/matching.py:122-123 work_links / experience_highlights declared",
      "pipeline/jobfit/match_reasoning.py:63-64 — their ONLY consumer (narrative, not score)"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "l2_priority": "Rank two fixture candidates with identical claimed skills but different verifiable substance (one with a real repo + dated roles, one with neither) and confirm the totals are indistinguishable."
  },
  {
    "id": "cs-jana-02",
    "journey": "jd-to-shortlist",
    "character": "jana-sourcer",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "dimension": "trust",
    "title": "The provenance discount — the one anti-self-report control in the scorer — is switched off by default for experienced candidates, and the UI badges the unearned credit as PROFESSIONAL",
    "expected": "A skill typed into a CV scores below a skill evidenced by production work, and the badge reflects what was actually established.",
    "got": "DEFAULT_PROVENANCE is 'professional' (weight 1.0 — no discount). transform.py sets provenance_default 'self_declared' ONLY for early-career; BAU gets 'professional'. Analysis-derived pool entries carry no skill_provenance map at all, so every skill inherits the 1.0 default. score_job then writes that default into matchedSkillProvenance, and the row renders it as a PROFESSIONAL badge — a merely-typed skill displays as production-proven.",
    "evidence": [
      "pipeline/jobfit/taxonomy.py:394 DEFAULT_PROVENANCE = \"professional\"",
      "pipeline/jobfit/taxonomy.py:382 \"professional\": 1.0",
      "pipeline/jobfit/transform.py:182 provenance_default=\"self_declared\" if is_early else \"professional\"",
      "app/_lib/candidate-pool.ts:47-73 poolEntryFromAnalysis — no skill provenance emitted",
      "pipeline/jobfit/matching.py:848-850 matchedSkillProvenance filled from the default",
      "app/features/sub_jobs/RecruiterCandidates.tsx:471,563 provLabel(prov[s] ?? \"self_declared\") renders the badge"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "l2_priority": "Score a BAU candidate whose skills were never evidenced and screenshot the chip — confirm it reads PROFESSIONAL."
  },
  {
    "id": "cs-jana-03",
    "journey": "jd-to-shortlist",
    "character": "jana-sourcer",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "dimension": "senior-quality",
    "title": "score_personal rewards raw text volume — a verbose profile out-scores a sparse-but-strong one, with no length normalisation",
    "expected": "Overlap measured as a rate (how much of what they claim is relevant), not a count, so a long list can't buy score.",
    "got": "hits is a COUNT over candidate.traits + candidate.skills appearing as whole words in the ad; the denominator is max(5, must-have count) — a property of the JD, never of the candidate. Nothing divides by the number of tokens supplied. A candidate who lists 40 JD-echoing skills saturates overlap at 1.0; a five-skill specialist with three hits gets 0.6. Worth up to 15 points for BAU (personal weight 0.15) and 20-25 for early-career. There is no de-duplication of near-identical claims and no penalty for volume anywhere in the scorer.",
    "evidence": [
      "pipeline/jobfit/matching.py:525-526 tokens = candidate.traits + candidate.skills; hits = sum(...)",
      "pipeline/jobfit/matching.py:534-535 overlap = min(1.0, hits / max(_OVERLAP_DENOM_FLOOR, n_must_have))",
      "pipeline/jobfit/archetypes.json bau weights { skills .50, career .35, personal .15 }"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "l2_priority": "Rank a 5-skill and a 40-skill fixture against one ČS ad; report the personal-dimension delta from the score breakdown."
  },
  {
    "id": "cs-jana-04",
    "journey": "jd-to-shortlist",
    "character": "jana-sourcer",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "dimension": "missing",
    "title": "The JD-to-shortlist surface has no per-candidate reasoning at all — 'Explain fit' exists only on the opposite axis",
    "expected": "Every shortlisted candidate carries a verdict/strengths/gaps/probes Jana can repeat to a hiring manager — the journey's definition of done.",
    "got": "The reasoning affordance is on MatchCard (candidate -> many jobs). RecruiterCandidates — the one job -> ranked candidates surface this journey is about — contains zero reasoning references; each row is a score badge, a fit-tier badge, matched/missing skill chips and one assumption line. To defend a pick, Jana must leave the shortlist and re-enter from the candidate side.",
    "evidence": [
      "app/features/sub_match/MatchCard.tsx:138-141 the only 'explainFit' trigger",
      "app/features/sub_jobs/RecruiterCandidates.tsx:479,497,561-581 — score + chips + one assumption, no rationale",
      "grep 'reasoning' app/features/sub_jobs/*.tsx -> no matches"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "l2_priority": "Open a ČS role's candidate scan and confirm no rationale control exists on any row; time the detour needed to get one per candidate."
  },
  {
    "id": "cs-jana-05",
    "journey": "jd-to-shortlist",
    "character": "jana-sourcer",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "dimension": "trust",
    "title": "The engine's own honesty boundary (claimed-but-unproven skills) is computed but never rendered on the shortlist",
    "expected": "The three-way truth the scorer already knows — matched / unproven-claim / genuinely absent — is visible where the pick is made.",
    "got": "score_skills separates a claimed-but-sub-threshold skill into unproven_skills with a reason (adjacency / provenance / both), explicitly so 'a near-miss specialist reads differently from an unsubstantiated claim'. That field renders only in AnalysisSummaryModal (Decisions) and JobFitTab (Analyze). The shortlist shows green matched and red missing only — the unsubstantiated middle silently disappears exactly where it matters most.",
    "evidence": [
      "pipeline/jobfit/matching.py:242-244 unproven_skills / _strength / _reason",
      "pipeline/jobfit/matching.py:431-447 the classification that populates them",
      "app/features/sub_decisions/AnalysisSummaryModal.tsx:102 and app/_components/results/job-fit/JobFitTab.tsx:50 — the only render sites",
      "app/features/sub_jobs/RecruiterCandidates.tsx:561-574 — matched + missing chips only"
    ],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "l2_priority": "Confirm live that a candidate with known sub-threshold claims shows neither the skill nor any 'unproven' marker on the ranked row."
  },
  {
    "id": "cs-jana-06",
    "journey": "jd-to-shortlist",
    "character": "jana-sourcer",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "dimension": "trust",
    "title": "The AI-written-CV / keyword-stuffing screen exists in the codebase but is not wired into ranking",
    "expected": "If the product can detect templated AI padding and skill-stuffing, that signal reaches the shortlist where an LLM-assisted applicant is being ranked.",
    "got": "authenticity_checks flags exactly the failure mode this run is about — buzzword density, 'skill list large relative to the CV's detail', near-absence of concrete dates/metrics. It is imported by pipeline.py only and folded into the analysis trust ledger. matching.py never imports it; the ranked row exposes no authenticity band. The single anti-LLM-boilerplate control in the repo does not touch the ordering.",
    "evidence": [
      "pipeline/jobfit/authenticity.py:43 authenticity_checks",
      "pipeline/jobfit/authenticity.py:36 _SKILL_STUFF_FLAG (skill list vs CV detail)",
      "pipeline/jobfit/pipeline.py:10,293 the only importer/caller",
      "grep 'authenticity' pipeline/jobfit/matching.py -> no matches"
    ],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "l2_priority": "Verify no authenticity band appears on any ranked candidate row, and whether it is reachable from the row at all."
  },
  {
    "id": "cs-jana-07",
    "journey": "jd-to-shortlist",
    "character": "jana-sourcer",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "dimension": "time-saved",
    "title": "No external or passive sourcing — the pool is only people already in the ATS, capped at ~160",
    "expected": "Jana's stated JTBD is finding the people her own Boolean string would miss. That requires a population beyond the existing database.",
    "got": "buildCandidatePool reads saved v2 profiles (cap 100) plus saved CV analyses (cap 60) from the local workspace. There is no external index, no passive-candidate source, no import path in the ranking chain. The product can re-rank the ATS well; it cannot find anyone new. Against her ~13 h/role baseline, the sourcing hours are untouched — only the re-reading of existing applicants is compressed.",
    "evidence": [
      "app/_lib/candidate-pool.ts:76-99 buildCandidatePool",
      "app/_lib/candidate-pool.ts:33-34 PROFILE_POOL_CAP 100 / ANALYSIS_POOL_CAP 60",
      "app/api/jobs/[id]/candidates/route.ts:20 the only pool source for the shortlist",
      "uat/characters/jana-sourcer.md:40-41,56-58 the JTBD and the pet peeve this violates"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "scope_note": "Plausibly a deliberate product boundary (ATS-side re-ranking, not a sourcing index). Recorded because it is the load-bearing gap against THIS Character's declared job, not as an accusation of a broken feature.",
    "l2_priority": "Confirm no import/external-source affordance exists anywhere on Jobs; measure the real pool size behind a ČS role."
  },
  {
    "id": "cs-jana-08",
    "journey": "jd-to-shortlist",
    "character": "jana-sourcer",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "dimension": "senior-quality",
    "title": "The shortlist runs the keyword overlap term, not the embedding bridge — a paraphrasing strong candidate under-ranks against a JD-word-echoing one",
    "expected": "If a semantic path exists, the surface where ranking decisions are made uses it.",
    "got": "score_personal takes the embedding path only when an embedder is passed; rankPoolForJob exposes it as opts.embeddings -> --embeddings. The candidates route calls rankPoolForJob with { signal } alone, so the shortlist always uses whole-word token overlap. A candidate who describes the same work in different words earns zero overlap credit; one who mirrors the ad's vocabulary earns full credit.",
    "evidence": [
      "pipeline/jobfit/matching.py:514-520 embedder branch",
      "app/_lib/recruiter-run.ts:37 if (opts.embeddings) args.push(\"--embeddings\")",
      "app/api/jobs/[id]/candidates/route.ts:31-36 rankPoolForJob(id, entries, job, { signal })"
    ],
    "code_check": "by-design",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "ceiling": "Even with embeddings on, the compared text is still the candidate's self-written prose against the ad — it makes presentation-matching smarter, not evidence-aware.",
    "l2_priority": "Confirm the ranked payload shows no semantic-overlap indicator; check whether any UI toggle exposes it."
  },
  {
    "id": "cs-jana-09",
    "journey": "jd-to-shortlist",
    "character": "jana-sourcer",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "dimension": "trust",
    "title": "Analysis-derived candidates are ranked on a materially thinner basis than v2 profiles, on the same 0-100 scale",
    "expected": "Two rows sharing a scale were scored from comparable inputs, or the difference is disclosed on the row.",
    "got": "A v2 profile reaches Python as its full raw payload (per-skill provenance, evidence, highlights, links). A saved analysis without a v2Profile is flattened to six fields with no provenance, no highlights, no links. Both then rank in one sorted list. The fail-closed sentinels are honest and well-reasoned, but the row does not tell Jana which basis produced which number.",
    "evidence": [
      "app/_lib/match-input.ts:60 raw profile payload for v2",
      "app/_lib/candidate-pool.ts:47-73 six-field fallback with 'unknown' sentinels",
      "pipeline/jobfit/recruiter.py:89 rows.sort(...) — one flat order per track"
    ],
    "code_check": "by-design",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "ceiling": "The assumptions line (RecruiterCandidates.tsx:577) surfaces ONE assumption; it is not a basis-parity disclosure.",
    "l2_priority": "Seed one v2 profile and one legacy analysis, rank both, and check whether the row discloses the difference."
  },
  {
    "id": "cs-jana-10",
    "journey": "jd-to-shortlist",
    "character": "jana-sourcer",
    "cert_level": "L1",
    "type": "strength",
    "severity": "polish",
    "dimension": "trust",
    "title": "STRENGTH — rediscovery is the one place real verified evidence moves the order, and it is band-limited and disclosed",
    "expected": "n-a (positive)",
    "got": "priorDepthBoost converts how far a candidate's prior pipeline entry actually advanced into a bounded ordering boost (PRIOR_DEPTH_BAND = 5, half a fit-tier step), explicitly structural: the boost can reorder within the band and never vault a tier. The displayed score stays the honest base, and PriorOutcome.stage carries the disclosed depth that becomes the why-now. This is exactly the evidence-over-presentation design the base scorer lacks — it already exists in the repo, on one surface. Do not touch it; extend it.",
    "evidence": [
      "app/_lib/rediscovery-rank.ts:26 PRIOR_DEPTH_BAND = 5",
      "app/_lib/rediscovery-rank.ts:38 priorDepthBoost",
      "app/_lib/rediscover.ts:36-42 PriorOutcome.stage / depth disclosure",
      "app/_lib/rediscover.ts:64-72 pickPrior"
    ],
    "code_check": "n-a",
    "verdict": "confirmed",
    "resolution": "by-design",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "ceiling": "It only orders WITHIN the rediscovery feed and only for candidates with a prior entry; a first-time applicant gets no evidence-aware treatment anywhere.",
    "l2_priority": "Confirm the why-now text on a rediscovered row names the actual prior stage, not a generic label."
  },
  {
    "id": "cs-jana-11",
    "journey": "jd-to-shortlist",
    "character": "jana-sourcer",
    "cert_level": "L1",
    "type": "strength",
    "severity": "polish",
    "dimension": "trust",
    "title": "STRENGTH — fairness-track separation, confidence bands with named drivers, and honest pool-cap signalling",
    "expected": "n-a (positive)",
    "got": "Early-career and experienced candidates are never ranked on one incomparable scale (fairness_track / rank_candidates_by_track). Confidence bands carry the specific reasons they are wide rather than a bare range. The pool cap is reported as poolTruncated rather than silently dropping people. ko_filter fails closed on an unclassified archetype and refuses to treat a DEFAULT_POLICY-stamped work_mode as a hard gate. This is a scorer that names its own seams — the thing Jana says earns her trust.",
    "evidence": [
      "pipeline/jobfit/recruiter.py:19-27 fairness_track",
      "pipeline/jobfit/recruiter.py:93 rank_candidates_by_track",
      "pipeline/jobfit/matching.py:723-767 _confidence with driver codes",
      "pipeline/jobfit/matching.py:310-317 fail-closed unknown archetype",
      "pipeline/jobfit/matching.py:341-349 phantom work_mode never gates",
      "app/api/jobs/[id]/candidates/route.ts:58 poolTruncated"
    ],
    "code_check": "n-a",
    "verdict": "confirmed",
    "resolution": "by-design",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "ceiling": "All of this makes the SCORE honest about its uncertainty; none of it makes the score's INPUTS evidence-based.",
    "l2_priority": "Confirm the track separation and the confidence drivers actually render on the live shortlist."
  }
]
```

## Headline question — ability or presentation?

**The shortlist ranks presentation. Every number in it is computable from text the
candidate wrote about themselves, and nothing in the ranking path reads anything
that can be checked.**

That is not a vibe; it is the whole surface of the scorer. `score_job`
(`matching.py:813`) combines exactly three dimensions:

- `score_skills` (`:405`, weight **.50** for BAU) — for each JD requirement, the
  best `skill_match_score` against the candidate's **claimed skill strings**. The
  taxonomy makes the string comparison intelligent; it does not make it evidenced.
- `score_career` (`:455`, weight **.35**) — `1.0 if candidate.role_family ==
  job.role_family else 0.35`, plus seniority proximity. Both sides come from the
  candidate's **self-stated** family and seniority. No employer, no dates, no
  verification.
- `score_personal` (`:496`, weight **.15**) — language coverage blended with
  **whole-word overlap between the candidate's own traits+skills and the ad's
  text**. This is a literal JD-similarity term.

So a profile assembled by pasting the JD's requirements into a skill list, naming
the JD's role family and seniority, and echoing the ad's vocabulary can reach a
near-perfect total without a single verifiable fact behind it.

**Is there evidence weighting?** The machinery exists and is genuinely well
designed — `provenance_weight` (`taxonomy.py:904`) discounts a school project to
0.7 and a self-declared claim to 0.4, and the `unproven_skills` bucket
(`matching.py:242`) separates an unsubstantiated claim from a real absence. But
it is **structurally disabled for the population Jana works with**:
`DEFAULT_PROVENANCE = "professional"` (`taxonomy.py:394`) carries weight **1.0**
(`:382`), and `transform.py:182` assigns `self_declared` **only to early-career**
candidates — experienced ones default to full professional credit. Analysis-derived
pool entries (`candidate-pool.ts:47-73`) emit no provenance map at all, so every
one of their skills inherits that 1.0. The discount fires for students and
switchers; for the experienced majority it is a no-op. Worse, that unearned
default is then rendered as a **PROFESSIONAL badge** on the shortlist row
(`RecruiterCandidates.tsx:471,563`) — the UI displays verification the system
never performed.

**Do verified artifacts count?** No. `MatchCandidate` carries `work_links` and
`experience_highlights` (`matching.py:122-123`), and `transform.py:165-171`
faithfully collects portfolio and repo URLs from the profile's evidence. Their
**only** consumer in the entire codebase is `match_reasoning.py:63-64` — the
narrative prompt. No `score_*` function references either. And even there the
link is passed as a bare string; nothing fetches it. A candidate with three
shipped repos and a candidate who typed a URL score identically, and the LLM is
invited to "weigh a portfolio/repo" it has never seen. There is a real GitHub
analyzer in the product (`app/api/github-analysis/route.ts`, persisted to
`analyses.github_json`), and it reaches the Analyze tab and the history page —
but `github_json` appears nowhere in the pool builder or the ranking chain.

**Do prior pipeline outcomes count?** Not in the base score — a grep for
`outcome|hired|prior_pipeline` across `matching.py`, `recruiter.py` and
`transform.py` returns nothing. They count in exactly one place, and it is the
best thing in this run: `priorDepthBoost` (`rediscovery-rank.ts:38`) turns how far
a candidate actually got last time into a bounded, disclosed ordering boost. That
is real evidence changing real order, and the band guarantee is structural rather
than incidental. It applies only inside the rediscovery feed.

**Does sparse-but-strong lose to verbose-but-average?** Yes, in two compounding
ways. In `score_personal`, `hits` is a **count** over `candidate.traits +
candidate.skills` (`:525-526`) and the denominator is `max(5, must-have count)`
(`:535`) — a property of the *ad*, never of the candidate. Nothing normalises by
how many tokens were supplied. Forty JD-echoing skills saturate the term at 1.0;
a five-skill specialist with three hits lands at 0.6. In `score_skills`, every
extra claimed skill is another chance to clear the 0.5 threshold on some
requirement, at no cost, because a claim that fails costs nothing — a
sub-threshold claim is quietly routed to `unproven` rather than to `missing`
(`:436-447`), which is honest bookkeeping but removes the only downside of
over-claiming.

**Is there de-duplication of LLM boilerplate, or any text-volume penalty?**
Nowhere in the scorer. The product *does* own a detector for precisely this —
`authenticity_checks` (`authenticity.py:43`) flags buzzword density, "skill list
is large relative to the CV's detail", and near-absent concrete dates/metrics.
It is imported only by `pipeline.py:10` and folded into the analysis trust ledger.
`matching.py` never sees it, and no authenticity band renders on a ranked row.
The one control aimed at the exact failure mode is present in the repo and absent
from the ranking.

There is one partial mitigation, and it is on the narrative rather than the score:
`_any_strength_grounded` (`match_reasoning.py:267`) checks that at least one
model-written strength references a real skill token and backfills from the
deterministic template otherwise (`:306`). That catches generic *output*. It does
nothing about generic *input*.

**Plain answer:** this surfaces the best-written profiles. A well-built,
honestly-instrumented scorer — fairness tracks, confidence bands with named
drivers, fail-closed gates, an unproven-claims bucket, a truthful pool-cap flag —
is being fed almost entirely unverified self-report, and then, on the shortlist
itself, the two honesty signals it *does* compute (unproven skills, and provenance
that would have been meaningful) are either not rendered or rendered as a
professional badge the system never earned. Against an LLM-assisted applicant who
mirrors the JD, the ranking is close to defenceless. The fix is not new
machinery — `priorDepthBoost` shows the pattern already exists in this codebase;
it needs to reach the base score, and `work_links` / `github_json` /
`authenticity_checks` need to reach the scorer rather than stopping at the prompt.

## Character feedback

*(first person, in Jana's voice — L1, over the designed experience)*

Tak jo. Otevřu si roli, dám "Score candidates", a dostanu seřazený seznam se
skóre. Vypadá to čistě. A pak se podívám, na čem to skóre stojí — a to je ten
moment, kdy mi to spadne.

Ono to totiž počítá přesně to, co si o sobě kandidát sám napsal. Dovednosti, které
si vypsal. Obor, který si zvolil. Seniorita, kterou si přiřadil. A pak — a tohle
mě dostalo — z patnácti procent to počítá, kolik slov z inzerátu se objevuje v
jeho vlastním textu. To není hledání člověka. To je kontrola shody klíčových slov,
jen elegantněji zabalená.

Vím přesně, co se stane. Kandidát si nechá životopis přepsat od modelu, ten mu do
něj nalije všechny požadavky z inzerátu, a vyskočí mi nahoře. Ten tichý, který
napsal pět řádků a má za sebou tři odvedené projekty, spadne dolů — protože
nenapsal dost slov. A já to na tom seznamu nepoznám. To je ta chyba, kterou si
nemůžu dovolit udělat před manažerem.

Nejvíc mě štve tohle: **ono to ty správné signály má.** Někdo tam napsal celý
mechanismus na provenienci — dovednost z produkce váží 1.0, ze školního projektu
0.7, jen tvrzená 0.4. Krásně vymyšlené. A pro moje zkušené kandidáty se to
nezapne, protože výchozí hodnota je "professional". Takže si člověk napíše
dovednost do CV a systém jí dá plný kredit za produkční zkušenost — a ještě jí na
kartičce napíše PROFESSIONAL. To není mezera. To je odznak za něco, co se nikdy
neověřilo. Kdybych to ukázala manažerovi a on se zeptal "a tohle víme odkud?",
neměla bych co odpovědět.

A stejně tak: engine si spočítá, které dovednosti jsou "tvrzené, ale nedoložené" —
to je přesně ta informace, kterou při výběru potřebuju — a na shortlistu ji
neukáže. Vidím zelenou "má" a červenou "nemá". To šedé mezi tím, to nejdůležitější,
zmizí. A někde v repozitáři leží kontrola na AI psané životopisy, která hlídá
přesně tohle. Do řazení nesahá.

Druhá věc, praktická. Ten seznam neumí odůvodnit ani jeden řádek. "Vysvětli fit"
existuje — ale na opačné straně, když jdu od kandidáta k rolím. Já jdu od role ke
kandidátům. To je celá moje práce. Takže mám čísla a nemám k nim větu. A moje
definice hotového je "důvod, který zopakuju manažerovi". Bez toho si ten seznam
můžu vytisknout leda pro sebe.

A do třetice, to zásadní: ono to nehledá. Ten "pool" jsou lidi, co už v databázi
jsou — sto profilů, šedesát analýz, strop. Moje práce je najít toho, koho můj
string nenašel. Tohle mi ho nenajde, protože nemá kde. Ono to umí dobře přerovnat
to, co už mám. Což — buďme fér — není nic. Těch třináct hodin na roli je ale z
větší části hledání, a ty mi to nesebere. Reálně mi to ušetří tak tři čtvrtě
hodiny přečítání starých přihlášek. Z třinácti hodin.

Co mě naopak potěšilo, a řeknu to nahlas: **rediscovery.** Ten kousek je udělaný
přesně tak, jak bych to chtěla. Když se někdo minule dostal do finále a neuspěl,
tak se mi vynoří výš než ten, koho vyhodili den jedna — a je to omezené na pět
bodů, takže to nikdy nepřeskočí opravdu lepšího kandidáta, a to skóre, které vidím,
zůstává to poctivé. A ukáže mi to, kam se minule dostal. To je "why now", které
chci. To je jediné místo v celém tom řetězci, kde na řazení působí něco, co se
opravdu stalo, a ne co si o sobě někdo napsal. Někdo tam přesně věděl, co dělá.
Ať se toho nikdo nedotýká — ať to naopak roztáhnou na celé skóre.

A oceňuju, že to nemíchá studenty se seniory do jednoho pořadí, a že u
konfidenčního pásma napíše, proč je široké. To je poctivost, kterou u těchhle
nástrojů skoro nevidím.

Takže — přijala bych to? Jako **nástroj na přerovnání vlastní databáze a na
rediscovery ano**, to je reálná hodnota a rediscovery bych používala hned. Jako
**shortlist, který pošlu manažerovi a obhájím, ne** — dokud skóre stojí jen na
tom, co si člověk o sobě napsal, a dokud u řádku není důvod. Doporučila bych to
kolegyni? Řekla bych jí: "pusť si to na staré přihlášky, tam ti to najde lidi, na
které nemáš čas. Ale to pořadí neber jako pravdu — je to žebříček toho, kdo si to
líp napsal."
