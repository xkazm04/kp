---
run: 2026-07-20-cases-scoring
character: lucie-dpo-compliance
journey: screening-decisions
cert_level: L1
verdict: L1-conditional
grounding: 4/10
time_saved_min: 135
time_saved_confidence: medium
language: cs
branch: vibeman/ambiguity-ui-wave1
source_state: read-only; uncommitted WIP present but confined to devcase/tenancy/i18n files — none on the screen-wave → decision-record chain
---

# L1 — Lucie Procházková (DPO) × Screening decisions

## Surface model

Built by following the actual import chain, affordance → handler → math → seal.

**Affordance layer**
- `app/features/sub_decisions/ScreenWaveModal.tsx:41` — the wave modal. Two sliders:
  `rejectBottomPercent` (`:328`) and `maxMatchToReject` (`:335`), plus an
  `autoRejectEnabled` checkbox (`:319`).
- Dry-run preview fires on open and on every slider change, debounced 350 ms
  (`ScreenWaveModal.tsx:106-141`), POSTing `dryRun: true`.
- Commit is a **separate, explicit** action behind a **second confirm modal**
  (`ScreenWaveModal.tsx:286` opens it, `:374-407` renders it, `:392` fires `commit`).
- Commit echoes the preview's `approvalToken` (`ScreenWaveModal.tsx:152`); a 409
  forces a fresh preview via `refreshNonce` (`:157-161`).
- Fairness copy: `shieldNote` (`ScreenWaveModal.tsx:339`).

**Boundary layer**
- `app/api/decisions/screen-wave/route.ts:18` — POST handler.
  - `requireOperator()` (`:19`) — operator-gated, rejects the anonymous demo session.
  - `currentWorkspace()` (`:25`) — tenant scoping.
  - `validateScreeningOverride(body.override)` (`:38`) → 400 on malformed/out-of-range.
  - `dryRun = body.dryRun === true` (`:43`) — defaults to commit.
  - **`body.approvedBy` is ignored**; the approver is bound server-side to
    `operatorApprover()` (`:59-65`). A caller cannot attribute the human review to
    an arbitrary name.
  - `ScreenWaveApprovalError` → **409** (`:71-73`).

**Decision math**
- `app/_lib/screen-wave.ts:141` `runScreenWave`.
  - Cohort = active + stage `Screened` for this job, this workspace (`:190`).
  - Unscored entries are **excluded from ranking entirely** and returned as explicit
    `unscored` keeps (`:214`, `:400-411`) — no fabricated 0 reaches a threshold or a seal.
  - Sort ascending by `matchScore`, worst first (`:215`).
  - `screenBottomCount(n, pct)` (`:223`) then `tieSafeBottomCount` (`:230`) shrinks the
    cutoff so an identical score is never split across it.
  - The reject predicate (`:255`):
    `autoRejectEnabled && rank < effectiveBottomCount && matchScore < effectiveFloor(cfg, roleFamily) && !isFairnessProtected(archetype)`.
  - `policyVersion = screen-wave/bottom<pct>/maxMatch<floor>[/fam:...]` (`:246`).
  - `approvalToken = screenWaveApprovalToken(jobId, policyVersion, [...wouldReject])` (`:259`).
  - **Commit fails closed**: no approval → throw (`:260-265`); token mismatch → throw
    (`:266-270`).
  - Optimistic CAS on commit (`:346`) — a stage change mid-wave is a no-op, not a
    phantom rejection.
  - Seal: `sealDecisionSafe({...})` (`:357-368`), `inputs: { ...reasonParams, approvedBy }`.
  - `dispatchRejection(updated, { automated: true })` (`:377`), isolated per candidate
    (`:376-384`).

**What the score actually is** (the load-bearing chain for the headline)
- `app/_lib/match-score.ts:44-89` documents **three independent producers**; decisions
  act on producer (B), `pipeline_entries.match_score`, backfilled from the Python
  `score_job(...).total`.
