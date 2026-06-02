Execute this requirement immediately without asking questions.

## REQUIREMENT

# Single-source and harden the (SIM) reset marker

## Metadata
- **Category**: maintenance
- **Effort**: Medium (2/3)
- **Impact**: Unknown (5/3)
- **Scan Type**: ambiguity_guardian
- **Generated**: 6/2/2026, 4:12:52 PM

## Description
resetSim deletes every artifact whose title matches the substring %(SIM)%, but the marker is duplicated: SIM_MARKER = "(SIM)" in constants.ts and a separate MARKER = "%(SIM)%" in sim-store.ts. A real job a user happens to title with "(SIM)" would be silently wiped. Import the single SIM_MARKER into sim-store, build the LIKE pattern from it, and narrow the broad catch{} blocks around the offers/jds deletes to ignore only the no-such-table error so genuine SQL failures surface instead of being swallowed while reset still reports success.

## Reasoning
resetSim runs destructive DELETEs driven by an untyped substring match with two sources of truth; a drifted marker or a swallowed SQL error means reset silently leaves data behind or removes the wrong rows. Centralizing the marker and tightening the catch makes the what-is-a-sim-artifact contract explicit and the destructive path trustworthy.

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