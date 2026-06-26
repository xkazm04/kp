> Total: 6 findings (0c critical, 1h high, 2m medium, 3l low)

Context: "Auth, Sessions & Workspace Tenancy" (Identity, Data & Privacy). Security-critical: every finding below is a cleanliness/dedup observation only — none weakens session/token verification, tenancy scoping, the proxy gate, or `require-operator`.

## 1. `/api/auth/logout` route is dead — no caller; the only sign-out UI clears the dev gate, not the real cookie
- **Severity**: high
- **Category**: dead-code
- **File**: app/api/auth/logout/route.ts:8 (whole route); app/_components/auth/SignOutButton.tsx:5,17
- **Scenario**: `grep -rn "api/auth/logout"` across `app/`, `proxy.ts`, `scripts/` returns ZERO fetch/href callers (only the route's own definition). `grep -rn "logout\|signOut\|sign-out"` shows the lone sign-out UI, `SignOutButton`, calls `signOutDev()` (the dev-only localStorage gate in `devAuth.ts`) and nothing else — it never POSTs `/api/auth/logout`. By contrast `/api/auth/login` IS wired (`app/login/page.tsx:25` fetches it), and `/api/demo` mints the cookie, so the cookie session is real and live in production. `signOutDev()` is a no-op on the cookie: when `KP_OPERATOR_PASSWORD` is set (auth enforced) there is no UI path that clears `__Host-kp_session`.
- **Root cause**: the cookie-clearing endpoint was built (P2) but the SignOutButton was wired to the older dev gate and never re-pointed at it; the two sign-out mechanisms drifted.
- **Impact**: a fully-built, security-relevant route with no callers reads as dead code on every audit. More concretely it masks a behavior gap — in an auth-enforced deploy the operator cannot sign out from the UI (the cookie persists its 7-day TTL). This is the highest-value item because the "dead route" and the "missing wiring" are the same defect.
- **Fix sketch**: do NOT delete the route. Wire `SignOutButton` to `await fetch("/api/auth/logout", { method: "POST" })` before navigating (and keep `signOutDev()` for the dev gate). That both removes the dead-code flag and closes the sign-out gap, without touching verification logic. (If product truly wants dev-gate-only sign-out, document the route as the API-consumer entry point — but the grep shows no such consumer.)

## 2. The string literal `"workspace"` (default workspace id) is independently re-declared in 4 places
- **Severity**: medium
- **Category**: duplication
- **File**: app/_lib/auth/session.ts:13 (`DEFAULT_WORKSPACE`); app/_lib/db/workspaces.ts:9 (`DEFAULT_WORKSPACE_ID`); app/_lib/db/billing.ts:19 (`const WORKSPACE`); app/_lib/db/core.ts:772 (hardcoded seed)
- **Scenario**: `grep -rn 'DEFAULT_WORKSPACE\b'` + `grep -rn 'const WORKSPACE'` show the same value `"workspace"` declared four times, each with a comment pointing at the others ("Matches billing's single-workspace id", "matches the seed + auth/session.DEFAULT_WORKSPACE + billing's id", "matches DEFAULT_WORKSPACE in auth/session.ts and billing's id"). They are kept in sync purely by hand-maintained cross-reference comments.
- **Root cause**: auth, db, and billing each defined the tenancy default locally rather than importing one canonical constant; module-boundary ergonomics (auth must stay node:crypto-light; billing is an isolated store) led to copies.
- **Impact**: this is the tenancy anchor — the constant the whole single-tenant lock pivots on. Four declarations that MUST agree, synchronized only by comments, is exactly the kind of latent drift that becomes a tenancy-scope bug if one is changed and another is missed. (Today low blast radius because the value is frozen; the risk is structural.)
- **Fix sketch**: make `db/workspaces.ts` `DEFAULT_WORKSPACE_ID` the single source (it's the data-layer owner), and have `session.ts`, `billing.ts`, and the `core.ts` seed import it — or, if the import graph forbids it (auth → db), keep `DEFAULT_WORKSPACE` in `session.ts` as the leaf constant and import THAT into db/billing. Either way collapse to one declaration. Add a tiny equality test if cross-module import is undesirable. Behavior-preserving.

## 3. `planImport` and `loadWorkspace` recompute the same "populated tables" set; the import route runs it twice per apply
- **Severity**: medium
- **Category**: duplication
- **File**: app/_lib/db-portability.ts:141-155 (`planImport`) vs 161-171 (`loadWorkspace`); app/api/workspace/import/route.ts:47-54
- **Scenario**: both `planImport` and `loadWorkspace` open a connection (`openForLoad()`), prepare the identical `tableExists` statement, and loop the dump computing the populated set via `SELECT COUNT(*)` per table. On an `apply` request the route calls `planImport(coerced.payload)` (line 47) to get `plan.populated`, then immediately calls `loadWorkspace(...)` (line 54) which opens a SECOND connection and recomputes the very same populated set internally. Read confirms two separate `openForLoad()` opens + two identical COUNT(*) sweeps for one logical restore.
- **Root cause**: the dry-run plan and the load were authored as standalone functions mirroring the script; the route composes them without sharing the already-computed plan.
- **Impact**: duplicated COUNT(*)-per-table logic in two functions (must stay in lockstep with `loadWorkspace`'s refuse-to-clobber rule), plus a redundant DB open + full table sweep on every apply. Minor perf, but the real cost is that the "is this table populated?" rule now lives in two spots and a future change must touch both. Note: the all-or-nothing safety semantics are correctly preserved either way — this is purely about not computing it twice.
- **Fix sketch**: extract a private `populatedTables(db, payload): string[]` helper used by both `planImport` and `loadWorkspace`. Optionally let `loadWorkspace` accept an already-computed `populated` list (the route already has it from `planImport`) so apply opens the DB once. Keep the up-front whole-dump check intact — do not relax the replace gate.

## 4. `EdgeSession` type is declared but never referenced by name
- **Severity**: low
- **Category**: dead-code
- **File**: app/_lib/auth/edge-verify.ts:10
- **Scenario**: `grep -rn "EdgeSession"` across `app/` + `proxy.ts` returns only the declaration (line 10) and its sole use as the inline return annotation `Promise<EdgeSession | null>` (line 32). No other module imports or names the type; `proxy.ts` consumes the result structurally (`if (!session)`) without referencing the type.
- **Root cause**: a named type exported for callers that never materialized; the only consumer (proxy) uses it positionally.
- **Impact**: negligible — a tiny exported type with one local use. Flagged for completeness; arguably fine to keep as documentation of the edge payload shape.
- **Fix sketch**: leave as-is (it documents the return shape), or inline the annotation and drop the `export`. Not worth a change on its own.

## 5. `sessionEpoch` env-parse logic is duplicated verbatim in proxy.ts (`sessionEpochFromEnv`)
- **Severity**: low
- **Category**: duplication
- **File**: app/_lib/auth/session.ts:39-42 (`sessionEpoch`) vs proxy.ts:42-45 (`sessionEpochFromEnv`)
- **Scenario**: both functions are byte-identical bodies: `Number.parseInt(process.env.KP_SESSION_EPOCH ?? "", 10)` → `Number.isFinite(n) && n > 0 ? n : 0`. The proxy version's comment explicitly states it can't import `session.ts` because the proxy is edge-safe and `session.ts` pulls in `node:crypto`. The DEV_AUTH_KEY string is similarly duplicated (devAuth.ts:16 vs the hardcoded `"kp_dev_authed"` in app/layout.tsx:125), also by-design (pre-paint inline script).
- **Root cause**: genuine runtime constraint — the Edge bundle cannot import the node-crypto module, so the epoch parser (and the cookie name's sibling pattern) are copied rather than shared.
- **Impact**: low and largely unavoidable. The risk is drift if the epoch semantics change in one place but not the other (this is a kill-switch, so divergence would be a real auth bug) — but it's currently guarded only by comments.
- **Fix sketch**: extract the pure `parseEpoch(raw: string | undefined): number` into a dependency-free leaf module (no `node:crypto`), import it from BOTH `session.ts` and `proxy.ts`. This is exactly the pattern already used for `SESSION_COOKIE` (single-sourced in the edge-safe `edge-verify.ts`). Do NOT change the parsing rule. Optional; the existing comments make the constraint explicit.

## 6. `export-utils.ts` and `load-state.ts` are in this context's scope but belong to export/loading UX, not auth/tenancy
- **Severity**: low
- **Category**: structure
- **File**: app/_lib/export-utils.ts (CSV/ICS/download/clipboard); app/_lib/load-state.ts (fetch failure classification)
- **Scenario**: Read confirms `export-utils.ts` is the CSV/ICS/`downloadFile`/`copyText` toolkit for candidate-report/calendar share surfaces, and `load-state.ts` is the "empty vs failed load" classifier for the Dev Case Studio poller. Neither touches sessions, tokens, tenancy, or the operator gate. They share NO code with `db-portability.ts` (which is the actual DB dump/restore core) — the only overlap is the word "export". `grep` shows `BackupCard.tsx` uses `downloadFile` from export-utils to save the DB dump, but that's a generic browser-download helper, not portability serialization.
- **Root cause**: both modules sit flat in `app/_lib/` and got swept into this context by name similarity ("export", "load") rather than ownership.
- **Impact**: cosmetic / cohesion only — no dead code, no real duplication with the portability core (I checked: `db-portability.ts` has its own `encodeCell`/`decodeCell`; it does not and should not reuse export-utils). Mentioning so the reviewer doesn't conflate `export-utils` with `db-portability` (a tempting-but-wrong "merge the two exporters" suggestion).
- **Fix sketch**: none required. Do NOT merge export-utils into db-portability — they are unrelated. At most, these two files would be more at home grouped under their consuming features in a future tidy; not worth moving now.
