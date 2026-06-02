Execute this requirement immediately without asking questions.

## REQUIREMENT

# Resolve the Accepted-vs-Sourced entry-stage contradiction

## Metadata
- **Category**: functionality
- **Effort**: High (3/3)
- **Impact**: Unknown (5/3)
- **Scan Type**: ambiguity_guardian
- **Generated**: 6/2/2026, 4:10:43 PM

## Description
ChannelsTab contradicts itself about where proactively-sourced candidates enter: the section header states both inbound applications and sourced candidates arrive at Accepted (lines 91-96), while the Proactive sourcing channel card says sourced candidates land at Sourced (line 37) � and the simulations match-phase caption references Sourced too. Pick one policy: either sourced candidates share the Accepted front or they get a distinct Sourced entry stage, then make the copy, the inbound route, and the stage transitions agree, documenting the chosen rule in a short comment at the channel-config source.

## Reasoning
A new developer (or a prospect reading the UI) cannot tell which stage a sourced candidate actually starts in because the same screen asserts two different answers, which undermines trust in the pipeline model and risks wrong filtering logic downstream. Deciding and single-sourcing the entry-stage rule removes a user-visible inconsistency and a latent source of stage-routing bugs.

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