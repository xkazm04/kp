# 2026-10-06 — `job_golive_receipts.failure_code` becomes a closed vocabulary

Charter: `codebase-security-scan`. Follow-up to `3f8f58313` (the
`job_golive_receipts` ERASURE_EXEMPT entry) and to
[`2026-10-06-unit-suite-triage.md`](./2026-10-06-unit-suite-triage.md), whose
exemption reasoning was right about the table's keying and incomplete about one
column.

## The defect

`job_golive_receipts` is listed in `ERASURE_EXEMPT` (`app/_lib/db/pipeline.ts`)
on the grounds that it holds job-keyed bookkeeping and counts. The keying half is
true — the DDL has no entry id and no person column, so the entry-keyed Art. 17
scrub has no path to the row. `failure_code` was the hole:

- `app/_lib/golive-run.ts:115-122` wrote `sourcingError.message` into it.
- That message is, for a `PipelineError`, the sourcing child's whole trimmed
  stderr (`python-runner.ts::parseStderrError`), and for a non-JSON reply the last
  400 characters of its stdout **and** stderr (`python-runner.ts`'s
  `Python returned non-JSON output` path).
- The sourcing child (`runSourceForRole`, `devcase-run.ts`) is handed every
  candidate profile in the workspace, so a traceback or an output tail can carry
  names, ids or profile text.
- `GET /api/jobs/[id]/publish` (`route.ts:80-81`) returns the receipt to the
  browser.

So: free text that may hold person data, in a row exempt from erasure, on the
wire. The existing pin (`golive-receipt-tenancy.test.ts`) asserts the **column
set**; a column can be free-text *shaped* and still pass it. The value's
vocabulary had to be pinned separately.

## The change

1. `app/_lib/golive-receipt-store.ts` — `GOLIVE_FAILURE_CODES`
   (`ABORTED`, `SOURCING_FAILED`, plus `PYTHON_ERROR_CODES` and `ENGINE_BUSY`
   upper-cased), the `GoliveFailureCode` type, `GOLIVE_FALLBACK_FAILURE_CODE`,
   `isGoliveFailureCode` and `coerceGoliveFailureCode`.
   `GoliveReceipt.failureCode` / `FinishReceiptOutcome.failureCode` are now that
   type. The codes are literals rather than an import so the store does not pull
   in the process runner; `golive-failure-code.test.ts` pins them to
   `PYTHON_ERROR_CODES` so the two copies cannot drift.
2. `golive-run.ts` — `goliveFailureCodeFor(error)`: a `PipelineError` whose
   upper-cased `code` is in the vocabulary keeps it, everything else is
   `SOURCING_FAILED`. The message is never persisted. The per-request
   `sourcingWarning` in the return value is untouched (out of scope, never stored).
3. `finishReceipt` coerces on write; `rowToReceipt` coerces on read, so even a row
   an older build left behind cannot be served as text.
4. `normalizeFailureCodes`, run from `ensureReceiptsTable` — idempotent repair of
   legacy rows: every non-null value outside the vocabulary becomes
   `SOURCING_FAILED`. No column added or removed; the PRAGMA pin is unchanged. It
   reads before it writes so the normal case stays write-free (an unconditional
   UPDATE would take a write lock on the read path — the SQLITE_BUSY_SNAPSHOT
   hazard this store's header warns about).
5. `ERASURE_EXEMPT["job_golive_receipts"]` and the **Erasure.** paragraph in
   `docs/features/jobs/README.md` now state the vocabulary, why the message was a
   problem, and which tests pin it.

### One test was amended, deliberately

`golive-receipt-tenancy.test.ts`'s "every SELECT/UPDATE/INSERT carries
workspace_id" now exempts statements carrying the marker
`one-time normalisation, deployment-wide by design` — the two normalisation
statements. They are a schema repair with no tenant to attribute them to, and
scoping them would leave every other workspace's legacy free text in place. The
exemption cannot grow silently: a new test asserts there are **exactly two**
marked statements and that they write no column but `failure_code`.

## Verification

| Gate | Result |
| --- | --- |
| `npm run typecheck` | pass |
| `npm run lint` | pass — 0 errors, 49 warnings (all pre-existing) |
| `npm run test:unit -- app/_lib/auth/**/*.test.ts app/api/**/*.test.ts` | 2111/2111 pass |
| `KP_FLAKE_RERUN=0 npm run test:unit` | **12658/12658 pass, 0 failing files** (12651 at `8ffc9f06`, +7 new) |
| golive + erasure focus run | 16/16 pass (`golive-run`, `golive-failure-code`, `golive-receipt-tenancy`, `db/erasure-full-scrub`) |

New assertions:

- `golive-run.test.ts` — a stubbed source throwing
  `stderr: …Traceback … Jane Example cand-123` leaves `failureCode` in
  `GOLIVE_FAILURE_CODES`, the string nowhere in the row (whole row serialised and
  checked), and `sourcingWarning` still carrying it; a `PipelineError` with
  `code: "engine_error"` maps to `ENGINE_ERROR`, one with `code: "rate_limited"`
  (outside the vocabulary) falls back to `SOURCING_FAILED`.
- `golive-failure-code.test.ts` — the vocabulary covers every
  `PYTHON_ERROR_CODES` member and `ENGINE_BUSY_CODE`; `coerceGoliveFailureCode`
  keeps null and a code and collapses prose; `finishReceipt` with an ill-typed
  prose value stores `SOURCING_FAILED`; a legacy free-text row is normalised in
  the DB (not merely on read) and a legitimate `ABORTED` on a sibling row is left
  alone.
- The existing `ABORTED` assertion (`golive-run.test.ts:69`) is unchanged and green.

## Not done / notes

- No column, service, dependency or route-shape change. The publish response
  carries the same fields; only `receipt.failureCode`'s TYPE narrowed.
- `sourcingWarning` (the transient, per-request message) is still the raw error
  text. It is returned to the operator who triggered the run and never persisted,
  and the brief scoped it out. If it is ever logged or stored, it needs the same
  treatment.
