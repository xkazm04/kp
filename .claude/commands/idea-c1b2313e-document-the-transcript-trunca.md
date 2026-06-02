Execute this requirement immediately without asking questions.

## REQUIREMENT

# Document the transcript truncation policy for scoring

## Metadata
- **Category**: maintenance
- **Effort**: High (3/3)
- **Impact**: Unknown (6/3)
- **Scan Type**: ambiguity_guardian
- **Generated**: 6/1/2026, 4:54:54 PM

## Description
runInterviewScorecard slices the joined notes to 6000 chars and /api/interview/complete caps each turn text at 4000 chars, so a long interview is silently truncated from the front-to-back middle before the scorecard sees it � the conclusion of a 20-minute screen can be dropped with no marker. These magic numbers carry an undocumented policy. Decide the intended behavior (raise the cap, head+tail sampling, or summarize-then-score), name the constants, and emit a log/flag when truncation actually discards turns.

## Reasoning
The scorecard gates Interview?Offer, yet on exactly the longest, richest interviews it may score an arbitrarily clipped subset without anyone knowing. Making the limit an explicit, documented decision (and visible when it bites) keeps the gate trustworthy and prevents a silent quality cliff as interviews lengthen.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Voice Interview Runtime

**Description**: Run real-time AI voice interviews with candidates (ElevenLabs / OpenAI realtime) — create, connect and complete sessions, replay and compare transcripts; includes the interview lab and public interview link page.
**Related Files**:
- `app/_components/voice/VoiceInterview.tsx`
- `app/_components/voice/VoiceInterviewClient.tsx`
- `app/_lib/voice/index.ts`
- `app/_lib/voice/elevenlabs.ts`
- `app/_lib/voice/openai.ts`
- `app/_lib/voice/types.ts`
- `app/_lib/interview-run.ts`
- `app/api/interview/create/route.ts`
- `app/api/interview/connect/route.ts`
- `app/api/interview/complete/route.ts`
- `app/api/interview/by-entry/route.ts`
- `app/api/interview/compare/route.ts`
- `app/interview/[token]/page.tsx`
- `app/interview-lab/page.tsx`
- `pipeline/jobfit/interview.py`
- `scripts/interview.py`
- `scripts/setup-eleven-agent.mjs`

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