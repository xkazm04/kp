---
run: 2026-07-20-cases-scoring
character: eva-eng-hiring-lead
character_name: Eva Marešová
journey: cv-analysis-jobfit
cert_level: L1
verdict: L1-conditional
grounding: 6/9 main analyze surface · 4/6 GitHub deep-dive
time_saved_min: 40
time_saved_confidence: medium
language: cs
repo_state: branch `vibeman/ambiguity-ui-wave1` @ 1335532 — READ AGAINST THE WORKING TREE (uncommitted WIP present; `app/api/github-analysis/route.ts` carries a +1-line WIP delta, non-structural)
prior_run: 2026-07-02-full (l1/eva-eng-hiring-lead--cv-analysis-jobfit.md) — same frame re-applied identically
headline_question: "Does this scoring pick the best candidate, or the best-presenting one?"
---

# L1 theoretical — Eva Marešová (eng hiring lead) × cv-analysis-jobfit

**Focus of this run:** the GitHub-evidence path (`app/api/github-analysis/route.ts` +
the "GitHub Evidence & CV Utilities" surface) and the headline question — does any
*verified* evidence channel outweigh self-reported text?

---

## 1. Reachability (resolved BEFORE judging)

Eva is an internal user. Her surface binding is the **Dev** tab plus **Analyze** and
**Matrix** for engineer CVs. This journey lives entirely on Analyze — inside her set,
with **no per-role nav gating** (`rubric.md` reachability rules for kp; tabs at
`app/features/tabs.ts`). The GitHub deep-dive is reachable from the Analyze form's
GitHub column (`app/features/sub_analyze/AnalyzeForm.tsx:145-181`) and a handle alone
is a valid run (`app/features/sub_analyze/useAnalyzeForm.ts:403-446`).

**No `unreachable` tags are needed for this journey.** Every finding below sits on a
surface Eva can open today, given the dev gate + a seeded analysis fixture.

Scope note: Eva's dev-case criteria (case authoring, brevity of live work) are **out of
this journey's scope** — only her transferable criteria (evidence-backed verdict,
director-defensibility, AI-awareness, time-saved, language) are applied.

## 2. Surface model (import chain, file:line)

### 2.1 Intake → the scored analysis

| Step | Code |
|---|---|
| CV column (required), JD column (file / paste / saved-JD picker), Company column, **GitHub column** | `AnalyzeForm.tsx:61-183` (GitHub cell `:145-181`, handle input `:162-168`) |
| Report-language select · Blind checkbox · Analyze button | `AnalyzeForm.tsx:207-241` |
| Submit orchestration | `useAnalyzeForm.ts:403-471` |
| Main run | `useAnalyzeForm.ts:457-470` → `runAnalysis.ts:81-97` `executeAnalysis` → POST `/api/analyze` |
| Route: parses form, persists files, starts a background task | `app/api/analyze/route.ts:24-171` (JD `:57-61`, grounding `:56`, reportLang `:127-128`, blind `:130`, `startTask` `:169`) |
| Task params | `app/_lib/analyze-run.ts:16-41` (`AnalyzeParams`) |
| Python CLI args | `analyze-run.ts:114-124` (`cliArgs`) → spawn `analyze-run.ts:193` |
| Python entry | `pipeline/jobfit/cli.py:24-48` |
| Gemini prompt + response schema | `pipeline/jobfit/gemini.py:92-109` (score/salary schema), `:557-579` (prompt assembly) |
| Score parse + deterministic total | `pipeline/jobfit/pipeline.py:192-195`, `:699-728` (`total = min(sum(components), 100)` at `:720`) |
| Job-fit parse | `pipeline.py:206-210`, `:891-908` (`score` = `_clamp_int(...)` at `:895`) |
| **Hallucination gate** | `pipeline.py:219-229` → `pipeline/jobfit/ats.py:107-143` `verify_skills_in_cv` |
| Result render | `app/_components/results/ResultPanel.tsx:199` (`VerdictBanner`), tabs `:62`, `:128-136`, `:249-257` |

### 2.2 The GitHub deep-dive — a *parallel* pipeline

