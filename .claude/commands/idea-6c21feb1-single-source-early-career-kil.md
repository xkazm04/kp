Execute this requirement immediately without asking questions.

## REQUIREMENT

# Single-source early-career; kill the shadowed literal

## Metadata
- **Category**: maintenance
- **Effort**: High (3/3)
- **Impact**: Unknown (7/3)
- **Scan Type**: ambiguity_guardian
- **Generated**: 6/3/2026, 10:45:46 AM

## Description
automation.py:47 sets _EARLY_CAREER = ("student", "career_switcher"), but automation.py:412 reassigns the same module global to registry.early_career_archetypes() before any function runs, so evaluate_entry/screen_candidate read the registry while the literal is dead and misleading. Meanwhile group_compare.py and match_reasoning.py STILL hardcode the same tuple, so two competing definitions of early-career coexist. Delete the dead literal, import the set from registry everywhere, and add a test asserting the literal-vs-registry sets match so a future registry change cannot silently diverge.

## Reasoning
Early-career detection drives the fairness gate (never auto-advance/reject students/switchers) � the most safety-critical invariant in this code. A divergence between the hardcoded tuple and the registry would silently mis-route protected candidates with zero error. Consolidating it makes the fairness rule trustworthy and onboard-able.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Automation Orchestration

**Description**: Run the end-to-end automated recruiting pipeline as scheduled or triggered passes — execute per-task automation, schedule runs and surface automation status across the funnel.
**Related Files**:
- `app/api/automation/run/route.ts`
- `app/api/automation/[task]/route.ts`
- `app/api/automation/schedule/route.ts`
- `app/_lib/automation-run.ts`
- `app/_lib/automation-pass.ts`
- `pipeline/jobfit/automation.py`
- `pipeline/jobfit/automation_cli.py`

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