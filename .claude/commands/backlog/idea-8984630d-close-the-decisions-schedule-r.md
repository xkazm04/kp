Execute this requirement immediately without asking questions.

## REQUIREMENT

# Close the Decisions↔Schedule round trip with next-step handoffs

## Metadata
- **Category**: functionality
- **Effort**: Medium (2/3)
- **Impact**: High (3/3)
- **Scan Type**: cx_journey_cartographer
- **Generated**: 6/12/2026, 11:49:55 AM
- **Direction**: 1 — Journey spine: every completed action hands off to the next step

## Description
The two busiest funnel handoffs are both blind today. (1) Accepting a screening_review on the Decisions tab auto-queues the candidate with `approvalKind="calendar"` (app/_lib/db/pipeline.ts ~768) and spawns an interview_prep task, but the recruiter stays on Decisions with no signal — the newly queued candidate is invisible until they manually open Schedule. Show an inline success affordance ("Interview queued for <name> — confirm the slot") that deep-links to the Schedule tab. (2) The reverse leg: when an interview transcript lands, ScheduleTab shows a "Transcript ready" modal but no path forward — the scorecard_review decision it creates lives on Decisions with no pull. Add a "Review scorecard" CTA inside the transcript view (and on the interviewed card) that deep-links to Decisions. Also upgrade both tabs' terminal states: the Decisions "You're caught up" state (DecisionsTab.tsx ~267) should link to Schedule/Pipeline with live counts, and the Schedule empty state (ScheduleTab.tsx ~209) should link back to Decisions when reviews are pending. Reuse buildUrl/buildTabSwitchUrl from app/features/tabs.ts; do not invent a parallel nav mechanism.

## Reasoning
This is the heart of the "standalone features" feeling: the system silently moves a candidate to the next stage, but never moves the recruiter with them. Decisions→Schedule→Decisions is the loop a recruiter walks many times per day; making each completion point at its successor converts four isolated screens into one continuous workflow at very low cost (the deep-link infrastructure already exists and is tested).

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Core funnel tabs

**Related Files**:
- `app/features/sub_decisions/DecisionsTab.tsx`
- `app/features/sub_decisions/AiReviewCard.tsx`
- `app/features/sub_decisions/AnalysisSummaryModal.tsx`
- `app/features/sub_schedule/ScheduleTab.tsx`
- `app/features/sub_schedule/InterviewTranscriptModal.tsx`
- `app/features/sub_schedule/InviteLifecyclePanel.tsx`
- `app/features/tabs.ts`
- `app/_lib/db/pipeline.ts`

**Post-Implementation**: After completing this requirement, evaluate if the context description or file paths need updates. Use the appropriate API/DB query to update the context if architectural changes were made.

## Recommended Skills

Use Claude Code skills as appropriate for implementation guidance. Check `.claude/skills/` directory for available skills. Verify both themes (Studio Light / Spark Dark) per docs/design/README.md before finishing.

## Notes

This requirement was generated from a CX scan of cross-tab handoffs (June 2026). It is part of Direction 1 (journey spine) together with idea-f64e941d (silent-success CTAs).

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
