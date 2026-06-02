Execute this requirement immediately without asking questions.

## REQUIREMENT

# Live template preview in the template manager

## Metadata
- **Category**: functionality
- **Effort**: High (3/3)
- **Impact**: Unknown (5/3)
- **Scan Type**: zen_architect
- **Generated**: 6/1/2026, 4:10:28 PM

## Description
JdTemplateManager edits raw {{placeholder}} markdown blind, even though render-template.ts is explicitly pure and client-safe. Add a split-pane live preview that renders the editing body against sample TemplateData via renderTemplate(), so authors see exactly how their branded JD looks � including the placeholder list � as they type.

## Reasoning
The renderer already exists and is safe to call client-side; surfacing it turns blind markdown editing into a confident, WYSIWYG-ish experience. It removes the guesswork that leads to broken or malformed templates reaching real published JDs.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: JD Library & Builder

**Description**: Create, AI-generate, template and store job descriptions; browse the JD library and render public JD pages. Saved JDs are reusable inputs for analysis and matching.
**Related Files**:
- `app/features/sub_library/LibraryTab.tsx`
- `app/features/sub_library/LibraryJdForm.tsx`
- `app/features/sub_library/JdBuilder.tsx`
- `app/features/sub_library/JdBuilderResult.tsx`
- `app/features/sub_library/JdTemplates.tsx`
- `app/features/sub_library/JdTemplateManager.tsx`
- `app/features/sub_library/render-template.ts`
- `app/api/jds/route.ts`
- `app/api/jds/[slug]/route.ts`
- `app/api/jds/save/route.ts`
- `app/api/jds/save/ingest-job.ts`
- `app/api/templates/route.ts`
- `app/api/templates/[id]/route.ts`
- `app/_lib/jd-build-run.ts`
- `app/_lib/jd-limits.ts`
- `app/_lib/templates-store.ts`
- `app/jds/[slug]/page.tsx`
- `app/jds/[slug]/JdBody.tsx`

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