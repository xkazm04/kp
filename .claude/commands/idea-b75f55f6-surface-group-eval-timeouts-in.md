Execute this requirement immediately without asking questions.

## REQUIREMENT

# Surface group-eval timeouts instead of a blank modal

## Metadata
- **Category**: user_benefit
- **Effort**: Medium (2/3)
- **Impact**: Unknown (4/3)
- **Scan Type**: ambiguity_guardian
- **Generated**: 6/2/2026, 4:13:26 PM

## Description
runGroupEval in SimulationProvider polls /api/decisions/group-eval for 25s; on timeout it sets payload null with loading false, so the reused GroupEvalModal pops open empty during the climactic Offer step with no error or explanation. Add an explicit evaluation-unavailable/timed-out state to the sims groupEval handling (and surface it in SimGroupEval/GroupEvalModal) so a slow or missing evaluation reads as a clear message rather than a blank comparison that looks broken on screen.

## Reasoning
The Offer step is a climactic demo moment; a blank modal at that point reads as a bug to the very audience the simulation is meant to impress. A small explicit timeout state turns an ambiguous empty render into honest, legible feedback and prevents is-the-demo-broken moments.

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