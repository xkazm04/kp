# Ambiguity+Business — Fairness Wave 1: regulated-hiring correctness

> 4 commits, 4 High findings closed. The highest-stakes cluster: scoring/decision correctness that affects who gets hired.
> Baseline preserved: tsc 0 · JS unit 1033 · Python 694 → 695 · i18n 2883 (en/cs parity). 0 regressions.

## Commits

| # | Commit | Finding | Files |
|---|---|---|---|
| 1 | `caff14a` | early-career fairness contract unenforced (UI-delegated) | recruiter.py, test_recruiter.py |
| 2 | `9503094` | auto-approve gate blind to design provenance | devcase-orchestrator.ts |
| 3 | `c8c5de8` | job-fit blind to a closed 10-skill taxonomy | github-analysis/route.ts, schemas.ts, GithubAnalysisPanel.tsx |
| 4 | `0f8160d` | CONSENT_TTL_DAYS a global jurisdiction-blind magic constant | consent.ts |

## What was fixed

1. **Early-career fairness contract (now structural).** `rank_candidates_for_job` promised early-career candidates are "shown as their own pipeline, never ranked on one number against experienced candidates" — but returned one flat list sorted by `total`, with the fairness behavior living only in a comment ("the UI splits by archetype"). A senior (career = work-history fit) and a student (career = potential) produce one incomparable `total` and any flat consumer (CSV, new screen, API client) silently mixes them. Every row now carries a `track` ("early_career"/"experienced"), and `rank_candidates_by_track` returns the rows pre-grouped per track — cross-track ranking is structural, not a UI convention.

2. **Design-provenance gate.** `gateApproval` auto-published purely from need-analysis confidence + gaps; it never checked whether the DESIGN step actually used the LLM. A confident analysis paired with a design that fell back to a deterministic template could auto-ship a generic assignment presented as a bespoke, codebase-grounded case. The design `source` is now persisted on the case and the gate fails closed on a known non-"llm" design (mirroring the existing fail-closed reality-reflection check).

3. **Job-fit taxonomy.** The GitHub↔JD fit compared against exactly 10 skill buckets, so off-taxonomy roles (Go/Rust/Java/K8s/security/data-eng) silently showed "Potential Gaps: none" — false reassurance. Expanded to ~27 buckets (whole-token aliasMatches keeps "go"/"c#" safe) and the panel now states "compared against N tracked skills — not an exhaustive check."

4. **Consent retention configurable.** `CONSENT_TTL_DAYS = 365` was a single window blind to jurisdiction and source (the lawful period varies by both). Now reads `KP_CONSENT_TTL_DAYS` (validated, default 365), with the per-call `ttlDays` override as the seam for a per-jurisdiction policy.

## Verification

| Gate | Result |
|---|---|
| tsc --noEmit | 0 |
| JS unit (`node --test`) | 1033 |
| Python (`unittest discover`) | 695 OK / 4 skip |
| i18n en/cs parity | OK (2883) |

## Patterns established (catalogue items 16–17)

16. **Carry the contract in the data, not a comment.** A fairness guarantee delegated to "the UI remembers to split" is one refactor from a regression on the most legally-sensitive surface. Attach the discriminating field (a `track`) to every row and expose the pre-grouped shape, so the unsafe operation is structurally absent rather than conventionally avoided.
17. **A gate must read every signal its decision depends on.** An auto-approve that ignores a degradation flag the UI badges after the fact ships the degraded artifact live. Persist the provenance the decision needs (design `source`) and fail the gate closed on it.

## What remains (fairness/correctness tail)

~13 fairness Highs remain — incl. the **flagged high-value follow-up: skill recency never enters the score** (a decade-stale skill scores as current; needs per-skill-recency plumbing through MatchCandidate + transform + eval validation, so deferred to a focused eval-backed session). Others: matched-skill provenance only shown for early-career, undocumented readiness coefficients, the offline fairness-eval publish, a name/gender/age neutrality probe, the recruiter-only provenance dossier.
