# Biz+UI Fix Wave 2 — Honest automation (attribution, supervision, audit integrity)

> 5 commits, **6 findings closed** (4 High + 2 Medium — analytics #1 and decisions #1 shared one root).
> Baseline preserved: tsc 0 → 0, unit 719/719 → 719/719, python 511 OK, `next build` ✓, i18n parity 1866 keys.

## Commits

| # | Commit | Findings closed | Severity | Files |
|---|--------|-----------------|----------|-------|
| 1 | `f312f0e` | analytics-diagrams #1 + decision-workflow #1 | High + High | db.ts (actOnPipelineEntry), decision-attribution(+test), analytics-momentum(+test), automation-pass, automation-run, screen-wave, offer-finalize, messages |
| 2 | `2f9e7eb` | automation-orchestration #3 | Medium | automation-pass, decision-attribution, SchedulerControl, PassPreviewModal, messages |
| 3 | `bb03827` | automation-orchestration #1 | High | scheduler-store, automation-pass, approval-kinds, DecisionsTab, AiReviewCard, schedule route, SchedulerControl, messages |
| 4 | `a7ffc81` | analytics-diagrams #2 | High | db.ts (pipelineAnalytics), decision-attribution(+test), AnalyticsTab, messages |
| 5 | `812916f` | decision-workflow-group-eval #3 | Medium | screen-wave, ScreenWaveModal, messages |

## What was fixed (grouped by sub-pattern)

1. **Actor-threaded attribution** (`f312f0e`) — every advance wrote one `advanced` kind mapped auto:true, so a recruiter's own gate click badged AUTO in the Decision Log/CSV and inflated the "automation handled X%" headline; policy rejects wrote BOTH `rejected` (human) and `auto_rejected`, counting once per side of the split and twice in momentum's bars. `actOnPipelineEntry` now takes `opts.actor` and records `advanced`/`auto_advanced` + `rejected`/`auto_rejected` — one event per decision, attribution chosen at the single writer. All four system callers updated; screen-wave's duplicate event removed (its rationale now rides as the event detail); funnel IN-lists, momentum kinds, autoAdvanced counter, labels and drift-guard tests all follow.

2. **Outcome states in the audit trail** (`2f9e7eb`) — a failed apply rendered with the same confident chip as one that landed, CAS skips vanished from the run history, and the preview hid fairness-backstop refusals among routine holds. `AutomationDecision.outcome` (applied|failed|skipped|fairness_blocked|queued) is set at each branch; `deriveDecisionOutcome` (browser-safe) reconstructs it from reason prefixes for pre-field rows. History shows outcome chips and keeps skip rows; the preview hoists fairness-blocked rows into a loud amber section.

3. **Supervised reject mode** (`bb03827`) — the marquee trust-ladder rung: the scheduled clock used to apply + email rejections sight-unseen; the only choices were "fully autonomous" or "clock off". New `scheduler.reject_mode` (NULL reads **approve** — safe default, autonomy is opt-in): in approve mode the pass queues each fairness-cleared reject as a `rejection_review` approval on the existing Decisions gate (screening-shaped payload AiReviewCard already renders, tagged "rejecting notifies the candidate"). The human Reject resolves through the pipeline route — rejection email still sent, human attribution recorded. `evaluate_entry`'s pending-approval freeze prevents re-deciding next tick. Advances/holds stay autonomous.

4. **KO discards visible** (`a7ffc81`) — entry-less `ko_declined` events were recorded with a promise no reader kept. `pipelineAnalytics()` now counts them windowed: "turned away at eligibility" line on the funnel card, a per-role column + CSV (KO-only roles still get a row), and the kind registered in DECISION_META + labels so the Decision Log badges/filters/counts each discard.

5. **Committed wave outcomes** (`812916f`) — committing a screening wave collapsed the decision list into a count banner at the exact irreversible moment. The rejects/keeps lists now render in the committed branch (the localized did-phrasing + staleSkipped reasons existed but were unreachable), and `ScreenDecision.commsFailed` badges the specific candidates whose rejection email failed.

## Verification table

| Gate | Before wave | After wave |
|------|------------|-----------|
| tsc --noEmit | 0 errors | 0 errors |
| node --test unit | 719/719 | 719/719 (2 drift-guard tests updated to the new attribution semantics) |
| python unittest | 511 OK (4 skipped) | 511 OK (4 skipped) |
| next build | ✓ | ✓ |
| i18n parity | 1849 keys | 1866 keys (en=cs) |

## Cumulative status (scan 2026-06-12)

**13 / 108 findings closed (8 / 32 Highs)** across waves 1–2, 11 fix commits, 0 regressions.

## Patterns established (catalogue additions, items 30–33)

30. **Attribution is chosen at the single writer** — when one mutator serves both human routes and automation, thread an `actor` opt and emit attribution-distinct event kinds there; never let callers record a second parallel event (double-count) or share one kind (misattribution). Grep `actOnPipelineEntry(` when adding callers — system callers must pass `actor: "system"`.
31. **Outcome ≠ action** — an audit row needs both "what was decided" and "what happened to the decision" (applied/failed/skipped/blocked/queued). Encode outcome as a field set at each branch, not as English prefixes inside prose, and provide a derive-from-prose fallback for old persisted rows.
32. **Supervision is an approval-queue downgrade, not a new pipeline** — a "human approves the machine's adverse action" mode reuses the existing gate: write the machine's verdict as an approval in the payload shape the gate's cards already render, and let the human resolution flow through the normal human route (correct comms + attribution for free). Registry kinds: APPROVAL_KINDS.
33. **An audited event without a consumer is a broken promise** — when a writer's comment claims analytics "can count" something, add the reader in the same change or file a follow-up; `grep <kind>` finding only the writer is a finding.

## What remains

Wave 3 (suggested next): **C — real corpus, real data** — Match-tab demo-corpus bug, fabricated salary in ads, JD-blind runs, quick-apply identity, dead apply links, public-JD PII leak (6 fixes, 6 Highs).
