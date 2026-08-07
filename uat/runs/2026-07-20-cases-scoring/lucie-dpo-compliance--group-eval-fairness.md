---
run: 2026-07-20-cases-scoring
character: lucie-dpo-compliance
journey: group-eval-fairness
cert_level: L1
verdict: L1-fail
language: cs
grounding:
  ai_comparison: 9/13
  fairness_evidence: 2/6
time_saved_min: 105
time_saved_confidence: medium
branch_state: vibeman/ambiguity-ui-wave1 (uncommitted WIP present; read-only run)
---

# L1 — Lucie Procházková (DPO / Fairness & Compliance) × group-eval-fairness

Theoretical, code-grounded certification. No browser. Every claim below was traced
through the actual import chain and cross-checked before recording.

## Surface model

**Entry → surface.** Decisions tab → a role row → group eval opens
`GroupEvalModal` (`app/features/sub_decisions/GroupEvalModal.tsx:63`), mounted from
`app/features/sub_decisions/DecisionsTab.tsx:1043` region. The modal only *reads* a
saved eval; generation is a background task (`group_eval` → `runGroupEval`).

**Affordances inside the modal** (all reachable, no role gating):

| Affordance | Backing code |
|---|---|
| AI comparison narrative | `GroupEvalModal.tsx:110` → `AiVerdict` ← `payload.comparison` ← `runGroupCompare`, `app/_lib/group-eval-run.ts:193-255` |
| Provenance subtitle (source + ran-at) | `GroupEvalModal.tsx:69-71` (`sourceLabelKey(evaluation.source)`); source computed `group-eval-run.ts:485` |
| Governance banner (advisory modes) | `GroupEvalModal.tsx:104-109` ← `governanceNote()`, `app/_lib/group-eval-governance.ts:61-76` |
| Comparison table (dims, matched/missing, provenance, salary) | `GroupEvalModal.tsx:130` → `ComparisonTable` |
| **"Fairness check" panel** | `GroupEvalModal.tsx:131-135` → `group-eval/FairnessPanel.tsx:17` |
| Robustness status | `group-eval/types.ts:47-52` `assessRobustness`; set `group-eval-run.ts:380` |
| Inline Advance / **Reject** | `GroupEvalModal.tsx:53` `onDecide` → `DecisionsTab.tsx:1043-1059` → `act()` `DecisionsTab.tsx:407` → `POST /api/pipeline/[id]` |
| Re-run | `GroupEvalModal.tsx:76-83` |

**Generation chain.** `runGroupEval` (`group-eval-run.ts:257`) →
`rankCandidates` (`:167`, `--weights-llm` + `--embeddings`) →
`rankPoolForJob` → `pipeline/jobfit/recruiter_cli.py` → `matching.score_job`
(`pipeline/jobfit/matching.py:788-810`); per-candidate `runReasoning` concurrently
(`:390-400`); `runGroupCompare` (`:488`) → `pipeline/jobfit/group_compare.py:50`
prompt; seal (`:519-549`); persist (`:640`).

**Lucie's adjacent compliance surfaces.**
- Decision records: `app/_lib/decision-record-store.ts` (seal `:197-271`, chain verify `:348-384`), API `app/api/decisions/records/route.ts:37-65` (operator-gated `:38`), UI `app/features/sub_analytics/DecisionRecordsPanel.tsx:30` mounted at `app/features/sub_analytics/AnalyticsTab.tsx:355`, JSON export `DecisionRecordsPanel.tsx:68`.
- Compliance posture + four-fifths calculator: `app/features/sub_decisions/ComplianceSection.tsx:24`, reached from `DecisionRulesModal.tsx:173`; math in `app/_lib/adverse-impact.ts:148`.
- Candidate AI disclosure: `app/_components/AiDisclosure.tsx:57-73`, shown at `app/apply/[id]/quick/QuickApplyForm.tsx:147,251`.
- Rejected-candidate view: `app/status/[token]/StatusClient.tsx:159-170`.
- Auto-reject wave: `app/_lib/screen-wave.ts:248-258` (predicate), `:260-270` (approval token), `:301-346` (commit); TS backstop `app/_lib/automation-fairness.ts:47-64`.

## Grounding audit

### (a) AI comparison surface — 9/13

Context assembled at `group-eval-run.ts:202-229`. **Reaching the prompt (9):** role
title, role salary band, per-candidate label, archetype, seniority, total, skills /
career / personal dim percents, matched skills, missing skills, verdict, potential
score, currency-gated salary expectation. **Not reaching it (4):** matched-skill
*provenance* and *strength* (computed `matching.py:848-851`, carried on the payload,
withheld from the prompt), the `confidence` band, `koPassed` + `assumptions`, and the
fairness/robustness matrix itself. Net effect: the narrative that a manager reads as
the deciding text is fed *scores and skill labels* but not the *evidentiary quality*
behind them — it cannot say "this skill is self-declared and that one is evidenced".

Mitigating strength: the compare prompt is fed **structured facts only, never raw CV
prose** (`group_compare.py:50-66`, "Use ONLY these facts"), so the narrative layer
itself does not re-import writing quality.

### (b) Fairness-evidence grounding — 2/6

What a defensible fairness verdict on this surface would need, vs what actually
reaches any check:

| Evidence source | Reaches a check? |
|---|---|
| Protected-attribute distribution | **No** — deliberately uncollected (`adverse-impact.ts:9-16`), honestly disclosed |
| Articulacy / verbosity / language-fluency confound | **No** — confirmed absent (see Findings L-04) |
| Blind-screening status per candidate | **No** — not recorded on the analysis, not surfaced |
| Provenance tier of each matched skill | Present on payload, **not** used by the fairness check |
| Cross-scheme weight variation | **Yes** — `matching.py:861-894`, rendered `FairnessPanel.tsx:73-157` |
| Knockout must-have integrity | **Yes** — `group-eval-run.ts:442-461` |

