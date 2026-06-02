Execute this requirement immediately without asking questions.

## REQUIREMENT

# Document and justify the calibration heuristics

## Metadata
- **Category**: maintenance
- **Effort**: High (3/3)
- **Impact**: Unknown (5/3)
- **Scan Type**: ambiguity_guardian
- **Generated**: 6/2/2026, 4:04:54 PM

## Description
calibrate() in dev-outcomes.ts decides whether to tell a human to move the promote floor using several unexplained constants: the fixed BANDS boundaries [0,55,70,85,101], the >= 0.5 majority-hire test for a usable band, the 85 fallback when no band converts, the 0.05 monotonicity tolerance for predictive, and the minimum of 4 resolved outcomes. Add comments/docstrings stating what each constant means, why those values, and the statistical caveat that bands with tiny counts (e.g. n=1) can flip predictive or suggestedFloor.

## Reasoning
These constants quietly drive a recommendation a human acts on (raising/lowering the floor), yet nobody reading the code can tell if 4 samples or a 0.05 tolerance are principled or arbitrary. Documenting them makes the calibration trustworthy and prevents over-reacting to noise from a near-empty band.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Dev Case Orchestration & API

**Description**: Server orchestration for the developer take-home pipeline — API routes for design/source/submit/publish/promote/lifecycle, plus the orchestrator, autonomy control gating and outcome calibration store.
**Related Files**:
- `app/api/devcase/route.ts`
- `app/api/devcase/source/route.ts`
- `app/api/devcase/submit/route.ts`
- `app/api/devcase/publish/route.ts`
- `app/api/devcase/promote/route.ts`
- `app/api/devcase/postings/route.ts`
- `app/api/devcase/outcomes/route.ts`
- `app/api/devcase/inbound/route.ts`
- `app/api/devcase/control/route.ts`
- `app/api/devcase/comms/route.ts`
- `app/api/devcase/lifecycle/route.ts`
- `app/api/devcase/lifecycle/[id]/approve/route.ts`
- `app/_lib/devcase-orchestrator.ts`
- `app/_lib/devcase-run.ts`
- `app/_lib/dev-control.ts`
- `app/_lib/dev-outcomes.ts`

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