Execute this requirement immediately without asking questions.

## REQUIREMENT

# Make the bursty commit-cadence heuristic explicit

## Metadata
- **Category**: maintenance
- **Effort**: High (3/3)
- **Impact**: Unknown (5/3)
- **Scan Type**: ambiguity_guardian
- **Generated**: 6/1/2026, 4:51:31 PM

## Description
In fetchRepoSignals, bursty is computed as spanHours <= Math.max(6, times.length), which compares a duration in hours against a count of commits — a unit mismatch no new developer could explain or safely tune. The field feeds a durable submission signal (likely meant to flag a whole repo committed in one short sitting), yet what bursty is supposed to detect, and why 6, is undocumented. Replace it with a named, unit-correct rule (for example BURSTY_WINDOW_HOURS plus a minimum commit count), document the intent in the RepoSignals type, and add a unit test with a clearly bursty and a clearly spread-out fixture.

## Reasoning
Cadence is being used as evidence about how a candidate works, so a heuristic that mixes hours and counts can mislabel honest histories and is impossible to calibrate with confidence. Pinning it to an explicit, tested rule turns an unexplained one-liner into a checkable invariant. The change is tiny and isolated to one function.

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