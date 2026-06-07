Execute this requirement immediately without asking questions.

## REQUIREMENT

# Make salary comparison currency-explicit and safe

## Metadata
- **Category**: user_benefit
- **Effort**: Unknown (4/3)
- **Impact**: Unknown (6/3)
- **Scan Type**: ambiguity_guardian
- **Generated**: 6/2/2026, 5:17:35 PM

## Description
salaryExpectationOf defaults a candidates currency to "CZK", while roleSalaryBand is a bare [min,max] number pair carrying no currency at all. GroupEvalModals SalaryCell plots the candidate midpoint against that band and prints a confident "X% over/under" with no currency check, so an expectation in EUR against a CZK band yields a meaningless verdict. Decide the contract: assume one currency app-wide and assert it, or carry currency on the role band and convert/skip on mismatch.

## Reasoning
The over/under-band verdict is shown as a hard signal that shapes advance and offer decisions, but it silently assumes every salary shares one currency. Making the currency assumption explicit prevents a misleading 30% over band badge from steering a hire the wrong way.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Decision Workflow & Group Eval

**Description**: Review AI recommendations and make advance/reject decisions per role, run group evaluations across a candidate pool, and configure decision rules and screening waves.
**Related Files**:
- `app/features/sub_decisions/DecisionsTab.tsx`
- `app/features/sub_decisions/DecisionsShared.tsx`
- `app/features/sub_decisions/DecisionsTypes.ts`
- `app/features/sub_decisions/RoleDecisionRow.tsx`
- `app/features/sub_decisions/AiReviewCard.tsx`
- `app/features/sub_decisions/AnalysisSummaryModal.tsx`
- `app/features/sub_decisions/DecisionRulesModal.tsx`
- `app/features/sub_decisions/GroupEvalModal.tsx`
- `app/api/decisions/config/route.ts`
- `app/api/decisions/group-eval/route.ts`
- `app/api/decisions/screen-wave/route.ts`
- `app/_lib/decision-config-store.ts`
- `app/_lib/group-eval.ts`
- `app/_lib/group-eval-run.ts`
- `app/_lib/screen-wave.ts`

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