- `pipeline/jobfit/matching.py:813` `score_job` → `_weighted_total` (`:804`) of three
  dimensions, weights from `pipeline/jobfit/archetypes.json`:
  - `bau` (experienced): **skills 0.50 · career 0.35 · personal 0.15**
  - `student` / `career_switcher`: skills 0.40/0.35 · career 0.40 · personal 0.20/0.25
- `score_skills` (`matching.py:405-452`) — for each JD requirement, the best
  `skill_match_score(candidate_skill, req.skill, provenance)` over the candidate's
  extracted skill strings, weighted must-have 1.0 / nice 0.4.
  `taxonomy.py:860` resolves both **surface forms** through a taxonomy; when a surface
  is unmodelled it falls back to a **capped Jaccard over distinctive tokens**
  (`taxonomy.py:775-793`, cap 0.3), then discounts by `provenance_weight`.
- `score_career` (`matching.py:455-460`) — role-family equality + seniority proximity.
  Structural, not textual.
- `score_personal` (`matching.py:496-546`) — `0.5 * language_coverage + 0.5 * overlap`,
  where `overlap` is **whole-word keyword hits of the candidate's traits+skills against
  the job-description text**, saturating at the ad's must-have count
  (`matching.py:531-537`). With `--embeddings` it becomes an embedding cosine
  (`:512-515`).

**Record layer**
- `app/_lib/decision-record-store.ts:197` `sealDecisionRecord` — per-tenant HMAC hash
  chain. `recordPayload` (`:164-175`) is the hashed content: kind, actor, policyVersion,
  candidateRef, rationale, reasonCode, inputs, createdAt.
- Keyed with `KP_DECISION_HMAC_KEY` (`:99-104`), key id per row, rotation-safe
  (`:110-115`), refuses a keyless downgrade append onto a keyed chain (`:239-243`),
  and `verifyDecisionChain` (`:348`) rejects a keyless row after any keyed row (`:368`).
- `app/api/decisions/records/route.ts:37` — operator-gated read + chain verdict, 20 s TTL cache.
- `app/features/sub_analytics/DecisionRecordsPanel.tsx:30` — the auditor's view: verify
  badge (`:112-122`), per-record row (`:131-160`), `Export dossier` JSON (`:59-69`).
  Rendered at `app/features/sub_analytics/AnalyticsTab.tsx:355`.
- `app/api/decisions/reconsider/route.ts:19` — the auto-rejected cohort projected back
  with the sealed reason read out of the record (`:47-59`).

**Disclosure layer**
- `app/_components/AiDisclosure.tsx:25` — jurisdiction-aware, on `/apply/[id]`
  (`ConversationalApply.tsx:618`), `/apply/[id]/quick` (`QuickApplyForm.tsx:147`),
  devcase/interview/offer/schedule. `showDataConsent` adds the retention sentence.
- `app/api/compliance/route.ts:15` — public regime + effective retention window.
- `app/features/sub_decisions/ComplianceSection.tsx:24` — the recruiter-side posture
  block + a four-fifths adverse-impact calculator that runs **in the browser on counts
  the recruiter pastes** (`:21-22`, `:168-175`).

## Grounding audit

Sources the reject decision *and its sealed record* ought to carry, vs. what actually
reaches them:

| # | Real-context source | Reaches the math? | Reaches the sealed record? |
|---|---|---|---|
| 1 | Real JD requirements (must/nice) | yes — `matching.py:405-452` | via `threshold`/`policyVersion` only |
| 2 | Candidate's extracted skills + provenance discount | yes — `taxonomy.py:860-900` | no |
| 3 | Archetype (fairness class) | yes — `screen-wave.ts:255` | no |
| 4 | Per-family floor policy | yes — `effectiveFloor`, `screen-wave.ts:307` | yes — `policyVersion` `screen-wave.ts:362` |
| 5 | Score **provenance** (analysis vs snapshot, when, which analysis) | resolved at `screen-wave.ts:201` | **no** — dropped |
| 6 | Score **staleness** vs the JD's last edit | computed `screen-wave.ts:204-205`, shown `:332`,`:387` | **no** — dropped |
| 7 | Scorer identity/version (weights vector, taxonomy revision, model) | implicit | **no** — nowhere |
| 8 | Named human reviewer | `operatorApprover()` `screen-wave.ts:272` | partial — an env-constant string |
| 9 | Adverse-impact of the actual reject set | no | no |
| 10 | Non-CV evidence (interview, live case, recruiter notes, prior history) | no | no |

