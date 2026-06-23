> Total: 5 findings (0c critical, 2h high, 1m medium, 2l low)

## 1. `safeHttpUrl` re-implemented inline in github-summary.ts
- **Severity**: High
- **Category**: duplication
- **File**: app/_lib/github-summary.ts:43-52 (the `safeLinkUrl` closure) vs app/_lib/safe-url.ts:34-45 (`safeHttpUrl`)
- **Scenario**: `github-summary.ts` defines a private `_HTTP_SCHEMES = new Set(["http:","https:"])` + `safeLinkUrl()` that re-creates safe-url.ts's http(s)-scheme guard. The module's own comment admits it: *"Mirrors safe-url.ts's safeHttpUrl guard, inlined to keep this module dependency-free (loadable by the strip-only test runner)."* Confirmed via `grep -rn "safeHttpUrl" app` → the only hit outside safe-url.ts is this comment; `grep -n "^import" app/_lib/safe-url.ts` → safe-url.ts has **zero** imports (it uses the global `URL`), so the "dependency-free" justification doesn't hold — importing `safeHttpUrl` would pull in nothing. safe-url.test.ts already imports safe-url.ts directly under the same `node --test` type-stripping runner (`app/_lib/github-summary.test.ts` and `app/_lib/safe-url.test.ts` use identical runner setup), so there is no loader barrier.
- **Root cause**: Defensive copy made before (or without noticing) that safe-url.ts is itself a pure, zero-dependency module safe to import anywhere.
- **Impact**: Two copies of a security-relevant XSS guard (recruiter-drawer `href`). They can drift: e.g. safe-url.ts also strips a leading `www.` and rejects empty-host URLs (`http://`); `safeLinkUrl` keeps the raw `url.href` and would pass an empty-host case differently. A future hardening to one copy (say, rejecting `data:`-with-base64 edge cases) silently misses the other.
- **Fix sketch**: Replace the local `_HTTP_SCHEMES`/`safeLinkUrl` with `import { safeHttpUrl } from "./safe-url"` and map: `safeLinkUrl(v) → (typeof v === "string" ? safeHttpUrl(v)?.href ?? "" : "")`. Keep the `clampStr` wrapping as-is. Drop the stale dependency-free comment.

