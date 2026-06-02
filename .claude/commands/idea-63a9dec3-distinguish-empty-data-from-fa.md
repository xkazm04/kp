Execute this requirement immediately without asking questions.

## REQUIREMENT

# Distinguish empty data from failed loads in UI

## Metadata
- **Category**: user_benefit
- **Effort**: High (3/3)
- **Impact**: Unknown (6/3)
- **Scan Type**: ambiguity_guardian
- **Generated**: 6/1/2026, 4:35:21 PM

## Description
Every loader (loadCases/loadPostings/loadLifecycles/loadOutbox in DevTab, plus the 3s poll loop in control/page.tsx) ends in .catch(() => {}), silently swallowing fetch errors. When the API is down the UI renders the same empty/stale state as nothing here yet, so the recruiter cannot tell a genuinely empty pipeline from an outage. Track a per-loader error and last-updated timestamp and render an explicit could not refresh banner or stale indicator.

## Reasoning
Trust in an autonomous hiring console depends on knowing whether what you see is real; silent staleness can cause a recruiter to act on outdated data. Surfacing load failures is low-effort and materially improves perceived reliability of the whole Dev Case Studio.

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

- **compact-ui-design**: Use `.claude/skills/compact-ui-design.md` for high-quality UI design references and patterns

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