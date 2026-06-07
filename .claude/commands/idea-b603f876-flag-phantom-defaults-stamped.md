Execute this requirement immediately without asking questions.

## REQUIREMENT

# Flag phantom defaults stamped by normalize_job

## Metadata
- **Category**: maintenance
- **Effort**: Unknown (4/3)
- **Impact**: Unknown (6/3)
- **Scan Type**: ambiguity_guardian
- **Generated**: 6/3/2026, 9:48:06 AM

## Description
normalize_job in pipeline/jobfit/jobs.py silently fills missing fields with locale defaults: company becomes Confidential, location becomes Praha, work_mode becomes onsite, seniority becomes medior. The structured Job carries no provenance, so a row that defaulted to Prague is indistinguishable from an ad that actually said Prague, which can mislead matching and any market-stats view. Record which fields were defaulted (a provenance/defaults set on the Job) and document the default policy in one place.

## Reasoning
These invisible assumptions skew geography/seniority distributions and candidate matching while looking like real data. Making defaulted-vs-stated explicit prevents wrong conclusions and is the foundation any market dashboard needs to trust the corpus.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Job Catalog, Ingestion & Sourcing

**Description**: Manage the catalog of open roles — ingest and parse external job postings, publish roles, rediscover and surface matched candidates, and produce recruiter sourcing output.
**Related Files**:
- `app/features/sub_jobs/JobsTab.tsx`
- `app/features/sub_jobs/JobsTable.tsx`
- `app/features/sub_jobs/JobRow.tsx`
- `app/features/sub_jobs/JobsShared.tsx`
- `app/features/sub_jobs/JobsTypes.ts`
- `app/features/sub_jobs/JobPostingModal.tsx`
- `app/features/sub_jobs/RecruiterCandidates.tsx`
- `app/features/sub_jobs/RediscoverPanel.tsx`
- `app/features/sub_jobs/CompareInterviews.tsx`
- `app/features/sub_jobs/jobMarkdown.ts`
- `app/api/jobs/route.ts`
- `app/api/jobs/ingest/route.ts`
- `app/api/jobs/status/route.ts`
- `app/api/jobs/[id]/candidates/route.ts`
- `app/api/jobs/[id]/publish/route.ts`
- `app/api/jobs/[id]/rediscover/route.ts`
- `app/_lib/job-ingest.ts`
- `app/_lib/candidate-pool.ts`
- `pipeline/jobfit/jobs.py`
- `pipeline/jobfit/jobs_cli.py`
- `pipeline/jobfit/recruiter.py`
- `pipeline/jobfit/recruiter_cli.py`
- `pipeline/jobfit/seed_jobs.py`
- `pipeline/jobfit/seed_jobs_csas.py`

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