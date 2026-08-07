---
run: 2026-07-20-cases-scoring
character: petra-recruiter
journey: cv-analysis-jobfit
cert_level: L1
verdict: L1-conditional
language: cs
grounding: 5/9
time_saved_min: 8
time_saved_confidence: medium
surface_binding_ok: true
branch_note: read-only pass over the working tree on `vibeman/ambiguity-ui-wave1` (uncommitted WIP present; nothing edited)
---

# L1 — petra-recruiter × cv-analysis-jobfit

## Surface model

Followed the actual import chain, affordance → handler → route → task → Python → prompt.

**Intake (Analyze tab).**
- Tab registered `app/features/tabs.ts:19` (`"analyze"`), label `tabs.ts:126`; history sub-view `tabs.ts:23`. No role gating — Petra's binding holds.
- CV drop / paste / upload + JD field + saved-JD picker: `app/features/sub_analyze/AnalyzeForm.tsx` (form body), saved-JD picker `AnalyzeSavedJdPicker.tsx`, drop zone `AnalyzeFileDropZone.tsx`.
- **Analyze button** `AnalyzeForm.tsx:207-221` → `handlers.submit` (`useAnalyzeForm.ts`). Disabled only when both CV and GitHub profile are empty (`AnalyzeForm.tsx:212`).
- **Report-language select** `AnalyzeForm.tsx:225-234` (cs/en per-run override).
- **Blind screening checkbox** `AnalyzeForm.tsx:238-241`.
- **No grounding toggle exists** — `submitAnalysis` hardcodes `form.append("grounding", "true")` at `app/features/sub_analyze/AnalyzeApi.ts:41`.

**Client → server.**
- `runAnalysis.ts:81-97` `executeAnalysis` → `AnalyzeApi.ts:30-58` `submitAnalysis` → `POST /api/analyze`.
- Progress: `AnalyzeApi.ts:78-158` `watchAnalysis` polls `/api/tasks/[id]` at 1.5 s, advancing the strip on the server's **real** phase (`AnalyzeApi.ts:135`), not a timer.

**Route → background task.**
- `app/api/analyze/route.ts:24` POST. Rate limit `:34`, tenant `:43`, billing pre-gate `:52`.
- Inputs read: `grounding :56`, `jobDescription(File) :57`, `jobDescriptionText :58`, `company :59-60`, `jdSlug :61`, CVs `:63`, `reportLang :127`, `blind :130`.
- Params assembled `route.ts:135-148`; background task started `route.ts:169` (`startTask("analyze")`) — survives navigation.

**Task → Python.**
- `app/_lib/analyze-run.ts:149` `runAnalyze`. Cache key `:166-175`. Spawn `:193`.
- **`cliArgs` `analyze-run.ts:114-124` is the entire grounding surface.** The Python process receives exactly: `cvPath`, `--grounding`, `--blind`, `--lang`, `--job-description-path|--job-description-text`, `--company-path|--company-text`. Nothing else. No DB handle, no candidate id, no `cvHash`, no jdSlug, no pipeline history.
- Persist `analyze-run.ts:338-367`; headline total reconciled to the component sum `:356`.

**Python pipeline.**
- `pipeline/jobfit/cli.py:56` → `service.py:12` `analyze` → `pipeline.py:95` `analyze_cv`.
- Deterministic pre-pass `pipeline.py:1171-1231` (`detected_signals`, `detected_skills`, `classify_role_family`, `role_band` anchor).
- **The one scoring call:** `pipeline.py:159` `analyze_profile_with_gemini` → `gemini.py:481`.
- **The prompt:** `gemini.py:557-598`. Schema `gemini.py:29-136`. Score block `gemini.py:92-99`. Job-fit block `gemini.py:121-135`.
- Model input parts `gemini.py:615`: **the raw CV file bytes** (non-blind) or the redacted text (blind).
- Score parsed `pipeline.py:192` → `_score_from_payload` `pipeline.py:699-728`. Job-fit parsed `pipeline.py:891-908`.
- Skill trust gate `pipeline.py:219-229` → `ats.py:107-143` `verify_skills_in_cv`.
- Honesty cross-check `pipeline.py:911-964` → `matching.py:813` `score_job`.
- Screens: `authenticity.py:42` , `authenticity.py:137`, `pipeline.py:1299-1325`.

