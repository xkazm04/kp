Execute this requirement immediately without asking questions.

## REQUIREMENT

# Define what rematch does to the source pipeline entry

## Metadata
- **Category**: functionality
- **Effort**: High (3/3)
- **Impact**: Unknown (6/3)
- **Scan Type**: ambiguity_guardian
- **Generated**: 6/3/2026, 10:45:46 AM

## Description
In automation-run.ts the rematch branch calls createPipelineEntry(...stage:"Screened") for the alternative job and records a rematched event, but never closes or rejects the original entry. automation.py documents rematch as for a "rejected/idle candidate", yet nothing enforces the source is inactive, so rematching an active entry yields TWO active entries for one candidate, both independently automatable. Decide and encode the contract: guard that the source is non-active (or auto-close it on rematch), and record the source->target link so the funnel never double-counts one person.

## Reasoning
An unresolved source entry means a candidate can appear twice in the active funnel and be advanced/rejected/emailed twice by the policy pass. Pinning the lifecycle prevents duplicate automation and confusing funnel counts, and makes the rematch state transition explicit instead of accidental.

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