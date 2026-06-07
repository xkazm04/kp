Execute this requirement immediately without asking questions.

## REQUIREMENT

# Stop reminding candidates of cancelled interviews

## Metadata
- **Category**: functionality
- **Effort**: Unknown (4/3)
- **Impact**: Unknown (6/3)
- **Scan Type**: bug_hunter
- **Generated**: 6/2/2026, 5:22:06 PM

## Description
interview-reminders.ts dueReminders() selects purely from schedule_invites WHERE status=confirmed AND reminder_sent_at IS NULL, never joining back to pipeline_entries. But when a recruiter rejects a candidate in ScheduleTab (act reject) or the entry is otherwise withdrawn after the slot was confirmed, only pipeline_entries is updated � the schedule_invite stays confirmed. Result: the ~24h heartbeat still fires a reminder for an interview that was cancelled. Fix: either join the due query to pipeline_entries and require the entry still be active/at the Interview stage, or add an explicit cancelScheduleInvite() called from the reject/withdraw paths that flips invite status so it drops out of the due set.

## Reasoning
Reminding a rejected candidate to attend a call that will not happen is an embarrassing, trust-eroding message that reaches the person directly. Because reminders run on an independent heartbeat that bypasses the policy scheduler, nothing else catches this � the invite and pipeline states silently diverge. Reconciling the two is the only place this can be fixed.

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