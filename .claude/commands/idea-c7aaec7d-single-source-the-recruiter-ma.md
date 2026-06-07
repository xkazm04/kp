Execute this requirement immediately without asking questions.

## REQUIREMENT

# Single-source the recruiter match-result view type

## Metadata
- **Category**: maintenance
- **Effort**: Unknown (4/3)
- **Impact**: Unknown (5/3)
- **Scan Type**: code_refactor
- **Generated**: 6/3/2026, 10:35:05 AM

## Description
The same 8-field per-candidate recruiter result shape (total, fitTier, confidence, scoreBreakdown, matchedSkills, matchedSkillProvenance, matchedSkillStrength, missingSkills) is re-declared as CandResult in group-eval-run.ts, MatchView in AnalysisSummaryModal.tsx, and inline enrichment fields on EvalCandidate in GroupEvalModal.tsx � all subsets of the canonical MatchResult in sub_match/MatchTypes.ts. Export a MatchResultView = Pick<MatchResult, ...> from MatchTypes and have the three call sites reuse it instead of re-typing the fields.

## Reasoning
Three hand-maintained copies of a result shape silently drift (e.g. matchedSkillStrength was added later and must be added everywhere). A single Pick-based view type makes the contract authoritative and lets the compiler catch any added/renamed field across the decision UI. This is distinct from the GroupEvalPayload-contract idea, which covers the top-level payload, not this per-candidate result subset used in AnalysisSummaryModal.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Decision Workflow & Group Eval

**Description**: Review AI recommendations and make advance/reject decisions per role, run group evaluations across a candidate pool, and configure decision rules and screening waves.
**Related Files**:
- `app/features/sub_decisions/DecisionsTab.tsx`
- `app/features/sub_decisions/DecisionsShared.tsx`
- `app/features/sub_decisions/DecisionsTypes.ts`
- `app/features/sub_decisions/RoleDecisionRow.tsx`
- `app/features/sub_decisions/AiReviewCard.tsx`
- `app/features/sub_decisions/AnalysisSummaryModal.tsx`
- `app/features/sub_decisions/DecisionRulesModal.tsx`
- `app/features/sub_decisions/GroupEvalModal.tsx`
- `app/api/decisions/config/route.ts`
- `app/api/decisions/group-eval/route.ts`
- `app/api/decisions/screen-wave/route.ts`
- `app/_lib/decision-config-store.ts`
- `app/_lib/group-eval.ts`
- `app/_lib/group-eval-run.ts`
- `app/_lib/screen-wave.ts`

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