| Step | Code |
|---|---|
| Launch (submit AND panel retry both route here) | `useAnalyzeForm.ts:368-401` `launchGithubRun`; fired at `useAnalyzeForm.ts:442` |
| Blind-mode suppression predicate | `app/features/sub_analyze/githubRunPolicy.ts:11-13` |
| Client call | `runAnalysis.ts:132-177` `executeGithubAnalysis`; **request body = `{ profile, jobDescriptionText }`** at `runAnalysis.ts:158-162` |
| Route | `app/api/github-analysis/route.ts:166-356` |
| Real REST harvest | user `:201`, org-account guard `:207-211`, paginated owned repos `:219` → `:413-439`, languages `:230-239`, ranking `:248-262`, activity windows `:269-270` |
| Deterministic JD↔repo signals over a 27-bucket alias map | `route.ts:137-164` (aliases), `:529-592` (`buildJobFitSignals`) |
| **Real commits / README / file names fetched** | `route.ts:614-653` `fetchRepoBundle` (commits `:628-630`, README `:655-664`, contents `:631-633`) |
| Gemini repo-signal review + its prompt | `route.ts:684-891`, prompt `:813-827` |
| Payload schema | `app/_lib/schemas.ts:208-260` |
| Render — a **separate tab**, below the always-visible verdict banner | `ResultPanel.tsx:62`, `:128-136`, `:249-257`; panel `app/_components/GithubAnalysisPanel.tsx` (self-declared separateness at `:40-42`) |
| Persist onto the saved analysis row (display only) | `useAnalyzeForm.ts:314-327` PATCH → `app/api/analyses/[slug]/route.ts:73-74`; revive `app/_lib/db/analyses.ts:383-395` |

**The seam, stated plainly:** `submit()` fires `launchGithubRun()` (`useAnalyzeForm.ts:442`)
and `executeAnalysis()` (`:457-470`) as two disjoint pipelines that never meet. The
GitHub result is PATCHed onto the saved row *after* the fact and rendered in its own tab.

## 3. Grounding audit (same 9-source frame as the 2026-07-02 run — consistency harness)

**Main analyze surface — does Eva's real context reach the prompt?**

| # | Source | Reaches the prompt? | Evidence (re-verified at this HEAD) |
|---|---|---|---|
| 1 | Full CV text | **yes** | `gemini.py:557-579`; blind redaction `redact.py:25` |
| 2 | The real JD | **yes** | `analyze/route.ts:57-61` → `analyze-run.ts:119-120` → `cli.py:24-48` |
| 3 | Company overview | **yes** | `analyze-run.ts:121-122`; company factor applied `pipeline.py:200-202` |
| 4 | Deterministic taxonomy evidence + salary anchor band | **yes (as a hint)** | `taxonomy.py:13,453-465` → `pipeline.py:1212-1213,1223-1231` → `gemini.py:566-567` |
| 5 | Live market signals (Search grounding + cited sources) | **yes** | `pipeline.py:231` `_market_evidence_from_payload`; UI `SalaryTab.tsx:103-142` |
| 6 | Recruiter's report language | **yes** | `analyze/route.ts:127-128` → `analyze-run.ts:118` |
| 7 | **GitHub evidence (when a handle is supplied)** | **NO** | `AnalyzeParams` has no github field (`analyze-run.ts:16-41`); `cliArgs` passes none (`:114-124`); `github_present: false` is a **hardcoded literal** (`analyze-run.ts:144`); `cli.py:24-48` has no such argument |
| 8 | The saved JD's **structured** comp band | **NO** | `jdSlug` rides for persistence/logging only (`analyze/route.ts:61,143`) |
| 9 | Prior history for this candidate | **NO** | cache dedupes identical bytes only (`analyze-run.ts` cache path) |

**Grounding 6/9 — unchanged from 2026-07-02 (no regression, no improvement).**

**GitHub deep-dive surface: 4/6** — repos + languages **yes** (`route.ts:219-243`),
README/commits/file names for the top 3 **yes** (`route.ts:614-653`), the JD **yes**
(`route.ts:172`, prompt `:822-823`), honest evidence basis + limitations **yes**
(`route.ts:283-300`, `:692`); **the candidate's CV / their actual claims — NO** (the
request body carries only `{profile, jobDescriptionText}`, `runAnalysis.ts:158-162`);
private/contribution-graph data **no**, and *disclosed* (`route.ts:284-286`).

