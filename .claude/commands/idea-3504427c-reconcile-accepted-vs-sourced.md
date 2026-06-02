Execute this requirement immediately without asking questions.

## REQUIREMENT

# Reconcile Accepted vs Sourced channel labels

## Metadata
- **Category**: user_benefit
- **Effort**: Low (1/3)
- **Impact**: Unknown (4/3)
- **Scan Type**: ambiguity_guardian
- **Generated**: 6/2/2026, 4:12:57 PM

## Description
ChannelsTab contradicts itself: the page header and the simulation both say proactively-sourced candidates arrive at Accepted, but the sourcing channel card in the CHANNELS array says they land at Sourced. The simulations source and match steps only ever query stage === "Accepted", so Sourced appears to be stale copy. Decide the canonical entry stage, fix the one inconsistent string in the CHANNELS array, and align the diagram captions in diagrams.ts so the demo tells one story.

## Reasoning
A customer watching the scripted demo reads the channel cards while the pipeline visibly moves candidates to Accepted; a card that says Sourced undercuts trust in the exact moment the product is being sold. It is a one-line copy fix, but it removes a real contradiction that also confuses new developers about which stage is the pipeline front.

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