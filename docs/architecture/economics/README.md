# Economics telemetry

`npm run economics:snapshot` writes one JSON file of **aggregates** describing what an install
has spent and sent. A council review copies the newest `telemetry-*.json` from this folder
into its pack (`.claude/council/config.md`, `## Economics`) instead of opening a database. The
rates that turn those quantities into dollars are in
[../price-book.md](../price-book.md).

The design: [../reviews/2026-10-08-economics-evidence.md](../reviews/2026-10-08-economics-evidence.md) §4.4.

## Running it

```bash
npm run economics:snapshot                      # -> docs/architecture/economics/telemetry-<date>.json
npm run economics:snapshot -- --out some.json   # elsewhere
KP_DB_PATH=/path/to/kp.sqlite npm run economics:snapshot
```

`KP_DB_PATH` is optional; without it the script reads `data/kp.sqlite`. It needs no key and no
network, and no dependency beyond `better-sqlite3`.

**The operator runs it. It is not a gate**: no CI step calls it, and nothing fails when no
snapshot exists. When none exists the council review says telemetry is absent.

## What it reads, and how

- The database is opened **read-only** (`readonly`, `fileMustExist`).
- When a `-wal` file sits beside it (the server is running), `db`, `-wal` and `-shm` are copied
  to an `os.tmpdir()` folder and the **copy** is opened, then deleted. The source is never
  written; `scripts/economics/__tests__/snapshot.test.mjs` compares its bytes before and after.

## What it writes

| key | holds |
| --- | --- |
| `database` | a label for the source (`KP_DB_PATH` or `data/kp.sqlite`), the file's base name, how it was read, and `kind`: `keyless` or `keyed` |
| `window`, `n` | first and last `llm_usage.ts`, and the total `llm_usage` row count |
| `row_counts` | `llm_usage`, `tasks`, `dev_outbox`, `ats_delivery` (`null` when the table does not exist) |
| `llm_usage` | grouped by `use_case` x `provider` x `model` x `outcome`: `n`, token sums, `cost_usd` sum, `unpriced_n` |
| `task_kinds` | per `tasks.kind` (joined on `llm_usage.request_id`, `outcome='ok'` rows): task count, `unpriced_tasks`, cost per task at `p50`, `p90`, `max` |
| `dev_outbox` | counts by `kind` x `channel` x `status` |
| `ats_delivery` | counts by `status`, and a histogram of `attempts` |

`keyless` means no priced, non-deterministic provider row: every model row is a
`deterministic` template serve at a known zero, or an unpriced call. It measures the shipped
default path. `keyed` means real priced spend is present. A snapshot always says which one it
read.

## What it never exports

No id, no recipient, no subject, no body, no `request_id`, no task id, and no path to the
database (a path carries the operator's account name). `dev_outbox` holds recipients and bodies
and is reduced to counts; the join keys (`request_id`, `tasks.id`) are used inside the query and
dropped. The test seeds recipients, bodies, subjects and ids into a fixture and asserts none of
them reaches the output.

## Where the snapshot comes from (decision, 2026-10-08)

The snapshot runs **only on a throwaway keyless database** until the operator names
`data/kp.sqlite`. Nothing in this folder was taken from the operator's own database. A fresh
keyless install writes no `llm_usage` row until a model call or a template serve happens, so
its first snapshot reads `n = 0`; a snapshot with `n = 0` is not committed, because it would
carry a window and no measurement.

## Schema notes

- `ats_delivery` is created lazily by `app/_lib/ats-delivery-store.ts`, not by
  `app/_lib/db/core.ts`, so a database that has never dispatched a webhook has no such table.
  The snapshot reports `null`, not zero, for it.
- There is no cost column on `dev_outbox` or `ats_delivery`; those two sections are counts, to
  be multiplied by the price book's rates (a known zero for kp's side of both).