**Salary specifically (her "number with a basis" bar):** anchored but **not grounded**.
The band from `data/salary_benchmarks.json` reaches the prompt (`taxonomy.py:453-465` →
`gemini.py:566-567`), but `gemini.py:574` explicitly licenses the model to **discard**
it off-market ("For any other market, ignore the anchor"), and nothing downstream checks
the returned band back against the benchmark — `_salary_from_payload` (`pipeline.py:837-888`)
only *repairs* shape (reversed range `:846-849`, out-of-band midpoint `:862-864`).

## 4. Cognitive walkthrough (rubric questions, in character)

1. **Will I try it?** Yes. Analyze is where engineer CVs go, and the GitHub column
   (`AnalyzeForm.tsx:145-181`) invites the one artifact I always have for a developer.
2. **Will I notice the control?** Yes — four labelled columns with per-column status,
   plus a Gemini-missing preflight that warns *before* a doomed submit
   (`AnalyzeForm.tsx:185-189`).
3. **Control ↔ effect?** Here the model and the mechanism diverge. The form presents
   GitHub as a **fourth input to one analysis**; it is in fact a second, independent
   analysis (`useAnalyzeForm.ts:442` vs `:457-470`). Nothing in the intake says so. The
   panel admits it only later, and only if I open the tab (`GithubAnalysisPanel.tsx:40-42`).
4. **Feedback?** Good. Background task survives navigation, cancellable, refresh-safe
   (`useAnalyzeForm.ts:285-306`); a JD that couldn't be read for the deep-dive is
   *reported* rather than silently dropped (`runAnalysis.ts:154-157`); GitHub can be
   retried alone without re-paying the pipeline (`useAnalyzeForm.ts:519`).
5. **Does the result clear my bar?** Partly. Matched chips are gated against the CV and
   carry evidence tooltips; the score can't contradict its own components. But the
   headline number is five LLM integers about a document, and the repo evidence sits in a
   tab that never touched it.
6. **Would I sign it?** As a first opinion, yes. As the ranking I spend my team's
   interview hours on — not yet. See §6.

## 5. Eva's scored acceptance criteria (applicable subset, applied identically)

| Criterion | L1 result | Evidence |
|---|---|---|
| completion — CV+JD(+GitHub) → evaluation, no dead-end | **pass (structural)** | §2 chain; GitHub-only run valid (`useAnalyzeForm.ts:403-446`) |
| trust — verdict backed by rubric + concrete evidence | **partial** | chips gated (`ats.py:107-143`) + evidence tooltips (`SkillChips.tsx:89-119`); but no provenance at the banner (`VerdictBanner.tsx:55-83`) and missing skills carry none (`MissingSkillsTiers.tsx:52-61`) |
| trust — defensible to an eng director | **partial** | provenance dossier exists but is **download-only**, never rendered (`ReportActions.tsx:40` → `provenance-dossier.ts:29`); defending requires manually merging two tabs |
| trust — AI use acknowledged, not pretended away | **pass** | repo review declares it is not reading source (`route.ts:814-818`), names its evidence basis + limits (`route.ts:283-300`) |
| senior-quality — evidence over vibes | **partial** | hallucination gate + fail-loud empty-signal path (`route.ts:768-797`) are excellent; but no verified channel weights the score (F-03) |
| time-saved — faster AND better signal | **pass-designed, discounted** | ~40 min/CV; the manual CV×repo merge claws some back |
| language — Czech authoring/eval UI | **partial** | chrome + narrative cs; deterministic ledger/probe text English (carried, shared with Petra) |

## 6. Findings

