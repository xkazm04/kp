---
run: 2026-07-20-cases-scoring
character: petra-recruiter
journey: jd-to-shortlist
cert_level: L1
verdict: L1-conditional
focus: job-description / posting GENERATION half (Jobs + Library authoring → JD prompt → downstream matching)
grounding: 3/9
time_saved_min: 22
time_saved_confidence: low-med
language: cs
branch_note: read-only pass; uncommitted WIP present on vibeman/ambiguity-ui-wave1, nothing edited
---

# Petra × Z inzerátu k odůvodněnému shortlistu — L1 (JD-generation half)

## Surface model

Followed from affordance → handler → route → task → prompt. No file guessed.

### 1. Where JD authoring actually lives

| Affordance | File:line | What it does |
|---|---|---|
| Nav group "Job descriptions" (sibling of "Jobs") | `app/features/tabs.ts:112-115` | `{ id: "jobs" }` + `{ id: "library", label: "Job descriptions" }` in ONE nav group. No role gating anywhere in the tab catalog. |
| Generate panel | `app/features/sub_library/LibraryGeneratePanel.tsx:12-14` | thin wrapper → `JdBuilder` |
| The authoring form | `app/features/sub_library/JdBuilder.tsx:245-310` | inputs: **role title, company, seniority, field (roleFamily), output language, "describe the need" rich editor, codebase URL (software only), template picker** |
| Live advisory lint | `JdBuilder.tsx:104-109` → `jd-library.ts:39-42` → `app/_lib/jd-lint.ts:24-64` | EN+CS boilerplate / inclusivity / must-have-count regexes, debounced 400 ms, never blocks |
| "Generate JD" → checklist popover | `JdBuilder.tsx:314-359` | 3 independent toggles: description ✓, market research ✓, **case design ✗ (default OFF, `JdBuilder.tsx:99`)** |
| Start → POST | `JdBuilder.tsx:128-141` | `/api/jds/generate` with `{title, company, seniority, roleFamily, needText, repoUrl, lang, templateId, options}` |
| "Save as draft" (no AI) | `JdBuilder.tsx:175-208` | POST `/api/jds` — persists the typed body verbatim |
| Paste-an-ad ingest (Jobs tab) | `app/features/sub_jobs/IngestAdPanel.tsx:54-72` | POST `/api/jobs/ingest` — a *separate* path, parses a handed ad into a matchable job |

### 2. Generate → the prompt

```
JdBuilder.runGenerate                       JdBuilder.tsx:123-167
 └─ POST /api/jds/generate                  app/api/jds/generate/route.ts:27
     ├─ requireOperator()                   route.ts:32          (paid-run gate, before any body read)
     ├─ validateJdBuildInput()              app/_lib/jd-limits.ts:69-79
     ├─ getTemplate(templateId, ws)         route.ts:71-78       (tenancy-scoped)
     ├─ insertAnalyzingJd()                 route.ts:96          (row appears as "Analyzing" immediately)
     └─ startTask("jd_build", …)            route.ts:99-110      (detached; survives navigation)
          └─ runJdBuild()                   app/_lib/jd-build-run.ts:193
              ├─ DevNeed constructed        jd-build-run.ts:223-231
              ├─ runNeedAnalysis()          app/_lib/devcase-run.ts:102-125
              │    └─ devcase_cli analyze-need → pipeline/jobfit/devcase/analyze.py:59-91   ← PROMPT 1
              ├─ runDesignArtifacts()       devcase-run.ts:138-172
              │    └─ devcase_cli design-artifacts → devcase/design.py:116-189              ← PROMPT 2 (the JD)
              │       (+ design.py:195-457 design_case — only when caseDesign is ticked)
              ├─ runMarketSalary()          jd-build-run.ts:104-139
              │    └─ market_salary_cli.py:125-162  (Gemini + Google-Search grounding)      ← PROMPT 3
              ├─ composeMarkdown() / renderTemplate()   jd-build-run.ts:266-289
              ├─ finishJdAnalysis()         jd-build-run.ts:305
              └─ ingestStructuredJob()      app/api/jds/save/ingest-job.ts:10-55            ← becomes the matchable Job
```

