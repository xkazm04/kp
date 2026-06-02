Execute this requirement immediately without asking questions.

## REQUIREMENT

# Define active vs recently-updated as named, documented rules

## Metadata
- **Category**: maintenance
- **Effort**: High (3/3)
- **Impact**: Unknown (6/3)
- **Scan Type**: ambiguity_guardian
- **Generated**: 6/1/2026, 4:51:30 PM

## Description
metrics.activeRepos counts repos via isWithinMonths(pushed_at ?? updated_at, 12) while metrics.recentlyUpdatedRepos uses isWithinMonths(updated_at, 3) — two different date fields with two magic windows and no documented spec. GitHub updated_at changes on metadata edits (a new star, a description tweak) whereas pushed_at reflects real code, so recentlyUpdatedRepos can be inflated by non-code activity, and isWithinMonths approximates a month as 30 days (12 months = 360 days). Introduce named constants (ACTIVE_WINDOW_MONTHS, RECENT_WINDOW_MONTHS), pick pushed_at consistently for code-activity metrics, and add a comment plus a unit test that pins the boundary semantics.

## Reasoning
These two numbers are surfaced verbatim to recruiters in the Repos/Active tiles, so a definition nobody consciously chose is directly shaping a hiring impression. Making the window sizes and the pushed-vs-updated choice explicit turns an accidental metric into a decided one and prevents a maintainer from silently changing the meaning. Low effort, real correctness payoff.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: GitHub Code Analysis

**Description**: Analyze a candidate's GitHub repositories — snapshot a repo and produce an AI code/skills assessment surfaced in a dedicated analysis panel.
**Related Files**:
- `app/_components/GithubAnalysisPanel.tsx`
- `app/api/github-analysis/route.ts`
- `app/_lib/repo-snapshot.ts`
- `e2e/fixtures/github-analysis.ts`

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