```json
[
  {
    "id": "EVA-CVJF-L1-01",
    "journey": "cv-analysis-jobfit",
    "character": "eva-eng-hiring-lead",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "dimension": "trust",
    "title": "GitHub evidence is architecturally excluded from the score it appears to inform — the intake presents it as a fourth input to one analysis, but it is a second, disjoint analysis",
    "expected": "A supplied GitHub handle materially moves the job-fit score/verdict for an engineering hire, or the UI states up front that it cannot.",
    "got": "submit() fans out two pipelines that never meet. The scoring CLI has no argument capable of carrying GitHub data, and the analyze telemetry hardcodes github_present:false.",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "evidence": [
      "app/features/sub_analyze/useAnalyzeForm.ts:442 (launchGithubRun) vs :457-470 (executeAnalysis) — disjoint",
      "app/_lib/analyze-run.ts:16-41 — AnalyzeParams has no github field",
      "app/_lib/analyze-run.ts:114-124 — cliArgs passes cv/grounding/blind/lang/jd/company only",
      "app/_lib/analyze-run.ts:144 — github_present: false is a hardcoded literal",
      "pipeline/jobfit/cli.py:24-48 — no GitHub argument exists to pass",
      "app/_lib/schemas.ts:208-260 — githubAnalysisSchema has no score field of any kind",
      "app/_components/results/verdict.ts:29-49 — verdict resolves from analysis.score / jobFit.score only",
      "app/_components/GithubAnalysisPanel.tsx:40-42 — the panel itself declares it 'runs separately from the CV analysis'"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Run a real engineer CV + ČS JD + a real GitHub handle. Confirm the headline summary never references repositories, and that changing the handle (or removing it) leaves the score byte-identical.",
    "scope_note": "PARTIAL COUNTERWEIGHT — not decorative everywhere: persisted GitHub evidence IS fed to the screen/prep/scorecard prompts downstream (app/_lib/automation-run.ts:229-238 --github-evidence; pipeline/jobfit/automation.py:203-236 github_evidence_block). But that is AFTER the candidate is added to the pipeline — it informs narrative artifacts, never the ranking decision that decides who gets in."
  },
  {
    "id": "EVA-CVJF-L1-02",
    "journey": "cv-analysis-jobfit",
    "character": "eva-eng-hiring-lead",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "dimension": "trust",
    "title": "The deep-dive never receives the CV, so it structurally cannot verify a candidate's claims — and 'Unverified Claims' labels JD requirements, not candidate claims",
    "expected": "A column headed 'Unverified Claims' lists things THIS CANDIDATE asserted that the repos do not support ('CV says Kubernetes, no infra work visible').",
    "got": "unverified_claims is defined in the prompt as 'jd skill not visible in the repo signals'. The CV is never sent to the route, so the comparison is JD-vs-repos. A JD requirement the candidate never claimed reads to a recruiter as a caught exaggeration.",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "evidence": [
      "app/features/sub_analyze/runAnalysis.ts:158-162 — POST body is { profile, jobDescriptionText }; no CV",
      "app/api/github-analysis/route.ts:172 — only jobDescriptionText is read from the body",
      "app/api/github-analysis/route.ts:820 — prompt defines unverified_claims as 'jd skill not visible in the repo signals'",
      "app/api/github-analysis/route.ts:529-592 — buildJobFitSignals compares repos against the JD only",
      "app/_components/GithubAnalysisPanel.tsx:251-255 — renders the column as 'Unverified Claims'",
      "app/_components/GithubAnalysisPanel.tsx:17-27 — panel receives only GithubAnalysis, never Analysis"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Supply a CV claiming a skill absent from the repos AND a JD that does not require it. Confirm it appears in NEITHER 'Unverified Claims' nor anywhere else — the exaggeration is invisible to the product."
  },
  {
    "id": "EVA-CVJF-L1-03",
    "journey": "cv-analysis-jobfit",
    "character": "eva-eng-hiring-lead",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "dimension": "senior-quality",
    "title": "No verified-evidence channel weights the score: provenance weighting exists, is unwired from analyze, and is itself LLM-assigned from CV prose; portfolio links are extracted and scored at zero weight",
    "expected": "Provable artifacts (open-source work, a real repo) outrank the same skill merely asserted in prose.",
    "got": "PROVENANCE_WEIGHTS is real (open_source 0.85 vs self_declared) but drives /api/match, not the analyze score; the analyze headline is five LLM integers with no provenance term. Worse, the provenance label is assigned by the LLM reading the CV (default self_declared), so even that dial is presentation-derived. profile.links (GitHub/portfolio URLs) is captured and never read by any scorer.",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "evidence": [
      "pipeline/jobfit/taxonomy.py:372-394 — PROVENANCE_WEIGHTS (observed/professional 1.0 … self_declared lowest)",
      "pipeline/jobfit/taxonomy.py:708-713, 859-884 — provenance_weight discounts skill_match_score",
      "pipeline/jobfit/matching.py:405-452 — consumed by score_skills (/api/match path)",
      "pipeline/jobfit/pipeline.py:699-728 — _score_from_payload sums five LLM integers; no provenance term",
      "pipeline/jobfit/pipeline.py:911-964 — _honesty_crosscheck computes a provenance-weighted total then DISCARDS it (:929-931, :960-964), returning only the unproven bucket",
      "pipeline/jobfit/profile.py:95 — SkillClaim.provenance defaults to self_declared; gemini.py:572 — the model emits it",
      "pipeline/jobfit/pipeline.py:554 — profile.links assigned, then read by no scorer",
      "pipeline/jobfit/transform.py:72-74 — the one +0.3 open_source nudge feeds the early-career POTENTIAL score, not job-fit"
    ],
    "code_check": "present-but-unwired",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Run two CVs for the same JD: (A) plain prose, strong real repos; (B) polished prose, empty/absent GitHub. Compare the headline scores and the ranking. L2 must answer whether B outranks A."
  },
  {
    "id": "EVA-CVJF-L1-04",
    "journey": "cv-analysis-jobfit",
    "character": "eva-eng-hiring-lead",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "dimension": "trust",
    "title": "job_fit.score is a bare clamped LLM scalar with no component contract — unlike the main score, which is server-authoritative",
    "expected": "The job-fit dial is reconcilable to parts, like the main score dial.",
    "got": "job_fit.score is taken verbatim from the model and clamped; the main score's total-equals-component-sum contract has no counterpart here, and nothing reconciles it against the keyword-coverage percent computed two panels down.",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "evidence": [
      "pipeline/jobfit/pipeline.py:895 — score=_clamp_int(raw.get('score'), 0, 100, 0)",
      "pipeline/jobfit/pipeline.py:699-728 — contrast: main total is ALWAYS the component sum (:720)",
      "pipeline/jobfit/pipeline.py:1304-1306 — the code states only job_fit.matching_skills is grounded",
      "app/_components/results/job-fit/JobFitTab.tsx:41 — dial renders the scalar with no breakdown"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "On a weak candidate, compare job_fit.score against the deterministic keyword-coverage percent and record the divergence."
  },
  {
    "id": "EVA-CVJF-L1-05",
    "journey": "cv-analysis-jobfit",
    "character": "eva-eng-hiring-lead",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "dimension": "clarity",
    "title": "Two adjacent tabs speak two different skill vocabularies — a hand-rolled 27-bucket alias map vs data/taxonomy.json",
    "expected": "'Matched' means one thing across the report Eva puts in front of a director.",
    "got": "The GitHub tab matches against 27 hardcoded alias buckets; the CV tab against the 176-term taxonomy. The two tabs can name the same skill differently or disagree on coverage, with no reconciliation.",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "evidence": [
      "app/api/github-analysis/route.ts:137-164 — SKILL_ALIASES, 27 buckets",
      "app/api/github-analysis/route.ts:589 — trackedSkillCount disclosed honestly to the UI",
      "pipeline/jobfit/taxonomy.py:13 — data-file-backed taxonomy for the CV path",
      "pipeline/jobfit/ats.py:127-129 — CV verification resolves through that taxonomy"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "scope_note": "Reconciliation-sweep class — impact rank exceeds its 'minor' label (hit on every run that supplies both).",
    "l2_priority": "Run one candidate with both tabs populated and diff the two skill lists for naming/coverage disagreement."
  },
  {
    "id": "EVA-CVJF-L1-06",
    "journey": "cv-analysis-jobfit",
    "character": "eva-eng-hiring-lead",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "dimension": "trust",
    "title": "Eva cannot tell a rejected engineer why with evidence: missing-skill chips carry no evidence, 'Top gaps' is a positional slice not a criticality ranking, and the full provenance dossier is download-only",
    "expected": "A rejection reason traceable to the JD's must-haves and the candidate's own document.",
    "got": "Missing chips are label + X only. Tiers are slice(0,3)/slice(3,8)/rest — the code says so explicitly. The verdict banner states no basis. The one artifact with real provenance is only produced as a downloaded markdown file.",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "evidence": [
      "app/_components/results/job-fit/MissingSkillsTiers.tsx:8-14 — 'a prominence/position split, NOT a must-have vs nice-to-have classification'",
      "app/_components/results/job-fit/MissingSkillsTiers.tsx:44-50 — splitIntoTiers is pure slicing",
      "app/_components/results/job-fit/MissingSkillsTiers.tsx:52-61 — MissingChip renders label + X, no evidence",
      "app/_components/results/VerdictBanner.tsx:55-83 — number + band word + static framing sentence; no cited basis",
      "app/_components/results/ReportActions.tsx:40 → app/_lib/provenance-dossier.ts:29 — dossier is download-only, never rendered"
    ],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "resolution": "open",
    "scope_note": "The neutral palette + position-neutral labels (MissingSkillsTiers.tsx:27-36) are a deliberate honesty choice — the gap is that the honesty lives in code comments and colour, never in words the user reads.",
    "l2_priority": "Read the live report as if writing a rejection email; record whether any on-screen text names a JD must-have and cites the CV."
  },
  {
    "id": "EVA-CVJF-L1-S1",
    "type": "strength",
    "dimension": "trust",
    "severity": "polish",
    "title": "The GitHub deep-dive is honest by construction — and it does fetch real evidence",
    "evidence": [
      "app/api/github-analysis/route.ts:614-653 — real README, real commit subjects, real file listings",
      "app/api/github-analysis/route.ts:207-211 — refuses an organization handle before analyzing anything",
      "app/api/github-analysis/route.ts:296-300 — annotates a truncated portfolio instead of implying completeness",
      "app/api/github-analysis/route.ts:581 — suppresses GAPS when language coverage was throttled (absence of evidence ≠ evidence of absence)",
      "app/api/github-analysis/route.ts:768-797 — fail-loud 'could not determine' rather than letting the model fabricate from nothing",
      "app/api/github-analysis/route.ts:814-818 — prompt forbids inferring what it cannot see"
    ],
    "code_check": "n-a",
    "verdict": "confirmed",
    "resolution": "by-design",
    "ceiling": "It is honest about a read it performs for a panel that no scorer consumes. The rigor is real; its consequence is not."
  },
  {
    "id": "EVA-CVJF-L1-S2",
    "type": "strength",
    "dimension": "trust",
    "severity": "polish",
    "title": "The hallucinated-skill gate is real, at the source, and discloses what it withheld",
    "evidence": [
      "pipeline/jobfit/pipeline.py:219-229 — withheld skills removed from chips AND surfaced as a named review note",
      "pipeline/jobfit/ats.py:107-143 — alias-aware verification (JS→JavaScript, k8s→Kubernetes)",
      "pipeline/jobfit/pipeline.py:1299-1322 — _grounding_sanity_checks flags a ≥95 score over an empty deterministic pre-pass"
    ],
    "code_check": "n-a",
    "verdict": "confirmed",
    "resolution": "by-design",
    "ceiling": "It gates the MODEL against the CV, not the CANDIDATE against reality. A skill the candidate simply wrote down passes it cleanly — and it verifies against Gemini's own extracted raw_text (pipeline.py:221), not the independent pypdf text, so it is circular if the model over-extracts."
  },
  {
    "id": "EVA-CVJF-L1-S3",
    "type": "strength",
    "dimension": "trust",
    "severity": "polish",
    "title": "Blind mode suppresses the GitHub deep-dive coherently, and says so before submit",
    "evidence": [
      "app/features/sub_analyze/githubRunPolicy.ts:11-13 — one pure predicate, enforced at the single launch site",
      "app/features/sub_analyze/AnalyzeForm.tsx:175-179 — the suppression is announced next to the field, not silently applied",
      "app/features/sub_analyze/useAnalyzeForm.ts:417-420 — a blind GitHub-only submit errors instead of no-oping"
    ],
    "code_check": "n-a",
    "verdict": "confirmed",
    "resolution": "by-design",
    "ceiling": "Anti-bias and evidence-based hiring are in direct tension here: ticking Blind removes the only verified channel entirely. Nothing tells Eva she just traded evidence for fairness."
  }
]
```

