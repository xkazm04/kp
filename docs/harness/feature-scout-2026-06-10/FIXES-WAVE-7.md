# Feature Scout #2 — Fix Wave 7: "Automation you can trust" (Theme F)

> 5 commits, 5 findings closed (5 High).
> Baseline preserved: tsc 0 → 0 · next build ✓ · unit 646 → 646 · python 500 OK → 500 OK · eslint clean on all changed files.

One mental model: the autopilot existed but wasn't adoptable — its front door deadlocked,
its decisions evaporated, its irreversible pass had no preview, and the human judgment
PREP1 introduced never reached the gates the AI's did. This wave makes the automation
trustworthy in both directions: visible when it acts, and listening when a human does.

## Commits

| # | Commit | Finding | Value | Files |
|---|---|---|---|---|
| 1 | `2e96d22` | AUTO1 — auto-score unscored inbound applicants | High | 5 (+109/−1) |
| 2 | `4fcd542` | AUTO3 — dry-run preview before the policy pass commits | High | 6 (+240/−12) |
| 3 | `329b6c6` | AUTO2 — persist + surface per-pass decisions (run history) | High | 7 (+166/−19) |
| 4 | `df6e6b5` | DEC1 — human scorecards → scorecard_review gate | High | 4 (+33/−2) |
| 5 | `b327436` | PREP1 — human-only scorecards in the compare grid | High | 5 (+57/−3) |

## What was fixed

1. **AUTO1 — the front door automates.** Inbound applicants landed with `matchScore: null`,
   the policy pass held them "awaiting match score" forever, and `match_score` was
   INSERT-only. A pre-policy sweep now scores unscored, non-degraded entries via the same
   deterministic recruiter_cli ranking (one spawn per job; ds- entries excluded), through a
   new FILL-ONLY `setEntryMatchScore` (never clobbers a human-era score), patching the
   in-memory snapshot so this very pass triages them, and logging a new `scored` pipeline
   event (registered in EVENT_KINDS/EVENT_CATALOG + en/cs verbs).

2. **AUTO3 — look before commit.** The pass auto-rejects AND emails in the same breath, yet
   had no preview while the screening wave got one (DEC2). `runAutomationPass({dryRun})`
   runs the identical flow read-only (sweep patches memory only, fairness backstop still
   consulted per reject, single-flight bypassed — a preview must never return an applied
   pass's result). "Run pass" now opens a preview modal: would-reject rows first with
   reasons, an explicit "Apply N changes & notify" commit.

3. **AUTO2 — the audit trail survives.** The per-entry decision log was computed every pass
   and discarded. `scheduler_runs.decisions_json` (additive) persists it from both the
   clock and — new — committed manual runs (trigger `manual`, never double-recorded on a
   joined pass; error runs symmetric). SchedulerControl gains a History panel: per-run
   trigger/badges (now including `errors`, with `evaluated`) expanding to action-toned
   decision rows with board-resolved candidate labels.

4. **DEC1 — the human verdict opens the gate.** The scorecard route saved and returned; only
   the two AI paths ever set `scorecard_review`, so a human-led interview never reached
   Decisions. A recommendation-carrying human scorecard for an active Interview-stage entry
   whose gate is open (no approval / parked at calendar) now sets the same approval the AI
   sets — the `source:"human"` Scorecard already parses as the shape AiReviewCard renders,
   which now tags it "Human interview scorecard".

5. **PREP1 — human-led rounds compare.** The compare cohort came only from
   `interview_sessions`; a human-scorecard-only candidate read as "wasn't interviewed" at
   the decision moment. The route unions in job entries carrying a human scorecard (new
   `listEntriesForJob`), scoringModel derived from the entry archetype, null AI fields,
   and a "human-led round" chip so blank AI rows can't be misread as a failed synthesis.

## Verification

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| `next build` | ✓ | ✓ |
| `npm run test:unit` | 646 | 646 |
| `npm run test:python` | 500 OK (4 skip) | 500 OK (4 skip) |
| eslint (changed files) | clean | clean |

## Patterns established (catalogue items 11–13)

11. **An automation gate that waits on data nothing produces is a deadlock, not a
    safeguard.** "Held: awaiting X" is only honest if some step computes X; audit every
    hold reason for a producer.
12. **Dry runs must bypass single-flight and consult the same guards.** Joining an
    in-flight committed pass would return applied results as a "preview"; and a preview
    that skips the fairness backstop previews a decision the commit won't make.
13. **When a human takes over an AI checkpoint, wire their artifact into the SAME gate,
    same shape.** The human scorecard reused the AI's approval kind, detail format and
    renderer — the queue, accept/reject plumbing and audit trail came free; only a source
    tag was new.

## What remains

Theme F Mediums stay open: AUTO4 (POLICY thresholds as config), AUTO5 (per-candidate
automation pause), AUTO6 (register the reminder sweep as a visible scheduler job), DEC2
(advance-lead-reject-rest batch), DEC3 (decision-note parity), DEC4/PREP2-4 (i18n +
stamps). Remaining waves per the INDEX: 3/4 (i18n), 6 (comms center), 8 (lifecycle CRUD),
9 (shell + analytics), 10 (ops) + the Med/Low sweep.
