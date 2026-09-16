# Job seeker — `/me`

> Status 2026-09-16: **under construction** on branch `spark/candidate-jobseeker`.
> This file is the doc-sync anchor for the module (`scripts/docs/feature-doc-map.json`);
> each work package fills its section in the same commit as the code.

The seeker-side of kp: the person running the install is looking for a job rather
than hiring. They reach `/me` by choosing "I'm looking for a job" on the first-run
Welcome step. Design record: the Spark vault idea `candidate-jobseeker` (2026-09-16);
dependency decision: [ADR 0009](../../architecture/decisions/0009-one-html-parser-for-owner-consented-acquisition.md).

## Entry points

| Surface | Path | Gate |
| --- | --- | --- |
| Thin shell (rail: brand mark, four links, appearance + language) | `app/me/layout.tsx` | `isOperator()` else 404; not in `PUBLIC_PAGES`, so the fail-closed proxy walls it when a password is set |
| Profile & CV studio | `app/me/page.tsx` | WP2 |
| Jobs feed + posting detail + fit dialog | `app/me/jobs/**` | WP5 |
| Sources (three tiers, acknowledgement) | `app/me/sources/**` | WP5 |
| Scans (shared scheduler registry) | `app/me/scans/**` | WP5 |
| API | `app/api/jobseeker/**` | operator-gated + `requireOperator` in every handler |

## Wire vocabulary

One file, `app/_lib/jobseeker/types.ts`: preferences, profile, sources (tiers A/B/C,
adapters, pause reasons, run outcomes), the extraction-rules DSL, postings + the feed
projection, dialogs and their artifacts, the Studio turn/reply shapes, the scan
summary. Every package imports from it; nothing redeclares it.

## Data model

Four workspace-scoped tables (all in `TENANCY_SCOPED_TABLES`, each with a colocated
`*-tenancy.test.ts`): `jobseeker_profiles`, `jobseeker_sources`, `jobseeker_postings`,
`jobseeker_dialogs`. DDL in `app/_lib/db/core.ts`; stores in `app/_lib/db/jobseeker-*.ts`.

## Keyless behaviour (product property)

- Dialog turns come from `pipeline/jobfit/jobseeker_cli.py`; without a provider the
  scripted `deterministic_turn` answers with `source: "deterministic"` and a
  `fallbackReason` — never an empty reply.
- Every harvested posting is structured deterministically and scored by the existing
  matcher; the LLM deep-dive runs only for the shortlist and is skipped keyless with
  `deepDiveSkipped: "no_provider"`.
- Under `KP_OFFLINE` every source returns `offline` before any egress.

## LLM use cases

`cv_polish`, `fit_dialog`, `extraction_rules` (Settings → Models section "Job search");
the deep-dive reuses `jd_ingest` and `match_reasoning`.

## Error codes

`JOBSEEKER_*` in `app/_lib/api-response.ts` (one STORE code, thirteen REFUSAL codes);
every code has four catalog entries under `errors.*`.

## Scheduler

`app/_lib/scheduler-jobs.ts` is the registry of named clock jobs. WP4 adds
`jobseeker_scan` (default 12 h, disabled until a manual scan succeeded) and makes
`/api/automation/schedule` and `SchedulerControl` iterate the registry.

## Sources and politeness

_WP3._

## Rules DSL

_WP3._

## Profile and CV studio

_WP2._

## Scan and scoring

_WP4._

## Feed, fit dialog, sources UI

_WP5._

## Known gaps

- Everything above marked with a work-package number is not built yet.
- `test:e2e`, `test:python:gate` and `test:eval:ci` are not run by the spark; owed
  before the branch merges.