**Grounding: 4/10** (1, 2, 3, 4 reach the decision; 8 half-credits; 5, 6, 7, 9, 10 absent
from the record). The machinery is careful; the *record* is fed a fraction of what the
decision actually saw.

## Reachability

Resolved before judging.

- Lucie is an internal user. `app/features/tabs.ts:105` (`decisions`) and `:139`
  (`analytics`) are in the nav with **no per-role gating** — both her surfaces are
  reachable once the dev gate is seeded (`env.md` §Auth).
- `DecisionRecordsPanel` renders unconditionally inside `AnalyticsTab.tsx:355` — **reachable**.
- `ScreenWaveModal` lives in the Decisions tab — **reachable** (she reviews, does not author).
- `AiDisclosure` sits on `/apply/[id]` and `/apply/[id]/quick`, which are **tokenized
  candidate surfaces**. Per `env.md` open question #3 the local mint path is unresolved,
  so Lucie can read the disclosure component's code and copy but cannot open it live.
  Findings touching it are **L1-only, `l2_priority` deferred**, not scored as unreachable
  — the copy itself is the artifact she audits, and it is fully visible in code.
- **Fixture dependency:** every records finding needs a committed wave in the seeded
  cohort. Absent that, `DecisionRecordsPanel` shows `t("empty")`
  (`DecisionRecordsPanel.tsx:125`) and L2 proves nothing.
- All findings below are within her reachable set. None tagged `unreachable`.

## Findings

