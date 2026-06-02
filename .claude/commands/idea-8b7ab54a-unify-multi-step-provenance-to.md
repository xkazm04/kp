Execute this requirement immediately without asking questions.

## REQUIREMENT

# Unify multi-step provenance to one tri-state collapse

## Metadata
- **Category**: maintenance
- **Effort**: High (3/3)
- **Impact**: Unknown (6/3)
- **Scan Type**: ambiguity_guardian
- **Generated**: 6/2/2026, 4:07:26 PM

## Description
devcase_cli._combine_source() returns a tri-state (llm / partial / deterministic) and its docstring explicitly flags the older binary llm-if-any collapse as misleading, yet submission_eval.run_one() and lifecycle_eval.run_one() still use exactly that binary form to set Row.source. Extract _combine_source into a shared helper and have both eval harnesses call it, so a mixed run reads as partial everywhere and the llm_rows count plus --strict gating reflect reality.

## Reasoning
Two definitions of the same how-degraded-was-this-run concept live side by side, and one is already declared wrong in its own docstring, so the eval reports overstate LLM coverage whenever any single step falls back. Centralizing the rule makes partial mean the same thing in the CLI and the evals and stops the two from drifting apart.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Dev Case Python Engine

**Description**: Backend intelligence for developer cases — design cases, source and analyze repos, evaluate submissions against scenarios, run lifecycle audits and reflection, with shared dev-case models.
**Related Files**:
- `pipeline/jobfit/devcase/__init__.py`
- `pipeline/jobfit/devcase/design.py`
- `pipeline/jobfit/devcase/source.py`
- `pipeline/jobfit/devcase/analyze.py`
- `pipeline/jobfit/devcase/evaluate.py`
- `pipeline/jobfit/devcase/submission_eval.py`
- `pipeline/jobfit/devcase/submission_scenarios.py`
- `pipeline/jobfit/devcase/scenarios.py`
- `pipeline/jobfit/devcase/lifecycle_eval.py`
- `pipeline/jobfit/devcase/lifecycle_audits.py`
- `pipeline/jobfit/devcase/reflect.py`
- `pipeline/jobfit/devcase/models.py`
- `pipeline/jobfit/devcase/devcase_cli.py`

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