## 7. Headline question — does this scoring pick the best candidate, or the best-presenting one?

**It picks the best-presenting one. Not by accident, and not for lack of machinery — by
wiring.**

**Is real repository evidence fetched?** Yes, genuinely. Not a stub: paginated owned
repos (`route.ts:219`, `:413-439`), per-repo language byte maps (`:230-239`), and for the
top three repos the actual README, the actual recent commit subject lines, and the actual
root file listing (`route.ts:614-653`), then a deliberately conservative Gemini review
over them (`:813-827`). This is the most epistemically careful code in the surface — it
refuses org accounts (`:207-211`), refuses to assert a gap when a fetch was throttled
(`:581`), and refuses to answer at all when it got nothing (`:768-797`).

**Does it move the score?** **No — it cannot.** There is no argument on the scoring CLI
capable of carrying it (`cli.py:24-48`); `AnalyzeParams` has no field for it
(`analyze-run.ts:16-41`); `cliArgs` passes none (`:114-124`); the analyze telemetry
records `github_present: false` as a **hardcoded literal** (`analyze-run.ts:144`) — a
fossil of a slot that was never wired. The GitHub payload has **no score field at all**
(`schemas.ts:208-260`), and the verdict resolver draws solely from `analysis.score` /
`analysis.jobFit.score` (`verdict.ts:29-49`). It is a tab beneath a verdict banner that
never saw it (`ResultPanel.tsx:199` vs `:249-257`).