```json
[
  {
    "id": "CS-L1-001",
    "journey": "screening-decisions",
    "character": "lucie-dpo-compliance",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "dimension": "trust",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "title": "The sealed record asserts a score but not where the score came from, when, or under which scorer",
    "expected": "The immutable record names the provenance of the decisive number: source (saved CV analysis vs. add-to-pipeline snapshot), the timestamp it was computed, the analysis slug, and the version of the scoring model/weights that produced it.",
    "got": "inputs are exactly { pct, n, count, rank, score, threshold, tieAdjusted, approvedBy }. The wave already RESOLVES provenance one screen earlier (withCanonicalScores) and throws it away before sealing. policyVersion carries the reject POLICY, never the SCORING policy.",
    "evidence": [
      "app/_lib/screen-wave.ts:357-368",
      "app/_lib/screen-wave.ts:201-203",
      "app/_lib/match-score.ts:44-89",
      "app/_lib/match-score.ts:100-104"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Export a dossier for a committed wave and confirm no field identifies the score's source, date, or scorer version.",
    "suggested_acceptance": "Seal scoreProvenance ({source, at, slug}) and a scorerVersion (weights vector id + taxonomy revision) into inputs."
  },
  {
    "id": "CS-L1-002",
    "journey": "screening-decisions",
    "character": "lucie-dpo-compliance",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "dimension": "trust",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "title": "Score staleness is computed and shown to the recruiter but never sealed into the record",
    "expected": "If a candidate was ranked on a score measured against JD text that has since been edited, the immutable record says so — that is the single most damaging fact a regulator could surface that the record does not contain.",
    "got": "The wave derives stale/staleSince per candidate and renders a chip in the preview and the committed view; sealDecisionSafe's inputs omit both. The reviewer saw the warning; the record does not remember it.",
    "evidence": [
      "app/_lib/screen-wave.ts:204-205",
      "app/_lib/screen-wave.ts:332",
      "app/_lib/screen-wave.ts:387",
      "app/_lib/screen-wave.ts:357-368",
      "app/features/sub_decisions/ScreenWaveModal.tsx:60-68"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Edit a JD after scoring, run a wave, commit, and confirm the exported record carries no staleness marker while the UI showed one.",
    "suggested_acceptance": "Add stale/staleSince to the sealed inputs."
  },
  {
    "id": "CS-L1-003",
    "journey": "screening-decisions",
    "character": "lucie-dpo-compliance",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "dimension": "trust",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "title": "The Art. 22 human reviewer defaults to an env-constant that names nobody",
    "expected": "Every adverse automated decision names the natural person who reviewed and approved it.",
    "got": "operatorApprover() returns KP_OPERATOR_NAME or the literal 'operator (single-operator deployment)'. Unless that env var is set, every sealed rejection in the chain is approved by an identical, person-less string. The code is admirably honest about this in its own comment — but honesty about a gap is not a named reviewer.",
    "evidence": [
      "app/_lib/auth/operator-approver.ts:11-13",
      "app/_lib/screen-wave.ts:272",
      "app/_lib/screen-wave.ts:316",
      "app/_lib/screen-wave.ts:367",
      "app/api/decisions/screen-wave/route.ts:59-65"
    ],
    "code_check": "by-design",
    "verdict": "confirmed",
    "resolution": "open",
    "ceiling": "Even with KP_OPERATOR_NAME set, the name is a deploy-wide constant, not a per-session authenticated identity — two different reviewers on the same deployment seal identically.",
    "l2_priority": "Check the local env: if KP_OPERATOR_NAME is unset, every committed record's approvedBy is the placeholder.",
    "suggested_acceptance": "Derive the approver from the authenticated session once per-user identity exists; until then, refuse to commit a wave when KP_OPERATOR_NAME is unset."
  },
  {
    "id": "CS-L1-004",
    "journey": "screening-decisions",
    "character": "lucie-dpo-compliance",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "dimension": "clarity",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "title": "The Czech auditor's on-screen record silently drops the human sign-off",
    "expected": "The most legally load-bearing field — who approved this — is visible in the record view the auditor actually reads.",
    "got": "The sealed English rationale ends '· approved by <X>'. DecisionRecordsPanel replaces it wholesale with the localized reasons.rejectDid string, whose ICU message has no approver placeholder. A Czech DPO reading the panel sees the mechanism and never the human. approvedBy survives only inside payloadJson, i.e. only in the exported dossier.",
    "evidence": [
      "app/features/sub_analytics/DecisionRecordsPanel.tsx:45-57",
      "app/features/sub_analytics/DecisionRecordsPanel.tsx:136",
      "app/_lib/screen-wave.ts:316",
      "messages/cs.json decisions.wave.reasons.rejectDid"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Open the panel in cs and confirm no approver appears on a committed auto_rejected row.",
    "suggested_acceptance": "Append an approvedBy line to the row, or add the placeholder to reasons.rejectDid."
  },
  {
    "id": "CS-L1-005",
    "journey": "screening-decisions",
    "character": "lucie-dpo-compliance",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "dimension": "clarity",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "title": "policyVersion is sealed and exported but never rendered in the record row",
    "expected": "The auditor sees which policy version produced each decision without leaving the screen.",
    "got": "The row shows kind, actor, rationale, seq, candidateRef, timestamp, truncated hash. policyVersion is in the payload and the export, not on screen.",
    "evidence": [
      "app/features/sub_analytics/DecisionRecordsPanel.tsx:131-160",
      "app/features/sub_analytics/DecisionRecordsPanel.tsx:64-68",
      "app/_lib/screen-wave.ts:362"
    ],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Confirm the rendered row lacks the policy version.",
    "suggested_acceptance": "Add policyVersion to the metadata line beside the hash."
  },
  {
    "id": "CS-L1-006",
    "journey": "screening-decisions",
    "character": "lucie-dpo-compliance",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "dimension": "trust",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "title": "Fairness shielding is server-side and fail-closed, but corrects only for declared archetypes — never for the articulacy bias the score itself carries",
    "expected": "A high-risk ranking system monitors the adverse impact of its ACTUAL reject sets and corrects for known bias in the ranking signal.",
    "got": "isFairnessProtected shields early-career + any unclassifiable archetype, enforced at the decision point in the server (good, and it fails closed). Nothing anywhere examines whether the reject set skews by anything else, and the only adverse-impact tool in the product is a four-fifths calculator that runs in the browser on counts the recruiter types by hand and stores nothing — it is never fed the wave's reject set.",
    "evidence": [
      "app/_lib/screen-wave.ts:255",
      "app/_lib/archetypes.ts:78-80",
      "app/features/sub_decisions/ComplianceSection.tsx:21-22",
      "app/features/sub_decisions/ComplianceSection.tsx:168-175"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Confirm the four-fifths panel has no path to import a wave's reject cohort.",
    "suggested_acceptance": "Feed the committed wave's reject/keep counts into the adverse-impact primitive automatically, and seal the resulting verdict alongside the wave."
  },
  {
    "id": "CS-L1-007",
    "journey": "screening-decisions",
    "character": "lucie-dpo-compliance",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "dimension": "trust",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "title": "The rejected candidate is told a narrative; the honest mechanism stays internal",
    "expected": "An adverse decision produced with automated assistance tells the subject that automation was involved, gives meaningful information about the logic, and points at the route to human review.",
    "got": "The record is mechanistically honest; the EMAIL is not. The template says 'after careful consideration we will not proceed' and 'the decision was based on how the profile matches this role's specific needs right now, not on an assessment of your abilities.' No mention of automation, no logic, no Art. 22 pointer. dispatchRejection receives automated:true and uses it ONLY to label the internal audit event — it changes nothing the candidate reads.",
    "evidence": [
      "app/_lib/comms-dispatch.ts:253-263",
      "app/_lib/comms-dispatch.ts:257-261",
      "messages/cs.json comms.rejection.opening",
      "messages/cs.json comms.rejection.standard"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "scope_note": "The journey routes rejection comms to comms scope; recorded here because it is the direct candidate-facing consequence of this wave and sits squarely inside Lucie's scored disclosure criterion.",
    "l2_priority": "Commit a wave and read the queued rejection in the Outbox for any automation disclosure.",
    "suggested_acceptance": "Branch the template on opts.automated: add an automated-assistance sentence, a one-line logic summary, and the human-review request route."
  },
  {
    "id": "CS-L1-008",
    "journey": "screening-decisions",
    "character": "lucie-dpo-compliance",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "dimension": "senior-quality",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "title": "The disclosure claims assessment of skills, experience and suitability; a measurable slice of the score is keyword overlap with the ad text",
    "expected": "The public description of what the AI assesses matches what the code computes.",
    "got": "AiDisclosure tells candidates 'we assess your skills, experience and suitability for the role.' For an experienced (bau) candidate the total is 50% skills + 35% career + 15% personal, where `personal` is half language coverage and half a count of the candidate's own trait/skill WORDS appearing verbatim in the job ad, saturating at the ad's must-have count. The skills term is itself surface-form matching over taxonomy terms with a capped token-Jaccard fallback for anything unmodelled. Only `career` (role family + seniority proximity) is independent of how the candidate phrased themselves.",
    "evidence": [
      "app/_components/AiDisclosure.tsx:61-68",
      "messages/cs.json aiDisclosure.body",
      "pipeline/jobfit/matching.py:496-546",
      "pipeline/jobfit/matching.py:531-537",
      "pipeline/jobfit/matching.py:804-830",
      "pipeline/jobfit/taxonomy.py:775-793",
      "pipeline/jobfit/archetypes.json"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Score two candidates with identical structured experience but different CV phrasing and measure the delta in the total.",
    "suggested_acceptance": "Either narrow the disclosure copy to what is measured, or exclude the description-overlap term from any AUTO-REJECT threshold while keeping it for ranking hints."
  },
  {
    "id": "CS-L1-009",
    "journey": "screening-decisions",
    "character": "lucie-dpo-compliance",
    "cert_level": "L1",
    "type": "broken-flow",
    "severity": "minor",
    "dimension": "trust",
    "impact": { "frequency": "low", "reachability": "low", "trust_erosion": "med" },
    "title": "The rejection_sent audit event is written unscoped and lands on the default tenant",
    "expected": "Every audit event for an adverse action lands on the acting team's audit trail.",
    "got": "The whole wave threads workspaceId meticulously; dispatchRejection's closing recordAutomationEvent omits it, so it falls to DEFAULT_WORKSPACE_ID. For a non-default team the entry lookup misses and the event is recorded with null label/jobTitle on the wrong workspace.",
    "evidence": [
      "app/_lib/comms-dispatch.ts:263",
      "app/_lib/db/pipeline.ts:1510-1518",
      "app/_lib/screen-wave.ts:383"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Only observable with a second workspace fixture; single-operator deploys will not hit it.",
    "suggested_acceptance": "Thread the workspace through dispatchRejection."
  },
  {
    "id": "CS-L1-S1",
    "journey": "screening-decisions",
    "character": "lucie-dpo-compliance",
    "cert_level": "L1",
    "type": "strength",
    "severity": "polish",
    "dimension": "trust",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "title": "STRENGTH — the reason code is mechanistically honest, not a euphemism",
    "got": "The sealed rationale and both localized strings state the actual mechanism: 'bottom {pct}% of {n} -> {count} (rank {rank}) and match {score} < threshold {threshold}', plus an explicit note when the cutoff was tie-adjusted. There is no 'insufficient match to requirements' anywhere in the record path.",
    "evidence": [
      "app/_lib/screen-wave.ts:312",
      "app/_lib/screen-wave.ts:319-327",
      "messages/cs.json decisions.wave.reasons.rejectDid",
      "app/_lib/screen-wave.ts:63-72"
    ],
    "code_check": "n-a",
    "verdict": "confirmed",
    "resolution": "by-design",
    "ceiling": "It names the RANKING mechanism honestly; it does not name what the score itself measures (see CS-L1-008)."
  },
  {
    "id": "CS-L1-S2",
    "journey": "screening-decisions",
    "character": "lucie-dpo-compliance",
    "cert_level": "L1",
    "type": "strength",
    "severity": "polish",
    "dimension": "completion",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "title": "STRENGTH — the human-in-the-loop gate is server-enforced and fails closed in four independent ways",
    "got": "A commit with no approval token throws; a stale token throws; both surface as 409 and force a re-preview. The approver cannot be asserted by the client. The dry run mutates nothing, writes no audit event and queues no email. Unscored candidates are excluded from ranking rather than coerced to 0. Unknown archetypes are shielded. The chain is HMAC-keyed with rotation support and refuses a keyless downgrade append.",
    "evidence": [
      "app/_lib/screen-wave.ts:260-271",
      "app/api/decisions/screen-wave/route.ts:59-65",
      "app/api/decisions/screen-wave/route.ts:71-73",
      "app/_lib/screen-wave.ts:214",
      "app/_lib/archetypes.ts:78-80",
      "app/_lib/decision-record-store.ts:239-243",
      "app/_lib/decision-record-store.ts:364-377"
    ],
    "code_check": "n-a",
    "verdict": "confirmed",
    "resolution": "by-design",
    "ceiling": "The gate proves A human clicked approve on THIS exact set. It cannot prove the review was meaningful — one click approves the whole batch, and the approver is a deploy-wide constant (CS-L1-003)."
  }
]
```

