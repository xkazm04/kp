Execute this requirement immediately without asking questions.

## REQUIREMENT

# Resolve the always-empty frameworks field in RepoSnapshot

## Metadata
- **Category**: maintenance
- **Effort**: Medium (2/3)
- **Impact**: Unknown (4/3)
- **Scan Type**: ambiguity_guardian
- **Generated**: 6/2/2026, 4:16:26 PM

## Description
RepoSnapshot in repo-snapshot.ts declares frameworks: string[], but buildRepoSnapshot hardcodes frameworks: [] and never populates it, while inferredStack IS derived from languages. A new developer reading the type assumes framework detection exists. Decide the intent: either implement detection (e.g. infer from topDirs/readme/package files), delete the field, or mark it explicitly reserved with a comment so the empty value is a documented decision rather than a silent gap.

## Reasoning
A typed field that is structurally promised but always empty is a trap: consumers may branch on it expecting data that never arrives. Making the decision explicit removes a phantom capability and clarifies whether framework inference is planned, abandoned, or intentionally out of scope.

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