Execute this requirement immediately without asking questions.

## REQUIREMENT

# Define apply submit-failure recovery for the candidate

## Metadata
- **Category**: user_benefit
- **Effort**: Unknown (4/3)
- **Impact**: Unknown (6/3)
- **Scan Type**: ambiguity_guardian
- **Generated**: 6/3/2026, 10:26:45 AM

## Description
In ConversationalApply.tsx a transient POST failure (network blip or a 500 from the route) sets error, and the render then returns ONLY the error paragraph � the whole chat plus every captured answer disappears. answeredRef has already marked every step answered, so there is no in-place retry; the candidate must fully reload the page, which restarts the conversation from the first question. Decide and implement a recovery contract: an inline Retry on the final submit that preserves answers and resets only the last step, versus a deliberate restart.

## Reasoning
A candidate who has answered every question and hits a one-off server hiccup loses the entire application with no obvious path back � a direct, silent funnel loss at the highest-intent moment. An explicit recovery policy converts a frustrating dead-end into a recoverable state and protects conversions the team likely assumes are succeeding.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Conversational Apply

**Description**: The candidate-facing application experience reached via a token link — a conversational apply flow that captures the applicant and feeds them into the recruiting pipeline.
**Related Files**:
- `app/apply/[id]/page.tsx`
- `app/apply/[id]/ConversationalApply.tsx`
- `app/api/apply/[id]/route.ts`
- `app/_lib/apply.ts`

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