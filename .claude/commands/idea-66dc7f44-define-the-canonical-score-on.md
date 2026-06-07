Execute this requirement immediately without asking questions.

## REQUIREMENT

# Define the canonical score on CaseEvaluation

## Metadata
- **Category**: maintenance
- **Effort**: Unknown (4/3)
- **Impact**: Unknown (6/3)
- **Scan Type**: ambiguity_guardian
- **Generated**: 6/3/2026, 10:41:20 AM

## Description
CaseEvaluation carries three overlapping score representations: the legacy scalars structure_score/judgment_score/architecture_score, the dimension_scores dict, and the ordered dimensions list - yet only the latter two map to the five-capability rubric. evaluate.py's LLM coerce path scores structureScore/judgmentScore/architectureScore independently of dimensionScores, so they can silently diverge, and structure_score has no rubric dimension at all. Pick one authoritative representation, document what (if anything) structure_score means, and either derive the scalars from dimension_scores or drop them.

## Reasoning
A reviewer or the UI reading judgment_score versus dimension_scores['judgment'] can get two different numbers from the same evaluation, and nobody can say which is correct. Resolving it removes a latent correctness trap and makes the evaluation contract trustworthy and onboarding-friendly.

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