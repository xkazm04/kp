Execute this requirement immediately without asking questions.

## REQUIREMENT

# Productize the simulation as a guided first-run tour

## Metadata
- **Category**: functionality
- **Effort**: Medium (2/3)
- **Impact**: High (3/3)
- **Scan Type**: cx_journey_cartographer
- **Generated**: 6/12/2026, 11:49:55 AM
- **Direction**: 5 — Teach the story: onboarding and empty states narrate the chronology

## Description
The app already contains its own chronological narrative — the demo simulation (app/features/simulation/SimulationProvider.tsx, SIM_PHASES in constants.ts ~76-84) walks Design → Source → Intake → Screen → Interview → Offer → Hired across Library, Jobs, Channels, Analytics, Schedule, Decisions and Pipeline, including candidate-side actions. But it hides in a collapsed footer pill (SimBar.tsx) that a new user will never find. Promote it to the onboarding path: (1) on a fresh/empty workspace, offer a first-run choice — "Watch the hiring story" (runs the simulation with its stepper visible, narrating which tab does what) or "Start your own" (drops into the JD builder, the true chapter one); (2) add a persistent "Tour" entry point (command palette action + About tab card) so it stays discoverable after first run; (3) in step mode, have each phase explain the handoff it is performing ("a screening was accepted, so the candidate now appears in Schedule") — the sim's nav() calls already visit the right tabs, the missing piece is the narration layer; (4) end the tour on a getting-started checklist mirroring the chain (create JD → publish job → connect channel → first candidate). Keep simulation data clearly marked and resettable as today.

## Reasoning
This is the highest-leverage asymmetry found in the scan: the interconnected story the user feels is missing has already been built — as a hidden developer demo. Surfacing it costs a fraction of writing onboarding from scratch, guarantees the tour never drifts from real behavior (it drives the actual app), and directly converts "group of standalone features" into a told-once chronological narrative every new user sees.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Simulation & discovery surfaces

**Related Files**:
- `app/features/simulation/SimulationProvider.tsx`
- `app/features/simulation/SimBar.tsx`
- `app/features/simulation/constants.ts`
- `app/features/CommandPalette.tsx`
- `app/features/sub_about/`
- `app/features/Workspace.tsx`
- `app/features/tabs.ts`

**Post-Implementation**: After completing this requirement, evaluate if the context description or file paths need updates. Use the appropriate API/DB query to update the context if architectural changes were made.

## Recommended Skills

Use Claude Code skills as appropriate for implementation guidance. Check `.claude/skills/` directory for available skills. Verify both themes (Studio Light / Spark Dark) per docs/DESIGN.md before finishing.

## Notes

This requirement was generated from a CX scan of cross-tab handoffs (June 2026). It is part of Direction 5 (teach the story) together with idea-7918a76c (chain-aware empty states).

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
