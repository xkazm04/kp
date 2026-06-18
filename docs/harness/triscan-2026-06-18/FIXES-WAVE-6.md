# Tri-Lens Fix Wave 6 — Durability / XSS / Timezone (themes T7 + T8 + T10)

> 4 atomic fix commits, 4 criticals addressed (3 fully closed; 1 foundation + honest scope).
> Baseline preserved: tsc 0 → 0 · TS unit tests 953 → 955 (+2) · 0 regressions.
> Branch: `vibeman/triscan-fixes-2026-06-18`.

## Commits

| # | Commit | Finding | Severity | Files |
|---|---|---|---|---|
| 1 | `9e97964` | github-evidence-cv #1 — stored XSS via unvalidated URL | Critical | github-summary.ts (+test) |
| 2 | `ae3cd0f` | tasks-system-ops #1 — torn backup snapshot | Critical | db-portability.ts |
| 3 | `31ebf89` | data-store-persistence #1 — foreign_keys pragma off | Critical (foundation) | db-path.ts |
| 4 | `c107310` | interview-scheduling-prep #1 — slot timezone mismatch | Critical | schedule-slots.ts (+test) |

## What was fixed

1. **GitHub-evidence stored XSS closed.** `coerceGithubEvidenceSummary`/`build` validated that `profileUrl` and each repo `url` were *strings* and clamped length, never the scheme — so a `javascript:`/`data:` value persisted and fired as stored XSS when a recruiter clicked the GitHub link in `CandidateDrawer`. Now any non-http(s) URL is dropped to an inert empty href (scheme guard inlined to keep the module dependency-free for the strip-only test runner). Length-clamping ≠ sanitization.

2. **Workspace backup is a consistent snapshot.** `dumpWorkspace` read each table in a loop with no transaction; a write landing mid-loop produced a referentially **torn** backup reported as success. Wrapped all reads in one `db.transaction` (WAL gives an isolated point-in-time view). Verified a read transaction works on a readonly connection.

3. **`foreign_keys` pragma enabled (foundation — see honest scope).** SQLite defaults FK enforcement OFF per connection and `openStore()` never turned it on. Enabled it on every runtime connection (the standard-correct default, prerequisite for any FK to be enforced). **Honest scope:** the schema declares no `REFERENCES` yet, so this is a behavioral no-op *today*, and the report's "GDPR erasure strands orphans" scenario doesn't actually fire here because the GDPR path **anonymizes in place rather than deleting** (`consent.ts`) — nothing is orphaned. Declaring `REFERENCES` across the tables is a separate per-table migration (SQLite can't `ALTER ADD CONSTRAINT`) and is deferred; the dump/load handles keep their own pragmas, so the restore's drop-and-recreate stays FK-off and safe.

4. **Interview slots anchored to a fixed zone.** `proposeSlots`/`offeredSlotFor` built and validated the 10:00/14:00 grid in the **server's** local zone, while the candidate picker renders the instant in the **browser's** zone — so a slot minted "10:00" on a Prague server showed as 04:00 to a NY candidate and a sensible local pick was rejected, and the offered hours silently shifted if the server ran in a different zone (UTC on CI/prod). Anchored offered hours + business days to an explicit interview IANA zone (`INTERVIEW_TZ`, default `Europe/Prague`, override `KP_INTERVIEW_TZ`) via `Intl` zone helpers, keeping `slot_at` an absolute instant; validation now demands the exact canonical instant for the offered wall time in that zone. **Follow-up:** showing both zones in the picker ("10:00 interviewer / 04:00 your time") is UI polish, deferred.

## Verification

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| `node --test app/**/*.test.ts` | 953 | 955 (+2) |

New tests: GitHub stored-XSS drop (github-summary), Prague-anchoring + UTC determinism (schedule-slots).

## Patterns established (catalogue, continued)

18. **Length-clamp is not sanitization.** A trust-boundary coercer that bounds a string but renders it as `<a href>` is still an XSS vector — vet the scheme.
19. **Multi-statement reads need a transaction for a consistent snapshot.** A "backup" assembled from unsynchronized reads can be referentially torn yet report success; one read transaction (WAL) fixes it.
20. **Enabling a pragma ≠ enforcing the constraint.** `foreign_keys = ON` is necessary-but-not-sufficient without `REFERENCES`; state that honestly rather than claiming a no-op closes the gap.
21. **Wall-clock identity needs an explicit zone.** A slot/time anchored to the server's `getHours()` shifts with the deployment and mismatches a browser-rendered display; pin it to an explicit IANA zone, keep the stored value an absolute instant.

## What remains (per INDEX)

- **Same-context follow-ups (High/Med):** declare `REFERENCES` + cascade across the schema (data-store, migration), reminder-window straddle a cold heartbeat (scheduling #2), recruiter/candidate dual slot systems w/ no shared collision authority (scheduling #3), CV name autofill skips long names (github-evidence #2), picker dual-zone display (scheduling #1 part b).
- **Last theme:** T9 conversion (3C: landing CTAs are dead anchors, guided-demo climax has no CTA, outreach has no opt-out/do-not-contact suppression).
