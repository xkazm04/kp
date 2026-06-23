> Total: 6 findings (0c critical, 0h high, 3m medium, 3l low)

## 1. `createOffer` export is now internal-only; the public export is dead surface
- **Severity**: Medium
- **Category**: dead-code
- **File**: app/_lib/offers-store.ts:116 (consumer that removed it: app/api/pipeline/[id]/route.ts:34)
- **Scenario**: Since the TOCTOU fix (idea-00987b3c) replaced the route's `getOpenOfferForEntry() ?? createOffer()` with `getOrCreateOpenOffer(...)`, nothing in the main repo imports `createOffer` anymore. Verified: `grep -rn "createOffer" app/ --include=*.ts*` returns only its own definition inside offers-store.ts (lines 116/246/251), a stale prose comment in route.ts:31, the unrelated WebRTC `pc.createOffer()` in VoiceInterview.tsx:443, and a mermaid diagram label in pipelineSteps.ts. The only live callers (`import { createOffer ... }`) are in `.claude/worktrees/*` — separate git branches, not this context's code.
- **Root cause**: The export was left public when its sole external caller was migrated to the transactional wrapper; nobody downgraded it to a module-private helper.
- **Impact**: Misleading API surface — invites a future caller to re-introduce the exact read-then-create TOCTOU the transaction was added to close. Low risk, real maintenance/foot-gun cost.
- **Fix sketch**: Drop the `export` keyword on `createOffer` (it stays callable from `getOrCreateOpenOffer` in the same module). `Parameters<typeof createOffer>[0]` at line 246 still resolves on a non-exported function, so no other change is needed.

## 2. `offerExpiresAtMs` is used only by its own test
- **Severity**: Low
- **Category**: dead-code
- **File**: app/_lib/offer-policy.ts:18 (test: app/_lib/offer-policy.test.ts:14-15)
- **Scenario**: `grep -rln "offerExpiresAtMs"` across the repo (excluding node_modules/worktrees) returns exactly two files: `offer-policy.ts` (definition) and `offer-policy.test.ts` (the one test asserting `offerExpiresAtMs(NOW) === NOW + OFFER_TTL_MS`). Production deadline-stamping is done inline in `createOffer` (offers-store.ts:129: `new Date(nowMs + OFFER_TTL_MS).toISOString()`), which does NOT call this helper.
- **Root cause**: A pure helper authored alongside the policy module for symmetry, but the one production write-site open-coded the arithmetic instead of using it.
- **Impact**: A function whose only purpose is to satisfy a test that tests only the function (success-theater). Negligible runtime cost; mild confusion about whether it's load-bearing.
- **Fix sketch**: Either (preferred) have `createOffer` call `offerExpiresAtMs(nowMs)` so the export earns its keep and the test guards real behavior, or delete the export plus its test if the inline form is intentional.

## 3. Deadline-comparison logic duplicated across SQL and the pure policy module
- **Severity**: Medium
- **Category**: duplication
- **File**: app/_lib/offers-store.ts:179-206 (`lapseExpiredOffers`, `dueOfferReminders`) vs app/_lib/offer-policy.ts:25-45 (`isOfferExpired`, `isOfferReminderDue`)
- **Scenario**: `offer-policy.ts` defines the canonical "is expired" rule (`nowMs >= ms`) and "in reminder window" rule (`ms > nowMs && ms <= nowMs + leadMs`). `offers-store.ts` re-expresses both as raw SQL: `lapseExpiredOffers` does `expires_at IS NOT NULL AND expires_at <= ?`, and `dueOfferReminders` does `expires_at > ? AND expires_at <= ?` over `[nowIso, cutoffIso]`. Two encodings of the same boundary semantics (inclusive-at-deadline, future-but-within-lead) maintained in parallel. `expireOfferIfDue` (line 165) correctly reuses `isOfferExpired`, so the per-row path already proves a single source of truth is achievable — the bulk sweeps just don't.
- **Root cause**: The sweeps are set-based UPDATE/SELECTs for which the row-by-row pure predicate isn't directly reusable, so each independently re-derived the boundary in SQL.
- **Impact**: A future tweak to the expiry/reminder boundary (e.g. strict `<` vs `<=`, or a grace period) must be made in 3-4 places that can silently drift; the inline comments asserting "ISO strings compare lexicographically in time order" are the only thing tying them together.
- **Fix sketch**: Not a mechanical extraction (SQL vs TS). Cheapest safe consolidation: add a doc-comment cross-reference and a small unit test that asserts the SQL sweeps agree with `isOfferExpired`/`isOfferReminderDue` on boundary rows (seed one row at exactly `now`, one at `now+leadMs`), so drift is caught. Do NOT try to force the pure predicate into the SQL path.

