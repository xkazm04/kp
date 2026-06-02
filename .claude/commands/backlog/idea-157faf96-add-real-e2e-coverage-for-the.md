Execute this requirement immediately without asking questions.

## REQUIREMENT

# Add real e2e coverage for the Profile Builder

## Metadata
- **Category**: maintenance
- **Effort**: High (3/3)
- **Impact**: Unknown (5/3)
- **Scan Type**: zen_architect
- **Generated**: 6/1/2026, 4:00:04 PM

## Description
Despite its name, e2e/profile-smoke.spec.ts exercises the Analyze flow (CV upload, job description, GitHub) and never touches ProfileTab, /api/profile, archetype routing, or completeness scoring, leaving the builder with zero end-to-end coverage. Add a focused spec that fills the intake, asserts archetype routing (including a self-declared-vs-signals contradiction), checks the completeness meter and missing list, and verifies a saved profile appears in the chips. Because the path is pure logic with no LLM, the test needs no Gemini key and stays fast and deterministic.

## Reasoning
A feature whose only test validates a different feature is effectively untested, so routing or scoring regressions ship silently. A deterministic, key-free spec is cheap to write and immediately guards the archetype and completeness logic that the rest of matching depends on.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Candidate Profile Builder

**Description**: Build and edit a structured candidate profile from evidence (CV, links, manual fields). The resulting profile feeds matching, analysis and the pipeline.
**Related Files**:
- `app/features/sub_profile/ProfileTab.tsx`
- `app/features/sub_profile/ProfileFields.tsx`
- `app/features/sub_profile/ProfileEvidenceColumn.tsx`
- `app/features/sub_profile/ProfileResultPanel.tsx`
- `app/features/sub_profile/ProfileTypes.ts`
- `app/api/profile/route.ts`
- `pipeline/jobfit/profile.py`
- `pipeline/jobfit/profile_cli.py`
- `pipeline/jobfit/seed_candidates.py`
- `e2e/profile-smoke.spec.ts`

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