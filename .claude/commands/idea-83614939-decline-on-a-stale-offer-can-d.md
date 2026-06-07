Execute this requirement immediately without asking questions.

## REQUIREMENT

# Decline on a stale offer can demote a hired candidate

## Metadata
- **Category**: code_quality
- **Effort**: High (3/3)
- **Impact**: Unknown (7/3)
- **Scan Type**: bug_hunter
- **Generated**: 6/2/2026, 5:21:44 PM

## Description
offer-finalize.ts respondToOffer() decline path calls markEntryStatus(entryId, "rejected"), which runs an UNCONDITIONAL UPDATE pipeline_entries SET status=rejected regardless of the entry's current stage/status. Multiple offers can exist for one entry (no per-entry uniqueness), and tokens never expire, so declining an old/duplicate offer link after the candidate already accepted another offer (Hired) silently flips them back to rejected. Notably actOnPipelineEntry's approve_event path already guards against this exact regression for schedule links, but the decline write does not. Fix: make markEntryStatus conditional (only transition from a non-terminal status, e.g. WHERE status NOT IN (hired,rejected) or WHERE stage != Hired) and log when the guard blocks the write.

## Reasoning
A single misdirected decline click silently corrupts a hired candidate's record to rejected, losing the hire and any downstream onboarding state with no audit trail. This is a data-integrity landmine that grows more likely the longer tokens live and the more re-extended offers pile up. The asymmetry with the already-guarded schedule path proves the protection is both necessary and easy to add.

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