**Is there any verified channel that outweighs self-reported text?** The mechanism
exists and is unused. `PROVENANCE_WEIGHTS` (`taxonomy.py:372-394`) discounts
`self_declared` beneath `open_source` and `professional` — exactly Eva's instinct,
encoded. But it drives `/api/match`, not this score; `_score_from_payload`
(`pipeline.py:699-728`) sums five LLM integers with no provenance term; and
`_honesty_crosscheck` literally computes a provenance-weighted total and **throws it
away** (`pipeline.py:929-931, 960-964`). Even if it were wired, the provenance label is
assigned *by the LLM reading the CV* (`profile.py:95`, `gemini.py:572`) — so the "is this
verified?" dial is itself a function of how the candidate wrote their document. And
`profile.links` — the candidate's own GitHub/portfolio URLs — is extracted at
`pipeline.py:554` and read by **no scorer**. Links are captured, displayed, and weighted
at zero.

**Is there a hallucinated-skill gate?** Yes, and it is good — but it is the *wrong*
gate for this question. `verify_skills_in_cv` (`ats.py:107-143`, called
`pipeline.py:219-229`) stops the **model** from claiming a skill the **CV** doesn't
mention. It does nothing about the **candidate** claiming a skill **reality** doesn't
support. The one channel that could close that gap never receives the CV
(`runAnalysis.ts:158-162`), so it cannot compare claim to artifact — its
"Unverified Claims" column is JD-vs-repos (`route.ts:820`), not claim-vs-evidence. The
code itself concedes the boundary: *"only `job_fit.matching_skills` is grounded"*
(`pipeline.py:1304-1306`).

