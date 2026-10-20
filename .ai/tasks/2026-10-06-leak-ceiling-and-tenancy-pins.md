# Leak-ceiling rows deleted and two tenancy pins closed (2026-10-06)

Charter `codebase-static-analysis-sweep`. Test files only; no route or `app/_lib` source touched.
Base: `e00ada3cb`.

## Part 1 — `app/api/error-response-contract.test.ts`

Reconciled first: running the file on the base printed, for both rows,
`leak-ceiling slack — tighten it: <route>  1 -> 0` and
`leak-ceiling burnt down, delete the entry to lock the win: <route>`.

| Row deleted | Why | Answers now |
| --- | --- | --- |
| `billing/webhook/route.ts` (was 1) | reported burnt down; `route.ts:87` has no raw-message forward | `safeJsonError(..., "BILLING_WEBHOOK_FAILED")` |
| `channels/inbound/[token]/route.ts` (was 1) | reported burnt down; `route.ts:234` has no raw-message forward | `safeJsonError(..., "CHANNEL_INBOUND_FAILED")` |

Each row is replaced by a one-line "FIXED, not ceilinged ... The row is deleted so the win is
locked" comment naming that code. billing/webhook had no live leak, so its row did not stay.
No ceiling was added or raised; no other row touched. After the edit the run prints neither
message and the file passes 5/5.

## Part 2 — `app/_lib/golive-receipt-tenancy.test.ts`

Test "the deployment-wide exemption is only the failure_code normalisation" had two gaps.
Both checks now live in a pure helper, `normalisationViolations(sql)`, in the test file:

- (a) **Projection.** A marked SELECT must project a constant (`SELECT 1`).
- (b) **Whole SET list.** The text between SET and WHERE (or the end) is split on top-level
  commas (quotes/parens aware) and must be exactly `[failure_code]`.

### Red, then green

Red against the OLD check (first-column regex + "mentions failure_code"), run on the bad fixtures:

```
OLD check passes marked SELECT job_id,workspace_id: true
OLD check passes SET failure_code='X', job_id=?:   true
```

Both bad shapes slipped through. The NEW helper on the same fixtures:

```
SELECT job_id, workspace_id FROM job_golive_receipts ...
  -> [ 'SELECT projects "job_id, workspace_id", not a constant' ]
UPDATE job_golive_receipts ... SET failure_code = 'X', job_id = ? WHERE ...
  -> [ 'SET assigns [failure_code, job_id], not exactly [failure_code]' ]
SELECT 1 FROM job_golive_receipts ... -> []
```

A new test, "the exemption check fails on each bad shape and passes the real statements",
pins this with inline fixtures: three bad shapes (the two above plus a no-WHERE
`SET failure_code = 'X', workspace_id = ?`) must each yield one violation, and the two real
statements (`SELECT 1 ...`, `SET failure_code = ...`) must yield none. The original test now
runs the helper over the two real marked statements from `golive-receipt-store.ts`
(unchanged, marker text unchanged). File passes 9/9.