## 4. `OfferView` (page) and `offerView()` return shape are a hand-synced duplicate
- **Severity**: Low
- **Category**: duplication
- **File**: app/offer/[token]/page.tsx:13-22 (`type OfferView`) vs app/_lib/offer-finalize.ts:156-173 (`offerView` return object)
- **Scenario**: The client `OfferView` type (token, status, jobTitle, candidateLabel, currency, salary, company, expiresAt) is a field-for-field manual mirror of the object literal `offerView()` returns. The page casts the fetched JSON to it (`p.offer as OfferView`, line 73). The two are kept in lockstep by hand across the API boundary with no shared type.
- **Root cause**: `offerView` returns an inferred anonymous object rather than a named exported type, so the client had to re-declare the contract.
- **Impact**: Add/rename a field on the server view and the client type silently goes stale (the `as` cast suppresses any error); low likelihood given the small shape, but it is genuine untyped coupling.
- **Fix sketch**: Export `type OfferView = ReturnType<typeof offerView>` (non-null) from `offer-finalize.ts` and import it in the page, replacing the local declaration. Pure type-level change, no runtime effect.

## 5. `OfferResponseResult` success branch carries three fields no caller reads
- **Severity**: Low
- **Category**: dead-code
- **File**: app/_lib/offer-finalize.ts:14-16 (`alreadyResponded`, `jobTitle`, `candidateLabel`)
- **Scenario**: The success variant of `OfferResponseResult` returns `alreadyResponded`, `jobTitle`, `candidateLabel`. The route returns the whole result via `jsonOk(result)` (route.ts:35), but the only consumer — the offer page — reads just `p.status` (page.tsx:127). Verified no other reader: `respondToOffer` is called only by `app/api/offer/[token]/route.ts`; grep for `.alreadyResponded` / `result.jobTitle` / `result.candidateLabel` returns only unrelated `result` objects in automation-run.ts and db/pipeline.ts (different scopes), never the offer result.
- **Root cause**: The result type was shaped speculatively for a richer welcome/email response that ended up sourcing those values from the `hired` entry instead.
- **Impact**: Speculative generality — three computed-but-unused fields propagated through every return site (5 places), each a small maintenance carry and a misleading "this is part of the contract" signal.
- **Fix sketch**: Confirm no email/comms path reads them off the HTTP response (they don't — `dispatchOnboarding` uses `hired`), then drop the three fields from the success variant and the 5 return literals; keep `status`. Defer if the team considers them intended public API shape.

## 6. GET handler ignores its `_request` param — confirm vs lint convention
- **Severity**: Low
- **Category**: cleanup
- **File**: app/api/offer/[token]/route.ts:11
- **Scenario**: `export async function GET(_request: NextRequest, context: ...)` never uses `_request`. The leading underscore is the deliberate unused-arg convention, so this is benign — flagged only for completeness/consistency. The POST handler in the same file does use `request`. Next.js route signatures require the first positional param even when unused, so it cannot simply be dropped.
- **Root cause**: Framework-mandated positional signature where GET happens not to need the request.
- **Impact**: None functionally; noted so a reviewer doesn't mistake it for an oversight. Lowest priority.
- **Fix sketch**: Leave as-is (the `_` prefix is correct). No action unless the repo lint config prefers omitting the param via a different pattern.
