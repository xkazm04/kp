# Tri-Lens Fix — High Wave 7: Public-endpoint / persistence robustness

> 3 atomic fix commits, **3 High findings closed** — all real even single-tenant.
> Baseline preserved: tsc 0 → 0 · TS unit tests 964 → 964 · 0 regressions.
> Branch: `vibeman/triscan-fixes-2026-06-18`.

## Commits

| Commit | Finding | Severity | Files |
|---|---|---|---|
| `3155298` | data-store-persistence #2 — migration `catch {}` swallows all | High | db/core.ts |
| `2697cf9` | comms-inbound #2 — body cap trusts content-length | High | request-body.ts (new), api/channels/inbound/[token]/route.ts |
| `bf11502` | comms-inbound #3 — resend double-fire | High | api/comms/[id]/resend/route.ts |

## What was fixed

1. **Migration errors surface instead of silently booting a broken DB.** Both ALTER migration loops used a bare `catch {}` commented "column already exists" — but it caught the *entire* error space. A genuine failure (corruption, I/O, lock contention under the documented multi-connection scheduler load) would boot a structurally-broken DB with no log — the exact "why is everything empty" hunt the seed-health code exists to prevent. A `migrateExec` helper now swallows only the benign re-run errors (`duplicate column name` / `already exists`) and `console.error`s + re-throws anything else.

2. **Inbound body cap enforced on real bytes.** The 64 KB guard checked only `content-length` — attacker-controlled (omit via chunked transfer, or lie and stream 50 MB), then `request.text()` buffered the whole body. The comment claimed it "fail[s] closed before buffering"; it did not. New `readTextWithLimit()` reads through a counting reader that *aborts the stream* the moment accumulated bytes exceed the budget; the header check stays as a cheap fast-reject for an honest oversized body.

3. **Resend can't double-deliver.** The resend route re-sent unconditionally (only the client button was disabled), so a double-click / two recruiters / a retried fetch delivered N copies of the same offer/rejection. Added an in-process in-flight set (collapses a concurrent double-fire) *and* a recovery check — if a newer non-failed row already exists for this `(ref, kind)` since the failed original, return `409 {recovered:true}` instead of re-sending.

## Verification

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| `node --test app/**/*.test.ts` | 964 | 964 |

(All three are route-/init-level — outside the codebase's pure-lib test boundary — verified by tsc + the full suite. `readTextWithLimit` is a small reusable helper other public routes can adopt.)

## Note (same class, not in scope here)

The header-only body cap also exists on the quick/conversational apply routes; `readTextWithLimit` is now the reusable fix to apply there next. The isolated stores (`schedule-store` etc.) carry the same `catch {}` migration pattern as core's pre-fix loops — a follow-up to route through an equivalent helper.

## Cumulative this session

30/30 criticals + **22 Highs** closed across 15 waves, 0 regressions throughout. TS 935→964, Python 626→634.
