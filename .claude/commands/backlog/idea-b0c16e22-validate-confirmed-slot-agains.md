Execute this requirement immediately without asking questions.

## REQUIREMENT

# Validate confirmed slot against currently-proposed slots

## Metadata
- **Category**: functionality
- **Effort**: High (3/3)
- **Impact**: Unknown (6/3)
- **Scan Type**: ambiguity_guardian
- **Generated**: 6/1/2026, 4:15:44 PM

## Description
The POST in app/api/schedule/[token]/route.ts trusts the client-supplied body.slot (label) and body.slotAt (ISO) verbatim - SchedulePicker sends both, but the server never checks that slotAt is one of the slots proposeSlots() currently offers, that the label matches that slotAt, or that the time is still in the future. A crafted or replayed request can book an arbitrary, past, or non-business-hours time, and confirmScheduleInvite() only guards against an exact-string collision. Decide the validation contract: recompute the proposable set server-side and reject any slotAt not in it (and any slot_at <= now), returning a clear 422.

## Reasoning
Right now the candidate page is the only thing enforcing which times are bookable, so the server has no spec for a valid slot - the booking calendar trusts whatever arrives. This is a correctness and light security gap that can silently produce interviews at impossible times that reminders and the recruiter calendar cannot represent. Validating server-side turns an implicit client-only rule into an enforced contract.

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