Execute this requirement immediately without asking questions.

## REQUIREMENT

# Pin salary confidence to a known vocabulary

## Metadata
- **Category**: maintenance
- **Effort**: High (3/3)
- **Impact**: Unknown (5/3)
- **Scan Type**: ambiguity_guardian
- **Generated**: 6/1/2026, 4:26:39 PM

## Description
salary.confidence is typed as a free-form z.string(), but SalaryGauge maps only low/medium/high to a fill opacity and falls back to opacity 1 for anything else � so confidence values like moderate, unknown, or Medium-High render visually identical to high. Define the canonical confidence vocabulary once, enforce it in the schema/codegen (enum), normalize casing, and make unrecognized values render neutrally rather than as full-confidence.

## Reasoning
Confidence is a trust signal, and silently drawing a medium/unknown estimate at full opacity overstates certainty to the user. Pinning the vocabulary makes the visual encoding faithful and removes a quiet failure mode shared by SalaryGauge and the ConfidenceBadge.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Analysis Results & Reporting

**Description**: Renders the multi-tab candidate report — job-fit, salary, interview, extraction and compare — with score dials, factor charts and AI disclosures, and persists/reopens past analyses from history.
**Related Files**:
- `app/_components/results/ResultPanel.tsx`
- `app/_components/results/shared.tsx`
- `app/_components/results/job-fit/JobFitTab.tsx`
- `app/_components/results/job-fit/MissingSkillsTiers.tsx`
- `app/_components/results/job-fit/SkillChips.tsx`
- `app/_components/results/salary/SalaryTab.tsx`
- `app/_components/results/salary/SalaryGauge.tsx`
- `app/_components/results/interview/InterviewTab.tsx`
- `app/_components/results/extraction/ExtractionTab.tsx`
- `app/_components/results/compare/CompareTab.tsx`
- `app/_components/ScoreDial.tsx`
- `app/_components/ScoreBadge.tsx`
- `app/_components/FactorChart.tsx`
- `app/_components/Meter.tsx`
- `app/_components/AiDisclosure.tsx`
- `app/_components/DisclosureRow.tsx`
- `app/_lib/comparison.ts`
- `app/api/analyses/route.ts`
- `app/api/analyses/[slug]/route.ts`
- `app/features/sub_history/HistoryTab.tsx`
- `app/history/[slug]/page.tsx`
- `scripts/compare.py`

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