**Result panels.**
- `app/_components/results/ResultPanel.tsx` (tabs: extraction / salary / job-fit / interview / compare); verdict banner resolver `results/verdict.ts:29`.
- Job-fit `results/job-fit/JobFitTab.tsx`: dial `:41`, chips `:44-48`, unproven bucket `:50-56`, keyword coverage `:59`.
- Chips + evidence tooltip `results/job-fit/SkillChips.tsx:28-43`, `:123-155`.
- GitHub deep-dive renders as a **sibling** panel `ResultPanel.tsx:250` / `AnalyzeTab.tsx:124-126`.

## Grounding audit — **5/9**

Enumerating the candidate context a defensible job-fit score *should* use, against what `cliArgs` (`analyze-run.ts:114-124`) and the prompt (`gemini.py:557-598`) actually admit:

| # | Source the score should use | Reaches the prompt? | Evidence |
|---|---|---|---|
| 1 | Full CV document | ✅ raw file bytes | `gemini.py:615` |
| 2 | The real JD text | ✅ capped 30 k | `gemini.py:511`, `:587` |
| 3 | Company/employer context | ✅ optional, user-pasted | `gemini.py:512`, `:588` |
| 4 | Role comp band | ✅ partial — deterministic CZ anchor only | `pipeline.py:1212`, `taxonomy.py:453`, prompt `gemini.py:574` |
| 5 | Live web market evidence | ✅ (forced on) | `gemini.py:516-520`, `AnalyzeApi.ts:41` |
| 6 | **Verifiable external artifacts (GitHub / portfolio / repo)** | ❌ separate route, never merged | `runAnalysis.ts:158`, `ResultPanel.tsx:250` |
| 7 | **This candidate's prior analyses in the ATS** (`cvHash` identity exists) | ❌ | `analyze-run.ts:114-124` carries no id |
| 8 | **Prior stage outcomes / interview or live-case observations** ("observed" provenance) | ❌ | `taxonomy.py:381` weight exists; unreachable from analyze |
| 9 | **Peer-cohort calibration** (other candidates on the same req) | ❌ | no cohort arg in `cliArgs` |

