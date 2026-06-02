Execute this requirement immediately without asking questions.

## REQUIREMENT

# Codify the history-to-analyze tab alias contract

## Metadata
- **Category**: maintenance
- **Effort**: High (3/3)
- **Impact**: Unknown (4/3)
- **Scan Type**: ambiguity_guardian
- **Generated**: 6/1/2026, 4:30:13 PM

## Description
The history id is a valid WorkspaceTabId accepted by isWorkspaceTabId, yet it has no entry in NAV_GROUPS or WORKSPACE_TABS and is silently remapped to analyze inline in Workspace.tsx (the navActive ternary plus AnalyzeWorkspace initialMode). Introduce an explicit TAB_ALIASES map and a resolveNavTab helper in tabs.ts, route Workspace.tsx and any deep-link page through it, and document that history is an alias mode of Analyze, not a standalone tab.

## Reasoning
A tab id that passes validation but is absent from every nav list is the kind of split-brain that confuses new contributors and invites bugs the moment someone adds a history nav button or a tabHref(history) link. Centralizing the alias makes the decision explicit, testable, and impossible to half-implement.

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