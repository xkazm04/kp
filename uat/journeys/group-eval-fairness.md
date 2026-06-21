---
name: group-eval-fairness
promotion: discovery
surfaces: [Decisions tab, "Group Evaluation & Fairness"]
characters: [tomas-hiring-manager, lucie-dpo-compliance]
language: cs
---

# Skupinové porovnání shortlistu a férový výběr

## Goal (in the user's words)
"Mám pár finalistů na jednu roli. Chci je vedle sebe, s jasným zdůvodněním koho a proč —
abych se rozhodl do patnácti minut. A Lucie chce vidět, že to bylo férové."

## Definition of done (user POV)
- A side-by-side comparison of one role's shortlist: per-candidate verdict, score
  breakdown, differentiators, risks, and a recommended lead.
- Tomáš can make a defensible pick **in under 15 minutes** — the reasoning is concrete
  enough to choose on, not a wall of generic praise.
- Lucie sees a **fairness view** she trusts: each candidate scored consistently, the
  recommended lead actually passes the role's must-haves (knockout).

## Entry state / preconditions
- Dev gate on → workspace at `/`, Decisions tab → group eval.
- A role with ≥2 (ideally 3–6) pending candidates, each with a profile and/or saved
  CV analysis, plus the role's job record (for the full breakdown + salary band).

## What L1 must check (structural, code-grounded)
- **Surface model:** `app/features/sub_decisions/GroupEvalModal.tsx` + the
  `group-eval/` parts — `ComparisonTable.tsx`, `AiVerdict.tsx`, `Risks.tsx`,
  `FairnessPanel.tsx`, `PerCandidateTabs.tsx`. Reachable for both (no role gating).
  Eval is GENERATED via a background task (`group_eval` → `runGroupEval`); the route
  `/api/decisions/group-eval/route.ts` only **reads** the saved eval.
- **Grounding audit (central):** `app/_lib/group-eval-run.ts:239` (`runGroupEval`).
  Per candidate it pulls the gathered profile, the **full deterministic recruiter
  breakdown** (`rankCandidates`, `group-eval-run.ts:156` — per-dimension scores,
  confidence, matched/missing with provenance, fit tier), the candidate's **own salary
  expectation** from their CV analysis (`salaryExpectationFrom`, line 135), and a cached
  AI reasoning per candidate (`runReasoning`, line 299). Confirm the AI "compare all"
  narrative is fed the REAL per-candidate dims + the role salary band
  (`runGroupCompare` context, line 191) — not labels alone.
- **Fairness (Lucie):** `group-eval-run.ts:168` opts into the LLM weight proposer +
  embeddings for a **cross-scheme fairness matrix** (each candidate re-scored under every
  candidate's weighting); confirm it fails open to deterministic, not silently off.
- **Knockout integrity:** the ko-aware sort (line 351) guarantees a must-have-failing
  candidate can't be crowned lead; the lead is sealed to the decision record only when
  ko passes (line 402). Verify the modal shows "top N of M" so a capped (6) field
  doesn't read as full coverage.

## What L2 must confirm (live-only)
- l2_priority: generate a real eval and assert the **comparison cells differ per
  candidate** and the recommended lead's rationale is **specific** (differentiators are
  requirement skills the lead matched that rivals missed, `computeDifferentiators`).
  Generic/identical verdicts = senior-quality `quality-gap`.
- Tomáš's clock: can he actually decide in <15 min? Friction/illegibility = `effort`/`time-saved` finding.
- Lucie's lens: does the fairness panel render with a real cross-scheme matrix, and is
  the AI/deterministic **source disclosed**? A non-disclosed AI verdict acting on a
  candidate is a **trust** finding.
- Latency: per-candidate reasoning runs CONCURRENTLY up to the cap (line 295) but cold
  spawns are slow — budget **30–130s** for the first generation; cached re-open is fast.

## Out of scope / known
- Configuring/running the auto-reject screen-wave → `screening-decisions.md`.
- Advancing the chosen lead to interview/offer → `pipeline-advance.md`.
- Keyless: reasoning + compare degrade to deterministic; tag `scope_note`, judge structure.
