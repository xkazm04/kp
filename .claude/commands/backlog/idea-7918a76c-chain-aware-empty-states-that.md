Execute this requirement immediately without asking questions.

## REQUIREMENT

# Chain-aware empty states that point upstream

## Metadata
- **Category**: ui
- **Effort**: Low (1/3)
- **Impact**: Medium (2/3)
- **Scan Type**: cx_journey_cartographer
- **Generated**: 6/12/2026, 11:49:55 AM
- **Direction**: 5 — Teach the story: onboarding and empty states narrate the chronology

## Description
Every tab's empty state today is a terminus ("No entries", "No one is waiting", checkmark "You're caught up") when it should be a chapter pointer. Encode the product's causal chain once — JD (Library) → Job (Jobs) → Channel (Channels) → Candidates (Pipeline) → Decisions → Schedule → Offer/Hired — as a small declarative structure (e.g. in app/features/tabs.ts next to NAV_GROUPS, where the tab universe already lives), and build a shared EmptyState component that, given the current tab, explains why the tab is empty in story terms and deep-links to the upstream step: empty Pipeline → "Candidates arrive through channels — set one up" (Channels); empty Decisions with a populated board → "Run screening on the board" (Pipeline); empty Schedule → "Interviews are queued when you accept a screening" (Decisions); empty Jobs → JD builder (Library); empty Matrix/Match → Profile/Analyze. Replace the bare-text empty states found in PipelineTab.tsx ~605, ScheduleTab.tsx ~209-213, DecisionsTab.tsx ~267-271, JobsShared.tsx ~112-144, and the Match/Profile equivalents. Wording goes through the i18n catalog (en + cs) like all class-1 UI text.

## Reasoning
Empty states are where a feature-showcase feel is born: a new user opens six tabs, five say "nothing here", and no tab admits it depends on another. Making each empty state name its upstream cause is the cheapest way to teach the chronology — the app explains its own plot exactly at the moment the user is lost, with zero new backend.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Empty-state sites across tabs

**Related Files**:
- `app/features/tabs.ts`
- `app/features/sub_pipeline/PipelineTab.tsx`
- `app/features/sub_schedule/ScheduleTab.tsx`
- `app/features/sub_decisions/DecisionsTab.tsx`
- `app/features/sub_jobs/JobsShared.tsx`
- `app/features/sub_match/MatchTab.tsx`
- `app/features/sub_profile/ProfileTab.tsx`
- `app/_components/ui/recipes.ts`

**Post-Implementation**: After completing this requirement, evaluate if the context description or file paths need updates. Use the appropriate API/DB query to update the context if architectural changes were made.

## Recommended Skills

Use Claude Code skills as appropriate for implementation guidance. Check `.claude/skills/` directory for available skills. Verify both themes (Studio Light / Spark Dark) per docs/design/README.md before finishing.

## Notes

This requirement was generated from a CX scan of cross-tab handoffs (June 2026). It is part of Direction 5 (teach the story) together with idea-5d2e0998 (productize the simulation as a guided tour).

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
