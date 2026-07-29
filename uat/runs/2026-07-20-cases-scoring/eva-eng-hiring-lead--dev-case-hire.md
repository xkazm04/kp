---
character: eva-eng-hiring-lead
journey: dev-case-hire
cert_level: L1
verdict: L1-conditional
grounding: 15/21
time_saved_min: 195
confidence: medium
date: 2026-07-20
run: 2026-07-20-cases-scoring
---

# Eva Marešová × dev-case-hire — L1 (theoretical, code-grounded)

Assignment: the case-AUTHOR side. READ-ONLY pass; no source touched.

## Surface model

Built by following the actual import chain from each affordance to the code behind it.

### S1 — Authoring intake (Dev tab → NeedForm)

| Affordance | file:line | Backed by |
|---|---|---|
| Dev tab exists in nav | `app/features/tabs.ts:28`, `:132-133` (`group devExtension`, `label "Dev cases"`) | no per-role gating — dev gate only |
| "Job description *" select (required) | `app/features/sub_dev/NeedForm.tsx:55-90`; gate at `:52` (`jdMissing`) | JD body is the need's primary statement |
| Codebases input, max 3 | `NeedForm.tsx:92-132`; cap `app/_lib/devcase-constraints.ts:8` (`MAX_CODEBASES = 3`) | GitHub-only, warned at `:115-119` |
| Seniority target | `NeedForm.tsx:134-142` (junior/medior/senior/lead) | scales timebox + probe depth |
| ▶ Run automated lifecycle | `NeedForm.tsx:143-152` → `runLifecycle` | orchestrator walk (S2) |
| Analyze need only | `NeedForm.tsx:153-157` | `analyze-need` verb only |

### S2 — Lifecycle orchestration

`app/_lib/devcase-orchestrator.ts:77` — stages `intake → analyzed → designed → awaiting_approval → approved → published → collecting → ranked → promoted → closed`.

- Auto-publish policy gate: `devcase-orchestrator.ts:49-70` — a design that fell back to the deterministic template is **refused** auto-publish (`:56`), as is an incomplete reflection (`:67`) or one with stated-vs-real gaps (`:70`).
- Freeze-at-publish: seed + interview scenario + naive-LLM baseline are materialized **before** the token is minted — `devcase-orchestrator.ts:148-167`, seed `:206-231` (`saveDevCaseSeedIfAbsent`), baseline `:239-257` (`saveDevCaseBaselineIfAbsent`).

### S3 — Case design (AI surface)

