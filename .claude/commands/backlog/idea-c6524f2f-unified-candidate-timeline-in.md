Execute this requirement immediately without asking questions.

## REQUIREMENT

# Unified candidate timeline in the drawer — one chronological story per person

## Metadata
- **Category**: functionality
- **Effort**: High (3/3)
- **Impact**: High (3/3)
- **Scan Type**: cx_journey_cartographer
- **Generated**: 6/12/2026, 11:49:55 AM
- **Direction**: 3 — Candidate thread: the person, not the tab, is the unit of story

## Description
A candidate's record is scattered across surfaces with no single chronological view: pipeline entry + events (Pipeline drawer), analyses (Analyze history), interview transcript (Schedule modal), prep artifact, dev case submission (Dev tab), sent messages (Channels comms center), offer state. Extend the CandidateDrawer (app/features/sub_pipeline/CandidateDrawer.tsx) with a unified timeline section that merges, in time order: pipeline_events, persisted analyses for this candidate (with score + link to /history/[slug]), interview session/transcript (link to the transcript modal), schedule invite lifecycle, dev case status (link to Dev tab scoped to the case), comms sent, and offer events. Each item links to its home surface carrying the candidate context (?profile=/?job= deep-link params per tabs.ts). Server-side, add one aggregation endpoint (e.g. /api/candidates/[id]/timeline) that joins the existing tables rather than having the drawer fire six fetches.

## Reasoning
"Group of standalone features" is exactly what a recruiter experiences when the same human appears as five disconnected records. The timeline inverts the model: tabs become lenses on one continuous story. This is also the foundation the other directions snap into — handoff CTAs (Direction 1) and inbox events (Direction 2) can link into the timeline as the canonical "where everything about this person lives".

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Candidate record surfaces

**Related Files**:
- `app/features/sub_pipeline/CandidateDrawer.tsx`
- `app/api/pipeline/events/route.ts`
- `app/api/analyses/route.ts`
- `app/api/analyses/[slug]/route.ts`
- `app/api/interview/by-entry/route.ts`
- `app/features/sub_schedule/InterviewTranscriptModal.tsx`
- `app/features/sub_channels/CommsCenter.tsx`
- `app/features/sub_dev/` (case lifecycle)
- `app/_lib/db/pipeline.ts`
- `app/features/tabs.ts`

**Post-Implementation**: After completing this requirement, evaluate if the context description or file paths need updates. Use the appropriate API/DB query to update the context if architectural changes were made.

## Recommended Skills

Use Claude Code skills as appropriate for implementation guidance. Check `.claude/skills/` directory for available skills. Verify both themes (Studio Light / Spark Dark) per docs/DESIGN.md before finishing.

## Notes

This requirement was generated from a CX scan of cross-tab handoffs (June 2026). It is part of Direction 3 (candidate thread) together with idea-d95fed6d (disposition/provenance sync).

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