## 2. `receiveSubmission` is a dead exported util (zero consumers)
- **Severity**: High
- **Category**: dead-code
- **File**: app/_lib/distribution.ts:58
- **Scenario**: `export function receiveSubmission(...)` has no caller anywhere in the live tree. `grep -rn "receiveSubmission" .` (all extensions, excluding node_modules/.next) returns only: the definition in `app/_lib/distribution.ts`, plus identical copies inside `.claude/worktrees/*` (throwaway worktrees, not the main app). The one worktree that *did* call it (`spicy-hopping-star/app/api/devcase/submit/route.ts`) is an old isolated copy; the live `app/api/devcase/submit/route.ts` and `app/api/devcase/inbound/route.ts` both call `intakeSubmission` instead (which is the closed-posting-guarded, idempotent, ack-sending replacement). So `receiveSubmission` is the superseded thin wrapper that was left behind when `intakeSubmission` took over.
- **Root cause**: `intakeSubmission` was added as the safe intake path; the older bare `receiveSubmission` wrapper was never removed.
- **Impact**: Dead code that is also a footgun — it bypasses the closed-posting guard and the candidate acknowledgement that `intakeSubmission` exists to enforce. A future caller reaching for the shorter name would silently re-ghost candidates (the exact regression `intakeSubmission`'s comment, lines 82-88, was written to prevent).
- **Fix sketch**: Delete `receiveSubmission` (lines 57-60). All real callers already use `intakeSubmission`.

## 3. `jsonError`/`jsonOk` envelope re-implemented inline across ~64 route files
- **Severity**: Medium
- **Category**: duplication
- **File**: app/_lib/api-response.ts:12-20 (helpers) vs ~64 route files re-deriving the ternary
- **Scenario**: api-response.ts:12 centralizes `const message = err instanceof Error ? err.message : fallback; return NextResponse.json({ error: message }, { status })`, and its header comment states this ternary *"was hand-rolled in dozens of route files"* and was *"Adopted first in the Scheduling & Offers routes as the pattern entry point."* The migration stalled: `grep -rln "instanceof Error ? .*\.message" app/api` → **64** route files still inline it (analytics, archetypes, automation, billing, channels, decisions, devcase, …), while only **54** import any of `jsonError`/`safeJsonError`/`jsonOk`. Examples: `app/api/analytics/route.ts:41`, `app/api/archetypes/route.ts:12,24`, `app/api/billing/checkout/route.ts:48`, `app/api/devcase/control/route.ts:33,58`.
- **Root cause**: Helper introduced as an opt-in convention; never swept across the older routes.
- **Impact**: 64 copies of the same envelope logic = no single place to later redact internal messages or add structured logging (the stated reason the helper exists). Note: some of these inline catches forward raw `err.message` where the safer choice is `safeJsonError` (the `error-message-hygiene.test.ts` files at app/api/interview, app/api/jds, app/api/pipeline already enforce this for a few dirs) — so this duplication is also masking a partially-enforced hygiene rule.
- **Fix sketch**: Mechanical sweep replacing `return NextResponse.json({ error: error instanceof Error ? error.message : "X" }, { status: 500 })` with `return jsonError(error, "X")`; use `safeJsonError` on store-backed catches. Don't bundle into one PR — chunk by area and lean on the existing hygiene tests.

## 4. `splitList` re-implemented inline in apply-intake.ts
- **Severity**: Low
- **Category**: duplication
- **File**: app/_lib/apply-intake.ts:326-329 vs app/_lib/split-list.ts:8
- **Scenario**: `buildIntakeProfile` does `answers.skills.split(/[,;]/).map(s => s.trim()).filter(Boolean)` — byte-for-byte the default branch of `splitList(text)` (pattern `/[,;]/`, trim, drop empties). Found via `grep -rn "split(/\[,;\]/" app`. This is precisely `splitList`'s documented job ("candidate free-text list fields (languages, skills, aspirations)"); the same file's sibling helper `completeness-followup.ts` already calls `splitList(answer("min_3_skills"))` for the identical skills field. So one candidate-skills splitter goes through the helper and the other hand-rolls it.
- **Root cause**: Local closure predates or overlooked the shared `splitList`.
- **Impact**: Low, but a future tweak to the delimiter rule (the helper's comment anticipates "also split on `/`") would update completeness-followup's parse and miss apply-intake's, so the same candidate's skills could parse differently on two paths.
- **Fix sketch**: `import { splitList } from "./split-list"` and replace the inline expression with `splitList(answers.skills)`.

## 5. Stale "Adopted first in the Scheduling & Offers routes" comment in api-response.ts
- **Severity**: Low
- **Category**: cleanup
- **File**: app/_lib/api-response.ts:3-7
- **Scenario**: The header says the `{ error }` envelope "was hand-rolled in dozens of route files" and was "Adopted first in the Scheduling & Offers routes as the pattern entry point" — framing it as an in-progress rollout. As of this scan the helper is the established API (54 importers) yet 64 routes still inline it (see finding 3). The "adopted first in X as the entry point" note is migration-era narration that no longer describes reality and slightly misleads a reader into thinking the convention is fresh/scoped.
- **Root cause**: Comment written at introduction, never updated as adoption spread (and stalled).
- **Impact**: Cosmetic/doc only. Mildly misleading provenance note.
- **Fix sketch**: Trim to a one-line statement of intent ("Shared JSON envelopes; centralizes error-message shaping so it can later be redacted/logged in one place"). Pairs naturally with the finding-3 sweep.