`pipeline/jobfit/devcase/design.py`.
- `design_role` `:116-189` — ctx carries JD body (`:126`, `jd_text[:4000]`), real stack (`:129`), complexity/gaps (`:131-132`), comparable market roles from the seed corpus (`:134`, `_comparable_roles:48-68`).
- `design_case` `:195-457` — the heart. System prompt `:70-74`: *"Assume the candidate's code can be 100% LLM-generated… probe judgment, tooling fluency, verification, architecture and transfer — never raw typing."*
  - Hard timebox cap `:31` (`_MAX_TIMEBOX_HOURS = 2.0`), seniority ladder `:34`, clamp `:422`. Prompt at `:249-254` explicitly forbids padding a senior case with deliverables — depth, not hours.
  - Covert probes `:255-262`: 2–4 probes with a mandatory `decisionSpace` of 2–3 *defensible* options ("not one right answer + distractors"), designed so the submission **cannot avoid encoding a choice**.
  - Forced DECISIONS log `:263-265`, framed as normal practice, "never as a test".
  - **Mid-flight update** `:266-272` (`CASE_DESIGN_PROMPT_VERSION = "case-design-v6"`, `:24`) — a stakeholder requirement change revealed partway through, making one-shot generation structurally impossible.
  - CV-derived targeted probes `:273-283`; reviewer-feedback redesign `:284-290`.
  - Domain-neutral deterministic fallback `:309-385` (never betrays the role's domain).

### S4 — Approval gate (Eva's review)

- `app/api/devcase/lifecycle/[id]/approve/route.ts:16-29` — editable subset: `title`, `brief`, `tasks`, `timeboxHours`.
- Probe-strength gate `:50-62` → `app/_lib/devcase-probe-audit.ts:1-40` (`enforceProbeGate`): a probe is load-bearing only if it forces ≥2 distinct defensible options (`MIN_OPTIONS`, `:39`), plants them at a concrete `where`, and defines `reveals`. Verdict `none | weak | strong` (`:31-35`).
- Eva's UI: `app/features/sub_dev/CaseDetail.tsx:237` (candidate-safe Markdown), `:272-281` probes + decision spaces, `:285` `ProbeStrengthBanner`, `:287-300` rubric, `:302` cohort probe panel.
- Editor: `app/features/sub_dev/LifecycleRow.tsx:176-194`.

### S5 — Candidate surface (Eva's output, Sam's leg — reachability-checked only)

`app/devcase/apply/[token]/page.tsx` — `notFound()` `:28`, closed-posting card `:34-42`, AI disclosure `:81`, probe-safe brief `:47` via `caseToMarkdown` (`app/features/sub_dev/DevHelpers.ts:42-58` — internal material excluded **by construction**, `:38-41`). One submit path `:96-104`: LiveWorkSurface when a seed exists, repo form otherwise.
Mid-flight reveal is served server-side on flush: `app/api/devcase/session/[id]/route.ts:86-102`, recorded as a `perturbation` event clients cannot forge (`KINDS`, `:44`).

### S6 — Evaluation (AI surface)

`app/_lib/devcase-run.ts:498-654` → `devcase_cli evaluate-submission` (`:563-573`) → `pipeline/jobfit/devcase/devcase_cli.py:394-470`.
- Observed-evidence assembly `devcase_cli.py:428-450`: `promptSignals` (`prompt_signals.py`), `canaryOutcomes` (`artifact_checks.canary_outcomes`), `baselineSimilarity`, plus `promptEvidence`/`checkEvidence`.
- `evaluate_submission` `pipeline/jobfit/devcase/evaluate.py:129-255`; system prompt `:24-29` — *"using AI is not a negative"*; `observedChecks` handling `:149-154` — a verbatim brief paste is "delegation-shaped but **NEVER a penalty by itself**".
- `mint_followups` `:330-451` — the pivot: *"the scores above are HYPOTHESES, not verdicts"* (`:336-341`). Questions anchor to one observed decision and ask for the why / rejected alternative / counterfactual — "never anything answerable by generic preparation or by re-reading the submission aloud" (`:370-371`). `listenFor` / `redFlag` internal (`:371-374`).
- Authenticity: `app/_lib/devcase-authenticity.ts:59-129` — commit-history penalties **waived** for observed sessions (`:70`, `:76`, rationale `:26-29`), replaced by the in-product tells: bulk paste −65 (`:86-89`) and broken hash chain / backdating −70 (`:95-98`). Fed at `devcase-run.ts:610`, `:617-630`.
- Observed process signals: `pipeline/jobfit/devcase/process_events.py:46-98`, evidence prose `:138-156` (incl. mid-flight adaptation `:148-156`).

### S7 — Eva's read (EvalPanel)

`app/features/sub_dev/EvalPanel.tsx`: transfer score `:58`, provenance strip `:66`, propagated confidence `:67-74`, authenticity chip `:78-95`, weighted dimension bars `:97-101`, strengths/concerns as real lists `:109-130`, observed-vs-inferred badge `:148-161`, DECISIONS-log chip `:168-189`, seed engagement `:195-209`, probe results `:212-231`, **interview follow-ups** `:236-249`, and the standing disclaimer `:251-254`: *"Code assumed LLM-generated — using AI is never penalised. Scores are hypotheses from the artifact; the interview follow-ups above are what verifies them."*

### S8 — The self-certifying fairness gate

`pipeline/jobfit/devcase/submission_eval.py` — a runnable gate over synthetic candidate behaviours. Thresholds `:71-74`. Fairness `:268-310`: no over-reliance flag invented from tool use alone (`_overreliance_from_tool_use:238-265`), verifiers must lead non-verifiers by ≥5 judgment pts (`:283`), AI-verifiers must not sit >2 pts below non-verifiers (`:284`). Discrimination `:313-350` incl. the `ai_no_verify` gamer (`:319`). Four-state gate `pass|fail|inconclusive|not_evaluable` (`:105-122`) — "no data must never read as unfair" (`:115`). LLM-judge asks `fairToAiUse` explicitly (`:374`).

## Grounding audit

**S3 — case design: 7/10**

| Real context the case should use | Reaches the prompt? |
|---|---|
| JD body (the actual role need) | ✅ `design.py:126` (via role; case inherits through `role` ctx `:216-221`) |
| Real stack from repo analysis | ✅ `:213`, `:218` |
| True complexity / risk areas | ✅ `:221-222` |
| Seniority target | ✅ `:219`, `:249-252` |
| Role responsibilities | ✅ `:220` |
| Comparable market roles (seed corpus) | ✅ role only (`:134`); ❌ absent from `design_case` ctx `:215-226` |
| CV-derived hypotheses → targeted probes | ✅ `:273-283` |
| Human reviewer feedback on redesign | ✅ `:284-290` |
| Bank brand / hiring process context | ❌ absent |
| Prior cases in this workspace (anti-repeat) | ❌ absent — nothing stops two roles getting near-identical cases |

**S6 — submission evaluation: 8/11**

| Evidence the grader should see | Reaches the prompt? |
|---|---|
| Case rubric | ✅ `evaluate.py:136` |
| Role title + seniority | ✅ `:138` (must-haves/responsibilities only reach `score_transfer` `:264-267`) |
| Commit reflection | ✅ `:139` |
| Tooling: fluency, probe outcomes, over-reliance flags, **evidence prose** | ✅ `:140` |
| Observed prompt signals | ✅ `devcase_cli.py:442` |
| Canary outcomes (planted flaws) | ✅ `:445` |
| Baseline similarity (vs frozen one-shot solve) | ✅ `:447` |
| Mid-flight adaptation | ✅ but only as an evidence *sentence* (`process_events.py:148-156`); the numeric `editsAfterPerturbation` (`:95-96`) reaches no rubric dimension and the deterministic fallback ignores it (`evaluate.py:172-183`) |
| Submitted file contents | ❌ go only to `artifact_checks`, never to the eval prompt |
| Seed diff | ❌ computed in TS **after** the eval (`devcase-run.ts:635-638`) |
| Candidate CV / prior analysis | ❌ absent |

**S7 — what actually reaches Eva's screen: 4/9** (see F1)
Rendered: dimension bars, authenticity score, DECISIONS chip, probe outcomes, followups.
Not rendered: `tooling.evidence`, `overRelianceFlags`, `observedChecks`/`checkEvidence`/`promptEvidence`, `integrity`.

**Journey grounding: 15/21.**

## Reachability

Eva's surface binding = authed workspace, primarily the Dev tab. `app/features/tabs.ts:28`/`:132-133` place `dev` in `NAV_GROUPS` with **no per-role or entitlement gating** — reachability reduces to "dev gate seeded + fixture behind the tab" (`uat/rubric.md:85-87`). Dev gate: `kp_dev_authed=1` (`uat/env.md:38-47`). Fixture: `devcase/seed_materializer.py` + a published case & submission (`env.md:126`).

**Every finding below is inside Eva's reachable set.** F1's data is server-side but the *deficient surface* (EvalPanel) is hers. S5 (`/devcase/apply/[token]`) is Sam's — inspected for probe-safety only, not scored against Eva. Keyless degradation drops one severity per `journeys/dev-case-hire.md:53`; no finding below depends on a keyless run.

## Findings

```json
[
  {
    "id": "EVA-DCH-L1-01",
    "journey": "dev-case-hire",
    "character": "eva-eng-hiring-lead",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "dimension": "trust",
    "title": "The mechanical evidence trail is computed, persisted — and never rendered to the person who must defend the verdict",
    "expected": "The evidence behind each score is on screen: what was watched (files opened/edited, read-before-write, decision-log entries, test edits, prompt-channel use, mid-flight adaptation), the canary verdicts, the baseline distance, and the tamper-evidence result.",
    "got": "EvalPanel renders scores, an authenticity NUMBER, probe outcomes and followups — but not one line of the evidence that produced them. `tooling.evidence` is typed (DevTypes.ts:153) and assembled in prose (process_events.py:138-156) yet rendered nowhere in sub_dev. `observedChecks` (canaryOutcomes, promptSignals, baselineSimilarity, checkEvidence, promptEvidence) is persisted at devcase-run.ts:489/639-650 and emitted at devcase_cli.py:461, but is absent from the EvalBundle type (DevTypes.ts:193) so no component can read it. `integrity` (devcase-run.ts:486) is likewise unrendered; its verdict survives only as a sentence inside the authenticity chip's `title=` tooltip (EvalPanel.tsx:82).",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "evidence": [
      "app/features/sub_dev/DevTypes.ts:193 — EvalBundle omits `observedChecks` and `integrity`",
      "app/features/sub_dev/DevTypes.ts:153 — Tooling.evidence typed but unused by any component",
      "pipeline/jobfit/devcase/process_events.py:138-156 — the evidence lines that are built and then dropped",
      "pipeline/jobfit/devcase/devcase_cli.py:461 — observedChecks emitted in the result",
      "app/_lib/devcase-run.ts:487-489, 639-650 — persisted on the bundle",
      "app/features/sub_dev/EvalPanel.tsx:52-274 — the full render; no evidence section",
      "app/features/sub_dev/EvalPanel.tsx:82 — integrity survives only inside a tooltip string"
    ],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Open a real evaluated submission and confirm whether ANY evidence string is visible on screen (not in a tooltip) — and whether an authenticity score of e.g. 35 states WHY without hovering. Then judge whether Eva could paste the panel into a director's deck as-is."
  },
  {
    "id": "EVA-DCH-L1-02",
    "journey": "dev-case-hire",
    "character": "eva-eng-hiring-lead",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "dimension": "clarity",
    "title": "Eva's entire Dev workspace is hardcoded English — the Czech nav label opens an untranslated surface",
    "expected": "The internal authoring/eval UI renders in Czech (her declared scored criterion; kp is next-intl-based and the app targets a Czech bank).",
    "got": "Zero of the 19 components in app/features/sub_dev/ call useTranslations/getTranslations. Every string in NeedForm, CaseDetail, EvalPanel, LifecycleRow is a literal. The nav label IS translated (messages/cs.json nav.tabs.dev = \"Vývojové případy\", nav.groups.devExtension = \"Rozšíření pro vývoj\"), so the shell promises Czech and the panel delivers English. The inversion is sharp: the ENGLISH-speaking candidate's page IS localized (devApply, messages/cs.json:3509; app/devcase/apply/[token]/page.tsx:30 getTranslations).",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "evidence": [
      "app/features/sub_dev/ — 19 .tsx files, 0 matches for useTranslations|getTranslations",
      "app/features/sub_dev/NeedForm.tsx:55,92,134,147,156 — literal English labels",
      "app/features/sub_dev/EvalPanel.tsx:56,214,239,252 — literal English",
      "messages/cs.json nav.tabs.dev = \"Vývojové případy\" — the translated entry point",
      "app/devcase/apply/[token]/page.tsx:30 + messages/cs.json:3509 — the candidate page IS localized"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Set LOCALE=cs, open the Dev tab, and confirm the panel body renders English under a Czech nav label. Check whether npm run i18n:check flags this (it compares key parity, not un-keyed literals — so it likely will not)."
  },
  {
    "id": "EVA-DCH-L1-03",
    "journey": "dev-case-hire",
    "character": "eva-eng-hiring-lead",
    "cert_level": "L1",
    "type": "broken-flow",
    "severity": "minor",
    "dimension": "trust",
    "title": "The approval gate accepts a timeboxHours up to 80 — the 2h brevity contract is enforced only against the LLM, not against the human",
    "expected": "The reviewer edit path honours the same hard cap the designer does (_MAX_TIMEBOX_HOURS = 2.0), or warns when exceeded.",
    "got": "coerceCaseEdits accepts any finite timeboxHours in (0, 80]. A reviewer can turn a 2h case into an 80-hour take-home with no warning, defeating the exact drop-off the cap exists to prevent (design.py:28-31 cites the 40-60% senior drop-off). LifecycleRow's editor imposes no client-side bound either.",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "med" },
    "evidence": [
      "app/api/devcase/lifecycle/[id]/approve/route.ts:26-27 — `o.timeboxHours > 0 && o.timeboxHours <= 80`",
      "pipeline/jobfit/devcase/design.py:31 — `_MAX_TIMEBOX_HOURS = 2.0`",
      "pipeline/jobfit/devcase/design.py:422 — the LLM's own estimate is clamped to the cap",
      "app/features/sub_dev/LifecycleRow.tsx:187 — client accepts any finite positive number"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Type 40 into the timebox at the approval gate and confirm it saves and renders '~40h timebox' on the candidate brief (DevHelpers.ts:47)."
  },
  {
    "id": "EVA-DCH-L1-04",
    "journey": "dev-case-hire",
    "character": "eva-eng-hiring-lead",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "dimension": "missing",
    "title": "The mid-flight update — the strongest anti-one-shot control — is invisible and uneditable at the approval gate",
    "expected": "Eva reviews the requirement change her candidates will receive mid-session, and can edit or remove it, before she publishes.",
    "got": "midFlightUpdate exists only server-side. The TS CaseScenario type (DevTypes.ts:75) has no such field, so no authoring component can render it; CaseDetail shows probes, decision spaces and the rubric but not the MFU; the approve route's editable subset (title/brief/tasks/timeboxHours) excludes it. Eva publishes a stakeholder message she has never read, in a role she must defend. Its internal `reveals` note (design.py:299) reaches no evaluator and no followup prompt — grep confirms midFlightUpdate appears only in design.py, session/[id]/route.ts and chat.py.",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "evidence": [
      "app/features/sub_dev/DevTypes.ts:75 — CaseScenario has no midFlightUpdate",
      "app/api/devcase/lifecycle/[id]/approve/route.ts:16-29 — editable subset excludes it",
      "pipeline/jobfit/devcase/design.py:266-272, 298-299 — designed, with an internal `reveals` note",
      "app/api/devcase/session/[id]/route.ts:20-34, 86-102 — delivered to the candidate",
      "pipeline/jobfit/devcase/process_events.py:148-156 — adaptation graded only as a prose evidence line"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Confirm no MFU text appears anywhere in CaseDetail or the approval gate for a case that has one; then confirm the candidate banner (LiveWorkSurface.tsx:317-320) does fire."
  },
  {
    "id": "EVA-DCH-L1-05",
    "journey": "dev-case-hire",
    "character": "eva-eng-hiring-lead",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "dimension": "trust",
    "title": "Seed engagement is structurally null on the live-work path — the primary path",
    "expected": "The 'which planted seam files did they touch' strip renders for in-product sessions, where the file tree is known exactly.",
    "got": "seedDiff is computed only from `signals.changedPaths`, and `signals` is null for every `session:` submission (devcase-run.ts:512, 523-532). So the guard at :636 is always false on the observed path and EvalPanel's seed-engagement strip (:195-209) never renders — precisely where the evidence is strongest, because the submitted tree IS captured (sessionFiles, devcase-run.ts:527) and already shipped to Python (:579).",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "evidence": [
      "app/_lib/devcase-run.ts:635-638 — `(signals?.changedPaths?.length ?? 0) > 0`",
      "app/_lib/devcase-run.ts:523-532 — signals stays null for a session: repoRef",
      "app/_lib/devcase-run.ts:527, 579 — sessionFiles captured and sent to Python",
      "app/features/sub_dev/EvalPanel.tsx:195 — strip gated on `ev.seedDiff && total > 0`"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Evaluate a live-session submission and confirm the 'Seed engagement: n/m planted files touched' strip is absent."
  },
  {
    "id": "EVA-DCH-L1-06",
    "journey": "dev-case-hire",
    "character": "eva-eng-hiring-lead",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "dimension": "clarity",
    "title": "AnalysisView advertises a 4h default timebox against a 2h hard cap",
    "expected": "Any timebox fallback matches the design contract (≤2h).",
    "got": "`~{design.case?.timeboxHours ?? 4}h` — a stale default double the cap, on the very screen where Eva first judges whether the case is short enough to send.",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "low" },
    "evidence": [
      "app/features/sub_dev/AnalysisView.tsx:152",
      "pipeline/jobfit/devcase/design.py:31"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Low — confirm the fallback can actually fire (a design with no timeboxHours)."
  },
  {
    "id": "EVA-DCH-L1-S1",
    "journey": "dev-case-hire",
    "character": "eva-eng-hiring-lead",
    "cert_level": "L1",
    "type": "strength",
    "severity": "polish",
    "dimension": "senior-quality",
    "title": "STRENGTH — the case is built on an explicit 'the artifact proves nothing' premise, and the whole pipeline is consistent with it",
    "expected": "n-a",
    "got": "Every layer restates and acts on the same premise: design assumes 100% LLM-generated code and makes ambiguity the instrument (design.py:70-74, 255-262); the eval grades judgment not correctness and says using AI is not a negative (evaluate.py:24-29); the followups treat the scores as hypotheses to verify live (evaluate.py:336-341); the UI tells Eva the same in plain language (EvalPanel.tsx:251-254). A probe with no real decision space is blocked at the gate (devcase-probe-audit.ts). This is a coherent design, not a bolted-on AI-detector.",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "evidence": [
      "pipeline/jobfit/devcase/design.py:70-74, 255-272",
      "pipeline/jobfit/devcase/evaluate.py:24-29, 330-341, 361-374",
      "app/features/sub_dev/EvalPanel.tsx:236-254",
      "app/_lib/devcase-probe-audit.ts:1-40"
    ],
    "code_check": "n-a",
    "verdict": "confirmed",
    "resolution": "by-design",
    "ceiling": "The premise is enforced by prompt text at the LLM boundary, not by a mechanism. Only the deterministic layers (probe audit, authenticity, process events, the fairness gate) are structurally guaranteed; a model that drifts toward grading correctness would not be caught at runtime — only by re-running submission_eval.py.",
    "l2_priority": "Confirm a real LLM evaluation's prose actually grades judgment rather than correctness."
  },
  {
    "id": "EVA-DCH-L1-S2",
    "journey": "dev-case-hire",
    "character": "eva-eng-hiring-lead",
    "cert_level": "L1",
    "type": "strength",
    "severity": "polish",
    "dimension": "trust",
    "title": "STRENGTH — a runnable fairness/discrimination gate is exactly the artifact Eva needs to defend the method itself",
    "expected": "n-a",
    "got": "submission_eval.py measures, over a synthetic behaviour landscape, that verifiers out-score non-verifiers by >=5 judgment pts, that AI-verifiers are NOT penalised (non-inferiority within 2 pts), that no over-reliance flag is invented from tool use alone, and that strong submissions beat both weak ones and the 'AI-no-verify gamer' by >=5 pts. It refuses to certify what it did not measure: a four-state gate keeps 'inconclusive' (thin sample) distinct from 'not_evaluable' (no data), and --strict fails on an error-fallback run so a degraded provider cannot masquerade as a clean green.",
    "impact": { "frequency": "med", "reachability": "med", "trust_erosion": "low" },
    "evidence": [
      "pipeline/jobfit/devcase/submission_eval.py:71-74 (thresholds), :105-122 (four-state gate)",
      "pipeline/jobfit/devcase/submission_eval.py:238-265 (no invented over-reliance), :283-284",
      "pipeline/jobfit/devcase/submission_eval.py:313-350 (discrimination incl. the gamer)",
      "pipeline/jobfit/devcase/submission_eval.py:485-499 (--strict semantics)"
    ],
    "code_check": "n-a",
    "verdict": "confirmed",
    "resolution": "by-design",
    "ceiling": "It certifies the evaluator over SYNTHETIC scenarios (submission_scenarios.py), not real candidates — so it evidences no adverse impact on planted behaviour cohorts, not on protected groups. It is also a CLI artifact: nothing in Eva's UI links to or displays the last gate run, so she cannot cite it without a terminal.",
    "l2_priority": "Run `python -m pipeline.jobfit.devcase.submission_eval --count 48 --no-llm` and record the actual margins; check whether any UI surfaces the result."
  }
]
```

## Headline question — does the design discover *mentality*, even against LLM-assisted candidates?

**Yes — the design genuinely discovers mentality, and it is the most serious answer to this problem I have read in code. But it discovers it in two places, and only one of them is fully wired to Eva's screen.**

### Where mentality is actually discovered

**1. The case is engineered so that no artifact can be the evidence.** `design.py:255-262` states the premise as a design constraint, not an aspiration: *"ASSUME the candidate's code will be 100% LLM-generated — including the commits and any write-up, so NOTHING in the artifact proves authorship. The case's real instrument is AMBIGUITY."* Each of 2–4 covert probes must carry a `decisionSpace` of 2–3 *defensible* options with different trade-offs — explicitly "not one right answer + distractors" — and must be designed so "the submission CANNOT avoid encoding a choice." That is the correct move. An LLM will happily resolve an ambiguity; what it cannot do is make the choice *the candidate would defend*. The artifact stops being the answer and becomes a **record of which path through the ambiguity was taken**.

**2. The mid-flight update makes one-shot generation structurally impossible** (`design.py:266-272`, `CASE_DESIGN_PROMPT_VERSION = "case-design-v6"`). A stakeholder requirement change fires roughly a third of the way in, delivered server-side on a session flush and recorded as a `perturbation` event clients cannot forge (`session/[id]/route.ts:86-102`, `KINDS` at `:44`). "The brief the candidate started from is no longer the brief they must finish against." A candidate who delegated wholesale must now re-drive the tool against changed constraints and reconcile earlier decisions — and the adaptation is measured (`process_events.py:78-84, 148-156`).

**3. The evaluation refuses to be the verdict.** `mint_followups` (`evaluate.py:330-341`) is where the design pays off: *"the submission — code, commits, decision log — may be entirely LLM-produced, so the scores above are HYPOTHESES, not verdicts."* Each question anchors to one observed decision and asks for the why, the rejected alternative, or the counterfactual — "never anything answerable by generic preparation or by re-reading the submission aloud" (`:370-371`). `redFlag` names the signature of delegated work: "restates WHAT was done but not why, defends every option equally, cannot name what they rejected" (`:372-374`). **Mentality is discovered in the live conversation; the case's job is to generate the right questions.** That is the correct architecture, and the product says so on Eva's own screen (`EvalPanel.tsx:251-254`).

**4. Process is observed, not reconstructed.** Read-before-write from event order, decision-log cadence, test edits, files opened vs edited (`process_events.py:46-98`), plus a captured prompt channel graded on *prompt quality* — decomposition, iteration, verification asks (`prompt_signals.py:1-17`). Planted canaries test whether a subtly-wrong result was caught or propagated (`artifact_checks.canary_outcomes`), and a frozen one-shot naive-LLM baseline is solved per case at publish (`devcase-orchestrator.ts:239-257`) so "how far is this from what a bare model produces unattended" is a *measured distance*, not a guess.

### Is AI collaboration measured as a skill, or treated as cheating?

**Measured as a skill — and this is enforced, not merely promised.** The system prompt says "using AI is not a negative" (`evaluate.py:28`). `prompt_signals.py:14-17` states the contract: *"using the assistant is never a penalty — zero prompts is simply 'no signal', and heavy use is graded on QUALITY, never volume."* Even `briefPasteRatio`, the one negative-leaning signal, "only AIMS the authorship interview — it never scores the candidate down here." The deterministic `assess_tooling` fallback hardcodes `overRelianceFlags = []` (`process_events.py:161`: *"never inferred from process — fairness contract"*).

And it is *tested*: `submission_eval.py` fails the build if AI-verifiers score more than 2 points below non-verifiers (`:284`), if any over-reliance flag lands on an AI user whose behaviour-matched non-AI peer was not flagged (`:238-265`), or if verifiers do not lead non-verifiers by ≥5 points (`:283`). It even asks an LLM judge `fairToAiUse` directly (`:374`). Most products in this space ship an AI-detector and a disclaimer; this one ships a **falsifiable fairness invariant**.

The one place AI use *is* penalised is narrow and correctly aimed: a single ≥600-char bulk paste with no incremental build-up costs 65 points (`devcase-authenticity.ts:57, 86-89`), and a broken hash chain or backdated timestamps costs 70 (`:95-98`). Both are *authorship* signals, not *tool-use* signals, and neither auto-rejects — a suspect band **holds** the submission for the ownership-verifying interview rather than advancing on score alone (`:8-10, 48-49`). Correspondingly, an observed live session has its commit-history penalties **waived** (`:70, 76`, rationale `:26-29`) — the team explicitly fixed the case where watched work was scored half-suspect for lacking commits it cannot have. That correction is a tell that this design has been run against reality.

### Where it falls short of Eva's bar

**It is not defensible to a skeptical engineering team *as shipped*, because the evidence does not reach the screen.** (F1.) The pipeline computes the exact material a director would demand — which canary was propagated, how the candidate drove the model, how far the work sits from a naive one-shot solve, whether the event log survived tamper-checking — and then drops it. `tooling.evidence` is typed and never rendered. `observedChecks` is not even in `EvalBundle` (`DevTypes.ts:193`), so no component *could* render it. The tamper verdict survives only as a sentence inside a `title=` tooltip. What Eva can point at is: five score bars, a bare authenticity number, probe chips, and a set of interview questions. Ask her *"čím?"* and she has a number and a tooltip.

The followups partly rescue this — each carries the observed decision it targets — but they are prospective (what to ask next), not retrospective (why we concluded this). And two secondary gaps compound it: seed engagement is structurally null on the live path (F5), and the mid-flight update she is publishing is invisible to her (F4).

**Plainly stated:** the *design* discovers mentality — decisively, and better than any take-home Eva could hand-build, because it moves the signal from the artifact to the decision path and then to a live conversation seeded by that path. The *evaluation surface* currently reports output quality plus a process score, and withholds the reasoning. So: **mentality is discovered by the instrument and under-delivered by the report.** That gap is a rendering problem, not an architecture problem — which is the good kind. The architecture is right; the last mile to the director's deck is missing.

## Character feedback — Eva Marešová

Řeknu to rovnou: tohle je poprvé, co někdo tomu problému rozumí.

I've sat through a dozen vendor demos this year and every one of them sold me the same thing — an AI that detects AI. Nesmysl. It's an arms race I lose by definition, and it insults the candidates I most want, the ones who use Copilot all day because that is the job now. This build starts from the opposite end and writes it into the code where I can read it: *assume all of it was generated, so nothing in the artifact proves anything.* Then it stops trying to catch them and starts making the case impossible to one-shot. Ambiguity with two or three genuinely defensible answers. A requirement change that lands mid-session so the brief they started from isn't the brief they finish against. And at the end it hands me questions built from *their* decisions — why this, what did you reject, what would have to change. Delegated work dies on those questions. Mine would. That's the whole thing, and somebody here actually thought it through.

And it's short. Two hours, hard-capped, with the reason written in the source — the 40-60% drop-off among seniors, the exact bleed I've been living with. Depth scales with seniority, not hours. A senior will take that. That alone changes who I can put through the process.

The fairness gate I would frame and hang on the wall. There's a script that fails the build if candidates who use AI score below candidates who don't. When our works council asks whether the tool disadvantages anyone — and they will, and the AI Act means they should — I can hand over a number instead of a promise. Nobody has ever given me that.

Tak proč nejsem nadšená.

Because I clicked into an evaluation and there was nothing to hold. Five bars. "Authenticity 35." A red chip. Nice, and useless to me. *Proč* 35? I hovered — the reasons are in a tooltip. **A tooltip.** I cannot put a tooltip in front of Kubíček. He will ask what she actually did, and I will be sitting there hovering my mouse and reading a sentence out loud. All that machinery — which planted flaw she caught, how she drove the model, how far her work sat from what the raw model spits out unattended, whether the log survived the tamper check — it's all computed. Someone wrote all of it. And then it doesn't come out on the screen. It's like commissioning a full forensic report and being handed only the grade. Obhájím to před ředitelem? Ne. Not with this panel.

Then the small ones that tell me nobody senior has actually *used* this. The mid-flight update — the cleverest thing in the entire product — I never see it. I approve a case and publish it and my candidate gets a message from "the team" that I have never read. I would find out what it says from a candidate complaining. And the approval form let me type a timebox of forty hours without a murmur, when the whole design is built around two. Guard the door against the model and leave it open for me? To je zvláštní.

And it's in English. Všechno. The tab in the sidebar says "Vývojové případy" — someone translated that — and then everything behind it is English. Meanwhile the page my *English-speaking* candidate opens is properly localized. It's backwards. I'll cope, I read English fine, but I am the one who has to sit next to a director and walk through this, and half of them will make me translate as I go.

Would I adopt it? Ano — but with a condition, not a "yes." The case authoring I'd take tomorrow; that's hours down to twenty minutes and the case is better than what I write by hand, which I don't say lightly. The evaluation I'd use as a *starting point* and then re-read the submission myself before I'd defend a call — which means the grading time doesn't actually go away yet. Give me the evidence on the screen, in a form I can copy into a deck, and it does.

Would I tell a peer? I'd tell them about the design. I'd say: someone finally built an assessment for the world we're in, where the interesting question isn't whether they used the AI but how they drove it and what they decided when it couldn't decide for them. Then I'd tell them to wait one release for the report to catch up with the instrument.

Máte správný nástroj. Ukažte mi, co naměřil.