**Does a strong-artifacts / plain-CV candidate outrank a beautiful-CV / nothing-behind-it
candidate?** On this surface, structurally no. Both are scored by the same five LLM
integers over prose. The plain-CV engineer's repos add zero; the polished CV's absent
repos subtract zero. The only asymmetry the system can express — provenance weighting —
is unwired, and the only external evidence it gathers is quarantined in a tab.

**Would Eva stake her team's time on this ranking?** As a triage pass, yes. As the
ranking, no — because the two candidates above are indistinguishable to it. **Could she
tell a rejected engineer why, with evidence?** Partly, and not well: matched chips carry
hover-gated CV snippets (`SkillChips.tsx:89-119`), but missing chips carry nothing
(`MissingSkillsTiers.tsx:52-61`), "Top gaps" is `slice(0,3)` and the file says so
(`:8-14`), the verdict banner cites no basis (`VerdictBanner.tsx:55-83`), and the only
real provenance artifact is download-only (`provenance-dossier.ts:29`).

**Plainly: this system measures presentation, with a rigorous honesty layer bolted to a
score that never consumes it.** It measures how well a candidate's document argues for
them, checked only for whether the *model* argued faithfully about the *document*. The
one place it touches reality — GitHub — is fetched carefully, rendered honestly,
persisted dutifully, and then excluded from every number that decides anything. The fix
is an integration, not a rebuild: the evidence already exists server-side at PATCH time
(`analyses/[slug]/route.ts:73-74`), the weighting table already exists
(`taxonomy.py:372-394`), and the downstream automation prompts already know how to
consume it (`automation.py:203-236`). It simply never reaches the gate.