## Reachability

Resolved before judging, per `rubric.md`.

- Lucie is an internal user; the dev gate opens the workspace tabs with **no per-role nav gating**. Decisions tab, group-eval modal, Decision Rules → ComplianceSection, and Analytics → DecisionRecordsPanel are **all reachable**.
- `GET /api/decisions/records?candidate=<entryId>` is `requireOperator()`-gated and reachable *by her role*, but **no UI passes the `candidate` param** — the per-subject dossier is reachable only by hand-editing a URL. Scored as reachability `low` (finding L-11).
- `/status/[token]` and `/apply/[id]` are candidate surfaces. Lucie reviews them as artifacts, not as an actor; findings there are scored `reachability: high` for the *candidate* whose rights they bear, which is what her lens measures.
- Blind screening (`AnalyzeForm.tsx:239`) sits on the Analyze tab — reachable, but it is an authoring control she reviews rather than uses.
- **No finding below is `unreachable`.**

## Findings

```json
[
  {
    "id": "LUC-GEF-L1-01",
    "journey": "group-eval-fairness",
    "character": "lucie-dpo-compliance",
    "cert_level": "L1",
    "type": "trust",
    "severity": "blocker",
    "dimension": "trust",
    "title": "The candidate disclosure promises a GDPR Art. 22(3) right to human review that is not implemented anywhere",
    "expected": "If the disclosure tells a data subject 'You can ask for a human review at any point', a route, control or contact affordance must exist that lets them do it.",
    "got": "messages/en.json aiDisclosure.body states 'A human reviews and makes every advance, offer, and rejection decision; nothing adverse is decided automatically. You can ask for a human review at any point.' Sentence 1 is defensible (the screen-wave approval-token gate). Sentence 2 has no implementation: exhaustive case-insensitive greps over app/, messages/, i18n/ for appeal, contest, requestHumanReview, 'request a human', reviewRequest, objectTo, 'right to object', human_review, art22, Article 22 return only operator-internal hits. The recruiter-side reconsider queue (app/api/decisions/reconsider/route.ts) is operator-initiated and not candidate-invocable.",
    "evidence": [
      "app/_components/AiDisclosure.tsx:57-73",
      "messages/en.json aiDisclosure.body",
      "app/apply/[id]/quick/QuickApplyForm.tsx:147",
      "app/api/decisions/reconsider/route.ts"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "l2_priority": "Open a real /status/[token] for a rejected candidate and confirm live that no control, link or contact exists to request human review.",
    "suggested_acceptance": "Either ship a candidate-invocable human-review request (token-scoped POST that opens a reconsider item and seals a record), or amend the disclosure copy to state the actual channel. Do not ship copy asserting a right the product does not carry."
  },
  {
    "id": "LUC-GEF-L1-02",
    "journey": "group-eval-fairness",
    "character": "lucie-dpo-compliance",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "blocker",
    "dimension": "completion",
    "title": "An adverse decision produces a rationale the candidate never sees — no basis, no AI involvement notice, no contest path, so the decision is uncontestable in practice",
    "expected": "A rejected candidate receives the basis of the decision (or a route to obtain it) sufficient to contest it — the counterpart of the sealed rationale the operator holds.",
    "got": "The seal carries a specific machine rationale ('Auto-rejected · bottom {pct}% of {n} → {count} (rank {r}) and match {score} < {floor} threshold · approved by {approver}', screen-wave.ts:312-327). The candidate sees a fixed generic string: 'Not selected this time / Thank you for applying. The team has decided to move forward with other candidates.' No reason, no score, no statement that AI participated in THIS decision, no contact. The non-terminal withdrawn copy does say 'please contact the hiring team'; the rejection copy has no equivalent. /data/[token] is scoped to erasure only — there is no rectification or explanation surface.",
    "evidence": [
      "app/status/[token]/StatusClient.tsx:159-170",
      "app/status/[token]/StatusClient.tsx:212-220",
      "app/_lib/screen-wave.ts:312-327",
      "app/_lib/screen-wave.ts:377",
      "app/data/[token]/DataClient.tsx:19-22"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "l2_priority": "Drive a real rejected-candidate token end to end and capture exactly what the candidate is told.",
    "suggested_acceptance": "Surface a plain-language basis on the terminal status view (dimension-level, not raw score), state whether automated scoring contributed, and give one contest control."
  },
  {
    "id": "LUC-GEF-L1-03",
    "journey": "group-eval-fairness",
    "character": "lucie-dpo-compliance",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "blocker",
    "dimension": "trust",
    "title": "No check in the product can detect articulacy/presentation bias — and the scoring actively rewards it, so the system can be provably robust and substantively biased at once",
    "expected": "For a high-risk AI hiring system, at least one shipped check must be capable of detecting the dominant real-world bias channel — presentation/articulacy (fluency, CV length, keyword density, native-language writing quality, LLM assistance), which correlates with socio-economic background and protected attributes.",
    "got": "Three checks exist and NONE measures this. (1) The in-modal 'fairness check' varies only the three dimension WEIGHTS (skills/career/personal) within ±0.15 and re-ranks (matching.py:637-639, 861-894) — it cannot change WHAT text is scored, only how already-computed numbers are combined. (2) The four-fifths adverse-impact rule is protected-attribute-only and is a manual browser calculator (see LUC-GEF-L1-09). (3) The automated-rejection fairness gate is an ARCHETYPE shield (career stage) plus a score floor — automation-fairness.ts:47-64 — explicitly 'not a protected-class test' (adverse-impact.ts:14-16). Meanwhile the scoring rewards presentation (LUC-GEF-L1-04, L1-05). A shortlist selected on articulacy therefore passes every check the product ships, cleanly.",
    "evidence": [
      "pipeline/jobfit/matching.py:861-894",
      "pipeline/jobfit/matching.py:637-639",
      "app/features/sub_decisions/group-eval/FairnessPanel.tsx:17-84",
      "app/_lib/automation-fairness.ts:47-64",
      "app/_lib/adverse-impact.ts:9-16",
      "pipeline/jobfit/matching.py:525-535"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "l2_priority": "Generate a real eval on two candidates of equivalent substance but very different CV verbosity/fluency and observe whether any panel flags the divergence.",
    "suggested_acceptance": "Add a presentation-confound probe to the existing eval harness (pipeline/jobfit/eval/matching_eval.py already hosts pedigree/socio/language probes at :186-239): same substance, verbose vs terse and native vs non-native phrasing, assert a bounded score delta. Surface the residual delta in the modal as a named ceiling."
  },
  {
    "id": "LUC-GEF-L1-04",
    "journey": "group-eval-fairness",
    "character": "lucie-dpo-compliance",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "dimension": "trust",
    "title": "The `personal` dimension rewards a longer, keyword-denser CV by construction, and the early-career path scores candidate-authored prose by embedding similarity",
    "expected": "A dimension that separates candidates should normalize for how much the candidate wrote, not reward it.",
    "got": "score_personal = 0.5*lang_cov + 0.5*overlap, where overlap = min(1.0, hits / max(5, n_must_have)) and `hits` counts the candidate's OWN tokens (traits + skills) appearing in the ad. The denominator scales with the ADVERT's must-have count and is never normalized by the candidate's list length — the in-code comment states this was deliberate so 'a 5-keyword CV' no longer 'tied a 50-keyword one'. Confirmed absent: no length, word-count, or per-candidate normalization anywhere in matching.py. On the early-career path score_motivation feeds 0.35 weight from semantic_overlap of the candidate's free-text `aspirations` against the job title+description — candidate-authored prose scored by cosine, the clearest articulacy channel in the deterministic engine. The Gemini CV prompt that emits the headline score contains no instruction to disregard writing quality, CV length, or source language (full prompt gemini.py:557-598; the only numeric rule is :578).",
    "evidence": [
      "pipeline/jobfit/matching.py:525-535",
      "pipeline/jobfit/matching.py:496-544",
      "pipeline/jobfit/matching.py:554-577",
      "pipeline/jobfit/matching.py:566-572",
      "pipeline/jobfit/gemini.py:557-598",
      "pipeline/jobfit/gemini.py:578"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "l2_priority": "Compare two live analyses of the same substance at different verbosity and record the personal-dimension delta.",
    "suggested_acceptance": "Normalize `overlap` by a term that includes the candidate's own token count, or cap per-candidate token contribution; add an explicit 'score independently of writing quality, CV length and source language' clause to the extraction prompt."
  },
  {
    "id": "LUC-GEF-L1-05",
    "journey": "group-eval-fairness",
    "character": "lucie-dpo-compliance",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "dimension": "trust",
    "title": "A merely STATED skill is credited at full `professional` provenance weight for every non-early-career candidate — narration substitutes for evidence, and the weight proposer then shifts weight toward it",
    "expected": "Provenance should distinguish claimed from evidenced, and a confident narrator should not receive the same credit as a demonstrated practitioner.",
    "got": "provenance_default = 'self_declared' if is_early else 'professional' (transform.py:182). `professional` carries provenance weight 1.0 (taxonomy.py:708-713) — identical to demonstrated experience. Only early-career candidates receive the 0.4 self_declared discount, i.e. the discount lands on the group least able to narrate polished professional experience. The per-skill tier is itself assigned by Gemini reading the CV's prose (gemini.py:52-57), so a CV that NARRATES a skill as professional earns the professional multiplier. propose_weights then shifts weight TOWARD `skills` for high-trust provenance (matching.py:686-713, high_trust set at :697) — which for BAU is everything by default. The modal's own copy tells the recruiter 'demonstrated skill is weighted higher when backed by high-trust evidence' (fairnessExplain), which reads as evidence-gating that the default does not deliver.",
    "evidence": [
      "pipeline/jobfit/transform.py:182",
      "pipeline/jobfit/transform.py:107-148",
      "pipeline/jobfit/taxonomy.py:708-713",
      "pipeline/jobfit/matching.py:686-713",
      "pipeline/jobfit/matching.py:71",
      "messages/en.json decisions.groupEval.fairnessExplain"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "l2_priority": "Open the comparison table on a real eval and check whether the provenance chips actually distinguish claimed from evidenced for BAU candidates.",
    "suggested_acceptance": "Default an unevidenced skill to a claimed tier for ALL archetypes, or reword fairnessExplain so it does not imply evidence-gating the default does not perform."
  },
  {
    "id": "LUC-GEF-L1-06",
    "journey": "group-eval-fairness",
    "character": "lucie-dpo-compliance",
    "cert_level": "L1",
    "type": "broken-flow",
    "severity": "major",
    "dimension": "trust",
    "title": "Blind screening is an opt-in per-CV checkbox defaulting off, is not recorded on the analysis, and never reaches the ranking path — so one shortlist can mix blind- and non-blind-scored candidates",
    "expected": "The journey's own definition of done requires 'each candidate scored consistently'. A de-biasing mode must therefore be a workspace policy, be recorded per analysis, and be visible in the comparison.",
    "got": "Real, well-built redaction exists (redact.py:129-175 — name, email, phone, profile links, gendered pronouns/honorifics, age/birth-year; photo implicitly, since redacted TEXT is sent instead of the file), and fails open honestly (redact.py:120-126; pipeline.py:125-140 refuses to claim redaction it did not perform). But: it is exposed only as an unchecked checkbox on the Analyze form (`inputs.blind ?? false`), reaches only POST /api/analyze, is not persisted as a flag on the stored analysis (greps over app/_lib/db/analyses.ts and app/_lib/analysis*.ts for blind|redact return nothing), and recruiter_cli.py never imports redact — so the group-eval ranking always runs un-redacted over whatever each candidate's analysis happened to be. The group-eval payload carries no blind/redaction field, so the comparison cannot disclose which candidates were scored blind.",
    "evidence": [
      "app/features/sub_analyze/AnalyzeForm.tsx:235-240",
      "app/features/sub_analyze/AnalyzeApi.ts:38-42",
      "app/api/analyze/route.ts:129-146",
      "pipeline/jobfit/redact.py:129-175",
      "pipeline/jobfit/pipeline.py:121-140",
      "app/_lib/group-eval-run.ts:569-638"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "l2_priority": "Analyze the same CV blind and non-blind, then group-eval both and check whether the modal distinguishes them in any way.",
    "suggested_acceptance": "Persist a `blind` flag on the analysis, render it per candidate in the comparison table, and add a workspace policy that can require blind screening for a role."
  },
  {
    "id": "LUC-GEF-L1-07",
    "journey": "group-eval-fairness",
    "character": "lucie-dpo-compliance",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "dimension": "trust",
    "title": "With AI-tuned weights the candidate's NAME is sent un-redacted to the LLM that tunes that candidate's own scoring weights",
    "expected": "The identity attributes redaction exists to remove must not be handed to a model that influences the candidate's score.",
    "got": "The group eval always opts into --weights-llm (group-eval-run.ts:179-184). weight_proposal.proposal_context puts `\"label\": cand.label` into the per-candidate row sent to the weight-proposing LLM (weight_proposal.py:47); cand.label is populated from the caller's entry label (recruiter_cli.py:72-73), in practice the candidate's name. The fairness matrix also carries labels (matching.py:872). No redaction is applied on this path — recruiter_cli.py never imports redact. The panel then advertises the result as 'AI-tuned weights' (FairnessPanel.tsx:77-79), i.e. the surface labelled 'fairness' is the one carrying identity to the model. A name is a strong proxy for gender, ethnicity and nationality.",
    "evidence": [
      "pipeline/jobfit/weight_proposal.py:40-52",
      "pipeline/jobfit/recruiter_cli.py:72-73",
      "app/_lib/group-eval-run.ts:179-184",
      "pipeline/jobfit/matching.py:872",
      "app/features/sub_decisions/group-eval/FairnessPanel.tsx:77-79"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "l2_priority": "Capture the actual weight-proposal payload on a live eval and confirm the name is present.",
    "suggested_acceptance": "Replace `label` with the opaque candidateId in proposal_context — the LLM has no legitimate use for the name when proposing dimension weights."
  },
  {
    "id": "LUC-GEF-L1-08",
    "journey": "group-eval-fairness",
    "character": "lucie-dpo-compliance",
    "cert_level": "L1",
    "type": "broken-flow",
    "severity": "major",
    "dimension": "trust",
    "title": "A reject issued from inside the group-eval modal seals with NO reason, while the same action from the analysis modal captures one",
    "expected": "Every rejection carries a recorded human reason — Lucie's stated pet peeve is 'a rejection with no human name and no recorded reason'.",
    "got": "GroupEvalModal's onDecide resolves the entry then calls `act(e, action)` with no third argument (DecisionsTab.tsx:1051-1058). act's signature is `(e, action, detail?, ttlDays?)` and the optional `detail` is what rides to the server and becomes the recorded reason on the sealed event (DecisionsTab.tsx:407, :415, :424-426). The AnalysisSummaryModal path by contrast passes a reason (DecisionsTab.tsx:1012-1013). So the fastest, most comparative reject surface in the product — the one where a manager rejects five people side by side — is the one that records the least. There is also no confirmation step on this irreversible action in the modal path.",
    "evidence": [
      "app/features/sub_decisions/DecisionsTab.tsx:1043-1059",
      "app/features/sub_decisions/DecisionsTab.tsx:407",
      "app/features/sub_decisions/DecisionsTab.tsx:424-426",
      "app/features/sub_decisions/DecisionsTab.tsx:1012-1013",
      "app/features/sub_decisions/group-eval/useGroupEval.ts:28-35"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "l2_priority": "Reject a candidate from the group-eval modal live, then read the sealed record in Analytics and confirm the reason field is empty.",
    "suggested_acceptance": "Require a reason (or offer the eval's own gap list as one-click reasons) before an inline reject, matching the analysis-modal path."
  },
  {
    "id": "LUC-GEF-L1-09",
    "journey": "group-eval-fairness",
    "character": "lucie-dpo-compliance",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "dimension": "missing",
    "title": "The only protected-class fairness check is an ephemeral in-browser paste-in calculator that stores nothing, gates nothing and leaves no audit trail",
    "expected": "A high-risk-system fairness result should be retained, attributable and capable of blocking an action — or at minimum recorded that it was run.",
    "got": "computeAdverseImpact runs client-side over counts the recruiter types into a textarea inside a <details> in the Decision Rules modal; 'Nothing is sent or stored'. Its verdict is wired to no enforcement path — a recruiter can read 'adverse impact' (ComplianceSection.tsx:223) and commit the screen-wave rejection regardless. There is also a sharp asymmetry Lucie will be asked about: the check that would prove something requires n>=30 per group (adverse-impact.ts:39), while the check the product actually SHIPS and labels 'fairness' runs from n>=2 (group-eval-cohort.ts:23).",
    "evidence": [
      "app/features/sub_decisions/ComplianceSection.tsx:169-257",
      "app/features/sub_decisions/ComplianceSection.tsx:20-22",
      "app/_lib/adverse-impact.ts:39",
      "app/_lib/group-eval-cohort.ts:23",
      "app/features/sub_decisions/DecisionRulesModal.tsx:173"
    ],
    "code_check": "by-design",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "l2_priority": "Run the calculator to an adverse verdict, then confirm live that the screen wave still commits.",
    "suggested_acceptance": "Let the recruiter seal a four-fifths run as a decision record (counts + verdict + who ran it) so a periodic monitoring obligation can be evidenced, and warn on wave commit when the last run was adverse."
  },
  {
    "id": "LUC-GEF-L1-10",
    "journey": "group-eval-fairness",
    "character": "lucie-dpo-compliance",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "dimension": "trust",
    "title": "Audit seals fail silently — an auto-rejection can land with no decision record at all, logged only to console.warn",
    "expected": "If the audit write fails, the compliance surface must know. An audit trail with silent holes is worse than none, because its completeness is asserted.",
    "got": "sealDecisionSafe swallows every seal error and returns null (decision-record-store.ts:277-284). This is a deliberate trade — the audit write must not abort a hiring decision — but every reject-path call site uses this variant, and the failure surfaces only as a console warning. Nothing in the operator UI reports 'N decisions this period could not be sealed'. Compounding: the hash chain only DETECTS tampering when KP_DECISION_HMAC_KEY is set (:99-104), and an all-keyless chain is forgeable (:92-93) — so the ComplianceSection posture line 'Every decision is sealed to a tamper-evident audit record' is conditional on an env var with no surfaced status.",
    "evidence": [
      "app/_lib/decision-record-store.ts:277-284",
      "app/_lib/decision-record-store.ts:92-104",
      "app/_lib/decision-record-store.ts:348-384",
      "messages/en.json decisions.compliance.covered2",
      "app/_lib/group-eval-run.ts:519-549"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "high" },
    "l2_priority": "Check whether the Decision Records panel reports chain-verification status and key presence live.",
    "suggested_acceptance": "Surface seal failures and HMAC-key absence in the Decision Records panel; count unsealed decisions per period."
  },
  {
    "id": "LUC-GEF-L1-11",
    "journey": "group-eval-fairness",
    "character": "lucie-dpo-compliance",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "dimension": "effort",
    "title": "The per-subject decision dossier — the right-to-explanation artifact — exists in the API but no UI can produce it",
    "expected": "One control that exports everything held about one data subject's decisions.",
    "got": "GET /api/decisions/records supports ?candidate=<entryId> (route.ts:37-65) and the panel can export JSON (DecisionRecordsPanel.tsx:68), but grep for 'candidate=' across app/features/**/*.tsx returns zero hits — no UI ever passes the filter. Lucie must hand-craft the URL, as an operator, to answer a single subject-access request.",
    "evidence": [
      "app/api/decisions/records/route.ts:37-65",
      "app/features/sub_analytics/DecisionRecordsPanel.tsx:68",
      "app/features/sub_analytics/AnalyticsTab.tsx:355"
    ],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "med", "reachability": "low", "trust_erosion": "low" },
    "l2_priority": "Confirm live whether any filter control exists on the Decision Records panel.",
    "suggested_acceptance": "Add a candidate filter + 'export this candidate's dossier' button to DecisionRecordsPanel."
  },
  {
    "id": "LUC-GEF-L1-12",
    "journey": "group-eval-fairness",
    "character": "lucie-dpo-compliance",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "dimension": "trust",
    "title": "A public fairness claim about separating reasoning from delivery fluency is not implemented in the prompt that does the rating",
    "expected": "Any published fairness guarantee must be traceable to the code that enforces it.",
    "got": "The About page tells users 'reasoning content is scored separately from delivery fluency - nerves and non-native English are not weak thinking' (messages/en.json:4063, rendered StudentsAbout.tsx:367). The interview SCORECARD prompt (automation.py:741-780) contains no such instruction; it requires verbatim quotes (:752-754) and handles ASR corruption (:758-764) but never separates content from delivery. The rule exists only in the interviewer agent's conversational brief in the eval harness (eval/interview_eval.py:128-133), which does not govern rating. The nearest real mechanism is _scorecard_confidence (automation.py:652-668), which widens the confidence BAND on a thin transcript — a different guarantee than the one published.",
    "evidence": [
      "messages/en.json:4063",
      "app/features/sub_about/StudentsAbout.tsx:367",
      "pipeline/jobfit/automation.py:741-780",
      "pipeline/jobfit/automation.py:652-668",
      "pipeline/jobfit/eval/interview_eval.py:128-133"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "med", "reachability": "med", "trust_erosion": "high" },
    "l2_priority": "Out of the group-eval surface; verify on the About page and against a live scorecard run.",
    "suggested_acceptance": "Add the content-vs-delivery clause to the scorecard prompt and pin it with an eval probe, or withdraw the claim."
  },
  {
    "id": "LUC-GEF-L1-S1",
    "journey": "group-eval-fairness",
    "character": "lucie-dpo-compliance",
    "cert_level": "L1",
    "type": "strength",
    "severity": "polish",
    "dimension": "trust",
    "title": "The build names its own seams — the fairness panel refuses to claim what it did not test, and the posture block states its ceilings",
    "expected": "n-a",
    "got": "fairnessScopeNote (cs + en) states the check 'does not assess demographic or protected-class bias (the app holds no such data)'. The panel title is 'Weighting robustness', not 'Fairness'. RobustnessStatus distinguishes assessed / not_varied / unavailable / not_applicable / insufficient_sample, and the uniform-weights case reads 'Not tested' rather than a false pass (types.ts:26-52, FairnessPanel.tsx:58-69). ComplianceSection lists two explicit ceilings including 'the automated-rejection fairness gate is an archetype shield (career stage), not a protected-class test'. adverse-impact.ts:9-16 carries the same honesty in code. This is the single biggest reason Lucie engages with the product at all.",
    "evidence": [
      "app/features/sub_decisions/group-eval/types.ts:26-52",
      "app/features/sub_decisions/group-eval/FairnessPanel.tsx:58-69",
      "messages/en.json decisions.groupEval.fairnessScopeNote",
      "messages/en.json decisions.compliance.ceiling1",
      "messages/en.json decisions.compliance.ceiling2",
      "app/_lib/adverse-impact.ts:9-16"
    ],
    "code_check": "by-design",
    "verdict": "confirmed",
    "resolution": "by-design",
    "ceiling": "Honest disclosure is not mitigation. The ceilings named are the demographic ones; the articulacy confound (LUC-GEF-L1-03/04/05) is named nowhere.",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" }
  },
  {
    "id": "LUC-GEF-L1-S2",
    "journey": "group-eval-fairness",
    "character": "lucie-dpo-compliance",
    "cert_level": "L1",
    "type": "strength",
    "severity": "polish",
    "dimension": "completion",
    "title": "The human-in-the-loop on the automated reject path is structurally real, not advisory",
    "expected": "n-a",
    "got": "A non-dry-run screen-wave commit without an approval token throws (screen-wave.ts:260-265); the token signs (jobId, policyVersion, exact rejected id set) so the committed set cannot diverge from what the human previewed (:266-270); the approver's name is written into the rationale and the seal (:316, :367). automation-fairness.ts:47-64 re-asserts the invariant fail-closed at the TS apply boundary and downgrades an unfair reject to a hold. Governance modes are sticky server-side so a client state reset cannot silently downgrade a committee role and auto-seal a lead (group-eval-governance.ts:42-45). The lead is only sealed when knockout passes (group-eval-run.ts:461, :519).",
    "evidence": [
      "app/_lib/screen-wave.ts:260-270",
      "app/_lib/screen-wave.ts:316",
      "app/_lib/automation-fairness.ts:47-64",
      "app/_lib/group-eval-governance.ts:42-45",
      "app/_lib/group-eval-run.ts:461"
    ],
    "code_check": "by-design",
    "verdict": "confirmed",
    "resolution": "by-design",
    "ceiling": "The human approves a SET, not each individual — a batch rubber-stamp is possible; the token only forces re-approval when the set or policy changes. And in default 'recommendation' mode the group eval still seals a lead with actor 'auto:group-eval' and no human authorizer (group-eval-run.ts:519-535).",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" }
  }
]
```

## Headline question

> Is "we picked the best-presenting candidate rather than the best one" a compliance
> exposure here, and does the fairness machinery actually detect it?

**Yes, it is an exposure. No, nothing in the product detects it — and the scoring
tilts toward presentation by design, so the system can be provably robust and
substantively biased at the same time.**

**1. What the fairness checks actually measure.** There are three, and none is a bias
test in the discrimination sense.

- The panel in this journey, labelled `fairnessCheck` and rendered "Weighting
  robustness", varies **only the three dimension weights** — skills / career /
  personal — per candidate, bounded to ±0.15 with a 0.10 floor and 0.60 ceiling
  (`matching.py:637-639`), then re-scores everyone under everyone's scheme and ranks
  by the row mean (`matching.py:861-894`). It cannot change *what text is scored*,
  only how three already-computed numbers are combined. If articulacy inflated the
  `personal` and `skills` inputs, every scheme inherits that inflation and the matrix
  reports a stable, "robust" order. It is a sensitivity analysis, not a fairness test.
- The four-fifths rule (`adverse-impact.ts:148`) *is* a protected-attribute test, and
  a correct one — reference group, ≥30 floor, three-state verdict. But it runs on
  counts a recruiter pastes into a textarea, in the browser, stored nowhere
  (`ComplianceSection.tsx:169-257`).
- The gate on the automated-rejection path is an **archetype shield** — early-career
  or unknown archetype, plus a score floor (`automation-fairness.ts:47-64`). The code
  says so itself: "NOT a protected-class test" (`adverse-impact.ts:14-16`).

**2. So a protected-attribute-only check would pass cleanly — and here even that
isn't running automatically.** The system's posture is honest about the demographic
gap. It is silent about the articulacy gap.

**3. And the scoring rewards presentation, in three places.**
- `score_personal` counts the candidate's own tokens found in the ad and divides by a
  denominator derived from the **advert**, never from the candidate
  (`matching.py:534-535`). Listing more can only help. The in-code comment shows this
  was a deliberate change so that "a 5-keyword CV" no longer "tied a 50-keyword one".
- On the early-career path, 0.35 of the dimension is cosine similarity between the
  candidate's **free-text aspirations** and the job text (`matching.py:566-572`) — a
  student who writes fluently in the ad's register outscores one who writes plainly.
- Any skill a non-early-career candidate merely *states* is credited at
  `professional` provenance, weight 1.0 — the same as demonstrated experience
  (`transform.py:182`, `taxonomy.py:708-713`); the tier itself is inferred by Gemini
  from the CV's prose (`gemini.py:52-57`), and the weight proposer then shifts weight
  *toward* skills for high-trust provenance (`matching.py:686-713`). The discount for
  self-declaration falls only on early-career candidates.

Confirmed absent across `pipeline/` and `app/`: any handling of `fluenc`, `verbosit`,
`articul`, "native speaker", "language bias", "writing quality", "word count", or any
length normalization in `matching.py`. The Gemini prompt that emits the headline score
(`gemini.py:557-598`) contains **no** instruction to disregard writing quality, CV
length or source language. One asymmetry is worth naming on its own: the buzzword
authenticity check is English-word-list-only (`authenticity.py:25-31`), so a Czech CV
can never trip it.

There *is* genuine mitigation — it just targets a different axis. `redact.py` strips
name, contact, gendered terms and age; `matching_eval.py:186-239` ships pedigree,
socio-economic and language-neutrality probes; short skill names were un-penalized;
uncertainty widens the band rather than lowering the score. All real. None touches
articulacy. And the redaction is opt-in, default off, not persisted, and never
applied on the ranking path (LUC-GEF-L1-06) — while the candidate's *name* is sent
un-redacted to the LLM that tunes their weights (LUC-GEF-L1-07).

**4. Does the fairness result gate or alter anything? No — it is an advisory label.**
`FairnessPanel` is presentational. `onDecide` (the inline advance/reject) is wired
independently of `robustness` (`GroupEvalModal.tsx:131-141`). The four-fifths verdict
blocks nothing: a recruiter can read "adverse impact" and commit the rejection wave.
The one place a fairness signal genuinely *does* alter an outcome is the archetype
shield, which fails closed and downgrades an unfair auto-reject to a human hold — that
one is real, and it is career-stage-only.

**5. Does an adverse decision produce a rationale that names the real basis, and could
a candidate contest it?** The *operator* gets a good record: rank, percentile, score,
threshold, approver, hash-chained (`screen-wave.ts:312-327`, `:357-368`). The
*candidate* gets: "Not selected this time. The team has decided to move forward with
other candidates." No basis, no notice that AI participated in this decision, no
contact, no control (`StatusClient.tsx:159-170`). And the disclosure they accepted at
application tells them "You can ask for a human review at any point" — a right with no
implementation anywhere in the codebase. On a decision path where the internal
rationale is a *score below a threshold* whose largest movable component rewards how
well someone writes, the candidate is told nothing and given nowhere to go.

**Could Lucie defend this to a regulator?** Partly, and not the part that matters.

She could defend: the human-in-the-loop (the approval token is a real two-key gate),
the tamper-evident record, the disclosure's existence, the retention/erasure story,
the fail-closed archetype shield, and — unusually — the product's willingness to
write its own ceilings into the UI. That is more than most vendors bring.

She could not defend, on 2 August 2026: **a claim of fairness resting on a check that
measures ranking stability, in a system whose scoring rewards fluency and CV length,
with no probe that would ever surface it.** Under the AI Act a high-risk system needs
bias examination appropriate to the risk; a weighting sensitivity analysis is not
that, and "we collect no demographic data" explains why the statutory test can't run —
it does not discharge the duty to examine the proxies you *do* score on.

**Highest exposure, in her order:**
1. **The unshipped Art. 22(3) right** (LUC-GEF-L1-01) — a written promise to data
   subjects that the product does not keep. This is the one that is indefensible in a
   sentence, and the cheapest to fix.
2. **Uncontestable adverse decisions** (LUC-GEF-L1-02) — no basis reaches the
   candidate, so the right to obtain an explanation and contest is theoretical.
3. **Articulacy bias, undetectable and rewarded** (LUC-GEF-L1-03/04/05) — the
   substantive discrimination risk, invisible to every shipped check.
4. **Name to the weight-tuning LLM** (LUC-GEF-L1-07) — a one-line fix, and the worst
   sentence to have to read aloud in a hearing.

## Character feedback

*(Lucie, first person, cs)*

Musím začít pochvalou, protože ji tenhle produkt má, a od dodavatele ji slyším jednou
za pět let: **tahle aplikace přiznává, co neumí.** Panel se nejmenuje "Férovost", ale
"Robustnost vážení". Pod ním stojí věta, že *neposuzuje demografickou předpojatost ani
příslušnost k chráněné skupině, protože aplikace taková data nemá*. Když jsou váhy
jednotné, nenapíše "robustní" — napíše "netestováno" a vysvětlí, že přepočet byl
prázdná operace. V sekci Compliance jsou dva stropy vypsané červeně vedle pěti
zelených odrážek. To je přesně to chování, kvůli kterému dodavateli začnu věřit. Kdyby
mi to samé někdo prodával s nálepkou "AI-powered bias-free hiring", končíme na první
schůzce.

A přesně proto mě to, co následuje, štve dvojnásob.

**Ta férová kontrola neměří férovost.** Přečetla jsem si, co dělá: přehází tři váhy —
dovednosti, kariéra, osobnostní — v pásmu ±0,15 a přepočítá pořadí. To je citlivostní
analýza. Když už je vstupní číslo nafouknuté tím, že někdo umí psát životopis, nafoukne
se ve všech schématech stejně a matice mi hrdě oznámí, že pořadí je stabilní.
Prokazatelně robustní. A věcně vychýlené. To není kontrola, to je alibi — a co je
horší, je to alibi *ve tvaru důkazu*, který si někdo vytiskne a přinese mně.

**Co skutečně skóruje, je forma.** Ta část mě zvedla ze židle. Osobnostní dimenze počítá,
kolik kandidátových slov se trefí do inzerátu, a dělí to číslem odvozeným z *inzerátu*,
ne z kandidáta. Kdo napíše padesát dovedností, porazí toho, kdo napíše pět — a v kódu
je komentář, že to tak bylo uděláno **schválně**. U juniorů se 35 % dimenze počítá z
kosinové podobnosti jejich vlastního volného textu o aspiracích. Student, který umí
psát v registru inzerátu, porazí studenta, který napíše "chci dělat data". A u všech
neseniorních kandidátů se dovednost, kterou člověk *jen napsal*, započítá s plnou vahou
1,0 — stejně jako pět let praxe. Sleva za vlastní tvrzení dopadá jedině na juniory,
tedy na ty, kdo mají nejmenší schopnost o sobě napsat profesionální prózu.

Hledala jsem, jestli tohle někde někdo hlídá. Nehlídá. Ani jedno slovo o plynulosti,
délce textu, rodilém mluvčím nebo kvalitě psaní — v celém scoringu, ani v promptu, který
to skóre vyrábí. Zato tam je kontrola na buzzwordy, jejíž seznam je **jenom anglicky**,
takže český životopis ji nemůže spustit ani omylem.

**Anonymizace existuje a je udělaná dobře** — a je to zaškrtávátko, defaultně vypnuté,
na jiné obrazovce, neukládá se k analýze a do porovnání se vůbec nedostane. Takže v
jednom shortlistu můžu mít člověka skórovaného naslepo a vedle něj člověka skórovaného
s fotkou a jménem, a modal mi to nijak neřekne. Definice hotovo té cesty říká "každý
kandidát oskórován konzistentně". Tohle konzistentní není. A jméno kandidáta se
neanonymizovaně posílá modelu, který ladí jeho vlastní váhy. To je jedna řádka kódu, a
je to věta, kterou nechci číst nahlas před dozorem.

**Teď to, co mi vezme podpis.** Kandidát při přihlášce odsouhlasí sdělení, ve kterém
stojí, že *si kdykoli může vyžádat lidské posouzení*. Prošli jsme kód napříč — žádná
route, žádné tlačítko, žádný kontakt, žádný řetězec. My tomu člověku písemně slibujeme
právo podle čl. 22 odst. 3, které produkt nemá. A když ho odmítneme, uvidí: "Tentokrát
jste nebyl vybrán. Tým se rozhodl pokračovat s jinými kandidáty." Žádný důvod, žádná
zmínka, že v tom rozhodnutí byla AI, žádný kontakt. Přitom interně máme uložené
"spodních 30 % z 41 → pořadí 34 a shoda 38 < 40, schválil Novák". Máme přesnou větu.
Prostě ji tomu člověku neřekneme.

A do třetice, to nejlevnější: když odmítnu kandidáta přímo z porovnávacího okna — což
je nejrychlejší cesta v celém produktu, pět lidí vedle sebe — nezapíše se **žádný
důvod**. Ze stejného tlačítka v jiném modalu se důvod zapisuje. Zrovna tam, kde se
rozhoduje nejvíc lidí nejrychleji, se zapisuje nejmíň.

**Šetří mi to čas?** Ano, a nechci to zlehčovat. To, co jsem dřív rekonstruovala týdny —
kdo co rozhodl, kdy, na základě čeho — tady čtu z hašového řetězce a vyexportuju do
JSONu. Audit jedné role mi místo tří hodin zabere hodinu a čtvrt. Můj vlastní práh
zněl: *pokud musím ručně dohledávat, kdo co rozhodl, přidal ten nástroj riziko, ne
jistotu.* Tenhle práh produkt splnil. Neselhal na čase. Selhal na obsahu.

**Nasadila bych to?** Do pilotu s podepsaným seznamem nápravných opatření ano, do
produkce před 2. srpnem 2026 ne. **Podepsala bych to?** Ne. Ne proto, že by to bylo
špatně postavené — je to postavené líp než většina toho, co vidím — ale protože bych
podepisovala prohlášení o férovosti opřené o kontrolu, která férovost neměří, u systému,
který odměňuje výřečnost, a vůči lidem, kterým jsme slíbili právo, co neexistuje.

Doporučila bych to kolegyni z jiné banky? Řekla bych jí: *podívej se, jak ten produkt
píše o vlastních limitech, to se máme co učit.* A hned potom: *a než to pustíš k lidem,
zeptej se jich, čím vlastně měří tu férovost. Pak si sedni.*

---

### Verdict rationale (L1-fail)

The journey's definition of done requires that "Lucie sees a fairness view she trusts:
each candidate scored consistently". Both halves fail structurally, not frictionally:
scoring is not consistent across a shortlist (blind on/off is unrecorded and
unsurfaced, LUC-GEF-L1-06), and the fairness view cannot support the trust it is
placed in because no shipped check can detect the dominant bias channel
(LUC-GEF-L1-03). Her JTBD is certification; on this evidence she cannot certify. Two
findings are blocker-severity on her own scored criteria (Art. 22 disclosure/right,
contestability). The surface itself renders and the inspection completes, so this is
L2-eligible — but the majors and blockers carry forward.

**Time saved:** ~105 min per role audit (manual ~180 min → ~75 min), medium
confidence. The provenance-reconstruction half of her job is genuinely delivered; the
fairness-substance half is not, and the app cannot answer it at any speed.
