Execute this requirement immediately without asking questions.

## REQUIREMENT

# Define the duplicate-application policy for apply

## Metadata
- **Category**: functionality
- **Effort**: High (3/3)
- **Impact**: Unknown (6/3)
- **Scan Type**: ambiguity_guardian
- **Generated**: 6/1/2026, 4:49:56 PM

## Description
The POST handler creates a new Sourced pipeline entry on every accepted submission with no dedup, so the same person can apply repeatedly to one role and generate many entries (the fallback candidateId is freshly random and time-based each time). Decide the intended policy � block, merge, or allow duplicates keyed on something like name plus jobId or a contact field � and enforce it around createPipelineEntry, surfacing repeat applies rather than silently duplicating.

## Reasoning
Whether duplicate applications are allowed is an unmade decision that currently defaults to always creating another entry, which pollutes recruiter pipelines and skews funnel analytics. Making the policy explicit keeps the Sourced stage trustworthy and clarifies behavior for both recruiters and future maintainers.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Conversational Apply

**Description**: The candidate-facing application experience reached via a token link — a conversational apply flow that captures the applicant and feeds them into the recruiting pipeline.
**Related Files**:
- `app/apply/[id]/page.tsx`
- `app/apply/[id]/ConversationalApply.tsx`
- `app/api/apply/[id]/route.ts`
- `app/_lib/apply.ts`

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