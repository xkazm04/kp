# Feature Scout — Decision Workflow & Group Eval (2026-06-10, re-scan of mined context)

> Total: 4 (1H/2M/1L)
> Prior scan 2026-06-08: 6 findings, Highs shipped, DEC5/DEC6 retired. This re-scan reports only net-new gaps.

## 1. Wire human scorecards into the Decisions `scorecard_review` approval gate
- **Value**: High
- **Category**: functionality
- **Effort**: M
- **Where**: `app/api/interview-prep/scorecard/route.ts:60` (saves, never gates) + `app/_lib/interview-prep.ts:104` (`saveHumanScorecard`), `app/_lib/automation-run.ts:195` and `app/_lib/interview-run.ts:247` (the ONLY `scorecard_review` setters — both AI-only), `app/features/sub_decisions/DecisionsTab.tsx:64` (queue filter), `app/features/sub_decisions/AiReviewCard.tsx:23-25` (renders only `entry.approvalDetail`, the AI scorecard)
- **Gap**: Documented unshipped deferral — harness-learnings W10 deferred "merge human scorecards into Decisions queue" and W14 explicitly notes wiring a human scorecard to the Decisions `scorecard_review` APPROVAL gate was NOT done. Verified: `POST /api/interview-prep/scorecard` calls `saveHumanScorecard` and returns; it never touches `setApproval`. A human-only interview (PREP1 scorecard, no voice session) therefore never reaches the Decisions queue — the entry stays parked at the `calendar` approval and the Interview→Offer gate simply never opens for it.
- **Proposal**: When a human scorecard carrying a `recommendation` is saved for an entry at the Interview stage with no pending approval, set `scorecard_review` with the human scorecard (`source:"human"`) as `approvalDetail` — it already parses as the `Scorecard` shape `AiReviewCard` renders (summary, rating dots, `RecBadge`). Add a "Human scorecard" tag variant in `AiReviewCard` when `parsed.source === "human"`, and when an entry is already at AI `scorecard_review`, show the human verdict beside the AI card (read via the existing `getHumanScorecard`).
- **Why users need it**: PREP1 made the human the scorer, but their verdict is a dead end — the decision queue only ever hears from the AI. This closes the loop so a human-conducted interview drives the same Interview→Offer decision the AI path does.

## 2. "Advance the lead, reject the rest" batch close-out in the Group Eval modal
- **Value**: Medium
- **Category**: feature
- **Effort**: M
- **Where**: `app/features/sub_decisions/GroupEvalModal.tsx:213-222` (footer: Re-run only), `:246-252` (`PerCandidateTabs` per-candidate decide, DEC3), `:184-191` (`decided` map), `app/features/sub_decisions/DecisionsTab.tsx:336-348` (`onDecide` → `act` with expectedStage CAS)
- **Gap**: Documented unshipped deferral — W9 shipped per-candidate inline decide (DEC3) but explicitly deferred the batch shortcut because "multi-reject wants a DEC1/DEC2-style preview". That preview pattern now exists (`ScreenWaveModal` dry-run → confirm), so the stated blocker is gone; the footer still offers only Re-run.
- **Proposal**: Add a footer action (gated on `onDecide` + `evaluation.topPick`) that opens an in-modal confirm panel listing exactly who advances (the lead) and who gets rejected (the still-pending rest, resolved against live `evalGroup.entries`), with an optional shared rejection note, then loops the existing `act()` per entry — the expectedStage CAS already makes any concurrently-decided candidate a safe no-op — and flips the `decided` pills.
- **Why users need it**: The group eval ends in exactly this verdict for most roles; today closing out a 6-person pool is six modal interactions even though the modal already knows the ranking and the lead.

