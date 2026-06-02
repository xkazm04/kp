Execute this requirement immediately without asking questions.

## REQUIREMENT

# Make apply steps self-describing; retire KO_STEP_IDS

## Metadata
- **Category**: code_quality
- **Effort**: High (3/3)
- **Impact**: Unknown (6/3)
- **Scan Type**: zen_architect
- **Generated**: 6/1/2026, 4:13:31 PM

## Description
Today KO_STEP_IDS in app/_lib/apply.ts is a hand-maintained constant that must mirror the knockout steps buildApplyScript conditionally emits, and the POST handler re-derives knockouts from it. Fold the knockout semantics into each step (e.g. a knockout:{failOn:false} field on the ApplyStep), and have the evaluator derive failure by re-building the script and inspecting the steps themselves. The parallel list disappears and one source of truth drives both rendering and evaluation.

## Reasoning
The current split guarantees silent drift: add a KO step in buildApplyScript, forget the constant, and the gate never fires. A self-describing step makes the script the single authority, so knockout behavior can never disagree with what the candidate was actually asked.

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