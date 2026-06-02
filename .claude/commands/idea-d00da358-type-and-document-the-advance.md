Execute this requirement immediately without asking questions.

## REQUIREMENT

# Type and document the advance/hold/reject contract

## Metadata
- **Category**: maintenance
- **Effort**: High (3/3)
- **Impact**: Unknown (5/3)
- **Scan Type**: ambiguity_guardian
- **Generated**: 6/2/2026, 4:00:46 PM

## Description
The recommendation values advance|hold|reject (and screen route advance) exist only inside a Python prompt string, yet they drive real UI: InterviewTranscriptModal types scorecard.recommendation as a bare string and hands it to InterviewRecommendationBadge, and automation-run.ts branches on result.route/recommendation untyped. Define a shared TS union (e.g. type InterviewRecommendation = advance|hold|reject), validate the LLM output against it at the parse boundary, and document the canonical set plus the chosen fallback for an unknown/empty value.

## Reasoning
Today an unexpected or misspelled recommendation from the model would slip through to the badge and silently render a default with no warning, and a new developer has no single place that states the legal values. Pinning the enum in types and validating it makes the contract explicit, catches model drift early, and removes guesswork about what hold actually means downstream.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Interview Prep & Rubric

**Description**: Generate per-candidate interview prep guides and scoring rubrics, and open prep / transcript modals from the schedule surface.
**Related Files**:
- `app/_lib/interview-prep.ts`
- `app/_lib/interview-prep-run.ts`
- `app/_lib/interview-rubric.ts`
- `app/api/interview-prep/route.ts`
- `app/features/sub_schedule/InterviewPrepModal.tsx`
- `app/features/sub_schedule/InterviewTranscriptModal.tsx`

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