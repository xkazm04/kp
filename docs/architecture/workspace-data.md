# Workspace data — seeding, dump & restore

Everything the app persists lives in **one SQLite file**: `data/kp.sqlite` (override
with `KP_DB_PATH`; in any real deploy make it an **absolute** path — see
[self-hosting.md](self-hosting.md) §4). All ~26 tables — pipeline entries/events,
profiles, jobs, analyses, interview sessions & preps, dev cases/postings/submissions/
lifecycle, offers, schedule invites, scheduler state, group evals, JD templates,
decision config, audit — share that file; `app/_lib/db.ts` and each isolated store
under `app/_lib/db/` create their tables lazily and run their own ALTER-if-missing
migrations on boot. The Postgres alternative is described in
[postgres-backend.md](postgres-backend.md).

## Seeding

On first start (or whenever a seeded table is empty) the app auto-loads the committed
seed JSONs from `data/seed_*` — `seed_jobs/jobs.normalized.json` (the 100-job corpus
the matcher also reads as its default), `seed_candidates/candidates.json`,
`seed_analyses/analyses.json`, `seed_pipeline/pipeline.json`. So a fresh checkout
needs **no seeding step at all** — `npm run dev` is enough.

The seeds themselves are regenerated with the Python generators (LLM-backed, so they
need the engines from [engine-setup.md](engine-setup.md); you only need these to
*change* the seed data, never to run the app):

```bash
python -m pipeline.jobfit.seed_jobs --count 150 --workers 6   # synthetic job corpus → data/seed_jobs/
python -m pipeline.jobfit.seed_jobs_csas --count 100          # ČS-flavored corpus variant
python -m pipeline.jobfit.seed_candidates --count 50          # candidate profiles → data/seed_candidates/
python -m pipeline.jobfit.seed_analyses                       # scored analyses → data/seed_analyses/
python -m pipeline.jobfit.seed_pipeline                       # pipeline board rows → data/seed_pipeline/
python -m pipeline.jobfit.seed_interview_calendar             # extra interview slots, written straight into the DB
```

## Dump & restore (move / share / back up a live workspace)

`scripts/db-dump.mjs` exports *every* table (discovered from `sqlite_master`, so new
stores are picked up automatically) plus its DDL into one portable JSON file;
`scripts/db-load.mjs` restores it:

```bash
npm run db:dump                                   # → data/dumps/kp-dump-<timestamp>.json (gitignored)
npm run db:dump -- --out my-dump.json             # explicit path
npm run db:dump -- --skip gemini_cache,tasks      # leave out the LLM cache / task bookkeeping

npm run db:load -- my-dump.json                   # restore into data/kp.sqlite
npm run db:load -- my-dump.json --replace         # overwrite tables that already have rows
npm run db:load -- my-dump.json --db other.sqlite # restore into a different workspace file
```

Load semantics are deliberately conservative: missing/empty tables are always
recreated from the dump's DDL and filled (so seeding a fresh machine needs no flag),
but a table that already has rows is only touched with `--replace` — and that check
runs over the whole dump up front, so without it either everything loads or nothing
does. The load runs in a single transaction; an older dump is carried forward by the
app's own boot migrations on next start. **Stop the app before restoring into its
live workspace.** (For a quick same-machine copy you can also just copy
`data/kp.sqlite` while the app is stopped — the dump format is for portability,
partial loads, and surviving schema drift.)

## Boot integrity — the file is checked once, before anything writes to it

`ensureDb()` (`app/_lib/db/core.ts`) opens the boot connection through
`openCheckedBootConnection()`, which runs **`PRAGMA quick_check(1)` exactly once** and
**refuses to serve** on any non-`ok` answer, logging and throwing
`DB_INTEGRITY_FAILED` with the path. Before this, a corrupt page, a truncated copy or a
backup restored to the wrong path opened cleanly and served requests until some
unrelated query tripped over the damage — and the boot DDL/migrations below would have
*written into* that file first, compounding it.

Two damage shapes, one code: a file that is not a database at all makes the first pragma
in `openStore()` throw `SQLITE_NOTADB`; a corrupt page opens fine and is only found by
`quick_check`. A non-SQLite failure out of `openStore()` (the test-isolation guard, an
unknown `KP_DB_BACKEND`) keeps its own message and is *not* relabelled as file damage.

`quick_check(1)` is the cheap form — it skips `integrity_check`'s index-vs-table content
cross-check and stops at the first problem. It runs on the **memoized boot connection
only**: never per request, and deliberately **not** inside `openStore()`, which the ~18
isolated stores call on every module load. `app/_lib/db/core-integrity.test.ts` pins
both refusals (against real deliberately-damaged temp files, in child processes) and
that `db-path.ts` carries no integrity check of its own.

**Operator response:** restore a backup (see Dump & restore above), or copy a known-good
`kp.sqlite` in while the app is stopped. `DB_INTEGRITY_FAILED` is a **log/throw code
only** — it never reaches the wire as an API error code, because no route can serve a
request at all once it fires, so it is deliberately absent from `STORE_ERRORS`.

## Referential integrity — the pragma is on, the schema declares nothing yet

SQLite defaults `foreign_keys` **OFF, per connection**. `openStore()` turns it **ON** on
every connection the app opens. The audit that belongs beside that: **no table in the
schema declares a `REFERENCES` clause today**, so the pragma enforces nothing yet — what
it buys is that the moment a relation *is* declared (or migrated in) it is enforced,
rather than shipping a foreign key that never once fires.

Both halves are pinned in `app/_lib/db/core-integrity.test.ts`: the pragma must stay ON
*and* be genuinely in force (proven by an orphan insert being refused against a scratch
relation, not by reading the pragma back), and the "no `REFERENCES` declared" fact is
asserted against the booted schema. **Declaring a foreign key is therefore a deliberate
step**: it trips that pin, and the fix is to write a per-table test for the relation
(orphan refused, delete behaviour) and update the pin to name it. Declaring
`REFERENCES` on existing tables needs a per-table rebuild migration anyway — SQLite has
no `ALTER TABLE ADD CONSTRAINT`.

Follow-ups recorded, not done here: `VACUUM`/retention scheduling and index-coverage
review.

## See also

- [result-caching.md](result-caching.md) — the `gemini_cache` table and when to skip it
- [../development/logging.md](../development/logging.md) — the JSONL logs that sit beside the DB in `tmp/`