## Headline question

**Is the wave an automated articulacy filter wearing the clothes of a competence filter — and does the record admit it?**

**Partly yes on the mechanism; and no, the record does not admit it — though not in the way the question anticipates.**

**1. What the reject math consumes.** The predicate at `screen-wave.ts:255` is
`autoRejectEnabled && rank < effectiveBottomCount && matchScore < effectiveFloor(...) && !isFairnessProtected(archetype)`.
Everything hinges on `matchScore`, a single 0–100 scalar. Following it to
`matching.py:813` → `_weighted_total` → `archetypes.json`, for an experienced candidate
it is **skills 0.50 · career 0.35 · personal 0.15**:

- **`personal` (15%) is a pure presentation signal.** `matching.py:531-537` counts how
  many of the candidate's own trait/skill *words* appear verbatim as whole words in the
  job-description text, divided by a saturation denominator. A candidate who mirrors the
  ad's vocabulary scores; an identically-qualified candidate who describes the same work
  in their own words does not. The other half of `personal` is language coverage.
- **`skills` (50%) is surface-form matching, not competence assessment.**
  `taxonomy.py:860` resolves both strings through a taxonomy — genuinely better than
  keyword equality — but where the taxonomy has no opinion it degrades to a **capped
  token Jaccard** (`taxonomy.py:775-793`), and throughout it is scoring *what the CV
  named*, discounted by provenance. It has no access to whether the person can do the
  thing.
