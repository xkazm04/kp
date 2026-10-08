# JD retry keeps the intake brief (2026-10-08)

## The hole (main at 9011a503)
- `app/api/intake/[id]/promote/route.ts:84` persisted `buildInput = {needText, seniority, roleFamily, lang, options}` — no `brief`, no `company` — while `:91-98` passed both in the task params.
- `JdBuildIntent` (`app/_lib/db/jobs.ts:41-50`) had no brief field.
- With the failed task row pruned, `retry-analysis/route.ts` `paramsFromIntent` (:23-47) replayed without the brief, so `jd-build-run.ts:337-358` built the DevNeed with no stack, responsibilities or statedRequirements, and `:394` lost the languages (a stated language is a ko_lang knockout, ADR 0019).

## The fix
- `376326cba` "fix(jd): the retry replay from the build intent keeps the intake brief": `JdBuildIntent.brief?: RoleBrief` (type-only import); promote persists `brief` and `company`; `paramsFromIntent` moved to `app/_lib/jd-build-start.ts` as exported `replayParamsFromIntent`, which returns `brief` only for a plain non-array object.
- `8d4499e25` "fix(jd): the retry route keeps resolving the stored template itself, in the JD's workspace": `app/api/jds/template-tenancy.test.ts` greps the route source for `getTemplate(..., workspaceId)`, so the moved function takes a `resolveTemplateBody` callback and the route binds it to the JD's workspace. Behaviour is unchanged. Found by a red `test:unit` after the first commit.
- Legacy intents (no brief) replay exactly as before: no `brief` key, every other field identical.

## Test
- `bdf470c7b` "test(jd): the retry replay keeps the intake brief, and omits a malformed one" — `app/_lib/jd-retry-keeps-brief.test.ts`: parity through insertAnalyzingJd -> loadJd -> replay, legacy, string/array/null/number brief omitted, null/garbage intent -> null, resolver contract.
- Failing on the old behaviour (replay's brief spread disabled in the working tree only, then restored):
  `not ok 1 - a promoted JD replays with its brief, deep-equal, and promote's other params` — "Expected values to be strictly deep-equal: + actual - expected" at jd-retry-keeps-brief.test.ts:51.

## build_input_json route check
Only `app/api/jds/[slug]/route.ts` returns it, and only under `?intent=1`, after the workspace-scoped `loadJd` and behind the gated `/api/jds/*` (not in public-routes). The list route returns a preview, not the row. No candidate-facing or unauthenticated route returns it. The same route already serves the brief via `?brief=1`. Nothing new is exposed beyond what that operator read already holds for promoted JDs.

## Docs
`91ffbc5f6` "docs(jobs): the retry's row-fallback replay carries the intake brief" — jobs README (route table + rate-limit row), intake README step 5.

## Gates (worktree)
typecheck 0, lint 0, `npm run test:unit` 0, `scripts/kpi/**` 0, `npm run test:docs` 0. Gates rewrote `app/_lib/*.generated.ts`; restored.
JDs promoted before this change have no brief in their intent and replay without it (not backfillable).