## 3. Capture decision notes on the AI-review card and group-eval decide, and show them in the drawer History
- **Value**: Medium
- **Category**: user_benefit
- **Effort**: S
- **Where**: `app/features/sub_decisions/DecisionsTab.tsx:280` (`AiReviewCard` callbacks pass no `detail`), `app/features/sub_decisions/AiReviewCard.tsx:95-111` (no note input), `app/features/sub_decisions/GroupEvalModal.tsx:177` (`onDecide` has no note arg), `app/features/sub_pipeline/PipelineShared.tsx:88-89,104-105` (`useEventVerb` ignores `ev.detail` for `advanced`/`rejected`)
- **Gap**: New seam created by waves shipping apart: DEC4 (W5) added note capture only to `AnalysisSummaryModal`, then DEC3 (W9) added a second decide surface with no note path, and the AI-recommendation cards — the highest-volume decisions — never got one. On the read side, the note is rendered ONLY in the Analytics DecisionLog (`DecisionLog.tsx:152`); the candidate drawer's per-entry History (PIPE3) drops it, so the one place you'd ask "why was this person rejected?" can't answer.
- **Proposal**: Thread an optional note through the remaining decide paths (a small reject-with-reason popover on `AiReviewCard` and the group-eval buttons; `act()` already forwards `detail`), and extend `useEventVerb` with `advancedDetail`/`rejectedDetail` message variants so the recorded note shows in the drawer History. No schema or API change — the `detail` plumbing is already end-to-end.
- **Why users need it**: DEC4's promise was an answerable audit trail, but two of the three decide surfaces still write blank reasons and the per-candidate view never shows the ones that exist.

## 4. Localize screening-wave rationales via structured reason codes
- **Value**: Low
- **Category**: user_benefit
- **Effort**: S
- **Where**: `app/_lib/screen-wave.ts:31-49` (`keepReason` hardcoded English, persisted byte-identical), `:126-128` (reject rationale template), `app/features/sub_decisions/ScreenWaveModal.tsx:207,223` (renders `d.rationale` raw)
- **Gap**: Opened by i18n (commit 7922fbe): the wave modal's chrome is fully translated (`decisions.wave` exists in `messages/cs.json`), but every per-candidate keep/reject rationale in the preview and committed views is a hardcoded English server string — a Czech recruiter reads "tie at cutoff — kept so equal scores aren't split" inside an otherwise Czech UI. The strings are deliberately byte-identical for the persisted audit trail, so they can't simply be translated server-side.
- **Proposal**: Add a structured `reasonCode` + params field to `ScreenDecision` alongside the unchanged `rationale` (audit trail stays byte-identical English), and have `ScreenWaveModal` render from the code via `decisions.wave.reasons.*`. Dry-run decisions are never persisted, so the preview — the surface recruiters actually tune — becomes fully bilingual at zero audit risk.
- **Why users need it**: The wave preview is a trust-building surface for an irreversible action; untranslated rationales undercut the bilingual UI exactly where the recruiter is deciding whether to pull the trigger.

---
## Cross-checks performed
- Read prior report `feature-scout-2026-06-08/decision-workflow-group-eval.md` (DEC1–DEC6), `INDEX.md`, and `harness-learnings.md` W5/W8/W9/W10/W11/W14/W16 entries. Confirmed shipped: DEC1+DEC2 (`ScreenWaveModal` + `dryRun` in `screen-wave.ts`), DEC3 (`onDecide` in `GroupEvalModal`), DEC4 (note in `AnalysisSummaryModal:225-233` + `detail` recorded). DEC5/DEC6 retired — not re-proposed (finding 4 localizes display only; it adds no per-role config or reviewer model).
- Human-scorecard gate: grepped `saveHumanScorecard|getHumanScorecard|scorecard_review|setApproval` app-wide — only `automation-run.ts:195` / `interview-run.ts` set `scorecard_review`; the scorecard route never gates. Matches the W14 "NOT done" note exactly.
- Batch close-out: grepped `GroupEvalModal` for footer/batch — footer is Re-run only; W9 deferral rationale (needs preview pattern) is now satisfied by the shipped `ScreenWaveModal`.
- Decision-note reach: confirmed `DecisionLog.tsx:152` renders `d.detail` but `useEventVerb` (`PipelineShared.tsx`) returns plain `t("rejected")`/`t("advanced", …)` with no detail; `AiReviewCard` and group-eval `onDecide` signatures carry no note.
- Collision avoidance: verified the policy pass (`automation-pass.ts`) does NOT call `runScreenWave` (route is the sole caller), but DROPPED a candidate "persist + surface screening-wave run history" finding anyway — it is shape-identical to the automation scout's claimed "persist per-pass decisions[] log" / dry-run / POLICY items. Committed waves already leave per-entry `auto_rejected` automation events (Analytics + drawer history), so the marginal value didn't justify the dedup risk. Profile CRUD and auto-score-inbound not touched.
- i18n: confirmed `DecisionsTab`/`AiReviewCard`/`ScreenWaveModal`/`GroupEvalModal` all use `next-intl` and `messages/cs.json` covers `decisions.*`; the only untranslated user-facing decision strings are the server-built rationales (finding 4).
