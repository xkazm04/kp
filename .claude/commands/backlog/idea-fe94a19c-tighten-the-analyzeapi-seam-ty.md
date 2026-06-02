Execute this requirement immediately without asking questions.

## REQUIREMENT

# Tighten the AnalyzeApi seam: typed payload + stage SoT

## Metadata
- **Category**: maintenance
- **Effort**: Medium (2/3)
- **Impact**: Unknown (4/3)
- **Scan Type**: zen_architect
- **Generated**: 6/1/2026, 4:03:38 PM

## Description
submitAnalysis takes six positional arguments (cvFiles, jdFile, jdText, companyFile, companyText, jdSlug) that are trivial to transpose, even though AnalysisInputs already exists as the exact typed shape in runAnalysis.ts. Pass that object instead. In the same pass, delete the hand-retyped const stages: StageId[] inside watchAnalysis and import STAGE_ORDER from AnalysisProgress so the stage list has one source of truth instead of two copies that can silently diverge.

## Reasoning
A six-arg positional call is a quiet correctness hazard and the duplicated stage array means a future stage change must be made in two files or the animation desyncs from the model. Both fixes are near-zero-risk, delete code, and make the client/server seam self-describing.

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