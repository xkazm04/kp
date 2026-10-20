---
kind: task
status: part-1-done-part-2-recorded
opened: 2026-10-06
charter: codebase-static-analysis-sweep
branch: autopilot/codebase-static-analysis-sweep-b226f6ba
gate: npm run test:unit -- 'app/_lib/auth/**/*.test.ts' 'app/api/**/*.test.ts'
measurable: auth+api unit scope failures in a linked worktree. Before: 4 named interview reds (7 inherited entries in the earlier baseline). After: 0 of 2099 + 149 auth.
---

# Static-analysis sweep — part 1 (gate repair) and part 2 (read-only record)

## Part 1 — the four inherited reds

Run in the worktree (`node_modules` is a junction, so `scripts/test-alias-loader.mjs`
sends `next/server` to `app/_lib/testing/next-server-shim.mjs`). Before the change,
the three files gave 4 `not ok`; after it, 0.

### recording-door.test.ts (2 tests) and sessions/recruiter-recording-delete.test.ts — shim gap, fixed in the shim

Evidence, from the real output before the fix:

```
# [api:interview:recording/[sessionId]] INTERVIEW_RECORDING_FAILED TypeError: NextResponse is not a constructor
#     at GET (app/api/interview/recording/[sessionId]/route.ts:77:12)
not ok 12 - playback streams the audio, serves a Range, and 404s ...   500 !== 200
not ok 13 - playback is closed by the RETENTION gate ...               500 !== 200
not ok 1  - the recruiter's deletion unlinks the file, keeps the record, and closes playback   500 !== 200
```

Cause: the shim exported `NextResponse` as `{ json, redirect, next }`, a plain object.
Fourteen handlers call `new NextResponse(body, init)` (`grep` below), `new` on an object
throws, and the handler's own `catch` turned that into a 500. Product code is correct
(the real `NextResponse` is a class); no product file changed.

Fix (commit eded3cb90): `NextResponse` is now `class NextResponse extends Response`
whose constructor installs the cookies writer (`withCookies`), with static `json`,
`redirect` and `next` bodies unchanged.

Guard: `next-server-shim.test.ts` gained two tests.
1. Scans non-test app code for `new NextResponse(` / `new NextRequest(`, asserts at least
   one site (non-vacuity; it finds 15) and that `Reflect.construct` on the shim's export
   yields a `Response` / `Request`. Against the OLD shim it fails with
   `NextResponse (constructed in app\api\analytics\metric-pack\route.ts)`; against the
   new one it passes.
2. A constructed `NextResponse` carries body, status, headers and cookies, and the three
   statics still answer as before.

(One trap while authoring: a heredoc through the Bash tool collapses `\b`/`\s` in a
`new RegExp("...")` string, which first made test 5 fail for the wrong reason — a bad
pattern, not the shim. The pattern is now a regex literal, written with the Edit tool,
and the before/after was re-run.)

Known limit, not fixed: the statics still return a plain `Response` with cookies attached,
so `NextResponse.json(...) instanceof NextResponse` is false in the shim. No test or
handler in the tree checks that today.

### complete-candidate-guard.test.ts "CONTROL" — a DIFFERENT cause: stale test setup, not the shim and not a product bug

Evidence:

```
not ok 1 - CONTROL — a candidate-mode session on a scoreable entry gets the scorecard, ...
  error: the Interview→Offer approval is set   + actual: null   - expected: 'scorecard_review'
```

The status was already 200 and the scorecard WAS attached to the session (the two
earlier assertions passed), so the shim was not involved. The approval stayed null
because the gate closed:

- `scoreableEntry()` calls `createPipelineEntry` with no `stage`, which lands the entry on
  `screenedLandingStage(axis)` — "Screened" on the default axis.
