Execute this requirement immediately without asking questions.

## REQUIREMENT

# Sync analysis disposition and tool provenance back into the pipeline

## Metadata
- **Category**: functionality
- **Effort**: Medium (2/3)
- **Impact**: High (3/3)
- **Scan Type**: cx_journey_cartographer
- **Generated**: 6/12/2026, 11:49:55 AM
- **Direction**: 3 — Candidate thread: the person, not the tab, is the unit of story

## Description
Three one-way streets keep the Tools tabs siloed from the funnel. (1) Disposition: the advance/hold/pass disposition recorded on /history/[slug] (DispositionEditor, PATCH app/api/analyses/[slug]/route.ts ~51-88) never touches the pipeline — if the analyzed candidate has a pipeline entry, "advance" should at minimum surface on that entry (event + drawer flag), and conversely the history page should show the entry's current stage with a link to the board. (2) Provenance: entries promoted from a Dev case (sub_dev/LifecycleRow.tsx) or added from Matrix/Match/Analyze carry no origin marker — record a source/provenance field on the entry and render it in the CandidateDrawer ("Promoted from dev case X", "Added via Match against <job>") linking back to the originating surface. (3) Interview sim: a completed sim session (sub_interview/InterviewSimTab.tsx, POST /api/interview/simulate) offers only "Start over" — add an optional "attach transcript to candidate" action (picker over pipeline entries) so practice runs can become part of a candidate's record instead of evaporating.

## Reasoning
The Tools group feeds the funnel but never hears back, and the funnel can't say where its candidates came from — both halves of the missing chronology. Bidirectional references are what turn "I ran an analysis once" into "this is chapter two of this candidate's story", and provenance is also what Analytics needs later to attribute outcomes to sources honestly.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Tools↔funnel seams

**Related Files**:
- `app/api/analyses/[slug]/route.ts`
- `app/history/[slug]/page.tsx`
- `app/features/sub_history/HistoryTab.tsx`
- `app/features/sub_match/Results.tsx`
- `app/_components/results/ResultPanel.tsx` (AddToPipelineButton)
- `app/features/sub_dev/LifecycleRow.tsx`
- `app/features/sub_interview/InterviewSimTab.tsx`
- `app/features/sub_pipeline/CandidateDrawer.tsx`
- `app/_lib/db/pipeline.ts`
- `app/api/pipeline/route.ts`

**Post-Implementation**: After completing this requirement, evaluate if the context description or file paths need updates. Use the appropriate API/DB query to update the context if architectural changes were made.

## Recommended Skills

Use Claude Code skills as appropriate for implementation guidance. Check `.claude/skills/` directory for available skills.

## Notes

This requirement was generated from a CX scan of cross-tab handoffs (June 2026). It is part of Direction 3 (candidate thread) together with idea-c6524f2f (unified candidate timeline).

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
