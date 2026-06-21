# Critical Fixes — bug-ui-scan 2026-06-20

> All **10/10 criticals** from the scan closed, in 9 atomic commits across 3 themed waves.
> Baseline preserved: tsc **0 → 0**, unit tests **1016 → 1019** (+3 regression tests, 0 failures),
> i18n parity OK (2 locales). Python tests: registry/extractors/sanity green.

Branch `vibeman/bug-ui-scan-2026-06-20` (off `main`, which carries the user's pre-existing
LLM-metering WIP, committed first as `b9a3090` to clear the tree before fixing).

## Commits

| Wave | Critical | Fix | Commit | Files |
|---|---|---|---|---|
| 1 — security | #1 demo cross-tenant PII read · #2 whole-DB export dump | demo cookie opt-in (`demoSessionAllowed`/`KP_DEMO_ENABLED`); `isOperator()` rejects demo sessions; `requireOperator()` on export + import | `232a6c6` | auth/session, require-operator, workspace-lock(+test), demo, workspace/export, workspace/import |
| 1 — security | #3 automation routes | `requireOperator()` defense-in-depth on run/schedule/[task] | `1e1e694` | api/automation/* |
| 1 — security | #4 GDPR erasure leaves analyses | scrub linked `analyses` payloads (match on candidate_label) inside the erasure txn | `a6ac9ff` | db/pipeline + new DB regression test |
| 2 — availability | #6 ensureDb re-entry / HMR re-seed | memoize the connection on `globalThis` | `e54ae45` | db/core |
| 2 — availability | #5 CV letter-spacing regex DoS | cap repaired window + collapse count; tail passes through | `e0c55b3` | extractors + new test |
| 2 — availability | #7 archetype weights unvalidated | fail fast at import if any weight vector ≠ {skills,career,personal} summing to 1.0 | `a93480b` | registry + tests |
| 3 — UI crash | #8 onboarding tab crash | guard `r.ok` in load + patch; surface error instead of storing the envelope | `2a56137` | OnboardingTab |
| 3 — UI crash | #9 mobile nav unusable | off-canvas drawer + hamburger below `md`; permanent rail at md+ | `eefdf51` | Workspace + en/cs messages |
| 3 — UI crash | #10 sim overlay traps the page | real `role=dialog` modal: focus-in/restore, backdrop dismiss always, visible Close | `346dfa0` | SimOfferFrame |

## Notes / honest scoping

- **#3 was overstated in the scan.** The automation routes are NOT unauthenticated — `proxy.ts`
  (Next 16's renamed middleware) fail-closed-gates every non-public route when `KP_OPERATOR_PASSWORD`
  is set, and automation is not in its public allow-list. The real gap was the *absence of
  handler-level defense-in-depth* that every other Python-spawning/secret-writing route has; the fix
  adds that.
- **#1/#2 demo fix is a mitigation, not a full tenancy fix.** The architectural root cause — ~28
  tables ignore `workspace_id` (`workspace-lock.ts`) — remains. The fix makes the anonymous demo
  secure-by-default (the cookie is opt-in on a gated deploy) and bars the demo session from the
  operator-gated export/import. Full per-table workspace scoping is the residual (already tracked by
  the project's own `KP_MULTI_WORKSPACE` lock).
- **#6 ensureDb** is single-threaded JS, so the "concurrent re-entry" is really *HMR module reload*
  re-running the initializer; `globalThis` memoization is the established cure (other singletons in
  this codebase use it).
- **WIP untouched.** The user's LLM-metering WIP was committed first (`b9a3090`) and not otherwise
  modified. The `core.ts` baseline tsc errors were transient (a backtick-in-template state that was
  already fixed by the time the WIP was committed).

## Pattern catalogue (durable shapes seen across the criticals)

1. **A valid session ≠ an operator.** A signed session for a *different* workspace (demo) still
   passed `isOperator()`; gate operator-only routes on the session's workspace, not just validity.
2. **Defense-in-depth on side-effecting routes.** Middleware gating is not enough for routes that
   spend money / spawn subprocesses / write secrets — re-check at the handler.
3. **Erasure must follow the data, not the foreign keys.** When a PII table has no FK to the
   subject, scrub it by the best available link (here `candidate_label`) and over-scrub on erasure.
4. **Never store an HTTP error envelope as domain state.** `setX(await r.json())` without `r.ok`
   turns a 500 into a render crash; guard and surface instead.
5. **Bound every repair/normalization pass run on untrusted input.** Size caps that bound *memory*
   don't bound *CPU*; cap the work (window + iteration count) on regex/normalize passes.
6. **Enforce documented invariants in code, not comments.** "weights must sum to 1.0" was a comment;
   fail fast at load so a data typo can't silently mis-scale a scorer.
7. **Memoize process singletons on `globalThis`** so Next dev HMR can't re-run expensive/destructive
   initializers against live state.
8. **A modal must be dismissable and focus-managed.** `role=dialog` + `aria-modal`, move focus in /
   restore on close, and always offer a visible, working exit (backdrop + Esc + labeled button).
