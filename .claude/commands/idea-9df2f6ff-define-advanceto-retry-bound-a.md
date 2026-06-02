Execute this requirement immediately without asking questions.

## REQUIREMENT

# Define advanceTo retry bound and timeout policy

## Metadata
- **Category**: maintenance
- **Effort**: High (3/3)
- **Impact**: Unknown (5/3)
- **Scan Type**: ambiguity_guardian
- **Generated**: 6/2/2026, 4:13:15 PM

## Description
In SimulationProvider, advanceTo loops a hardcoded for (i < 4) and returns whatever stage it lands on without erroring if the target is never reached, and waitEntry returns false on timeout while the walk continues regardless. After the recent 7-to-5 stage consolidation, the literal 4 is an undocumented guess at pipeline depth. Derive the loop bound from the canonical SIM_PHASES/stage list and decide explicitly whether failing to reach the target stage should throw (halting the demo with a clear message) or log-and-continue, applying that decision at every waitEntry/advanceTo call site.

## Reasoning
The simulation driver robustness rests on a magic iteration count that the stage refactor already invalidated once; when it is wrong the demo fails quietly with a misleading status. Tying the bound to the real stage list and making the timeout/failure policy explicit turns silent drift into a checked invariant and predictable behavior.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Demo Simulation & Channels

**Description**: An interactive scripted demo that simulates the whole recruiting flow (inbound applications, screening, decision waves, group eval, offers) with spotlight UI and reset controls, plus the Channels inbox aggregating inbound candidate comms.
**Related Files**:
- `app/features/simulation/SimulationProvider.tsx`
- `app/features/simulation/SimBar.tsx`
- `app/features/simulation/SimSpotlight.tsx`
- `app/features/simulation/SimDecisionWave.tsx`
- `app/features/simulation/SimGroupEval.tsx`
- `app/features/simulation/SimExplainDrawer.tsx`
- `app/features/simulation/SimOfferFrame.tsx`
- `app/features/simulation/company-template.ts`
- `app/features/simulation/constants.ts`
- `app/features/simulation/diagrams.ts`
- `app/_lib/sim-store.ts`
- `app/api/sim/inbound/route.ts`
- `app/api/sim/reset/route.ts`
- `app/api/sim/screen-draft/route.ts`
- `app/api/sim/offer-draft/route.ts`
- `app/api/sim/offer-link/route.ts`
- `app/features/sub_channels/ChannelsTab.tsx`
- `app/_lib/comms.ts`
- `app/_lib/comms-dispatch.ts`

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