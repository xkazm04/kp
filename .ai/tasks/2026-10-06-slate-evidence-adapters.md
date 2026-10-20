---
kind: task
status: done
opened: 2026-10-06
charter: accepted-idea-delivery
branch: autopilot/accepted-idea-delivery-81b2e5af
gate: npm run test:unit -- app/_lib/slate-evidence.test.ts app/_lib/db/role-slate.test.ts app/_lib/role-rubric.test.ts app/_lib/role-rubric-evaluate.test.ts
measurable: perf:budget findings. Before 63, after 63 (the module has no importer).
---

# Slate evidence adapters (idea 245c6aff)

Reconciled first: `CandidateEvidence` had no producer outside `role-rubric.ts` and
`db/role-slate.ts`, so every slate member evaluated as null. Built to main's shape
(`{population, axes: {key: {score, evidenceRef}}}`), not the idea's `{covered, source}`.

## What shipped

`app/_lib/slate-evidence.ts`, pure, imported by nothing:

- `humanEvidence(axes, analysis, ref)` — `jobFit.matchingSkills` scores 1,
  `missingSkills` scores 0.
- `agentEvidence(axes, fit, ref)` — `fit.coverage[]` on agentfit.py's scale
  (automatable 1, assisted 0.5, human_only 0); `fit` is `unknown` and narrowed
  defensively.
- Keys use deriveRoleRubric's normalisation (`req:` + collapsed, lower-cased).
  Only `requirement_coverage` axes are filled; an unnamed axis is unassessed.

## Decisions

- A skill named in both matching and missing is contradictory: left unassessed.
- Coverage words are matched exactly (case-sensitive), as the producer emits them.

## Not done

No route calls either function; computing and persisting evidence is the next increment.
