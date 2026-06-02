Execute this requirement immediately without asking questions.

## REQUIREMENT

# Make cover-probe reveals a required, enforced field

## Metadata
- **Category**: maintenance
- **Effort**: High (3/3)
- **Impact**: Unknown (6/3)
- **Scan Type**: ambiguity_guardian
- **Generated**: 6/2/2026, 4:07:30 PM

## Description
lifecycle_eval._check_case() flags probe missing reveals as a reliability failure, but design.py coerce() accepts an LLM probe with reveals set to an empty string and CoverProbe.reveals defaults to empty, so a valid LLM design can fail the very validator it is meant to satisfy. Decide that reveals is mandatory (it is, given the whole purpose of a covert probe) and enforce it in one place: have coerce() backfill or drop probes with empty reveals, and document the rule on the CoverProbe model.

## Reasoning
The producer and the validator currently disagree on whether a probe must explain what it reveals, so LLM-designed cases can be marked unreliable for a field the design code never guaranteed. Closing the gap removes spurious reliability failures and makes the probe contract trustworthy and self-documenting.

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