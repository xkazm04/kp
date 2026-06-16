Execute this requirement immediately without asking questions.

## REQUIREMENT

# Give every silent success a destination (completion-CTA pattern)

## Metadata
- **Category**: functionality
- **Effort**: Medium (2/3)
- **Impact**: High (3/3)
- **Scan Type**: cx_journey_cartographer
- **Generated**: 6/12/2026, 11:49:55 AM
- **Direction**: 1 — Journey spine: every completed action hands off to the next step

## Description
Four surfaces fire a mutation and succeed with zero navigation feedback, leaving the user to manually hunt for proof in another tab. Introduce one small shared "completion CTA" primitive (success line + deep link with context, built on buildUrl from app/features/tabs.ts) and apply it at: (1) Library "Ingest as Job" (LibraryTab.tsx ~32) → link to the Jobs tab with the new job opened (`?tab=jobs&job=<id>`); (2) Matrix bulk-add to pipeline (MatrixTab.tsx ~202-223) → link to the Pipeline board filtered to the target role (`?tab=pipeline&q=<jobTitle>`); (3) Dev cases "Promote to pipeline" (sub_dev/LifecycleRow.tsx ~196) → link to the promoted entry on the board; (4) Background tasks (features/tasks/TasksTab.tsx) → every terminal task state links to its result location (JD build → Library, analysis → history slug, group eval → Decisions role group, batch screen → Decisions), extending the existing partial candidateLabel link at ~488. The primitive should take a label + WorkspaceTabId + scoped params so future actions adopt it in one line.

## Reasoning
"Fire API, show nothing" is the single most repeated CX defect across the scan — it makes each feature feel like a standalone demo because the user never sees consequences land in the next surface. A shared primitive fixes the pattern once and makes the connected behavior the default for every future action, instead of re-litigating it per feature.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Silent-completion surfaces

**Related Files**:
- `app/features/sub_library/LibraryTab.tsx`
- `app/features/sub_matrix/MatrixTab.tsx`
- `app/features/sub_dev/LifecycleRow.tsx`
- `app/features/tasks/TasksTab.tsx`
- `app/features/tabs.ts`
- `app/_components/ui/recipes.ts`

**Post-Implementation**: After completing this requirement, evaluate if the context description or file paths need updates. Use the appropriate API/DB query to update the context if architectural changes were made.

## Recommended Skills

Use Claude Code skills as appropriate for implementation guidance. Check `.claude/skills/` directory for available skills. Verify both themes (Studio Light / Spark Dark) per docs/DESIGN.md before finishing.

## Notes

This requirement was generated from a CX scan of cross-tab handoffs (June 2026). It is part of Direction 1 (journey spine) together with idea-8984630d (Decisions↔Schedule round trip).

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
