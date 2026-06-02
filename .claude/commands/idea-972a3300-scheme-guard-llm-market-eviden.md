Execute this requirement immediately without asking questions.

## REQUIREMENT

# Scheme-guard LLM market-evidence source URLs

## Metadata
- **Category**: code_quality
- **Effort**: High (3/3)
- **Impact**: Unknown (7/3)
- **Scan Type**: bug_hunter
- **Generated**: 6/2/2026, 4:22:45 PM

## Description
SalaryTab renders analysis.marketEvidence.sources (typed z.array(z.string()) with no .url() check) directly into an anchor href with target=_blank, labeled only 'Source N'. A model-supplied javascript: or data: URL would execute on click, and the opaque label hides where the link actually points. Validate each source via new URL(), allow only http/https, drop the rest, and render the hostname as the link text.

## Reasoning
Sources flow from CV/JD text through the LLM, so they are untrusted input at a render trust boundary; an href-based XSS or a disguised link in a recruiter-facing report is a real security and trust failure. The guard is small and well understood.

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