### 3. What the JD becomes downstream

| Step | File:line | Shape |
|---|---|---|
| RoleSpec → Job record | `ingest-job.ts:26-29` | `requirements: mustHaves.map(s => ({skill: s, kind:"must_have"})) + niceToHaves.map(… "nice_to_have")` — **flat skill strings, nothing else** |
| Job description field | `ingest-job.ts:25` | `role.responsibilities.join("; ")` |
| Scoring | `pipeline/jobfit/matching.py:405-452` | per requirement: best `skill_match_score(candidate_skill, req.skill, provenance)` over the candidate's skill list; must=1.0, nice=0.4 |
| Reasoning prompt's view of the role | `pipeline/jobfit/match_reasoning.py:81-88` | `{title, seniority, roleFamily, mustHave[], niceToHave[], entryEligible}` — **the JD prose never reaches it** |
| Salary band on the matchable job | `ingest-job.ts:36-49` | fixed to the grounded analysis; a hand-typed markdown figure is deliberately NOT honored |

## Grounding audit

The context a senior recruiter's JD is actually built from, vs. what reaches the generation prompt (`design.py:117-135` is the authoritative `ctx`):

| # | Real context the JD should use | Reaches the prompt? | Evidence |
|---|---|---|---|
| 1 | The stated need (free text) | **YES** | `analyze.py:66` (`notes`) + `design.py:120` (`statedResponsibilities`) |
| 2 | Seniority + role family | **YES** | `design.py:121-122` |
| 3 | Repo/codebase reality (software roles only) | **YES (partial)** | `devcase-run.ts:103-108`, `design.py:128-132` |
| 4 | Company / employer identity | **NO** — `company` is passed to the salary CLI and pasted into the markdown header, but is **absent from the role-design `ctx` entirely** | `jd-build-run.ts:223-231` (DevNeed has no company field), `design.py:117-135` |
| 5 | Comp band / the budget Petra was actually given | **NO** — the app *produces* a band, it never *accepts* one | no input in `JdBuilder.tsx:245-290` |
| 6 | Team context / hiring manager / who they'd sit with | **NO** | no input; not in `ctx` |
| 7 | Brand / EVP / why work here | **NO** — only a markdown *template* shell, applied after generation | `jd-build-run.ts:275-287` |
| 8 | Success criteria ("what good looks like at 6 months") | **NO** | not an input, not a RoleSpec field (`jd-build-run.ts:144-152`) |
| 9 | The org's own comparable/prior JDs + hiring history | **NO** — `_comparable_roles` reads the generic **seed corpus**, not this workspace's roles | `design.py:48-66` (`load_corpus()`) |

**Grounding: 3 / 9.** Everything the machine knows about *this* hire is the free text Petra typed plus two dropdowns. The bank she works for, the money she was authorised, the team, the manager, and what success means are all invisible to the prompt.

## Reachability

Resolved **before** judging, per the rubric.

