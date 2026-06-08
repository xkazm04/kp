# Feature Scout — Decision Workflow & Group Eval (kp)

> Total: 6 opportunities (High: 3, Medium: 2, Low: 1)
> Files read: ~14

## 1. Run the screening auto-reject wave from the recruiter's Decisions tab
- **Value**: High
- **Category**: feature
- **Effort**: M
- **Where it slots in**: `app/features/sub_decisions/DecisionRulesModal.tsx:46` (Rules modal) and `app/features/sub_decisions/DecisionsTab.tsx:216` (the `Rules` button in the header) — extends the screening-rule surface.
- **Gap**: The whole screening "first wave" engine is built and battle-hardened — `runScreenWave` (`app/_lib/screen-wave.ts:52`), `POST /api/decisions/screen-wave` (`app/api/decisions/screen-wave/route.ts:11`), config store, fairness gate, tie-break, comms — but the ONLY thing that ever calls it is the demo (`SimDecisionWave.tsx` via `SimulationProvider`). A real recruiter staring at a role's pool in `DecisionsTab` can *configure* the rule (`DecisionRulesModal`) but has no button to actually run it. The capability ships dark.
- **Opportunity**: Add a "Run screening wave" action per role (in `RoleDecisionRow` or the Rules modal) that POSTs the role's `jobId` to `/api/decisions/screen-wave`, then renders the returned `decisions[]`/`rejected`/`kept`/`commsFailures` in a results panel — the same shape `SimDecisionWave` already lays out.
- **Why it matters**: Turns hours of one-by-one triage on a 40-candidate pool into one reviewed batch action — the core efficiency promise of an ATS — using code that already exists and is audited.
- **Sketch**: Reuse the `SimDecisionWave` decision-list layout in a real modal; call the existing route with the live `g.jobId`; live-refresh the queue (`useLiveRefresh`) afterward so auto-rejected rows drop out.

