Execute this requirement immediately without asking questions.

## REQUIREMENT

# Add a distinct empty state to codeReview.status

## Metadata
- **Category**: maintenance
- **Effort**: High (3/3)
- **Impact**: Unknown (5/3)
- **Scan Type**: ambiguity_guardian
- **Generated**: 6/2/2026, 4:16:27 PM

## Description
codeReview.status is enum([disabled, ok, error]), but ok is returned both for a real Gemini review AND for the no-owned-public-repositories case (route.ts returns status ok with an empty skills payload and summary No owned public repositories were available to review). A consumer that treats status===ok as we have evidenced-skills data is wrong in the empty case. Add a distinct skipped/empty status (and a matching CodeReviewStatusBadge label) so the four states - disabled, nothing-to-review, reviewed, error - are each unambiguous.

## Reasoning
Overloading ok to mean both successfully reviewed and successfully found nothing to review forces every reader to also inspect the summary string to know what actually happened. A dedicated state makes the badge, the schema, and downstream logic self-describing and prevents an empty review from being mistaken for a positive result.

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