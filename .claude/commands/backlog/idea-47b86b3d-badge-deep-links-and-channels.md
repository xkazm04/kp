Execute this requirement immediately without asking questions.

## REQUIREMENT

# Badge deep links + a Channels inbound badge

## Metadata
- **Category**: functionality
- **Effort**: Low (1/3)
- **Impact**: Medium (2/3)
- **Scan Type**: cx_journey_cartographer
- **Generated**: 6/12/2026, 11:49:55 AM
- **Direction**: 2 — Actionable attention: from passive counts to pulled-forward work

## Description
Two cheap upgrades to the existing attention system (app/api/attention/route.ts, useAttention.ts, badgeKey mapping in tabs.ts). (1) Channels has no badge: new inbound applications land at stage "Accepted" and are only countable by visiting Channels or Pipeline. Add a channels-facing attention bucket (or reuse the pipeline Accepted count) so the Channels nav item signals "X new inbound", consistent with the SHELL2 declarative badgeKey pattern — extend the AttentionKey union, never hardcode positionally. (2) Make badge clicks land on the relevant slice, not just the bare tab: the decisions badge should open Decisions scrolled/filtered to pending reviews, the schedule badge to awaiting-slot entries, the jobs badge to jobs needing action — using existing tab-scoped deep-link params (TAB_SCOPED_PARAM_KEYS) where available rather than inventing new state. Keep the attention payload tiny; the unit test in tabs.test.ts pins the param set, so update it deliberately.

## Reasoning
The badge system is the one cross-tab signal that already exists everywhere — but it answers "how many?" without "where?" or "what?". Wiring count → place closes the cheapest possible loop and gives the Channels tab (currently a pure setup surface that users never revisit) a living role in the daily story.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Attention badges & nav

**Related Files**:
- `app/api/attention/route.ts`
- `app/features/useAttention.ts`
- `app/features/tabs.ts`
- `app/features/tabs.test.ts`
- `app/features/WorkspaceNav.tsx`
- `app/features/Workspace.tsx`
- `app/features/sub_channels/ChannelsTab.tsx`

**Post-Implementation**: After completing this requirement, evaluate if the context description or file paths need updates. Use the appropriate API/DB query to update the context if architectural changes were made.

## Recommended Skills

Use Claude Code skills as appropriate for implementation guidance. Check `.claude/skills/` directory for available skills.

## Notes

This requirement was generated from a CX scan of cross-tab handoffs (June 2026). It is part of Direction 2 (actionable attention) together with idea-8f8f578d (candidate-action inbox).

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
