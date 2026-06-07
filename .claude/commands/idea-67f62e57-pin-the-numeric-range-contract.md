Execute this requirement immediately without asking questions.

## REQUIREMENT

# Pin the numeric range contract for scores vs percents

## Metadata
- **Category**: maintenance
- **Effort**: Unknown (4/3)
- **Impact**: Unknown (6/3)
- **Scan Type**: ambiguity_guardian
- **Generated**: 6/3/2026, 10:33:40 AM

## Description
Across the Dev Case context, confidence, tooling fluency, readBeforeWrite, rubric weight, and snapshot.languages values are passed to formatPercent(..., {fraction:true}) — implying a 0..1 range — while transferScore and DimensionScore.score are rendered as raw 0..100. None of these ranges are documented or enforced; NeedAnalysis.confidence is just `number`. Add explicit range annotations to each numeric field in DevTypes.ts (e.g. 0..1 vs 0..100), a small clamp/assert helper used at the render boundary, and unit tests so a Python evaluator emitting confidence as 0..100 surfaces as a caught error instead of '8500%'.

## Reasoning
The same component tree mixes fractions (0..1) and scores (0..100) with no checkable invariant, so any upstream unit change silently renders absurd values to recruiters making hiring decisions. Pinning the contract turns an invisible assumption into a compile/test-time guarantee and makes the scoring UI trustworthy.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Dev Case Studio (UI)

**Description**: Recruiter-facing workspace for the automated developer take-home flow: define needs, generate/publish postings, review submissions, run evals, and walk cases through their lifecycle with an autonomy control panel.
**Related Files**:
- `app/features/sub_dev/DevTab.tsx`
- `app/features/sub_dev/DevShared.tsx`
- `app/features/sub_dev/DevTypes.ts`
- `app/features/sub_dev/DevHelpers.ts`
- `app/features/sub_dev/NeedForm.tsx`
- `app/features/sub_dev/PostingsSection.tsx`
- `app/features/sub_dev/SubmissionForm.tsx`
- `app/features/sub_dev/SubmissionRow.tsx`
- `app/features/sub_dev/LifecycleSection.tsx`
- `app/features/sub_dev/LifecycleRow.tsx`
- `app/features/sub_dev/ApprovedCasesSection.tsx`
- `app/features/sub_dev/EvalPanel.tsx`
- `app/features/sub_dev/AnalysisView.tsx`
- `app/features/sub_dev/OutboxSection.tsx`
- `app/features/sub_dev/ProvenanceStrip.tsx`
- `app/features/sub_dev/ScoreBar.tsx`
- `app/features/sub_dev/ApplyTokenPill.tsx`
- `app/control/page.tsx`

**Post-Implementation**: After completing this requirement, evaluate if the context description or file paths need updates. Use the appropriate API/DB query to update the context if architectural changes were made.

## Recommended Skills

Use Claude Code skills as appropriate for implementation guidance. Check `.claude/skills/` directory for available skills.

## Notes

This requirement was generated from an AI-evaluated project idea. No specific goal is associated with this idea.

## DURING IMPLEMENTATION

- Use `get_memory` MCP tool when you encounter unfamiliar code or need context about patterns/files
- Use `report_progress` MCP tool at each major phase (analyzing, planning, implementing, testing, validating)
- Use `get_related_tasks` MCP tool before modifying shared files to check for parallel task conflicts

## AFTER IMPLEMENTATION

1. Log your implementation using the `log_implementation` MCP tool with:
   - requirementName: the requirement filename (without .md)
   - title: 2-6 word summary
   - overview: 1-2 paragraphs describing what was done
   - category: one of feature/bugfix/refactor/performance/security/infrastructure/ui/docs/test
   - patternsApplied: comma-separated patterns used (e.g. "repository pattern, debounce, memoization")

2. Check for test scenario using `check_test_scenario` MCP tool
   - If hasScenario is true, call `capture_screenshot` tool
   - If hasScenario is false, skip screenshot

3. Verify: `npx tsc --noEmit` (fix any type errors)

Begin implementation now.