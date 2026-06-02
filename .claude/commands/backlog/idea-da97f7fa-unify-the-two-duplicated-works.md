Execute this requirement immediately without asking questions.

## REQUIREMENT

# Unify the two duplicated workspace sidebars

## Metadata
- **Category**: maintenance
- **Effort**: High (3/3)
- **Impact**: Unknown (5/3)
- **Scan Type**: zen_architect
- **Generated**: 6/1/2026, 3:54:10 PM

## Description
Workspace.tsx (client <button> tab-switch) and WorkspaceNav.tsx (server <Link> deep-link) duplicate the entire <aside>, the KP logo block, the NAV_GROUPS loop, the dot+label item markup, and the navItemClass call verbatim. Extract one <WorkspaceSidebar> that takes a polymorphic item renderer � renderItem({ item, isActive }) � so the client passes a button and the deep-link pages pass a Link, while the chrome is defined once. Roughly 40 lines of drift-prone copy collapse into a single component.

## Reasoning
Two hand-maintained copies of the same nav guarantee eventual divergence � the active-state treatment already drifted once (the in-code comment notes a coral-wash vs ink-pill mismatch that had to be reconciled). Centralizing the chrome makes the active state and structure provably identical on every surface and halves the maintenance cost of any nav change.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Workspace Shell & Shared UI

**Description**: The studio shell that hosts every feature tab — workspace layout, sidebar navigation, tab routing, live-refresh, root layout/metadata and the shared UI primitives (badges, modal, markdown, icons) reused across features.
**Related Files**:
- `app/features/Workspace.tsx`
- `app/features/WorkspaceNav.tsx`
- `app/features/live-refresh.ts`
- `app/features/tabs.ts`
- `app/layout.tsx`
- `app/page.tsx`
- `app/globals.css`
- `app/opengraph-image.tsx`
- `app/apple-icon.tsx`
- `app/_lib/og-fonts.ts`
- `app/_lib/useJsonFetch.ts`
- `app/_lib/useReducedMotion.ts`
- `app/_components/Badge.tsx`
- `app/_components/Modal.tsx`
- `app/_components/Markdown.tsx`
- `app/_components/SegmentedControl.tsx`
- `app/_components/icons/index.ts`
- `app/_components/icons/CompareIcon.tsx`
- `app/_components/icons/ExtractionIcon.tsx`
- `app/_components/icons/InterviewIcon.tsx`
- `app/_components/icons/JobFitIcon.tsx`
- `app/_components/icons/SalaryIcon.tsx`

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