- **`career` (35%) is the only articulacy-independent term** — role-family equality and
  seniority proximity, structural facts.

So the honest characterisation: this is a **CV-lexicon matching filter with a genuine
structural component**, and roughly 15% of an experienced candidate's headline is
literally keyword overlap with the ad text. It is not purely an articulacy filter. It is
also not a competence filter. Calling it "match" is doing a lot of work.

**2. Does the record name the real basis?** On this narrow point the build is **better
than the question presumes, and deserves credit.** There is no euphemism. The sealed
rationale (`screen-wave.ts:312`) and both localized renderings state:
*"Auto-rejected · bottom 30% of 41 → 12 (rank 4) and match 38 < 45 threshold."* The
closed reason-code set (`screen-wave.ts:63-72`) contains no soft codes at all — no
"insufficient match to requirements". The record says *bottom-N-by-score*, which is
exactly what happened. That is the single most defensible thing in this journey, and the
one I would protect against any future "let's soften the wording" ticket.

**3. Where it fails anyway.** The record names the *ranking mechanism* honestly and then
stops. It does not name **what the score measures** (CS-L1-008), nor **where that score
came from or when** (CS-L1-001) — provenance is resolved one function call earlier at
`screen-wave.ts:201` and discarded before the seal — nor **that the score may predate an
edit to the very JD it was scored against** (CS-L1-002), a warning the reviewer was
shown and the record forgot. The euphemism is not in the record; it is in the
**disclosure the candidate reads**, which promises assessment of "your skills, experience
and suitability" (`aiDisclosure.body`) and in the **rejection email**, which says only
"after careful consideration" with no hint that automation ranked them (CS-L1-007).

