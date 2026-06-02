Execute this requirement immediately without asking questions.

## REQUIREMENT

# Guard history detail page against DB read errors

## Metadata
- **Category**: code_quality
- **Effort**: Medium (2/3)
- **Impact**: Unknown (5/3)
- **Scan Type**: bug_hunter
- **Generated**: 6/2/2026, 4:22:58 PM

## Description
history/[slug]/page.tsx calls loadAnalysis(slug) with no try/catch. It handles not-found via notFound() and schema drift via safeParse, but lets any DB or IO exception (SQLITE_BUSY past the busy_timeout, disk error, an ensureDb seed failure) escape and crash the Server Component into a raw 500. The sibling /api/analyses/[slug] route already wraps the same call. Wrap the page read and render a styled error panel like its schema-drift branch.

## Reasoning
A transient DB lock turning a shareable history link into an unstyled 500 is a poor failure mode for a recruiter-facing report, and it is inconsistent with how the API route already degrades. Cheap, low-risk hardening at a trust boundary.

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