## 8. Verdict

**L1-conditional.** The journey completes end-to-end with no structural dead-end, and
the verification *architecture* is the most carefully-reasoned in the app. Three majors
carry to L2, and they are one theme: **the product gathers verified evidence and then
declines to let it decide anything.** Grounding **6/9** main + **4/6** deep-dive —
identical to 2026-07-02, i.e. the major the last run raised is **still open, unmoved**.

**Estimated time saved if it all worked: ~40 min per engineer CV · medium confidence**
(manual CV+JD deep read plus a by-hand repo skim ≈ 45-60 min → ~10 min run + reading two
tabs). Discounted because she must still merge the CV verdict and the repo evidence in
her own head — the exact labour the product implied it had taken.

**L2 priorities:** (1) the A/B ranking experiment in EVA-CVJF-L1-03 — plain-CV/strong-repos
vs polished-CV/no-repos, same JD; (2) confirm the headline summary never references repos
and that removing the handle leaves the score identical; (3) plant a CV-only exaggeration
absent from the JD and confirm it surfaces nowhere; (4) diff the two tabs' skill
vocabularies; (5) read the report as a rejection email and see what evidence is quotable.

## 9. Character feedback — Eva, first person (cs)

> Nahraju CV inženýra, přidám jeho GitHub, vyberu JD. Formulář má čtyři sloupce vedle
> sebe a jedno tlačítko. Já z toho čtu jednu větu: *tohle všechno půjde do jednoho
> hodnocení.* Nejde. Jsou to dvě analýzy, které se nikdy nepotkají, a nikdo mi to na
> vstupu neřekne.
>
> A přitom — musím to říct — ta GitHub část je nejpoctivější kus softwaru, jaký jsem
> v těchhle nástrojích viděla. Fakt si stáhne commity, README, seznam souborů. Odmítne
> organizační účet. Když ho GitHub uškrtí, **nenapíše "žádné mezery"** — napíše, že to
> neví. Když nedostane nic, radši selže nahlas, než aby model vycucal sebevědomý posudek
> z prázdna. Tohle je přesně ta pokora, kterou po nástroji chci.
>
> Jenže je to pokora bez následku. Ten posudek nikam nejde. Skóre se počítá z pěti čísel,
> která model vytáhl z *textu životopisu* — a repozitáře leží ve vedlejší záložce pod
> verdiktem, který je nikdy neviděl. V kódu dokonce našli místo, kde se spočítá vážení
> podle důkazů — open source váží víc než "napsal jsem si to" — a pak se ten výsledek
> **zahodí**. Odkazy na portfolio se z CV vytáhnou a nepřečte je žádný scorer. Nula.
>
> Takže si to řekněme narovinu. Přijde mi kandidát, který má za sebou tři roky veřejné
> práce a životopis napsaný na kolenou. A přijde druhý, který má životopis vybroušený do
> posledního bulletu a za ním nic. **Tenhle systém je nerozezná.** Ne "špatně je
> seřadí" — *nerozezná je*, protože měří jenom to, jak dobře se ten dokument
> obhajuje sám za sebe.
>
> A ta kontrola vymyšlených dovedností, na kterou jsem byla pyšná? Hlídá, jestli si
> **model** nevymyslel dovednost, která v CV není. Nehlídá, jestli si ji nevymyslel
> **kandidát**. To je úplně jiná otázka a je to ta moje.
>
> *Obhájím to před ředitelem? Čím?* Ukážu mu číslo bez uvedeného základu, chybějící
> dovednosti bez jediného důkazu, a "hlavní mezery", což je — přečetla jsem si to
> v kódu — prostě první tři položky ze seznamu. Odmítnutému inženýrovi napíšu co? Že
> model usoudil?
>
> Adopce: ano na první síto, ne na rozhodnutí. Ušetří mi to reálně přes půl hodiny na
> kandidáta a beru to. Ale hodiny svého týmu podle tohohle pořadí nerozdělím, dokud se
> ty důkazy nedostanou do toho čísla. Máte je nasbírané. Máte i tu váhovou tabulku.
> Jenom je nepouštíte ke slovu tam, kde se rozhoduje.
