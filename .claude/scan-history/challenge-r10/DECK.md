# Challenge deck - kp challenge-r10 (2026-10-04)

Approval: in advance for the coverage loop (operator 2026-09-23, re-confirmed 2026-10-04). Excluded: none.
Critic: independent subagent re-verification on 2026-10-04 against `ce89502e4`.
Idea score mean: ambition 3.81 / grounding 4.31 / falsifiability 4.69 (overall mean: 4.27).

## Voided Cards (already landed between d57d380b8 and ce89502e4)

| Card | Title | Size | E/I/R | Gate | Verdict | Void Reason |
|---|---|---|---|---|---|---|
| `db-core-migrations/A` | One loud column migrator for every store: catch-all ALTERs stop swallowing | L | 6/7/5 | architecture | void | already landed: 5ef013f51 (`app/_lib/db/add-columns.ts`, `app/_lib/db/core.ts:1754`) |
| `devcase-detail/A` | One cohort ranking: auto-promote and the shortlist stop mixing score currencies | M | 7/8/6 | policy-tighten | void | already landed: 5ef013f51 (`app/_lib/devcase-cohort-rank.ts`, `app/_lib/devcase-orchestrator.ts`) & 6186139e8 |
| `pipeline-core/B` | Policy pass decides by stage role, not the five shipped stage names | M | 6/7/6 | contract | void | already landed: 5ef013f51 (`pipeline/jobfit/automation.py:1005-1050`, `app/_lib/automation-pass.ts`) |

## Surviving Cards & Wave Plan

Waves of <= 4 builders, disjoint non-shared write sets, signature changes and foundational models first.

| Card | Title | Size | E/I/R | Gate | a/g/f | Verdict | Wave |
|---|---|---|---|---|---|---|---|
| `pipeline-core/A` | Automation drafts from the entry's own role, not the seed file | M | 7/9/5 | contract | 5/5/5 | build (LANDED) | 1 |
| `analyze-workspace/A` | One JD source: a picked role stays linked through edits, files and tab switches | M | 6/8/5 | architecture | 4/5/5 | build (LANDED) | 1 |
| `voice-tts-package/B` | A resumed utterance plays to its end: blocked and truncated speech continue | M | 6/8/5 | contract | 4/5/5 | build (LANDED) | 1 |
| `devcase-detail/B` | Source DB previews who it files: pick from the ranked matches, counts that are true | M | 6/8/5 | contract | 4/5/4 | build (LANDED) | 1 |

## Wave 1 Build Status: 4 of 4 Landed (100% Complete)

| Card | Title | Shas | Tests Red -> Green | Acceptance | Status |
|---|---|---|---|---|---|
| `pipeline-core/A` | Automation drafts from the entry's own role, not the seed file | `685d1b5ea`, `d4e391d44` | 8 -> 8 | 8 of 8 | Landed |
| `analyze-workspace/A` | One JD source: a picked role stays linked through edits, files and tab switches | `23595bbb7`, `bead7bfa7` | 8 -> 8 | 8 of 8 | Landed |
| `voice-tts-package/B` | A resumed utterance plays to its end: blocked and truncated speech continue | `cf9abc674`, `3041ddf9d` | 6 -> 6 | 6 of 6 | Landed |
| `devcase-detail/B` | Source DB previews who it files: pick from the ranked matches, counts that are true | `8c80e389`, `47da85b9` | 7 -> 7 | 7 of 7 | Landed |
| `analyze-workspace/B` | Seen before: Analyze names this exact CV's prior runs and decisions pre-spend | M | 6/8/5 | none | 4/5/4 | build (LANDED) | 2 |
| `jobs-posting-campaign/A` | Go-live leaves a durable receipt: abandoned or failed sourcing resumes | M | 7/8/6 | architecture | 4/4/5 | revise (LANDED) | 2 |
| `voice-tts-package/A` | Language coverage is probed from installed voices, not a hardcoded list | M | 6/7/5 | contract | 4/5/5 | build (LANDED) | 2 |
| `interview-execution-scoring/A` | Voice scorecard commits once: attach, gate, seal in one locked unit | L | 7/8/6 | architecture | 4/4/4 | revise (LANDED) | 2 |
| `interview-execution-scoring/B` | A finished-but-unscored interview shows on Schedule with Re-score | L | 7/8/5 | contract | 4/5/4 | revise (LANDED) | 2 |
| `db-core-migrations/B` | System strip names the DB's own faults: lost unique guards, unreadable rows | M | 5/7/4 | contract | 3/5/5 | build | 3 |
| `e2e-suite/A` | E2E specs import the routes' own view types: tsc catches payload drift CI hid | M | 6/7/5 | contract | 3/5/5 | build | 3 |
| `jobs-posting-campaign/B` | Reopening a role restates its terms: prefilled seats, a floor above hires | M | 6/7/5 | contract | 3/5/5 | revise | 3 |
| `e2e-suite/B` | One axe policy for every spec: a contrast-measured holdout ledger that expires | M | 6/7/5 | policy-tighten | 4/5/4 | revise | 4 |

## Wave 2 Build Status: 5 of 5 Landed (100% Complete)

| Card | Title | Shas | Tests Red -> Green | Acceptance | Status |
|---|---|---|---|---|---|
| `analyze-workspace/B` | Seen before: Analyze names this exact CV's prior runs and decisions pre-spend | `667296c1`, `5866f422` | 8 -> 8 | 8 of 8 | Landed |
| `jobs-posting-campaign/A` | Go-live leaves a durable receipt: abandoned or failed sourcing resumes | `958a502d`, `dfabbdbe` | 8 -> 8 | 8 of 8 | Landed |
| `voice-tts-package/A` | Language coverage is probed from installed voices, not a hardcoded list | `6a50e2b0`, `a5ce8079` | 7 -> 7 | 7 of 7 | Landed |
| `interview-execution-scoring/A` | Voice scorecard commits once: attach, gate, seal in one locked unit | `d2ad9240`, `a474100e` | 10 -> 10 | 7 of 7 | Landed |
| `interview-execution-scoring/B` | A finished-but-unscored interview shows on Schedule with Re-score | `c4c1d320`, `3b564056`, `440984df` | 8 -> 8 | 8 of 8 | Landed |

## Critic Revision Notes

- **`e2e-suite/B`**: Split the WCAG 2.1 tag uplift for candidate-door specs (`journey-role-to-schedule`, `token-doors-axe`) into the series' last commit, separate from the policy module and initial migration, so any unexpected findings in CI's release job can be managed without reverting the ledger.
- **`interview-execution-scoring/A`**: Move `sealDecisionSafe` immediately after the core immediate transaction: `decision-record-store.ts` uses its own `openStore` handle, so sealing inside core's immediate transaction triggers `SQLITE_BUSY` on the held write lock. The core transaction executes attach, gate re-check, and approval.
- **`interview-execution-scoring/B`**: Drop `app/_lib/interview-scorecard-commit.ts` from write set: have slot A's `finalizeCandidateInterviewScoring` accept `deps.attach`, and let rescore route pass an attach bound with `{ requireUnscored: true }`, avoiding cross-slot file conflict.
- **`jobs-posting-campaign/A`**: Specify that `golive-receipt-store.ts` executes on `ensureDb()` (the core connection handle) rather than an isolated `openStore()` handle, avoiding `SQLITE_BUSY_SNAPSHOT` deadlocks inside the go-live transaction.
- **`jobs-posting-campaign/B`**: Add `app/api/jobs/publish-atomicity.test.ts` to the write set to mirror the `.immediate()` transaction upgrade in its hand-copied transaction fixture.