- **Reachable.** JD generation sits in the `library` tab, in the *same* nav group as Jobs (`tabs.ts:112-115`). There is no per-role nav gating in the tab catalog, so with the dev gate on Petra opens it in one click from Jobs. Every finding below is on a surface she can reach today.
- **One caveat, and it is a harness bug, not a product bug:** her Character file's `Surface binding` lists *Jobs, Match, Analyze, Pipeline, Schedule, Interview, Onboarding* — **Library is not in it** (`uat/characters/petra-recruiter.md:112-118`), and the journey's `surfaces:` front-matter says "Jobs tab" (`uat/journeys/jd-to-shortlist.md:4`). Taken literally, the JD-generation half of this journey is attributed to a surface that doesn't host it. Recorded as F5.
- **Gate that could bite at L2:** `/api/jds/generate` is operator-gated (`route.ts:32`). In open mode (no `KP_OPERATOR_PASSWORD`) it's a no-op, so local L2 is fine — but a passworded env turns every Generate into a 403 that the UI renders as "not permitted" (`JdBuilder.tsx:145`). Confirm which mode the L2 env runs in.
- **Not judged:** `/api/devcase/*` (Eva's surface), Billing, Models.

## Findings

```json
[
  {
    "id": "L1-PETRA-JD-01",
    "journey": "jd-to-shortlist",
    "character": "petra-recruiter",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "dimension": "senior-quality",
    "title": "The JD-generation prompt never learns the company, the comp band, the team, or what success looks like — grounding 3/9",
    "expected": "A JD prompt fed the real hire: the authorised band, the team and manager, the bank's EVP, the 6-month success criteria, and the org's own prior JDs for this family.",
    "got": "design_role's ctx is need.title + statedResponsibilities + seniorityTarget + roleFamily + an analysis of the free text (+ repo for software). `company` is collected in the form and used ONLY for the salary lookup and the markdown header — it is absent from the role-design context object. There is no input for band, team, manager, or success criteria at all.",
    "evidence": [
      "pipeline/jobfit/devcase/design.py:117-135",
      "app/_lib/jd-build-run.ts:223-231",
      "app/features/sub_library/JdBuilder.tsx:245-310",
      "pipeline/jobfit/devcase/design.py:48-66"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "l2_priority": "Generate a real ČS role (e.g. 'Specialista retenční péče', medior, cs) and read the mustHaves. Are they distinguishable from what the same prompt would emit for any bank in Europe? Count how many bullets Petra would have to rewrite by hand.",
    "suggested_acceptance": "Add optional band / team / manager / success-criteria inputs and thread them into design_role's ctx; ground _comparable_roles on the workspace's own JD corpus, not the seed corpus."
  },
  {
    "id": "L1-PETRA-JD-02",
    "journey": "jd-to-shortlist",
    "character": "petra-recruiter",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "dimension": "trust",
    "title": "The JD's only downstream footprint is a flat list of skill strings — the whole document is discarded before matching and before reasoning",
    "expected": "The JD I wrote — its judgment-revealing requirements, its context, its bar — shapes how candidates are scored and how the reasoning explains a pick.",
    "got": "ingestStructuredJob flattens the RoleSpec to `requirements: [{skill, kind}]` and `description: responsibilities.join('; ')`. score_skills then scores a candidate purely by best per-requirement string match over their declared skills. reasoning_context hands the LLM only {title, seniority, roleFamily, mustHave[], niceToHave[], entryEligible} — the generated JD body is nowhere in the reasoning prompt.",
    "evidence": [
      "app/api/jds/save/ingest-job.ts:19-31",
      "pipeline/jobfit/matching.py:405-452",
      "pipeline/jobfit/match_reasoning.py:81-88"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "l2_priority": "Generate two DIFFERENT ČS roles in the same family/seniority, run the same candidate against both, and diff the reasoning. If the narratives are near-identical, the JD is decorative and the score is a keyword tally.",
    "suggested_acceptance": "Pass the JD body (or a distilled 'what this role demands judgment about' block) into reasoning_context.job so the rationale can cite the actual role, not just its skill tags."
  },
  {
    "id": "L1-PETRA-JD-03",
    "journey": "jd-to-shortlist",
    "character": "petra-recruiter",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "dimension": "missing",
    "title": "The one instrument that IS designed for the LLM era — the covert-probe case — is default-off, rendered stripped, and cannot be attached to the job",
    "expected": "If the product knows candidate output is LLM-generated (it says so explicitly), the anti-echo instrument it builds should reach the candidate.",
    "got": "design_case bakes in cover-probes with a decisionSpace, a forced DECISIONS log, and a mid-flight requirement change that makes one-shot generation structurally impossible. In the JD builder, `caseDesign` defaults to FALSE. When ticked, the artifact is stored in jds.analysis_json but the Ledger's CaseArtifact type carries only {title, brief, tasks, timeboxHours} — coverProbes, decisionSpace and midFlightUpdate are not read at all — and CaseCard is pure display: no publish, no attach-to-job, no send-to-candidate. Real dev cases are minted on a separate path (POST /api/devcase) that takes no JD slug.",
    "evidence": [
      "pipeline/jobfit/devcase/design.py:230-301",
      "app/features/sub_library/JdBuilder.tsx:99",
      "app/features/sub_library/LibrarySavedJdsLedger.tsx:974-981",
      "app/features/sub_library/LibrarySavedJdsLedger.tsx:1073-1091",
      "app/api/devcase/route.ts:39"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "l2_priority": "Tick 'case design', wait out the build, then try to actually USE the case: attach it to the role, send it to a shortlisted candidate. Confirm the dead-end live.",
    "suggested_acceptance": "Render the probes/decisionSpace/midFlightUpdate in the Ledger (recruiter-only), and add 'Use this case for this role' wiring the JD's case into the posting/devcase lifecycle."
  },
  {
    "id": "L1-PETRA-JD-04",
    "journey": "jd-to-shortlist",
    "character": "petra-recruiter",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "dimension": "trust",
    "title": "The provenance discount — the only structural defense against a claimed skill — defaults to full professional credit and is derived from the CV's own self-description",
    "expected": "A skill asserted in a CV should not score like a skill demonstrated.",
    "got": "MatchCandidate.provenance_default = DEFAULT_PROVENANCE = 'professional' = weight 1.0. build_match_candidate derives per-skill provenance from the profile's own skill_claims/evidence, i.e. from how the CV describes itself — and consider() keeps the STRONGEST provenance seen. A CV that phrases every claim as job evidence therefore scores at 1.0 across the board. Additionally, reasoning_context only surfaces skillProvenance for early-career archetypes, so for a BAU/senior candidate the reasoning cannot even mention how verifiable a matched skill is.",
    "evidence": [
      "pipeline/jobfit/taxonomy.py:382",
      "pipeline/jobfit/taxonomy.py:394",
      "pipeline/jobfit/matching.py:102",
      "pipeline/jobfit/transform.py:113-125",
      "pipeline/jobfit/match_reasoning.py:68-73"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "l2_priority": "Score one candidate whose CV is plainly LLM-polished against a generated JD. Check whether the reasoning distinguishes asserted from evidenced at all for a non-early-career profile.",
    "suggested_acceptance": "Surface skillProvenance in reasoning_context for every archetype, and consider a lower default than 'professional' for skills with no dated evidence behind them."
  },
  {
    "id": "L1-PETRA-JD-05",
    "journey": "jd-to-shortlist",
    "character": "petra-recruiter",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "dimension": "clarity",
    "title": "JD generation lives in the 'Job descriptions' (library) tab, not the Jobs tab this journey and this Character's surface binding name",
    "expected": "The journey's declared surfaces match where the affordance is.",
    "got": "The Jobs tab holds ingest (paste an ad), the postings table, campaigns and rediscovery — but no JD-generate affordance (only CampaignTab has a 'generate', for ad variants). Authoring lives in sub_library. tabs.ts groups them together, so Petra reaches it fine — but her Surface binding omits Library entirely and the journey front-matter says 'Jobs tab'.",
    "evidence": [
      "app/features/tabs.ts:112-115",
      "app/features/sub_library/JdBuilder.tsx:41",
      "uat/characters/petra-recruiter.md:112-118",
      "uat/journeys/jd-to-shortlist.md:4",
      "app/features/sub_jobs/CampaignTab.tsx:102"
    ],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "l2_priority": "Confirm the Czech nav label for the library tab and whether a recruiter looking for 'napsat inzerát' finds it from Jobs without help.",
    "suggested_acceptance": "Add Library to petra-recruiter's Surface binding and to the journey's surfaces list."
  },
  {
    "id": "L1-PETRA-JD-06",
    "journey": "jd-to-shortlist",
    "character": "petra-recruiter",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "dimension": "senior-quality",
    "title": "An 11-character need is enough to launch a full paid 1–2 minute JD build",
    "expected": "The floor for a build should be a need substantive enough to design from.",
    "got": "JD_BUILD_NEED_MIN_LENGTH = 11. 'potřebuji' plus two characters clears the gate at both the form and the runJdBuild boundary. The advisory lint doesn't even engage until 40 chars (LINT_MIN_BODY_CHARS), so the thinnest inputs get the least guidance — exactly inverted.",
    "evidence": [
      "app/_lib/jd-limits.ts:32-33",
      "app/_lib/jd-limits.ts:69-79",
      "app/features/sub_library/jd-library.ts:29"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "l2_priority": "Generate from a 15-char need and judge the output against the senior bar. Is it usable, or is it the generic JD the model would write from the title alone?",
    "suggested_acceptance": "Raise the floor, or warn that a thin need will yield a generic role and show what to add."
  },
  {
    "id": "L1-PETRA-JD-07",
    "journey": "jd-to-shortlist",
    "character": "petra-recruiter",
    "cert_level": "L1",
    "type": "strength",
    "severity": "polish",
    "dimension": "trust",
    "title": "STRENGTH — the salary band is genuinely web-grounded, source-cited, and deliberately not hand-editable",
    "expected": "Petra's bar: a salary figure carries a basis (band / seniority / market), never a naked number.",
    "got": "market_salary_cli uses Gemini Google-Search grounding for a current band with cited sources, falls back to a labelled deterministic taxonomy band, and normalizeMarketSalary hardens the payload at the trust boundary so a garbage band degrades to available:false and the JD omits the salary line rather than printing '0 Kč'. ingestStructuredJob then FIXES the matchable band to that analysis so a number typed into the markdown cannot masquerade as research, and the Ledger's SalaryCard shows the sources + provenance.",
    "evidence": [
      "pipeline/jobfit/market_salary_cli.py:6-7",
      "pipeline/jobfit/market_salary_cli.py:125-162",
      "app/_lib/jd-build-run.ts:126-135",
      "app/_lib/jd-build-run.ts:165-171",
      "app/api/jds/save/ingest-job.ts:36-49"
    ],
    "code_check": "by-design",
    "verdict": "confirmed",
    "resolution": "by-design",
    "ceiling": "The band is market-anchored (CZ default), not ČS's own internal grade for this role — Petra still can't tell the tool what she was actually authorised to offer, and the band never reflects it.",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "l2_priority": "Confirm the sources render as real, clickable, current citations and the number is plausible for the Czech market."
  },
  {
    "id": "L1-PETRA-JD-08",
    "journey": "jd-to-shortlist",
    "character": "petra-recruiter",
    "cert_level": "L1",
    "type": "strength",
    "severity": "polish",
    "dimension": "clarity",
    "title": "STRENGTH — the specificity/inclusivity lint is bilingual, advisory, and now also runs over the GENERATED body",
    "expected": "Something should catch 'konkurenceschopné platové ohodnocení' before it reaches a candidate.",
    "got": "jd-lint is rules-only (instant, free, deterministic), with inflection-tolerant Czech stems alongside the English patterns, flags masculine-coded and ageist phrasing and an over-long must-have list, and suppresses the missing-salary finding when market research grounded a real band. It runs live in the builder AND over the rendered JD in the Ledger — closing the seam where a Generated JD published unlinted.",
    "evidence": [
      "app/_lib/jd-lint.ts:24-64",
      "app/features/sub_library/jd-library.ts:39-42",
      "app/features/sub_library/LibrarySavedJdsLedger.tsx:952-960"
    ],
    "code_check": "by-design",
    "verdict": "confirmed",
    "resolution": "by-design",
    "ceiling": "It lints WORDING, not SIGNAL. It has no opinion on whether a must-have is discriminating — 'strong communication skills' is not on any pattern list and passes clean.",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "l2_priority": "Confirm the Czech patterns fire on a real Czech draft and that the all-clear state renders."
  },
  {
    "id": "L1-PETRA-JD-09",
    "journey": "jd-to-shortlist",
    "character": "petra-recruiter",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "dimension": "clarity",
    "title": "Generate confirms with a 4-second toast and then wipes the form",
    "expected": "Petra's explicit criterion: after every action, an explicit confirmation of what happened and to whom.",
    "got": "On success the builder closes the checklist, clears title/need/repo, calls onSaved() and shows a 'queued' chip for 4000 ms. The chip names no role and links nowhere; after it fades, the only trace is a new 'Analyzing' row in the Ledger. Mitigating: the row DOES appear immediately with live task progress and the build survives navigation — so this is a confirmation-wording gap, not a silent success.",
    "evidence": [
      "app/features/sub_library/JdBuilder.tsx:154-161",
      "app/api/jds/generate/route.ts:96-112",
      "app/features/sub_library/jd-library.ts:62-70"
    ],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "l2_priority": "Watch the real transition: does the Ledger row appear before the toast fades, and does it name the role?",
    "suggested_acceptance": "Name the role in the confirmation and link it to its Ledger row."
  }
]
```

## Headline question — does the generated JD design for signal?

**No. As built, the JD half creates self-defeating keyword symmetry. The parts of this codebase that genuinely design for signal exist, are impressive, and are wired to a different flow.**

The evidence, in order:

**1. The JD's output shape is a keyword list, by construction.** `design_role` returns exactly `{title, seniority, roleFamily, mustHaves[], niceToHaves[], responsibilities[], languages[]}` (`design.py:147-148`). There is no field anywhere in that schema for a judgment call, a trade-off the role owns, a decision this person will have to make alone, or what distinguishes someone good from someone credentialed. The prompt asks the model to "calibrate must-haves" and "lightly ground against comparable market roles" (`design.py:136-145`) — it never asks for anything a candidate could not simply assert.

**2. That list is the entire scoring surface.** `ingestStructuredJob` maps every must-have to `{skill, kind:"must_have"}` (`ingest-job.ts:26-29`), and `score_skills` scores a candidate as the weighted mean of per-requirement best string match against their declared skills (`matching.py:405-452`). The score is, mechanically, an overlap measure between two lists of phrases.

**3. The reasoning layer cannot rescue it, because it never sees the JD.** `reasoning_context` passes the job as `{title, seniority, roleFamily, mustHave[], niceToHave[], entryEligible}` (`match_reasoning.py:81-88`). The generated document — the only artifact with any prose in it — is not in the prompt. So the "reason next to each candidate" is written from the same keyword lists that produced the number.

**4. The one structural defense is self-reported.** Provenance weighting is a real, well-built idea: observed 1.0, professional 1.0, self_declared 0.4 (`taxonomy.py:372-393`). But `provenance_default` is `professional` = 1.0 (`matching.py:102`, `taxonomy.py:394`), and per-skill provenance is derived from how the CV describes itself, taking the strongest reading (`transform.py:113-125`). An LLM writing a CV against a published JD will phrase every claim as professional experience — because that's what maximises the read — and score 1.0. Worse, the reasoning prompt only receives `skillProvenance` for early-career archetypes (`match_reasoning.py:68-73`), so for Petra's typical BAU candidate the narrative can't flag "asserted, not evidenced" even when the data would support it.

**Compose those four and the loop closes on itself.** An LLM writes the JD from a paragraph Petra typed. A candidate's LLM writes a CV from that published JD. The matcher scores the string overlap between the two, at full professional credit. The reasoning explains the score using the same strings. Every arrow in that loop is LLM-to-LLM text similarity, and the candidate's LLM is optimising directly against the published artifact. The better the candidate's tooling, the higher they rank — which is precisely backwards.

**And here is what makes this a design gap rather than a blind spot: the codebase already knows the answer.** `design_case` is written by someone who understood the problem exactly:

> "ASSUME the candidate's code will be 100% LLM-generated — including the commits and any write-up, so NOTHING in the artifact proves authorship. The case's real instrument is AMBIGUITY" — `design.py:255-259`

It bakes in cover-probes with a `decisionSpace` of 2–3 *defensible* options (not one right answer plus distractors), a forced DECISIONS log framed as normal practice rather than a test, and a **mid-flight requirement change** that fires a third of the way through so "the brief the candidate started from is no longer the brief they must finish against" (`design.py:266-272`). Downstream there is paste detection, a hash-chained event log, watermark checks for relayed solutions, and a one-shot naive-LLM **baseline solve** persisted as the comparison target for "what did the human add beyond the bare model?" (`devcase-run.ts:299-320`, `606-630`). That is a genuinely sophisticated answer to the LLM-era selection problem.

It is also, in Petra's flow, **switched off by default** (`JdBuilder.tsx:99`), **rendered with its instrument stripped out** — the Ledger's `CaseArtifact` type reads only `{title, brief, tasks, timeboxHours}`, so `coverProbes`, `decisionSpace` and `midFlightUpdate` are generated, persisted, and never displayed (`LibrarySavedJdsLedger.tsx:974-981`, `1073-1091`) — and **unattachable**: `CaseCard` is display-only, and real postings mint their case through `POST /api/devcase` (`app/api/devcase/route.ts:39`), which accepts no JD slug.

So the honest verdict: the JD, as generated, produces requirements that any LLM-written CV can mirror back perfectly, and it hands downstream matching nothing but the keywords to mirror. The signal-designing machinery is real and good — it is one checkbox, one render, and one wiring decision away from the JD flow, and until those three land, every score in this journey is a similarity contest between two language models.

## Character feedback — Petra, first person

Tak. Pojďme na to popořadě, protože tady je něco fakt dobrého a něco, co mi nesedí vůbec.

**Co mě potěšilo.** Ta mzda. Vážně. Poprvé mi nějaký nástroj hodí číslo a vedle něj zdroje, ze kterých ho vzal — a ještě mi nedovolí to číslo přepsat rukou, aby to nevypadalo jako rešerše, když to je můj odhad. To je přesně ten druh poctivosti, kvůli které bych nástroji začala věřit. A když se to nepovede, radši mzdu vynechá, než aby do inzerátu napsalo „Mzda: 0 Kč". Někdo tohle promyslel.

Ten lint taky. Česky, s ohýbáním — „konkurenceschopné platové ohodnocení" mi to chytne, „mladý kolektiv" mi to chytne. Šest let tyhle věty píšu a mažu, a konečně to za mě někdo hlídá průběžně, ne až mi to vrátí compliance.

**Co mi nesedí.** Ten formulář se mě nezeptá na nic, co o té roli doopravdy vím. Zeptá se mě na název, firmu, seniority, obor a odstavec textu. Nezeptá se mě, kolik mám na tu pozici schválené — a to je první číslo, co po mně manažer chce. Nezeptá se, do jakého týmu ten člověk jde, komu bude reportovat, co má za půl roku umět, aby to byl dobrý nábor. A když jsem se podívala, co se z toho formuláře do generování vůbec dostane, zjistila jsem, že ani ta firma tam nejde — použije se jen na hlavičku dokumentu a na mzdovou rešerši. Takže „Česká spořitelna" je pro ten model jen slovo v nadpisu. Nevygeneruje mi to inzerát pro *nás*. Vygeneruje to inzerát pro tuhle pozici obecně, kdekoli v Evropě.

A pak to horší, a to je věc, na kterou bych sama nepřišla, kdybych se nedívala do kódu. Ten hotový inzerát — ten text, co si přečte kandidát a co budu obhajovat — se dál v procesu **nepoužije vůbec**. Do matchingu se z něj vezme jen seznam dovedností jako holé řetězce, a do toho odůvodnění, které mi pak ukazuje „proč zrovna tihle tři", nejde ani ten text, ani nic z něj — jen ty samé řetězce. Takže inzerát je vlastně dekorace. To skóre je překryv dvou seznamů slov.

A teď si to složte. Já napíšu odstavec, model z něj udělá inzerát. Kandidát si ten inzerát načte do svého modelu a nechá si napsat životopis. A náš nástroj pak spočítá, jak moc se ten životopis podobá tomu inzerátu. **To není výběr, to je zrcadlo.** A vyhraje ten, kdo má lepší nástroj na psaní, ne ten, kdo tu práci umí. To je přesně opačně, než potřebuju. Já hledám člověka, kterýmu můžu dát nejednoznačné zadání a on se přijde zeptat na to správné.

**A tohle mě naštvalo nejvíc:** ono to v té aplikaci **je**. Když jsem šla po kódu dál, našla jsem případovku, která je postavená přesně na tomhle problému — předpokládá, že kandidátův výstup je stoprocentně z modelu, a schválně do zadání zabuduje nejednoznačnost, past, kde se vyplatí si to nejdřív přečíst, a — tohle je fakt dobré — **změnu zadání uprostřed řešení**, aby to nešlo vygenerovat jedním promptem. K tomu deník rozhodnutí a porovnání s tím, co by napsal holý model. Někdo tomu problému rozuměl líp než já.

A v mém formuláři je to **odškrtnuté**. Když to zaškrtnu, uvidím v detailu název, zadání a úkoly — ty sondy, ta rozhodnutí, ta změna uprostřed, to se mi vůbec nezobrazí. A hlavně: nemám kam s tím jít. Žádné tlačítko „použij tuhle případovku na tuhle roli". Vygeneruje se to, uloží se to, a tam to zůstane ležet.

**Ušetřený čas.** Inzerát si normálně píšu ke dvěma hodinám, když ho dělám pořádně — s manažerem, s tím, co po tom člověku vlastně chceme. Tohle mi z toho ubere první nástřel a mzdovou rešerši, což je poctivě tak dvacet minut. Zbytek si stejně přepíšu, protože o tom týmu a o těch penězích ten text neví. Takže ano, ušetří to čas, ale řádově méně, než ta minuta a půl čekání slibuje.

**Adoptovala bych to?** Na psaní inzerátů ano, jako startovní bod — kvůli té mzdě a tomu lintu. Na shortlist zatím ne, dokud vím, že to skóre je podobnost dvou textů od modelů. To bych manažerovi neobhájila, a co je horší — obhájila bych to *snadno*, protože to bude vypadat přesvědčivě. To je nebezpečnější než špatné skóre, které vypadá špatně.

**Řekla bych o tom kolegyni?** Řekla bych: „mzdovou rešerši si tam pusť, ta je dobrá. Ale ten shortlist si přečti očima, ne podle procent."

Jedno na závěr: neopravujte to tak, že do promptu přidáte větu o „rozlišujících požadavcích". To se naučí ten kandidátův model za týden. Zapněte tu případovku a nechte lidi udělat kus té práce. To se zrcadlem obejít nedá.

---

### Verdict

**L1-conditional.** Structurally Petra completes the job: she reaches the builder in one click from Jobs, authors, generates, gets a source-cited band, the JD lands in the Ledger, ingests as a matchable draft job, and ranks. No dead-end, no re-entry loop. But four majors carry forward — grounding 3/9, the JD discarded before matching and reasoning, the anti-LLM case instrument dead-ended, and the provenance defense defaulting to full credit — and every one of them lands on the same fault line: the JD is generated as prose for humans and consumed as keywords by machines, with nothing in between that rewards judgment.

**Scored criteria (JD half):** completion ✅ · senior-quality ❌ (F1, F2) · trust/hallucination — deferred to L2 · score-with-drivers — deferred (breakdown exists, `matching.py:160-182`) · salary-with-basis ✅ (F7) · clarity ⚠️ (F9, minor) · time-saved ⚠️ (~22 min, below the promise) · language ✅ (cs is honest end-to-end; de/fr correctly disabled rather than silently English, `JdBuilder.tsx:60-67`).