- Commit a474100ec (2026-10-05, "commit voice scorecard attach, gate check and approval
  atomically") made `commitCandidateScorecard` set `scorecard_review` only when
  `scorecardGateOpen(entry)` — active, an `interview`-role stage, approval null or
  `calendar` — "matches the human scorecard door rule in
  app/api/interview-prep/scorecard/route.ts". Before it the approval was set by
  `runAutomationTask` regardless of stage. A screening-stage entry is rightly refused.
- `interview-scorecard-commit.test.ts` already builds its entries at `stage: "Interview"`;
  this file predates the gate.

Fix (commit 42a8ebfff): `scoreableEntry()` passes `stage: "Interview"`. The cache key is
computed from `entry.stage` after creation, so the seeded verdict still matches. No
assertion was edited. The guarded TEST-mode case improves: its entry's gate is now open,
so only the mode guard can explain "approves nothing".

Not a product bug: refusing to open an Interview→Offer approval for an entry that is not
at an interview stage is the intended behaviour of a474100ec.

### Acceptance numbers

| Check | Result |
| --- | --- |
| the 4 named tests | pass (recording-door + recruiter-recording-delete 14/14, guard 3/3) |
| `app/_lib/auth/**` + `app/api/**` unit scope | 2099 tests, 0 fail, 0 cancelled, 0 skipped (auth alone: 149/149) |
| remaining reds | none in this scope |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0, 0 errors, 3 warnings (listed in finding 7, all pre-existing) |

Side effect to know about: `npm run typecheck` runs `schemas:gen`, which rewrote three
`*.generated.ts` files with CRLF only (no content diff). They were restored with
`git restore` so the tree is clean.

## Part 2 — ranked static-analysis findings (read-only; no source changed)

Method: `tsc --noEmit --noUnusedLocals --allowUnreachableCode false`; a name-based
export-reachability script over `app/`, `packages/`, `edge/`, `scripts/`, `e2e/`, `docs/`;
greps for casts at data boundaries and swallowed catches; `wc -l` for module size.
The dead-export scan is name-based, so a string-keyed or dynamic reference is not seen —
confirm each before deleting.

| # | Severity | Where | Finding | One-line fix |
| --- | --- | --- | --- | --- |
| 1 | medium | `app/api/match/reasoning/route.ts:50`, `app/api/jobs/ingest/route.ts:21` (22 `(await request.json()) as T` sites under `app/api`) | The body is cast, never checked. A JSON `null` (or a non-object) reaches `body.lang` / `body.adText` as a TypeError, which the catch answers as a generic 500 instead of a 400 refusal. | Read through `readJsonWithLimit(request, MAX, {})` (the house idiom, `request-body.ts:105`, used in `interview/complete`) and narrow with a guard. |
| 2 | medium | 46 exports with zero uses anywhere, e.g. `app/_components/Badge.tsx:343,352,356` (3 badges), `app/_lib/format.ts:89,269`, `app/_lib/db/companion.ts:398,598,631`, `app/_lib/db/users.ts:169` (`deleteUser`, only a spec names it), `app/_components/kit/ActionLine.tsx:11`, `app/features/library/jds/intake/IntakeVoiceBar.tsx:60`, `app/_lib/gigs/qualify.ts:259`, `app/_lib/db-portability.ts:172` | Dead code that still has to typecheck, be translated and be read. 636 exported names in all have no importer outside their own file (the rest are used inside the file, so only the `export` is surplus); full list reproducible with the script described above. | Delete the 46, drop `export` on the rest, and add a ratchet like `ts-debt.json` so the count cannot grow. |
| 3 | medium | `app/_lib/db/core.ts` (3857 lines), `app/_lib/db/pipeline.ts` (3567), `app/_lib/api-response.ts` (2138), `app/_components/voice/VoiceInterview.tsx` (1628), `app/_lib/db/devcase.ts` (1367) | Oversized modules; `core.ts` mixes connection, migrator and seeding, and `api-response.ts` at 2k lines is a response helper that has grown a registry. Merge conflicts and review cost concentrate here. | Split along the seams already present: `core.ts` → connection / migrations / seeds; `api-response.ts` → helpers vs `STORE_ERRORS`/`REFUSAL_ERRORS` registries. |
| 4 | medium | 278 `.catch(() => {})` / `.catch(() => undefined)` in non-test code; client side by area: library 34, tools 32, settings 31, hiring 31, jobseeker 28; e.g. `app/features/library/jobs/jobsPostingModalLogic.ts:127`, `app/features/shell/setup/OnboardingExperience.tsx:192` | A failed request leaves state on its seeded default with no signal; `decisionsComplianceFold.ts:5` already documents this exact trap. (The ones in `app/_lib/jobseeker/fetch/politeFetch.ts` are `reader.cancel()` cleanups and are benign.) | Replace with one `fireAndForget(label)` helper that logs, and convert the ones that gate UI state to `useErrorMessage()`. |
| 5 | low-medium | `app/_lib/db/gigs.ts:352`, `app/_lib/db/skill-profiles.ts:220`, `app/api/workspace/import/route.ts:55` (45 `JSON.parse(x) as T` in all) | A stored or uploaded JSON column is asserted to a type with no validation, so schema drift surfaces as `undefined` fields far from the read. The import route is the riskiest: it takes an operator-uploaded file. | Parse through the module's existing validator or a small `isGigReward`-style guard, returning null on mismatch. |
| 6 | low | `app/_lib/github/code-review.ts:8` (`RepoBundle`), `app/_lib/group-eval-run.ts:28` (`FairnessScheme`), `app/_lib/interview-run.ts:4` (`getSubmission`), `app/features/hiring/decisions/DecisionsShared.tsx:7` (`STAGES`) | Unused imports (tsc `noUnusedLocals`, TS6133/TS6196); `noUnusedLocals` is off in `tsconfig.json`, so nothing keeps this at zero. | Remove them, then turn on `noUnusedLocals` (this is the whole list). |
| 7 | low | `app/_components/voice/VoiceInterview.tsx:851` (`useEffect` misses `lockSettings`), `app/_lib/auth/session-revocation.ts:227` (`nowMs` assigned, never used — auth, out of this brief's scope), `app/_lib/auth/session-nav.ts:55,68` (`window.location.assign` to internal routes), `app/_components/table/table-i18n.test.ts:15` (unused `Locale`), `app/_components/results/salary/SalaryTab.tsx:127`, `app/_dev-inspector/DevInspectorImpl.tsx:101` (literal strings) | The 3 warnings `npm run lint` already prints, 8 sites. The `lockSettings` dep is the only one that can be a stale closure. | Fix `VoiceInterview.tsx:851` first; leave the auth ones to the auth owner. |
| 8 | low | `app/_lib/testing/next-server-shim.mjs:147-168` (the `NextResponse` statics) | `NextResponse.json/redirect/next` return a plain `Response`, so `instanceof NextResponse` is false in a linked checkout and true in CI. | Build them with `new NextResponse(...)` now that it is a class; add an `instanceof` assertion to the shim test. |

Negative results, recorded so nobody re-runs them: `tsc --allowUnreachableCode false`
reports **0** unreachable-code errors; there is no real `as any` in non-test code (the 16
grep hits are all prose in comments); `if (false)` / `? true : false` constant branches
found none. Unreachable *logical* branches (a guard that can no longer be false) need a
reader, not a compiler, and were not found by the cheap checks here.

Evidence for the 15 construction sites in part 1:
`grep -rn "new NextResponse(\|new NextRequest(" app` — metric-pack, five `intake/[id]/*`,
`interview/recording/[sessionId]` (2), `jobseeker` (cv.md, cv.pdf, dialogs ×2), `stt`,
`tts`, `workspace/export`, and `_lib/gigs/specialist.ts` (`NextRequest`).
