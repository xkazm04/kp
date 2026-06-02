Execute this requirement immediately without asking questions.

## REQUIREMENT

# Define what devcase confidence scores mean

## Metadata
- **Category**: user_benefit
- **Effort**: Unknown (4/3)
- **Impact**: Unknown (6/3)
- **Scan Type**: ambiguity_guardian
- **Generated**: 6/2/2026, 4:07:42 PM

## Description
NeedAnalysis, CommitReflection and ToolingSignal each carry a confidence float, with deterministic paths hardcoding magic values (0.5 with a snapshot, 0.3 ungrounded, 0.3 for reflection, 0.2 for tooling) and the LLM path free to return anything in 0..1, yet nothing documents what the scale means or consumes it. Write down the scale (what low versus high implies, and that deterministic fallbacks are deliberately low) and wire one concrete consumer, for example surface it beside the provenance partial badge or warn reviewers below a threshold.

## Reasoning
Reviewers see a number with no defined meaning and no effect on anything, so it neither builds nor calibrates trust in the evaluation. Giving confidence a documented scale and a visible consumer turns a decorative field into an honest how-much-to-trust-this signal for hiring decisions.

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