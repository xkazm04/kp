Execute this requirement immediately without asking questions.

## REQUIREMENT

# Turn attention badges into a candidate-action inbox ("Today" rail)

## Metadata
- **Category**: functionality
- **Effort**: High (3/3)
- **Impact**: High (3/3)
- **Scan Type**: cx_journey_cartographer
- **Generated**: 6/12/2026, 11:49:55 AM
- **Direction**: 2 — Actionable attention: from passive counts to pulled-forward work

## Description
Candidate actions (applies via /apply, books a slot via /schedule/[token], completes the voice interview via /interview/[token], accepts or declines an offer via /offer/[token]) all persist correctly and bump the /api/attention counts — but a count is a passive removal hint, not direction. Build a workspace event surface (a "Today" rail on the Pipeline tab, or a popover off the sidebar badges) that lists recent candidate-initiated events drawn from pipeline_events/automation events ("Erika booked Tue 14:00", "Marek finished his interview — scorecard ready", "Petra accepted the offer"), each with an entry-specific deep link to the exact next step (Schedule card, Decisions scorecard_review, Pipeline Hired column). Wire it to the existing live-refresh bus (app/features/live-refresh.ts) and useAttention polling so it updates without reload. Offer-accepted deserves a distinct celebratory treatment instead of today's behavior where the entry silently vanishes from the Decisions queue (DecisionsTab.tsx ~117).

## Reasoning
The scan's root-cause finding: the loop recruiter→candidate→recruiter is broken at the workspace surface level, not the data level. Everything records; nothing pulls. An event inbox converts the app's strongest hidden asset (a complete event log) into the chronological story the user asked for — the workspace starts narrating "what just happened and what you should do next", which is exactly the difference between a feature showcase and a product with a plot.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Attention & live-refresh plumbing

**Related Files**:
- `app/api/attention/route.ts`
- `app/features/useAttention.ts`
- `app/features/live-refresh.ts`
- `app/features/sub_pipeline/PipelineTab.tsx`
- `app/features/WorkspaceNav.tsx`
- `app/api/pipeline/events/route.ts` (pipeline activity feed source)
- `app/_lib/offer-finalize.ts`
- `app/features/tabs.ts`

**Post-Implementation**: After completing this requirement, evaluate if the context description or file paths need updates. Use the appropriate API/DB query to update the context if architectural changes were made.

## Recommended Skills

Use Claude Code skills as appropriate for implementation guidance. Check `.claude/skills/` directory for available skills. Verify both themes (Studio Light / Spark Dark) per docs/DESIGN.md before finishing.

## Notes

This requirement was generated from a CX scan of cross-tab handoffs (June 2026). It is part of Direction 2 (actionable attention) together with idea-47b86b3d (badge deep links + Channels inbound badge).

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
