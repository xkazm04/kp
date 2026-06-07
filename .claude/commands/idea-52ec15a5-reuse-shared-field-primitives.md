Execute this requirement immediately without asking questions.

## REQUIREMENT

# Reuse shared field primitives across profile forms

## Metadata
- **Category**: maintenance
- **Effort**: Unknown (4/3)
- **Impact**: Unknown (4/3)
- **Scan Type**: code_refactor
- **Generated**: 6/3/2026, 9:57:09 AM

## Description
ProfileFields.tsx exports Section/Text/Pick/Check primitives, but ProfileEvidenceColumn.tsx re-implements raw <input>/<select> elements and ArchetypeManager.tsx defines its own local Field wrapper � both repeat the identical Tailwind string (focus-ring h-9 ... rounded-md border border-stone-200 px-2 text-base) ~16 times across the two files. Extract a single styled Input/Select primitive (or reuse Text/Pick) and route every profile-form control through it, deleting the duplicated markup and the redundant local Field component.

## Reasoning
The field styling is copy-pasted in three components, so a border, height, or focus-ring tweak today means editing a dozen scattered class strings and risking drift. Consolidating onto one primitive shrinks the form components, guarantees visual consistency, and makes future field-level changes a one-line edit.

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