Execute this requirement immediately without asking questions.

## REQUIREMENT

# Canonicalize the candidate-facing link base URL

## Metadata
- **Category**: maintenance
- **Effort**: High (3/3)
- **Impact**: Unknown (5/3)
- **Scan Type**: ambiguity_guardian
- **Generated**: 6/3/2026, 9:57:07 AM

## Description
CandidateDrawer builds voice and scheduling links from window.location.origin (client side), while /api/pipeline/[id] builds the offer link from process.env.APP_BASE_URL ?? request origin (server side). Behind a proxy, or when a recruiter uses localhost while candidates need a public host, these diverge and candidate links break. Introduce one helper (e.g. publicBaseUrl()) that both client and server resolve from a single documented source, with an explicit precedence: APP_BASE_URL over request/window origin.

## Reasoning
These links are sent to external candidates, so an inconsistent base URL is a silent, outward-facing failure that only surfaces in non-localhost deploys. A single canonical resolver removes the ambiguity and the deploy-time footgun before real candidate links go out wrong.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Pipeline Board & Scheduler

**Description**: The kanban-style ATS board tracking candidates across stages, with a candidate drawer, live SSE updates and an automated stage scheduler that advances entries on a policy pass.
**Related Files**:
- `app/features/sub_pipeline/PipelineTab.tsx`
- `app/features/sub_pipeline/PipelineBoard.tsx`
- `app/features/sub_pipeline/PipelineShared.tsx`
- `app/features/sub_pipeline/PipelineTypes.ts`
- `app/features/sub_pipeline/CandidateDrawer.tsx`
- `app/features/sub_pipeline/CandidateDrawerTypes.ts`
- `app/features/sub_pipeline/CandidateResultView.tsx`
- `app/features/sub_pipeline/SchedulerControl.tsx`
- `app/api/pipeline/route.ts`
- `app/api/pipeline/[id]/route.ts`
- `app/api/pipeline/events/route.ts`
- `app/_lib/scheduler.ts`
- `app/_lib/scheduler-store.ts`
- `pipeline/jobfit/seed_pipeline.py`

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