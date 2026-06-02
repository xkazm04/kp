Execute this requirement immediately without asking questions.

## REQUIREMENT

# Promote comment-enums to one typed source of truth

## Metadata
- **Category**: code_quality
- **Effort**: High (3/3)
- **Impact**: Unknown (6/3)
- **Scan Type**: zen_architect
- **Generated**: 6/1/2026, 4:03:24 PM

## Description
The four probe kinds (ambiguity|legacy_trap|verification_trap|underspecified) are hardcoded across ~7 sites � models.py docstrings, design.py coerce (twice), reflect.py, and as PROBE_KINDS in lifecycle_eval.py � and seniority (junior|medior|senior|lead) and the five dimension names recur just as widely, each re-validated by hand. Define each ONCE as a Literal/Enum or frozenset next to RUBRIC_DIMENSIONS (the pattern the codebase already proved), import everywhere, and delete the per-site re-validation in every coerce() and _check_*.

## Reasoning
These documented-in-comments enums are a drift trap: design.py defaults an invalid kind to 'ambiguity' while reflect.py echoes kind verbatim, so the same value is validated inconsistently. A single typed definition makes the allowed set self-enforcing, kills the scattered membership checks, and follows the RUBRIC_DIMENSIONS single-source-of-truth discipline the team already trusts.

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