**4. Provenance / policy / actor / sign-off.** Policy version: sealed and exported, but
not rendered in the panel (CS-L1-005). Actor: `auto:screen-wave` — accurate. Human
sign-off: enforced server-side and fail-closed, which is genuinely rare and good — but
the approver resolves to a deploy-wide constant unless `KP_OPERATOR_NAME` is set
(CS-L1-003), and the Czech panel drops it from view entirely (CS-L1-004). Score
provenance: absent.

**5. Fairness shielding.** Enforced **server-side** at the decision point, not in UI copy
— confirmed at `screen-wave.ts:255`, fail-closed for unknown archetypes at
`archetypes.ts:78-80`. It corrects **only for declared archetypes**. Nothing in the
system corrects for, or even measures, articulacy bias, and the four-fifths tool is a
manual paste-in calculator that never sees a real reject set (CS-L1-006).

**Could Lucie hand this record to a regulator?** She could hand over a *hash-chained,
tamper-evident, human-approved, mechanistically-worded* record — which puts it ahead of
most of what she has audited. It would fail on four questions:

1. *"What does this score measure?"* — nothing in the record answers it, and the
   candidate-facing copy answers it wrongly.
2. *"When was it measured, against which version of the job description, by which model?"*
   — unanswerable from the record.
3. *"Who is the natural person who reviewed this?"* — `operator (single-operator deployment)`.
4. *"Show me the adverse-impact analysis of this reject cohort."* — does not exist.

That is a **conditional pass, not a certifiable one**. The skeleton a regulator wants is
built and load-bearing; the flesh — provenance, scorer identity, a named human, a bias
audit — is missing.

## Character feedback

