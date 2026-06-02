Execute this requirement immediately without asking questions.

## REQUIREMENT

# Lock the pure shared primitives behind golden tests

## Metadata
- **Category**: code_quality
- **Effort**: High (3/3)
- **Impact**: Unknown (5/3)
- **Scan Type**: zen_architect
- **Generated**: 6/1/2026, 3:54:43 PM

## Description
The shared layer hides untested business logic in pure functions: Badge.ts token mappers (scoreToFitTier, fitTierToken) duplicate matching.pys 70/55 thresholds; tabs.ts buildUrl/isWorkspaceTabId encode URL-state rules; Markdown.tsx hand-parses a markdown subset. Add a focused unit-test suite over these pure functions � including a parity test asserting the client fit-tier cutoffs equal the values declared in pipeline/jobfit/matching.py � plus edge cases for buildUrl (clearing default tab, null values) and Markdown (unbalanced asterisks, fenced blocks).

## Reasoning
These functions are tiny, pure, and high-leverage � wrong thresholds silently mis-band candidates and a Markdown regex slip mis-renders job postings, both invisible until a user notices. Because they have no I/O they are trivial to test, and the matching.py parity test converts a comment-enforced invariant (kept in lockstep with matching.py) into a check that actually fails when the two drift.

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