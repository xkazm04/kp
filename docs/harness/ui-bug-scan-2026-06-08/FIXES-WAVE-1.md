# UI+Bug Scan — Fix Wave 1: Trust-boundary & validation (security)

> 8 commits, 8 findings closed (2 Critical, 1 High, 5 Medium).
> Baseline preserved: tsc 0 → 0, next build ✓, unit 638 → 638, lint clean on all touched files.
> One mental model: **fail closed — never trust the client/external input.**

## Commits

| # | Commit | Finding | Severity | Files |
|---|---|---|---|---|
| 1 | `947cada` | devcase `/inbound` auth bypass | **Critical** | app/api/devcase/inbound/route.ts |
| 2 | `3c2f1af` | `parseRepoRef` traversal / confused-deputy | **Critical** | app/_lib/repo-snapshot.ts |
| 3 | `22c0971` | `intervalMinutes: NaN` wedges the clock | High | app/_lib/scheduler-store.ts, app/api/automation/schedule/route.ts |
| 4 | `baf3418` | `setFloor: NaN` fake calibration | Medium | app/api/devcase/outcomes/route.ts, app/_lib/dev-control.ts |
| 5 | `21bec9f` | auto-approve gate fails open | Medium | app/_lib/devcase-orchestrator.ts |
| 6 | `f1172a2` | profile body unvalidated → Python CLI | Medium | app/api/profile/route.ts, app/features/sub_profile/ProfileForm.ts |
| 7 | `3dd5ba7` | KO questions skippable on direct POST | Medium | app/api/apply/[id]/route.ts |
| 8 | `922fca5` | candidate can override session provider | Medium | app/_components/voice/VoiceInterview.tsx, app/interview/[token]/page.tsx |

## What was fixed (grouped by sub-pattern)

### Broken access control on public webhooks (the 2 criticals)
1. **devcase `/inbound`** accepted `body.postingId` as an alternative to the apply token. Posting ids are `randomId("pst")` — an internal, non-crypto `Math.random()` key explicitly documented as "Never a security boundary" — so an unauthenticated party could guess/enumerate ids and inject submissions into any posting, driving the auto-promote lifecycle (evaluate→rank→promote→invite) without the 128-bit token. Fixed by making the token (from `?token=` or body) the only accepted credential and resolving the posting exclusively via `getPostingByToken`. The internal postingId path (`/api/devcase/submit`) is unchanged.
2. **`parseRepoRef`** let a user-supplied ref like `x/../../user/repos` (or `%2e%2e`) parse cleanly and, unencoded, normalize to a *different* `api.github.com` endpoint — hit with the server's `GITHUB_TOKEN` (confused-deputy reaching token-owner / private-repo endpoints). Fixed by enforcing GitHub's name grammar (reject `.`/`..` and anything off-charset → null) plus `encodeURIComponent` on every path segment in all three fetch helpers.

### `typeof === "number"` ≠ finite (the NaN-slips-the-guard trio)
3. **`intervalMinutes`** — `Math.max/min` propagate NaN rather than clamping it, so a NaN/Infinity from a schedule POST survived as `interval_minutes` and later threw `RangeError("Invalid time value")` in `claimDueRun` on every heartbeat, silently stopping the clock. `setIntervalMinutes` now `Number.isFinite`-guards before the clamp (fallback to default); route rejects non-finite with 400.
4. **`setFloor`** — a NaN promote-floor stringified to `"NaN"`, read back as null, silently reverted to the default — while the route returned 200 and wrote an audit row claiming the change took effect (success theater). Route rejects non-finite with 400; `setPromoteFloor` throws on non-finite as the durable backstop.

### Fail-open safety gates / unvalidated bodies
5. **auto-approve gate** read `analysis?.statedVsRealGaps?.length ?? 0`, conflating an absent reality-reflection field with "verified zero gaps" — letting an ungrounded design auto-publish on confidence alone. Now treats a missing/non-array field as "not verified" → routes to human.
6. **profile POST/PUT** cast the body and fed `profile`/`signals` straight to the Python CLI with no shape check; the AI-draft path bypassed the form's client guards and a non-numeric `yearsExperience` became NaN→null silently. Now rejects a non-object profile/signals with 400, and `archetypeScopedProfileFields` only persists a finite years.
7. **KO knockout gate** declined only when a KO key was present and `=== false`, so a scripted POST that omitted `ko_auth`/`ko_mode`/`ko_lang` passed — landing an Accepted entry that never cleared work-authorization/mode/language. Now derives the job's expected KO steps from `buildApplyScript` and requires every one present and `=== true`.

### Trust boundary on an outward-facing surface
8. **candidate interview portal** rendered the internal provider/language A/B picker and defaulted to ElevenLabs regardless of the session's stored provider; `/connect` honored the browser's request, so a candidate on an OpenAI session was silently switched, partially honoring the grounded instructions. Added `provider` (pin) + `lockSettings` (hide) props; the portal pins to `session.provider` and hides the picker; availability auto-switch is skipped in locked mode so the recruiter's grounded choice stands.

## Verification (before / after)

| Gate | Baseline (B2) | After Wave 1 |
|---|---|---|
| tsc --noEmit | 0 errors | 0 errors |
| next build | ✓ | ✓ |
| test:unit (node --test) | 638 pass | 638 pass |
| eslint (touched files) | — | clean |

No regressions. No test behavior changed (the `archetypeScopedProfileFields` finite-guard is exercised only on non-numeric input, which no existing case feeds).

## Cumulative status (across all waves so far)

| Wave | Theme | Closed |
|---|---|---|
| 1 | Trust-boundary & validation (security) | 8 |

All 3 scan criticals: **2 of 3 closed** (devcase inbound, repo-ref traversal). The remaining critical (interview-prep "Regenerate" data-loss) is scoped to **Wave 2 — Data integrity**.

## Patterns established (catalogue items 1–4)

1. **Guessable internal id as an auth path.** A non-crypto primary key (`randomId`/`Math.random`) accepted as an alternative to a CSPRNG token collapses the trust boundary. Public webhooks must accept ONLY the unguessable credential; keep id-addressed actions on a separate internal/authenticated route.
2. **`typeof x === "number"` admits NaN/Infinity.** Any numeric input from a body/query needs `Number.isFinite`, AND the consuming store must guard too (Math.max/min propagate NaN rather than clamping). Guard at the boundary *and* fail-closed in the store.
3. **`?? 0` on a safety signal conflates absent with verified-clean.** A fail-closed gate must treat a missing/non-array field as "unknown → deny", never default it to the passing value. Check `Array.isArray` / presence before trusting a count.
4. **Absence-as-pass on enumerated requirements.** A check that only rejects an explicit negative (`=== false`) is bypassed by omitting the key. Derive the *expected* set server-side (from the same source of truth the client uses) and require each member present-and-affirmative.

## What remains

Per the INDEX, 8 themes (75 findings) open. Recommended next: **Wave 2 — Data integrity (lost-updates & dropped writes)**, which closes the third critical (interview-prep regenerate) plus 6 highs (atomic RMW on the prep payload, autosave flush-on-close, task-state leak, submission-lost-on-failed-POST, stale-JD-body save, CV dedupe race).
