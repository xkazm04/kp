Execute this requirement immediately without asking questions.

## REQUIREMENT

# Centralize JD-by-slug loading inside useAnalyzeJdLibrary

## Metadata
- **Category**: maintenance
- **Effort**: High (3/3)
- **Impact**: Unknown (5/3)
- **Scan Type**: code_refactor
- **Generated**: 6/3/2026, 10:03:32 AM

## Description
The same fetch(/api/jds/{slug}) then setJobDescriptionText(body) flow is written twice: inline in AnalyzeForm onPick (AnalyzeForm.tsx around line 92) and again in useAnalyzeJdLibrary for the ?jd= URL param (useAnalyzeJdLibrary.ts around line 28). The presentational form should not contain network code. Move the load-full-JD-by-slug logic into the hook as a single pickJd(slug) function that fetches the body, sets the textarea, and records selectedJdSlug, then have AnalyzeForm and the URL-param effect both call it. The form just wires onPick to library.pickJd.

## Reasoning
One JD-loading path means the preview-to-full-body fetch, error handling, and slug bookkeeping cannot drift between the dropdown and the deep-link entry points, and the hook finally owns all JD library access as its name implies. It also untangles a fetch from a render component, making the form easier to read and test and setting up the planned JD-source-union work.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: CV Analysis Workspace

**Description**: Upload or paste a CV and a job description, then run an AI job-fit analysis with live scan progress. The primary intake surface (Analyze tab) for evaluating a single candidate against a role.
**Related Files**:
- `app/features/sub_analyze/AnalyzeTab.tsx`
- `app/features/sub_analyze/AnalyzeWorkspace.tsx`
- `app/features/sub_analyze/AnalyzeColumn.tsx`
- `app/features/sub_analyze/AnalyzeForm.tsx`
- `app/features/sub_analyze/AnalyzeFormCollapsed.tsx`
- `app/features/sub_analyze/AnalyzeFileDropZone.tsx`
- `app/features/sub_analyze/AnalyzePasteRow.tsx`
- `app/features/sub_analyze/AnalyzeProfileInput.tsx`
- `app/features/sub_analyze/AnalyzeSavedJdPicker.tsx`
- `app/features/sub_analyze/AnalyzeApi.ts`
- `app/features/sub_analyze/AnalyzeTypes.ts`
- `app/features/sub_analyze/runAnalysis.ts`
- `app/features/sub_analyze/useAnalyzeForm.ts`
- `app/features/sub_analyze/useAnalyzeJdLibrary.ts`
- `app/features/sub_analyze/useGlobalFileDrag.ts`
- `app/api/analyze/route.ts`
- `app/api/extract-text/route.ts`
- `app/_lib/analyze-run.ts`
- `app/_lib/upload-constraints.ts`
- `app/_components/AnalysisProgress.tsx`
- `app/_components/ScanAnimation.tsx`

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