**5/9.** The sharper number: of the five sources that *do* reach the scorer, **four are documents the candidate or the recruiter typed** (CV, JD, company blurb, and the taxonomy's keyword read of the CV). **Zero independently verifiable evidence of ability reaches the scoring prompt.** The one verifiable source the product owns — GitHub — is architecturally quarantined (F4).

## Reachability

Resolved **before** judging, per rubric.

- Petra is an internal user; the workspace dev gate (`kp_dev_authed=1`) exposes all tabs with **no per-role gating** (`app/features/tabs.ts`). Analyze (`tabs.ts:19`) and Analyze history (`tabs.ts:23`) are both in her set.
- Every affordance judged below sits on the Analyze tab or its result panels — **all reachable**. No finding here is tagged `unreachable`.
- Two caveats deferred to L2, not scored against her now: (a) `env.md` open question #5 — whether a Gemini key is present locally bounds whether live output quality is in scope; (b) Analyze history is non-empty only with a seeded analysis fixture (`env.md` fixture table).
- **Structural claim only.** Everything below is *fix landed / design as coded*. Whether the presentation bias actually changes a ranking on real CVs is L2's to measure.

## Findings

```json
[
  {
    "id": "CS-L1-01",
    "journey": "cv-analysis-jobfit",
    "character": "petra-recruiter",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "dimension": "senior-quality",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "title": "The job-fit score is a single LLM read of the CV document — every point of it is presentation-derived",
    "expected": "A fit score whose drivers separate what the candidate demonstrated from what they asserted.",
    "got": "job_fit.score is taken verbatim from the model payload (clamped only) at pipeline.py:895; the general score's five components are likewise verbatim (pipeline.py:713-719). The single model call's inputs are the CV file bytes + JD text (gemini.py:615, :587). The prompt (gemini.py:557-598) contains no instruction to weight demonstrated evidence over self-assertion, no length normalization, and no anti-inflation rule; its only truth guard, 'Do not invent facts that are not supported by the document' (gemini.py:579), constrains the MODEL, not the candidate. `traits` is a scored component worth 10/100 (gemini.py:98) sourced from the CV's own adjectives (pipeline.py:550), and `skills` — the largest component at 30/100 (gemini.py:95) — from the CV's self-authored skill list.",
    "evidence": [
      "pipeline/jobfit/pipeline.py:895",
      "pipeline/jobfit/pipeline.py:713-720",
      "pipeline/jobfit/gemini.py:557-598",
      "pipeline/jobfit/gemini.py:92-99",
      "pipeline/jobfit/gemini.py:615"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Run the SAME candidate history twice — once as a polished 2-page CV, once as a sparse honest one — and diff job_fit.score. Any material delta with identical underlying facts is the bias, measured."
  },
  {
    "id": "CS-L1-02",
    "journey": "cv-analysis-jobfit",
    "character": "petra-recruiter",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "dimension": "trust",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "title": "The matched-skill 'evidence' tooltip is a tautology — it quotes the skill list back at itself, not the CV",
    "expected": "Hovering a matched skill shows the line of the CV that proves it.",
    "got": "SkillChips receives `evidence={analysis.evidenceTrace?.skills}` (JobFitTab.tsx:47). That field is built by insights.py:90 as ONE synthesized string: f\"{len(profile.skills)} skills matched: {', '.join(profile.skills[:12])}\". findEvidence (SkillChips.tsx:28-43) then regex-tests the skill name against that string — so a chip shows 'evidence' precisely when its own name is in the first 12 skills of the list it came from. It proves nothing about the CV. Worse, chips beyond the first 12 get NO tooltip and render as plain pills (SkillChips.tsx:75-82), visually indistinguishable from 'evidenced' ones at a glance.",
    "evidence": [
      "pipeline/jobfit/insights.py:90",
      "app/_components/results/job-fit/JobFitTab.tsx:47",
      "app/_components/results/job-fit/SkillChips.tsx:28-43",
      "app/_components/results/job-fit/SkillChips.tsx:75-82"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Hover three matched chips on a real analysis; confirm the tooltip text is the 'N skills matched: …' echo rather than a CV quote, and screenshot it."
  },
  {
    "id": "CS-L1-03",
    "journey": "cv-analysis-jobfit",
    "character": "petra-recruiter",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "dimension": "senior-quality",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "title": "An evidence-weighted score IS computed on this exact run — and deliberately thrown away in favour of the LLM's presentation-driven number",
    "expected": "If the codebase can score by provenance, that number should at least inform the headline.",
    "got": "_honesty_crosscheck (pipeline.py:911-964) rebuilds the same candidate and calls matching.score_job (pipeline.py:957), which returns a provenance-weighted `total`, a `confidence` band, and `matched_skill_provenance` (matching.py:840-851) using PROVENANCE_WEIGHTS that discount self_declared to 0.4 vs professional 1.0 (taxonomy.py:372-392). Only `unproven_skills` is returned; the docstring states the rest is discarded on purpose: 'the synthesized matching total and its confidence band are deliberately discarded so no second overall number can reach the UI' (pipeline.py:930-931). The UI honours this — UnprovenSkillsBlock renders chips with 'intentionally no number' (JobFitTab.tsx:112-121). Result: the one evidence-graded signal the pipeline produces is demoted to a chip while the presentation-graded LLM number keeps the dial (JobFitTab.tsx:41).",
    "evidence": [
      "pipeline/jobfit/pipeline.py:930-931",
      "pipeline/jobfit/pipeline.py:957",
      "pipeline/jobfit/matching.py:840-851",
      "pipeline/jobfit/taxonomy.py:372-392",
      "app/_components/results/job-fit/JobFitTab.tsx:41",
      "app/_components/results/job-fit/JobFitTab.tsx:112-121"
    ],
    "code_check": "by-design",
    "verdict": "confirmed",
    "resolution": "open",
    "scope_note": "The discard is a documented product decision (avoid two competing headline numbers), not a bug. Recorded because the decision resolves in favour of the presentation-derived number.",
    "l2_priority": "Confirm the unproven chips render and carry provenance/adjacency labels live, and judge whether Petra reads them at all next to a big dial."
  },
  {
    "id": "CS-L1-04",
    "journey": "cv-analysis-jobfit",
    "character": "petra-recruiter",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "dimension": "missing",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "title": "GitHub evidence — the only checkable artifact the product touches — never reaches the scoring prompt",
    "expected": "Per the journey: 'confirm it's pulled into the same analysis, not a disconnected panel.'",
    "got": "Disconnected panel, confirmed. executeGithubAnalysis is a separate fetch to /api/github-analysis (runAnalysis.ts:158) fired independently of executeAnalysis. The route builds its own buildJobFitSignals (app/api/github-analysis/route.ts:279) and returns a standalone GithubAnalysis object. It renders as a sibling panel (ResultPanel.tsx:250, AnalyzeTab.tsx:124-126) and appears nowhere in analyze-run.ts's persisted payload. cliArgs (analyze-run.ts:114-124) has no GitHub argument, so verified commit history cannot reach gemini.py's prompt even in principle.",
    "evidence": [
      "app/features/sub_analyze/runAnalysis.ts:158",
      "app/api/github-analysis/route.ts:279",
      "app/_components/results/ResultPanel.tsx:250",
      "app/_lib/analyze-run.ts:114-124"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Run a CV+JD+GitHub profile together; confirm the job-fit score is byte-identical to the same run without the GitHub profile (cache key at analyze-run.ts:166-175 already excludes it — strong prior)."
  },
  {
    "id": "CS-L1-05",
    "journey": "cv-analysis-jobfit",
    "character": "petra-recruiter",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "dimension": "trust",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "title": "The scorer sees the rendered document — layout, typography, photo, length — with no normalization",
    "expected": "The same rubric applied to equal informational content, whatever the formatting.",
    "got": "Non-blind runs ship the raw file bytes to the model (gemini.py:615, `types.Part.from_bytes`), so design quality, template polish, photo and page count are all in the model's context window. There is no length cap on this path (CV_TEXT_BLOCK_MAX_CHARS at gemini.py:469 applies ONLY to blind mode's redacted text, gemini.py:593) and no normalization rule anywhere in the prompt (gemini.py:557-598). A 2-page designed CV and a sparse honest one are handed to the same rubric as unequal inputs. Blind mode helps with identity (gemini.py:546-553) but redacts name/contact only — it does not equalize length, polish, or keyword density.",
    "evidence": [
      "pipeline/jobfit/gemini.py:615",
      "pipeline/jobfit/gemini.py:467-469",
      "pipeline/jobfit/gemini.py:593",
      "pipeline/jobfit/gemini.py:557-598"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Same facts, two renderings (designed PDF vs plain .txt). Diff the score. This isolates format from content."
  },
  {
    "id": "CS-L1-06",
    "journey": "cv-analysis-jobfit",
    "character": "petra-recruiter",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "dimension": "trust",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "title": "When the model omits skill_claims, every self-listed skill silently defaults to 'professional' — the top provenance weight",
    "expected": "An unsourced skill defaults to the WEAKEST provenance, not the strongest.",
    "got": "_v2_profile_from_payload sets default_prov = 'self_declared' if early else 'professional' (pipeline.py:615), and when the LLM returns no skill_claims at all it fabricates one claim per skill at that default: claims = [SkillClaim(skill=s, provenance=default_prov) ...] (pipeline.py:632-633). For any non-early-career candidate — Petra's whole desk — that stamps every keyword in a skills bar as `professional`, weight 1.0 (taxonomy.py:382), identical to a skill proven by five years in production. The 0.4 self_declared discount (taxonomy.py:391) exists and is bypassed by the default. This directly weakens the unproven bucket in CS-L1-03: fewer skills get flagged as provenance-discounted precisely when the model gave the least information.",
    "evidence": [
      "pipeline/jobfit/pipeline.py:615",
      "pipeline/jobfit/pipeline.py:632-633",
      "pipeline/jobfit/taxonomy.py:382",
      "pipeline/jobfit/taxonomy.py:391"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Inspect a live run's saved payload for skill_claims presence; if absent, confirm the unproven bucket is empty/thin as predicted."
  },
  {
    "id": "CS-L1-07",
    "journey": "cv-analysis-jobfit",
    "character": "petra-recruiter",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "dimension": "missing",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "title": "No prior history reaches the score — the product knows this candidate and tells the scorer nothing",
    "expected": "A second analysis of a candidate already in the pipeline should know what happened last time.",
    "got": "The app computes a content-addressed candidate identity (cvHash) at intake and persists it precisely so 're-runs of the same CV collapse in History and link across jobs' (analyze-run.ts:349-351, route.ts:94). That identity — and every prior analysis, prior screening decision and pipeline stage outcome keyed to it — is never passed to the scorer: cliArgs (analyze-run.ts:114-124) forwards only the CV path, JD, company text, lang and two flags. Every analysis is a cold read. taxonomy.py:381 defines an 'observed' provenance for skills confirmed in a live case or interview — the highest-trust tier in the system — and no analyze-path code can ever set it.",
    "evidence": [
      "app/_lib/analyze-run.ts:114-124",
      "app/_lib/analyze-run.ts:349-351",
      "app/api/analyze/route.ts:94",
      "pipeline/jobfit/taxonomy.py:381"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Analyze a candidate who already sits in the seeded pipeline; confirm no panel references their prior stage or decision."
  },
  {
    "id": "CS-L1-08",
    "journey": "cv-analysis-jobfit",
    "character": "petra-recruiter",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "dimension": "trust",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "title": "The anti-inflation gate only fires at ≥95 AND a totally empty pre-pass — keyword density defeats it by construction",
    "expected": "A screen that catches inflation in the range recruiters actually act on.",
    "got": "_grounding_sanity_checks fires only when score.total >= 95 AND the deterministic pass found NO skill and NO signal (pipeline.py:1317-1318). But detected_skills is keyword matching over the CV text — a polished, keyword-dense CV lights it up trivially, so the gate's own precondition is defeated by the exact quality that inflates the score. The code names this seam itself: 'It cannot detect a subtler inflation (e.g. a 78 nudged to a 90)' (pipeline.py:1313-1314). Recorded as minor, not major, because the build discloses its own limit — but the honest range 78→90 is precisely where Petra's advance/hold/pass decision lives.",
    "evidence": [
      "pipeline/jobfit/pipeline.py:1317-1318",
      "pipeline/jobfit/pipeline.py:1313-1314",
      "pipeline/jobfit/pipeline.py:1183"
    ],
    "code_check": "by-design",
    "verdict": "confirmed",
    "resolution": "open",
    "scope_note": "Self-disclosed limitation; the disclosure itself is logged as a strength (S4).",
    "l2_priority": "n-a at L2 — structural."
  },
  {
    "id": "CS-L1-09",
    "journey": "cv-analysis-jobfit",
    "character": "petra-recruiter",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "dimension": "clarity",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "title": "Grounding is hardcoded on with no toggle — the journey's expected control does not exist",
    "expected": "The journey lists a 'grounding/blind toggle' pair on the intake.",
    "got": "Only the blind checkbox exists (AnalyzeForm.tsx:238-241). submitAnalysis unconditionally sends form.append('grounding', 'true') (AnalyzeApi.ts:41), which route.ts:56 reads and analyze-run.ts:117 turns into --grounding. Every run therefore makes a live web-search call the recruiter never chose and cannot see she is paying for. Not harmful to the score, but the journey's surface model was wrong here — recording the model gap.",
    "evidence": [
      "app/features/sub_analyze/AnalyzeApi.ts:41",
      "app/api/analyze/route.ts:56",
      "app/_lib/analyze-run.ts:117",
      "app/features/sub_analyze/AnalyzeForm.tsx:238-241"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Confirm market_evidence sources render on every run (proving grounding really is always on)."
  },
  {
    "id": "CS-L1-S1",
    "type": "strength",
    "cert_level": "L1",
    "dimension": "trust",
    "title": "verify_skills_in_cv is a real anti-hallucination gate at the right layer",
    "got": "Every LLM-claimed matching skill is checked against the CV text alias-aware ('k8s' confirms 'Kubernetes') before it can reach the chips, the keyword panel or the interview kit; withheld skills are named in the trust ledger rather than silently dropped (pipeline.py:219-229, ats.py:107-143). This closes Petra's stated blocker — a competency the CV never mentions. Do not touch it.",
    "evidence": ["pipeline/jobfit/pipeline.py:219-229", "pipeline/jobfit/ats.py:107-143"]
  },
  {
    "id": "CS-L1-S2",
    "type": "strength",
    "cert_level": "L1",
    "dimension": "trust",
    "title": "Blind screening fails closed, and refuses to claim a redaction it didn't make",
    "got": "If blind is requested but no text could be extracted, the pipeline raises rather than uploading the identity-bearing original (gemini.py:539-545). If text redacted but no name was detected, it says so honestly — 'Blind screening PARTIAL … the name may have reached the model' — instead of asserting anonymity (pipeline.py:136-148). That is exactly the seam-naming Petra trusts a build for.",
    "evidence": ["pipeline/jobfit/gemini.py:539-545", "pipeline/jobfit/pipeline.py:136-148"]
  },
  {
    "id": "CS-L1-S3",
    "type": "strength",
    "cert_level": "L1",
    "dimension": "clarity",
    "title": "The headline total is server-authoritative and can't contradict its own bars",
    "got": "The persisted total is always the component sum, never the model's claimed total; the model's number is demoted to a divergence signal that still gets flagged (pipeline.py:699-728, :1260-1296), and the same reconciled value is denormalized on save (analyze-run.ts:356) so History and the dial agree.",
    "evidence": ["pipeline/jobfit/pipeline.py:699-728", "pipeline/jobfit/pipeline.py:1260-1296", "app/_lib/analyze-run.ts:356"]
  },
  {
    "id": "CS-L1-S4",
    "type": "strength",
    "cert_level": "L1",
    "dimension": "trust",
    "title": "Deterministic authenticity + prompt-injection screens, phrased as screens not verdicts",
    "got": "Buzzword density, skill-stuffing, implausible tenure and metric-free prose are flagged deterministically (authenticity.py:42-67); CV-embedded injection attempts (imperatives, zero-width smuggling, absurd repetition) are detected over the raw extraction (authenticity.py:137-153). Every finding says 'verify' and no CV is ever auto-dropped. This is the only machinery in the build that actively pushes back on presentation — it just doesn't touch the score.",
    "evidence": ["pipeline/jobfit/authenticity.py:42-67", "pipeline/jobfit/authenticity.py:137-153"]
  }
]
```

## Headline question — does this pick the best candidate, or the best-presenting one?

**As coded, it measures presentation. Plainly.** Not because the machinery is careless — it is unusually careful — but because of where the number comes from.

**The whole score is one LLM read of a document the applicant authored.** `job_fit.score` is the model's integer, clamped and nothing more (`pipeline.py:895`). The general score's five components are equally verbatim (`pipeline.py:713-719`); the only server-authoritative act is *summing the model's own five numbers* (`pipeline.py:720`). There is exactly one scoring call (`pipeline.py:159` → `gemini.py:481`), and its context is the CV file bytes plus the JD (`gemini.py:615`, `:587`).

**What the applicant controls, and what it is worth.** `skills` is the largest component at 30/100 (`gemini.py:95`), read off the CV's own skill list. `traits` is 10/100 (`gemini.py:98`) — sourced from `payload["traits"]` (`pipeline.py:550`), i.e. the adjectives the candidate wrote about themselves. Between them, **40 of 100 points are self-description**, before counting how much of `experience` and `role_seniority` is also narration. Add the un-normalized document (`gemini.py:615`, no length cap outside blind mode at `gemini.py:593`) and layout, template quality and page count enter the context window too. Yes, the same rubric is applied to unequal inputs.

**Is assertion ever distinguished from evidence?** In the schema — yes, ambitiously. `skill_claims[].provenance` (`gemini.py:51-58`) with a real weight table: `professional` 1.0, `personal_project` 0.7, `coursework` 0.5, `self_declared` 0.4 (`taxonomy.py:372-392`). **In the score — no, three times over.** (1) The prompt never instructs the model to discount by provenance when scoring; the scoring rules at `gemini.py:578-583` say only that sub-totals must respect maxima and "do not invent facts". (2) The evidence-weighted total that *is* computed on the same run is deliberately discarded — `"the synthesized matching total and its confidence band are deliberately discarded so no second overall number can reach the UI"` (`pipeline.py:930-931`), leaving the presentation-derived number holding the dial (`JobFitTab.tsx:41`). (3) When the model omits `skill_claims`, every self-listed skill defaults to `professional` — the *top* weight (`pipeline.py:615`, `:632-633`).

**Anti-inflation?** One gate, firing only at ≥95 with a completely empty deterministic pre-pass (`pipeline.py:1317-1318`) — and the pre-pass is keyword matching (`pipeline.py:1183`), so keyword density switches the gate off by construction. The code says so itself: *"It cannot detect a subtler inflation (e.g. a 78 nudged to a 90)"* (`pipeline.py:1313-1314`).

**Hallucinated-skill gate?** Yes, and it is genuinely good — but read what it verifies. `verify_skills_in_cv` (`ats.py:107-143`) confirms the skill *appears in the CV text*. That stops **the model** inventing a skill. It does nothing about **the candidate** claiming one: typing "Kubernetes" into a skills bar passes it perfectly. It is an anti-hallucination gate, not an anti-inflation gate, and the two get conflated easily.

**Verified evidence?** The product owns exactly one checkable source — GitHub — and it is quarantined: a separate fetch (`runAnalysis.ts:158`), its own `buildJobFitSignals` (`github-analysis/route.ts:279`), rendered as a sibling panel (`ResultPanel.tsx:250`), absent from `cliArgs` (`analyze-run.ts:114-124`), absent from the cache key (`analyze-run.ts:166-175`). Prior stage outcomes are equally absent despite a persisted `cvHash` identity built for exactly this linking (`analyze-run.ts:349-351`). The system even defines an `"observed"` provenance for skills confirmed in a live case or interview (`taxonomy.py:381`) — the highest-trust tier it has — which no analyze-path code can ever set.

**The verdict.** A well-coached or LLM-assisted applicant controls essentially every input that moves this number, and the strongest counterweights in the codebase — provenance weighting, the matching engine's total, GitHub, prior outcomes — are either discarded by design, defaulted away, or never wired to the scorer. The deterministic screens (`authenticity.py:42-67`, `:137-153`) are the honourable exception: they *do* push back on polish, they are well built, and they touch nothing but a review note.

The good news is that this is a wiring problem, not a modelling one. The evidence-graded score already exists and runs on every analysis. It is thrown away one line before it could matter.

## Character feedback — Petra Nováková

Tak jo. Nejdřív to dobré, protože toho je víc, než jsem čekala.

Ta věc mi **nevymýšlí dovednosti**. Někdo si dal práci a každou dovednost, kterou model prohlásí za shodu, ověří proti textu CV — a když ji neověří, napíše mi to do poznámek místo aby ji tiše zahodil (`pipeline.py:219-229`). To je přesně ta čára, na které jsem s předchozími dvěma nástroji skončila. Tady ne. A blind screening, který **odmítne běžet**, místo aby potichu poslal originál s fotkou — a napíše mi "jméno jsem nenašel, možná se k modelu dostalo, ověř si to" (`pipeline.py:136-148`)? Takhle mluví nástroj, kterému se dá věřit. Nikdo mi tohle nikdy nepřiznal dobrovolně.

Ale.

Přišla jsem si pro číslo, které obhájím před liniovým manažerem. A když jsem si prošla, odkud to číslo je — je to **jeden přečet dokumentu, který si napsal sám kandidát**. Třicet bodů ze sta za seznam dovedností, který si vypsal. Deset bodů za přídavná jména, kterými se popsal (`gemini.py:95`, `:98`). To je čtyřicet bodů za to, jak dobře o sobě někdo umí psát. Já tuhle větu — "motivovaný týmový hráč se silnými komunikačními dovednostmi" — napsala tisíckrát. Vím přesně, co znamená. Neznamená nic. A tenhle systém za ni platí body.

Nejvíc mě ale dostalo tohle: **ono to to lepší číslo umí spočítat.** Je tam celý vážený systém — profesionální zkušenost 1.0, školní projekt 0.7, "napsal jsem si to sám" 0.4 (`taxonomy.py:372-392`). Spočítá se to. Na každém běhu. A pak to někdo **vědomě zahodí**, aby v UI nebyla dvě čísla (`pipeline.py:930-931`). Já chápu ten designový důvod. Ale zahodilo se to poctivé a nechalo se to hezké. To je rozhodnutí, ne chyba, a právě proto mě štve.

A pak jsem najela myší na zelený čip s fajfkou, protože jsem čekala řádek z CV. Víte, co se ukázalo? Seznam dovedností. Ten samý seznam, ze kterého ten čip vznikl (`insights.py:90`). Ono mi to jako "důkaz" ukazuje samo sebe. To není důkaz, to je ozvěna. A čipy od třináctého dál nemají ani tu ozvěnu a vypadají úplně stejně — takže na první pohled nepoznám podložené od nepodloženého.

GitHub tam je. Jediná věc v celém tom nástroji, kterou si nikdo nemůže vymyslet — skutečné commity, skutečné repo — a je to **samostatný panel vedle** (`ResultPanel.tsx:250`), který do skóre nevstupuje ani náhodou. To je jako kdybych měla na stole reference od bývalého zaměstnavatele a nechala je zavřené v obálce, protože hodnotím jenom motivační dopis.

**Přijala bych to?** Jako čtečku ano, jako rozhodčího ne. Ušetří mi to prvních deset minut — extrakce sedí, mezery jsou vypsané, mzda má aspoň nějaký základ. Ale to skóre nemůžu vzít a položit ho manažerovi na stůl, protože kdyby se mě zeptal "a co ten kandidát doopravdy uměl?", musela bych říct "tohle měří, jak dobře to má napsané". A to je věta, po které mi ten manažer přestane věřit — a právem.

Odhaduju, že mi to reálně ušetří **osm minut na CV** oproti tomu, když to čtu sama — jenže protože tomu číslu nemůžu věřit na slovo, to CV si stejně otevřu. Takže z těch osmi je nakonec **čtyři**. Pořád plus. Zdaleka ne to, co to slibuje.

**Řekla bych o tom kolegyni?** Řekla — s jednou větou navíc: "je to skvělý první průchod, ale to skóre neber jako pořadí." Což je přesně to, co by ten nástroj neměl potřebovat, aby si člověk domýšlel sám.

Jedna věc na závěr, poctivě: tenhle build **si své švy pojmenovává sám**. "Nedokáže odhalit jemnější nafouknutí, třeba ze 78 na 90" — to si napsali sami do kódu (`pipeline.py:1313-1314`). Nikdo mě nenutil to hledat. Tomu, kdo tohle napsal, věřím víc než celému marketingu obou ATS, kterými jsem si prošla. Ať to prosím dotáhnou až ke skóre.
