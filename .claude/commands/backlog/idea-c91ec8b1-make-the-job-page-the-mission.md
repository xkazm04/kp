Execute this requirement immediately without asking questions.

## REQUIREMENT

# Make the job page the mission-control hub for its role

## Metadata
- **Category**: functionality
- **Effort**: High (3/3)
- **Impact**: High (3/3)
- **Scan Type**: cx_journey_cartographer
- **Generated**: 6/12/2026, 11:49:55 AM
- **Direction**: 4 — Job as connective tissue: one role, one place, every lens

## Description
Almost every tab is keyed by job (JD library entry → Jobs posting → Channels webhooks per role → Pipeline ?job/?q filter → Matrix ?job column → Analytics by-role rows → Dev cases per JD), yet no surface assembles that into one view. Upgrade the job modal/page (sub_jobs/JobPostingModal.tsx, which already links to Matrix via ?job=) into a hub with a lifecycle strip — JD → channels listening → funnel counts by stage → pending decisions → interviews booked → offers out — where every segment deep-links to the owning tab with job context: the JD source in Library, webhook status per channel (Channels), the board filtered to the role (?tab=pipeline&q=), the Decisions role group, Matrix ranking (?tab=matrix&job=), and the Analytics by-role row. Reuse existing endpoints/counters wherever they exist (attention buckets, /api/pipeline filters, analytics by-role aggregation) rather than introducing a new aggregate API unless genuinely needed; the deliverable is connection, not new data.

## Reasoning
The recruiter's actual mental model is "how is my Frontend role doing?", and today answering it requires visiting six tabs and re-applying the job filter in each. A job hub gives the showcase a spine at the role level the same way the candidate timeline (idea-c6524f2f) does at the person level — together they cover both protagonists of the hiring story.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Job-keyed surfaces

**Related Files**:
- `app/features/sub_jobs/JobPostingModal.tsx`
- `app/features/sub_jobs/JobsShared.tsx`
- `app/features/sub_library/LibraryTab.tsx`
- `app/features/sub_channels/ChannelsTab.tsx`
- `app/features/sub_matrix/MatrixTab.tsx`
- `app/features/sub_analytics/AnalyticsTab.tsx`
- `app/features/sub_pipeline/PipelineTab.tsx`
- `app/api/jobs/` (job endpoints)
- `app/features/tabs.ts`

**Post-Implementation**: After completing this requirement, evaluate if the context description or file paths need updates. Use the appropriate API/DB query to update the context if architectural changes were made.

## Recommended Skills

Use Claude Code skills as appropriate for implementation guidance. Check `.claude/skills/` directory for available skills. Verify both themes (Studio Light / Spark Dark) per docs/design/README.md before finishing.

## Notes

This requirement was generated from a CX scan of cross-tab handoffs (June 2026). It is part of Direction 4 (job as connective tissue) together with idea-918bdc29 (job-keyed handoff fixes).

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
