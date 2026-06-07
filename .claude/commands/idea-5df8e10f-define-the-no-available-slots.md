Execute this requirement immediately without asking questions.

## REQUIREMENT

# Define the no-available-slots outcome for self-scheduling

## Metadata
- **Category**: functionality
- **Effort**: Unknown (4/3)
- **Impact**: Unknown (5/3)
- **Scan Type**: ambiguity_guardian
- **Generated**: 6/3/2026, 10:01:19 AM

## Description
schedule-store.proposeSlots searches a hardcoded 21-day horizon at two fixed times per day and skips booked slots; if all are taken it silently returns an empty array, and SchedulePicker shows a we will be in touch dead-end with no recruiter-side signal and no way forward for the candidate. Decide the fallback: widen or make the horizon configurable, expose a request more times action, and/or flag the entry for the recruiter when a candidate hits zero slots so the booking does not quietly stall.

## Reasoning
An empty slot list is an unhandled boundary that strands the candidate and is invisible to the recruiter, so a scheduling request can silently die. Deciding the zero-slots contract makes the self-scheduling flow robust at its busiest-calendar edge instead of relying on it never happening.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Scheduling & Offers

**Description**: Send interview-schedule invites and offer links via public token pages, let candidates pick slots, finalize offers and dispatch reminders.
**Related Files**:
- `app/features/sub_schedule/ScheduleTab.tsx`
- `app/features/sub_schedule/ScheduleCalendar.tsx`
- `app/features/sub_schedule/ScheduleTypes.ts`
- `app/api/schedule/invite/route.ts`
- `app/api/schedule/[token]/route.ts`
- `app/api/offer/[token]/route.ts`
- `app/_lib/schedule-store.ts`
- `app/_lib/offers-store.ts`
- `app/_lib/offer-finalize.ts`
- `app/_lib/interview-reminders.ts`
- `app/schedule/[token]/page.tsx`
- `app/schedule/[token]/SchedulePicker.tsx`
- `app/offer/[token]/page.tsx`
- `pipeline/jobfit/seed_interview_calendar.py`

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