Execute this requirement immediately without asking questions.

## REQUIREMENT

# Fix the four broken job-keyed handoffs (Channels, Analytics, Library, Jobs)

## Metadata
- **Category**: functionality
- **Effort**: Low (1/3)
- **Impact**: High (3/3)
- **Scan Type**: cx_journey_cartographer
- **Generated**: 6/12/2026, 11:49:55 AM
- **Direction**: 4 — Job as connective tissue: one role, one place, every lens

## Description
Four point fixes, all using the existing buildUrl deep-link infra in app/features/tabs.ts. (1) Channels webhook creation with zero jobs dead-stops with a bare "no jobs" message (ChannelsTab.tsx ~201) — link it to the Library JD builder ("Create a job description first") or Jobs tab. (2) The Analytics automation panel reports raised holds (sub_analytics/AutomationPanel.tsx ~333-338) with no path to act — link the holds figure to the Decisions tab. (3) The Analytics source/ROI panel (SourcePanel.tsx ~360) reports per-channel economics with no path to the Channels config — link each channel row to Channels. (4) The Jobs tab empty state (JobsShared.tsx ~112-144) offers only "clear filters" — when genuinely empty, point to the Library tab/JD builder where jobs are born. These complement the ANA1 funnel→board deep links that already work; the principle is every number that implies an action links to where the action happens.

## Reasoning
Each fix is an hour of work, and together they repair the role lifecycle chain: JD authored → job published → channels listening → funnel measured → automation supervised. Analytics in particular currently behaves as a read-only endpoint of the story; giving its figures destinations makes it a navigation instrument instead of a report.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Job-keyed handoff sites

**Related Files**:
- `app/features/sub_channels/ChannelsTab.tsx`
- `app/features/sub_analytics/AutomationPanel.tsx`
- `app/features/sub_analytics/SourcePanel.tsx`
- `app/features/sub_analytics/AnalyticsTab.tsx`
- `app/features/sub_jobs/JobsShared.tsx`
- `app/features/tabs.ts`

**Post-Implementation**: After completing this requirement, evaluate if the context description or file paths need updates. Use the appropriate API/DB query to update the context if architectural changes were made.

## Recommended Skills

Use Claude Code skills as appropriate for implementation guidance. Check `.claude/skills/` directory for available skills.

## Notes

This requirement was generated from a CX scan of cross-tab handoffs (June 2026). It is part of Direction 4 (job as connective tissue) together with idea-c91ec8b1 (job mission-control hub).

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
