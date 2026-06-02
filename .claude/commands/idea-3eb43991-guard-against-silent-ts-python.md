Execute this requirement immediately without asking questions.

## REQUIREMENT

# Guard against silent TS/Python interview-rubric drift

## Metadata
- **Category**: maintenance
- **Effort**: High (3/3)
- **Impact**: Unknown (6/3)
- **Scan Type**: ambiguity_guardian
- **Generated**: 6/2/2026, 4:00:35 PM

## Description
interview-rubric.ts opens with a comment calling itself a Mirror of RATING_ANCHORS and INTERVIEW_RUBRIC in pipeline/jobfit/automation.py, but nothing enforces that the two copies agree. Add a test (or a tiny build-time check) that asserts the TS RATING_ANCHORS keys/labels and the INTERVIEW_RUBRIC competency list/order match the Python source exactly, failing CI on drift. Generate one side from the other, or load a shared JSON fixture, so the single source of truth is real rather than aspirational.

## Reasoning
The whole point of a fixed rubric is that every candidate is scored on the SAME comparable axes; if Python adds a sixth competency or rewords an anchor, the TS mirror silently diverges and the InterviewTranscriptModal renders a stale scale with no error. Making the parity checkable converts a fragile verbal convention into an enforced contract and prevents a class of comparability bugs that would be nearly invisible in review.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Interview Prep & Rubric

**Description**: Generate per-candidate interview prep guides and scoring rubrics, and open prep / transcript modals from the schedule surface.
**Related Files**:
- `app/_lib/interview-prep.ts`
- `app/_lib/interview-prep-run.ts`
- `app/_lib/interview-rubric.ts`
- `app/api/interview-prep/route.ts`
- `app/features/sub_schedule/InterviewPrepModal.tsx`
- `app/features/sub_schedule/InterviewTranscriptModal.tsx`

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