Execute this requirement immediately without asking questions.

## REQUIREMENT

# Surface AI-provenance disclosure on every result tab

## Metadata
- **Category**: functionality
- **Effort**: High (3/3)
- **Impact**: Unknown (6/3)
- **Scan Type**: zen_architect
- **Generated**: 6/1/2026, 3:55:51 PM

## Description
AiDisclosure.tsx is bundled into this Analysis Results context yet rendered nowhere in it — it only appears on candidate token pages (apply/interview/offer/schedule), so the recruiter-facing ResultPanel presents AI-generated job-fit, salary, and interview scores with no 'AI-assisted, human decides' framing. Anchor a results-flavored provenance band once in ResultPanel ('AI-generated estimates for decision support, not a hiring decision — verify before acting') so it covers all tabs, with a per-tab source line drawn from analysis.metadata (engine/model). Reuse the disclosure visual language already established by AiDisclosure/DisclosureRow.

## Reasoning
The product's stated differentiator (per AiDisclosure's own comment) is transparent, human-in-the-loop AI — yet the very screen where AI scores drive decisions omits that framing, a real governance gap under hiring-AI rules like the EU AI Act and NYC Local Law 144. One anchored disclosure closes it everywhere and turns an already-present-but-dead component into the trust surface it was meant to be.

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