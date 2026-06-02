Execute this requirement immediately without asking questions.

## REQUIREMENT

# Name and document the silent extraction caps

## Metadata
- **Category**: maintenance
- **Effort**: High (3/3)
- **Impact**: Unknown (5/3)
- **Scan Type**: ambiguity_guardian
- **Generated**: 6/1/2026, 4:42:02 PM

## Description
Several magic caps silently drop data with no rationale or flag: detected_skills truncates to 30 in the pipeline (40 default in taxonomy), evaluate_keyword_coverage slices hits to 24, missing to 12, and over_used to 6, and _keyword_status encodes an unstated keyword-stuffing rule (in_cv at least 6 and in_cv greater than in_jd times 3). Promote these to named, commented constants, document the stuffing threshold, and decide whether a truncated list should carry a plus-N-more indicator.

## Reasoning
Undocumented limits read as complete coverage when they are not, and the keyword-stuffing policy is a product decision currently buried in a literal. Naming and documenting them makes the behavior reviewable and prevents misreading a capped list as the full picture.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Scoring & Extraction Engine (Python)

**Description**: The Python job-fit pipeline: parses CV text, builds candidate profiles, scores fit vs a JD, detects archetypes, flags ATS issues, maps transferable skills and estimates salary bands using Gemini.
**Related Files**:
- `pipeline/jobfit/pipeline.py`
- `pipeline/jobfit/service.py`
- `pipeline/jobfit/cli.py`
- `pipeline/jobfit/models.py`
- `pipeline/jobfit/extractors.py`
- `pipeline/jobfit/extract_cli.py`
- `pipeline/jobfit/profiling.py`
- `pipeline/jobfit/insights.py`
- `pipeline/jobfit/soft_signals.py`
- `pipeline/jobfit/archetype.py`
- `pipeline/jobfit/ats.py`
- `pipeline/jobfit/taxonomy.py`
- `pipeline/jobfit/transferable.py`
- `pipeline/jobfit/transform.py`
- `pipeline/jobfit/gemini.py`
- `pipeline/jobfit/_summary.py`
- `pipeline/jobfit/market_salary_cli.py`
- `pipeline/jobfit/logger.py`
- `app/_lib/salary-band.ts`
- `scripts/analyze.py`
- `scripts/salary.py`
- `scripts/jobfit.py`

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