## 2. Dry-run preview before committing the screening wave
- **Value**: High
- **Category**: functionality
- **Effort**: M
- **Where it slots in**: `app/_lib/screen-wave.ts:113` (the irreversible `actOnPipelineEntry(e.id, "reject", …)` + `dispatchRejection`) and `app/api/decisions/screen-wave/route.ts:21`.
- **Gap**: `runScreenWave` is all-or-nothing: it computes the bottom-% cohort AND immediately flips statuses and queues candidate rejection emails. The route accepts an `override` rule but still commits. There's no "show me who this would reject" step before a destructive, comms-sending batch.
- **Opportunity**: Add a `dryRun` flag (route + `runScreenWave`) that runs the full ranking/fairness/tie-break math and returns the `decisions[]` with rationales but skips `actOnPipelineEntry` and `dispatchRejection`. The wave UI (#1) shows the preview, the recruiter tweaks the bottom-%/threshold sliders, sees the count change live, then confirms to commit.
- **Why it matters**: Auto-rejection sends real emails and is irreversible — a preview is the difference between a trusted power tool and a feature no recruiter dares to enable (it's `autoRejectEnabled:false` by default for exactly this reason).
- **Sketch**: `runScreenWave(jobId, override, { dryRun })`; early-return the computed `decisions` before the mutating branch; reuse the existing validation so the preview honors the same clamps.

## 3. Advance / reject directly from the Group Evaluation modal
- **Value**: High
- **Category**: user_benefit
- **Effort**: M
- **Where it slots in**: `app/features/sub_decisions/GroupEvalModal.tsx:175` (modal footer, currently only `Re-run`) and `app/features/sub_decisions/DecisionsTab.tsx:141` (`openGroupEval`).
- **Gap**: The group eval is where the recruiter forms the verdict — ranked order, recommended lead, fairness matrix, risks — yet it's read-only. To act they must close the modal and re-open per-candidate `AnalysisSummaryModal`s one at a time. The decision context and the decision action are split across two surfaces.
- **Opportunity**: Give each candidate row/tab in the modal inline Advance/Reject buttons (and an "Advance the lead, reject the rest" shortcut) wired to the existing `act(entry, action)` in `DecisionsTab`. The modal already holds the `entryId` per candidate via the group's `entries`.
- **Why it matters**: Collapses "compare → decide" into one motion at the exact moment of highest context — the natural close of a comparative review.
- **Sketch**: Pass an `onDecide(entryId, action)` prop down to `PerCandidateTabs`/`CandidateDetail`; map labels back to `g.entries` for the id; reuse the `expectedStage` CAS already in `act()`.

## 4. Capture a decision note / reason when advancing or rejecting
- **Value**: Medium
- **Category**: feature
- **Effort**: S
- **Where it slots in**: `app/features/sub_decisions/AnalysisSummaryModal.tsx:94` (footer Advance/Reject) and `app/features/sub_decisions/AiReviewCard.tsx:89`; plumbed through `app/api/pipeline/[id]/route.ts:92` → `actOnPipelineEntry(id, action, detail)`.
- **Gap**: The plumbing for a per-decision note already exists end-to-end but is unused for human decisions: `actOnPipelineEntry(id, action, detail?, …)` (`app/_lib/db.ts:3062`) takes a `detail`, the route forwards `body.detail` (`route.ts:95`), and the audit log renders `d.detail` (`DecisionLog.tsx:145`). But the accept/reject branches in `db.ts:3087` IGNORE `detail` (only `approve_event` uses it as a slot), and no decision UI ever sends one. Every human advance/reject lands in the auditable Decision Log with a blank reason.
- **Opportunity**: Add an optional "reason" text field to the reject (and advance) action; record it as the `pipeline_events.detail` for the `rejected`/`advanced` event so it shows in `DecisionLog`. Especially valuable on rejects, which already send a candidate comm.
- **Why it matters**: "Why was this strong candidate rejected?" is the #1 question an auditable hiring trail must answer — and the storage + display are already there; only the capture and one `recordEvent` arg are missing.
- **Sketch**: Add `detail` to the accept/reject `recordEvent(db, { …, detail })` calls in `actOnPipelineEntry`; surface a small note input in `AnalysisSummaryModal`/`AiReviewCard`; pass it through the existing `act()` body.

## 5. Per-role rule overrides + auto-advance threshold
- **Value**: Medium
- **Category**: functionality
- **Effort**: M
- **Where it slots in**: `app/_lib/decision-config-store.ts:17` (`DEFAULTS` has only `screening`) and `app/features/sub_decisions/DecisionRulesModal.tsx:48` (title hardcoded "Screening").
- **Gap**: Decision config is a single global `screening` rule with two knobs (reject-bottom-%, max-match). There's no per-role override (a senior-eng role and a grad role get the same auto-reject band), and there's no *positive* automation — no "auto-advance candidates above match X" to mirror the auto-reject. The screen-wave route already accepts a per-run `override`, so the engine supports it; only the config model and UI are global.
- **Opportunity**: Let the Rules modal scope a rule to a role (persist `screening:<jobId>` alongside the global default; `getDecisionConfig` already merges over defaults), and add an `autoAdvanceMinMatch` field so the top of a pool can advance automatically the same way the bottom is rejected.
- **Why it matters**: One global threshold can't be right for every role; per-role tuning + symmetric auto-advance is the difference between a blunt switch and a calibrated funnel.
- **Sketch**: Key configs by `phase:roleKey` in `decision-config-store`; have the wave look up the role-scoped rule first; extend `decision-config-schema` with a clamped `autoAdvanceMinMatch` and an advance branch in `runScreenWave`.

## 6. Reviewer calibration / second-opinion on contested decisions
- **Value**: Low
- **Category**: feature
- **Effort**: L
- **Where it slots in**: `app/features/sub_decisions/DecisionsTab.tsx:106` (`act`) and `app/_lib/group-eval.ts` (the fairness/disagreement signal already computed).
- **Gap**: Every decision is made by a single actor with no notion of multiple reviewers or agreement. The group eval already computes when the robust fairness order *diverges* from the headline fit order (`GroupEvalModal.tsx:906`) — a natural "this one is contested" signal — but that only informs; it never routes a borderline candidate to a second reviewer or records concurrence.
- **Opportunity**: Flag decisions where AI confidence is low or the fairness order diverges as "needs a second look," let a second reviewer concur/dissent, and record both in the audit trail (extending `pipeline_events`).
- **Why it matters**: Calibration across reviewers is a real enterprise-ATS need for defensible hiring, but it presumes multi-user accounts the app doesn't yet model — hence lower confidence on fit/feasibility today.
- **Sketch**: Add a `reviewer`/`concurrence` column to decision events; surface a "second opinion" queue filtered to diverged/low-confidence entries; gate behind whatever user model lands first.
