# Biz+UI Fix Wave 4 — Close the loop (workflow dead ends)

> 6 commits, **7 findings closed** (all High — the wave with the most Highs in the split).
> Baseline preserved: tsc 0 → 0, unit 751/751, python 537 OK, `next build` ✓, i18n parity 1895 keys.
> Subagent process: five parallel agents on disjoint scopes + one cluster agent for the two ScheduleTab findings (shared file, shared mental model).

## Commits

| # | Commit | Finding closed | Scope |
|---|--------|----------------|-------|
| 1 | `3b045b5` | voice-interview-runtime #1 — dead "Start again" ending | VoiceInterview.tsx |
| 2 | `63b7a97` | candidate-profile-builder #1 — archetype routing frozen at 4 | sub_profile (3 files) |
| 3 | `bd8e2de` | jd-library-builder #2 — unreachable jd_build result | TasksTab, JdBuilder, tabs.ts(+test) |
| 4 | `de7d7c4` | pipeline-board-scheduler #1 — persistent recruiter notes | db.ts (notes), pipeline route, drawer, messages |
| 5 | `d0c267a` | interview-prep-rubric #1 — Regenerate destroys preserved progress | InterviewPrepModal |
| 6 | `9668d36` | interview-prep-rubric #2 + voice-interview-runtime #2 — vanishing human-verdict candidates; "in progress" revokes live calls | ScheduleTab, HumanScorecardPanel, interview-prep.ts, db.ts reads, create route, messages |

## What was fixed (grouped by sub-pattern)

1. **Every async artifact has a route back to it** (`bd8e2de`, `de7d7c4`) — a backgrounded jd_build's paid LLM result was destroyed by the tab unmount and its outcome link carried no identity; now `?jdTask=<id>` (a registered tab-scoped param) rehydrates result + form inputs. And the recruiter's own observations finally have a home: a persistent, debounce-autosaved `notes` column on the entry (set_notes action), pre-filling the AI scorecard's input.

2. **State transitions disclose themselves** (`9668d36`, `d0c267a`) — recording a human verdict no longer makes the candidate vanish (human-led rounds join Interviewed with a chip; the panel says "moved to the Decisions queue"; every Interviewed card can reopen prep & scorecard), and Regenerate no longer blanks-then-destroys the carried-forward notes/checklist/interviewer the server had explicitly preserved.

3. **Status reads as status, not as a loaded gun** (`9668d36`, `3b045b5`) — "Interview in progress" was an enabled re-create button that revoked the live call and buried the finished transcript behind a newer empty session; it's a non-interactive live pill now, `/create` 409s on recently-active sessions (unless forced), and status reads prefer transcript-bearing sessions. The candidate's side got its ending too: a completed screen closes on a thank-you card instead of a dead "Start again".

4. **Registry-driven beats frozen literals** (`63b7a97`) — the profile editor's archetype control joins every other archetype surface in reading the registry; custom archetypes are routable, auditable, and no longer destroyed by a stray click.

## Verification table

| Gate | Before wave | After wave |
|------|------------|-----------|
| tsc --noEmit | 0 errors | 0 errors |
| node --test unit | 751/751 | 751/751 |
| python unittest | 537 OK | 537 OK (untouched) |
| next build | ✓ | ✓ |
| i18n parity | 1886 keys | 1895 keys (en=cs) |

## Cumulative status (scan 2026-06-12)

**32 / 108 findings closed (26 / 32 Highs)** across waves 1–5 (executed 1, 2, 3, 5, 4) — 32 fix commits, 0 regressions throughout.
Remaining Highs (6): print artifact (results #1), public JD chrome i18n (jd #3), dev-case comms lang (dcapi #2), restore migrations (data #1), task fast lane (data #4), grounded retry (scoring #1) — i.e. Wave 6 (platform safety) + the two High i18n items in Wave 7 + the print item in Wave 9.

## Patterns established (catalogue additions, items 42–45)

42. **Async results need identity in their links** — an outcome link without the task id is a dead end after any unmount; deep-link params registered in TAB_SCOPED_PARAM_KEYS + the existing useTaskResult bridge make rehydration nearly free.
43. **A label that looks like a button must not be a destructive button** — when an action's label flips to describe state ("in progress"), the affordance must flip too (non-interactive pill); guard the API side with a recent-activity 409 + force escape hatch.
44. **Carried-forward server state needs client hydration at the SAME moment** — preserving data server-side while the client keeps wipe semantics converts preservation into deferred destruction (the next autosave clobbers it). Fix both sides of a carry-forward in one change.
45. **Latest-row reads lie when rows vary in substance** — "newest session" must prefer substance (has transcript) over recency, or a newer empty row buries completed evidence.

## What remains

Wave 6 — platform safety (3 Highs + 3 Med): restore-migration brick, task-queue fast lane, grounded-retry zero callers, pre-restore snapshot, transcript-save retry, board-unmount guard. Then waves 7–9 (i18n seams incl. 2 Highs, theme register, shell/report UX incl. the print High) and the Medium/Low sweep.