*(in Lucie's voice)*

I came to this expecting the usual: a beautiful funnel, and a shrug when I ask who signed
off. I did not get that, and I want to say so plainly before I list what is wrong.

Someone here has actually read Article 22. The commit cannot happen without a token from
a preview a human looked at; if the cohort shifted underneath, the server refuses with a
409 and makes them look again. The name of the approver cannot be supplied by the client
— the handler ignores `body.approvedBy` and derives it server-side. The dry run truly
writes nothing. The chain is HMAC-keyed, rotates properly, and refuses to let someone
quietly append an unkeyed row to dodge the MAC. A candidate with no score is not coerced
to zero and swept out; an archetype the system cannot classify is *shielded*, not
gambled on. These are not the decisions of a vendor performing compliance. Someone
thought about the failure mode where a person gets hurt.

And the reason text. I braced for "insufficient match to requirements" — the sentence I
have watched three vendors hide a percentile behind. Instead it says: bottom 30% of 41,
rank 4, match 38 below threshold 45. In Czech. With a note when the cutoff moved to avoid
splitting a tie. I would defend that sentence in a hearing. Do not let anyone soften it.

Now. The record tells me *how the ranking worked* and then goes quiet on everything that
would let me verify it. It tells me the score was 38. It does not tell me where 38 came
from — a saved CV analysis or a snapshot stamped whenever someone dropped them on the
board — even though the code works that out one line before it seals. It does not tell me
when 38 was computed, or which version of the scoring produced it. And this is the one
that made me put my pen down: the screen *warns the recruiter* that a score predates an
edit to the job description, with a little amber chip, and then the permanent record
forgets that entirely. So the reviewer saw a red flag, approved anyway, and the artifact I
would hand a supervisor contains no trace that the flag was ever raised. That is worse
than not computing it. Capture it or stop showing it.

Then I followed the score into the Python, and I stopped being comfortable. Fifteen
percent of an experienced candidate's number is a count of their own words appearing in
the advertisement. Half of the remainder is string matching over what the CV happened to
call things. Meanwhile the notice we show the candidate says we assess "your skills, your
experience and your suitability for the role." We do not. We assess how their vocabulary
overlaps with ours, plus whether their role family and seniority line up. I am not saying
the number is worthless — the family and seniority term is real, and the taxonomy work is
serious. I am saying that a bank telling a rejected applicant we assessed their
suitability, when the mechanism rewards writing the ad back at us, is a sentence I cannot
sign. Narrow the claim or narrow the mechanism. Preferably: keep the overlap term for
ranking hints and take it out of anything that fires an automatic rejection.

Two more. My name. `operator (single-operator deployment)` is not a person, and the code
comment says so out loud, which I respect and which does not help me — I need a natural
person in that field or I have a solely-automated decision with a decorative human
attached. Refuse the commit if the name is unset; make it impossible to run this without
someone owning it. And when I open the panel in Czech, the approver is not even displayed
— the localized rationale replaces the English string that carried it, so the one field I
came for is only in the JSON export.

The fairness gate protects early-career and anyone unclassifiable, server-side,
fail-closed. Good. It protects nobody from the articulacy problem, and the four-fifths
calculator — which is a perfectly decent primitive — sits there waiting for me to *type
counts into a textarea by hand*. It has never seen a real reject cohort. Wire it to the
wave and seal its verdict next to the decisions, and you would have something I could
genuinely put in front of the regulator before August.

And the email. Everything careful the record does, the email undoes: "after careful
consideration," "not an assessment of your abilities." The dispatch function is *told* the
rejection was automated and uses that fact only to label an internal log line. The person
who was ranked by a machine and cut at rank 4 is told a human thought about them. That is
the gap between the record and the story, and it is the gap that ends up in a newspaper.

**Would I adopt it?** For an internal pilot with a named operator, provenance sealed, and
the email fixed — yes, and I would say so in writing. Today, no: I would not certify it
for a real screening wave on Česká spořitelna candidates.

**Time.** Auditing one role's screening wave the old way — interviewing the recruiter,
reading the rules, sampling files, reconstructing what the threshold was that week — is
most of a working day, call it three hours. Here I open a panel, see a verify badge, and
export the whole chain in one click; then I still spend the better part of an hour
reconstructing score provenance, chasing which model produced what, and running the
adverse-impact numbers by hand. Roughly **135 minutes saved per wave, medium confidence**.
Close the provenance gap and it becomes twenty minutes of reading, which is the tool I was
promised.

**Would I tell a peer?** Yes — with the sentence I'd actually use: *"the decision record
is the best I've seen from a vendor and it still can't tell you what the number means."*
