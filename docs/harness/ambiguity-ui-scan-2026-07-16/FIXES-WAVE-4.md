# Fix Wave 4 — UI / label claims that contradict server truth

> 6 findings closed in 6 atomic commits (all High). Theme: a surface states or implies something the data/server doesn't support.
> Baseline preserved: tsc 0 → 0 errors; node unit suite 2352 → 2364 pass, 0 fail, 0 regressions.
> Branch: `vibeman/ambiguity-ui-wave1` (continues Waves 1–3). All targets in clean files (no devcase/core/messages WIP touched).

## Commits

| # | Commit | Finding closed | Files |
|---|---|---|---|
| 1 | `2a00417` | comparison drivers/merged-rec key by non-unique label | `comparison.ts` (+2 dup-label tests) |
| 2 | `12a37f9` | ROI ledger labels a mean "median" | `db/analytics.ts`, `AnalyticsTab.tsx` (+test) |
| 3 | `de384ac` | comparison table crowns a "Lead" the server didn't | `group-eval/ComparisonTable.tsx`, `GroupEvalModal.tsx` (+source-guard) |
| 4 | `918b628` | reject-below-N acts on 50 rows but says "affects 120" | `pipeline/command/route.ts`, `CommandBar.tsx` (+route test) |
| 5 | `a7550e5` | pricing CTAs discard the selected plan | `auth/session-nav.ts`, `PricingSection.tsx` (+behavioral test) |
| 6 | `ac525c5` | placeholder evidence leaks into the compare grid as a quote | `interview-scorecard.ts`, `CompareInterviews.tsx` (+predicate tests) |

## What was fixed

1. **Comparison label-collision** — CV labels aren't unique (two variants can share a filename), yet the driver narrative filtered `others` by `label !== best.label` (dropping a distinct same-label variant) and the merged recommendation's `byLabel` map collapsed duplicates to the LAST analysis (attributing one CV's headline/skills to another). Made INDEX the identity throughout (inputs and variants are positionally aligned), mirroring `resolveWinnerIndex`.
2. **ROI "median" is a mean** — the ROI ledger tile is labeled "median" but rendered `avgTimeToHireDays`, an arithmetic mean. Added a true `medianTimeToHireDays` (matching OrgBenchmarkPanel's contract) and fed the median-labeled tile that value; the mean stays on the avg-labeled main tile and the forecast ETA. No message-key change — the label is now truthful.
3. **False "Lead" crown** — the table set `isLead={i === 0}` (column position), so an all-KO / sub-min-cohort field (server `topPick: null`) still crowned column 1, and the pill ternary let that phantom crown suppress the candidate's KO pill. Now gated on `hasLead` (server topPick) with KO taking precedence in the pill.
4. **reject-below-N truncation** — the preview rendered ≤50 rows but reported `total` = the full match count; the confirm bound to the 50 rendered ids, so a 120-match cohort rejected only 50 with a "50 rejected" success. The preview now returns `matchedIds` (the full set; only rendered rows capped) and the confirm binds to that; the TOCTOU guard (`resolveRejectTargets`) is unchanged.
5. **Pricing CTA discards the plan** — all four tier buttons called `enterWorkspace()` with no argument, so the selected plan was never captured. `enterWorkspace(plan?)` now persists it as a `?plan=` query param on the entered/login URL; the buttons pass `tier.id`.
6. **Placeholder evidence leaks as a quote** — the compare grid filtered evidence by the exact string `"Not assessed."`, but the Python synthesis emits several "Not assessed…" spellings and guards on the PREFIX. Added a shared `isPlaceholderEvidence()` (the TS mirror of the Python prefix contract) and used it.

## Verification

| Gate | Before | After |
|---|---|---|
| tsc --noEmit | 0 errors | 0 errors |
| node unit suite | 2352 pass / 0 fail | 2364 pass / 0 fail |

Behavioral regressions that fail pre-fix: comparison dup-label (×2), analytics mean-vs-median, reject-below-N >cap, landing plan-threading (×3). The group-eval crown carries a source-guard (client component, no unit seam).

## Patterns established (catalogue items 14–17)

14. **Label as identity when labels aren't unique** — keying a map/filter by a display label that the codebase elsewhere documents as non-unique silently drops or mis-attributes rows. When a stable index exists (aligned arrays), make the index the identity everywhere, not just in the one function that already learned the lesson.
15. **Statistic name/label divergence** — a value named/derived one way (mean) shown under a label claiming another (median). Either fix the label or compute the claimed statistic; never swap the label without matching the math. In an audit-grade readout, prefer computing the real statistic.
16. **Positional UI cue vs server verdict** — deriving a "winner/lead/best" highlight from column/row position instead of the server's actual pick, so the cue survives the case where the server crowned nobody. Thread the real identity; let the honest "none" case reach the UI.
17. **Render cap conflated with action scope** — a preview caps RENDERED rows for display but a confirm binds to the rendered set, silently shrinking the action below the stated total. Cap only what you render; carry the full id set for the action (ids are cheap).

## What remains (deferred, with cause)

- **interview-simulation-comparison #1** (attach offered before the session ends) — DEFERRED: the clean fix needs a completion callback threaded through the voice component (which Wave 3 already touched) AND a new "finish first" i18n string in the WIP message files. Both blocked by constraints this session held to; better done alongside the voice-callback work.
- **hiring-automation-scheduler #2** (dry-run preview vs commit divergence) — larger automation-pass change; a candidate for a future wave.
- **plans-checkout-billing-ui #1** (pricing dead-end checkout) and **analytics-calibration #2** (prior-window bySource lower-bound) — remaining theme-D items for a future wave.
