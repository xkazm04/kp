---
kind: task
status: done
opened: 2026-10-08
charter: codebase-security-scan
branch: autopilot/codebase-security-scan-4d3136cc
gate: node scripts/run-unit-tests.mjs "scripts/economics/**/*.test.mjs"
measurable: surfaces merged since the last scan (7c70ca1f). 7 findings. 2 fixed in scripts/economics/ (the known temp-copy leak and the torn WAL copy it sat beside). 5 reported, all low, on surfaces whose council Approvals are open.
---

# Security scan of what merged since 7c70ca1f

Base: local `main` `7dc5a5136`. Range: `git log 7c70ca1f..main`, 10 commits. The previous
records are `2026-10-07-pipeline-write-doors-scan.md` and
`2026-10-07-agent-entry-machine-actors-scan.md`.

## Scope

| # | Surface | Commits | Mode |
| --- | --- | --- | --- |
| 1 | `scripts/economics/snapshot.mjs`, run by the operator, reads the hiring DB and writes aggregates | `7dc5a5136` | fix |
| 2 | `app/api/pipeline/stage-migration/route.ts` and the store guard in `app/_lib/db/pipeline.ts` (`migratePipelineStages`, `actOnPipelineEntry`) | `75f7e84a1`, `4f2c3beb3` | report only: candidate-pipeline-board Approval is open |
| 3 | `app/_lib/jd-languages.ts` and its callers `app/_lib/jd-role-trace.ts` and `app/_lib/jd-build-run.ts` | `93ab4f662`, `8e27071b2` | report only: ai-assisted-jd-authoring Approval is open |

## Findings

| ID | Where | Severity | Status |
| --- | --- | --- | --- |
| E1 | `scripts/economics/snapshot.mjs:163-185` (pre-fix), `openReadOnly` | medium | fixed in `ab598d918` |
| E2 | `scripts/economics/snapshot.mjs:168-173` (pre-fix), db-then-wal copy | medium | fixed in `ab598d918` |
| P1 | `app/api/pipeline/stage-migration/route.ts:88-114`, plus `app/_lib/db/pipeline.ts:1225-1229` | low | reported |
| P2 | `app/api/pipeline/stage-migration/route.ts:119-126` | low | reported |
| P3 | `app/api/pipeline/stage-migration/route.ts:135` | low | reported (pre-existing) |
| J1 | `app/_lib/jd-limits.ts:78-88`, `app/api/jds/generate/route.ts:53` → `app/_lib/jd-role-trace.ts:115,154,165` | low | reported (pre-existing bound gap) |
| J2 | `app/_lib/jd-languages.ts:15-20` with `app/_lib/jd-role-trace.ts:145` | low | reported |

### E1: the temp copy of the database outlived a failed open (medium, fixed)

`openReadOnly` copied the db, the -wal and the -shm into `mkdtempSync(os.tmpdir()/kp-economics-*)`.
Only `close()` removed that folder. A throw from the second or third copy, or from
`new Database(...)`, left a full copy of the hiring database in temp. That copy holds
candidates' personal data, and no erasure or retention process reaches it.

**Severity: medium.** The folder is private to the operator's account, so nobody else reads
it. But it is an unmanaged copy of personal data that outlives GDPR erasure.

**What I found.** better-sqlite3 opens lazily. A copy that is not a database does not throw
at `new Database` but at the first statement. In `main()` that statement runs inside the
`try/finally`, so that case was already covered there. The cases that really leaked were a
copy that throws once the db file is already in temp, and a constructor that throws.

**Fix.** Any failure after `mkdtempSync` closes the handle, removes the folder and then
rethrows (`snapshot.mjs:250-262`). The open now reads `sqlite_master`, so a copy that is not
a database fails inside that cleanup. Tests in `scripts/economics/__tests__/snapshot.test.mjs`
point `os.tmpdir()` at a private folder and check that no `kp-economics-*` folder remains:

- a db file and a -wal file that are not SQLite: the call rejects with `SQLITE_NOTADB`;
- a -wal that is a directory: the copy throws after the db file was copied.

**Red on the unchanged source.** I put the base `snapshot.mjs` back temporarily. Tests 7-10
failed: the first did not reject, and the second failed with "the db copy outlived the
failed wal copy".

### E2: a torn db+wal copy reported wrong numbers with no error (medium, fixed)

The brief asked whether a torn copy can make the snapshot report wrong numbers silently.
**It can, and I reproduced it.** The race goes like this:

1. The script copies the db file.
2. Before it copies the -wal, the live server checkpoints, restarts the wal (new salt) and
   commits.
3. The copy now holds a stale db plus only the new frames.

I ran this on a throwaway database (never `data/kp.sqlite`), with these results:

- **Schema already checkpointed, rows still in the wal:** the copy opened, `integrity_check`
  returned `ok`, and the copy counted 10 rows against the source's 63.
- **Schema itself still in the wal:** the stale db has no `llm_usage` table. The snapshot then
  answered `n = 0`, `"keyless"`, against a source that held 6 priced rows. This is the
  council's economics row stating $0 spend.

**Severity: medium.** This is integrity of evidence the council reads, not a disclosure.

**Fix** (`snapshot.mjs:177-226`). A copy counts as one point in time if either check passes:

- **The wal header did not change.** The header holds the salts. If it is unchanged there
  was no restart, so every page the checkpointer wrote into the db is still a frame in the
  copied wal.
- **The db file's size and mtime did not change.** Then no checkpoint wrote it.

If neither holds, the copy is discarded and taken again. After 3 attempts the script refuses
and names the reason. If the -wal disappears mid-copy (the server shut down cleanly), it
starts over and reads the source read-only.

Two tests use a test seam (`afterDbCopy`) to run `wal_checkpoint(TRUNCATE)` and one insert
between the two copies:

- tearing once must retry and count 6;
- tearing on every attempt must refuse and leave nothing in temp.

With the guard forced to accept, both tests fail.

**Limit.** The fallback check uses mtime. On a filesystem with coarse timestamps (FAT,
1-2 s), it could accept a copy that was torn within one timestamp tick. The wal-header check
has no such limit, and it decides first.

### P1: a board edit can take a hired candidate off the terminal column (low, reported)

`75f7e84a1` refuses a migration whose destination is the terminal stage. Nothing checks the
**source**. Take an axis edit that removes or re-ids the stored terminal column. Its
occupants are active (not in `TERMINAL_ENTRY_STATUSES`, `app/_lib/pipeline-status.ts:48`),
so the 409 forces a mapping. The picker (`strandedTargets.ts`) and the 422 rule out the new
terminal column. That leaves only a non-terminal column as the destination.

Accepted-offer candidates then go back onto, for example, Interview:

- one `stage_migrated` event is written, and no outcome is reversed;
- `notifyStageEnteredHook` fires per entry (`pipeline.ts:1284`). The interview and homework
  arrival hooks can then mint invites to people already hired.

**Severity: low.** It takes a deliberate `pipeline:write` edit and is audited. The real cost
is integrity: hire counts, the role-fill state, and outbound candidate comms.

**Proposed fix:** refuse a leg whose `fromStage` is the stored axis's terminal column while
it holds active entries, or carry those entries to the new terminal column as a rename in
the store, with the outcome kept.

### P2: the re-role occupancy check runs outside the transaction (low, reported)

`route.ts:119-126` reads `countPipelineByStage` before `migratePipelineStages` opens its
IMMEDIATE transaction and before `setDecisionConfig`. A concurrent single move onto the
column that is about to become terminal is still legal under the stored axis. It can land in
that window, and the axis write then puts the candidate on the outcome column with no offer.

**Severity: low.** It needs two `pipeline:write` users acting at the same time, and the
window is milliseconds.

**Proposed fix:** pass the next terminal stage id into `migratePipelineStages` and re-count
its occupants inside the IMMEDIATE transaction, refusing with `TerminalMigrationTargetError`
when it is occupied.

### P3: the migration limiter is keyed per IP only (low, reported, pre-existing)

`route.ts:135` keys on `stage-migration:<ip>`. With no trusted proxy, every client resolves
to one bucket, so one seat can spend 20 per 10 minutes for every workspace. The
2026-10-07 scan keyed the add door per workspace and IP for the same reason. This range did
not introduce the key; it only moved code near it.

**Severity: low.** The effect is a denial of board edits, behind `pipeline:write`.

**Proposed fix:** key it `stage-migration:<ws>:<ip>` and update the row in
`rate-limit-contract.test.ts` deliberately.

### J1: no upper bound on the need text, which is now parsed several times (low, reported)

`validateJdBuildInput` sets minimums only, and `/api/jds/generate` reads `needText`
unbounded. Next route handlers have no default body cap. Each build now runs
`languageMentions` (NFD normalisation plus regex) over title, need and brief three times
(`jd-role-trace.ts:115, 154, 165`), plus `languageIds` per model language.

**Measured.** It is linear, not catastrophic: 1 MB of adversarial input (`"ale "×N`,
diacritics, a combining-mark run, punctuation runs) costs 6-160 ms per pass.

**Severity: low.** The door sits behind `pipeline:write` and the `jd-generate` limiter. The
LLM spawn over the same text costs far more than the parse. The missing cap predates this
range.

**Proposed fix:** add an upper cap in `validateJdBuildInput` (for example
`JD_BODY_MAX_LENGTH`, 20000), so the form and the server boundary keep one contract.

### J2: an unnegated mention keeps a language that was also ruled out (low, reported)

The rule says a language is stated when **any** clause mentions it with no negation cue. The
known miss is documented: "not only English but also German" negates English. The reverse
case is not documented. Take "English for documentation, not for client calls": the first
clause states English, so English is kept and the negated mention is not recorded.

The same holds for any language named both positively and negatively. Separately,
`briefLanguages` (`jd-role-trace.ts:145`) trusts the brief outright.

**Severity: low.** This is accuracy rather than access: a recruiter's own text decides
which language KO is applied. I list it only because the ko_lang chain (`8e27071b2`) turns
the verdict into a knockout.

**Proposed fix:** pin this reading in `jd-languages.test.ts` as an intended rule ("one
positive mention states the language"), so a later change to the rule is a decision rather
than a drift.

## Read and found clean

- **Stage-migration authorization.** The route calls `requireOperator` and then
  `requireCapabilityCoded("pipeline:write")` (`route.ts:50-58`) before reading the body. The
  workspace comes from `currentWorkspace()` (the session, `route.ts:68`). The body carries no
  workspace field, and every store query filters on `workspace_id = ?`.
- **Stage-migration input bounds.** `validateDecisionConfig` caps the stage list
  (`PIPELINE_STAGES_MAX`) and label length (60). Each `migrate` entry is type-checked and must
  name a stage on the new axis, so a large map costs O(entries × stages) and is refused at
  the first bad leg. `Object.entries` over a non-object `migrate` yields legs that fail
  `target_missing`.
- **Stage-migration error responses.** The validator detail rides as data beside a code.
  `TerminalMigrationTargetError` echoes only the client's own stage ids. Everything else
  goes through `safeJsonError(..., "STAGE_MIGRATION_FAILED")`, so no thrown message reaches
  the client.
- **The `4f2c3beb3` store guard.** `guardTerminal` returns `null` before any write in that
  transaction (only the SELECT precedes it). The `console.warn` names the entry id and the
  stages, server-side only. `outcome: "offer_accepted"` is passed only by
  `app/_lib/offer-finalize.ts`.
- **`jd-languages.ts` regexes.** I read all of them: `[̀-ͯ]`, `[a-z0-9]+`,
  `[.;,:!?()\n\r]+|\b(?:but|ale|vsak)\b` and `^jazy(k|c)`. None has nested or overlapping
  quantifiers, and I measured each as linear (J1).
- **The brief in the language trace.** It reaches `authorInputText` only through the intake
  edit door, which runs `sanitizeEditedBrief` (`app/api/intake/[id]/brief/route.ts:37`), and
  the promote door, which reads the stored row.
- **Model-written language names.** They pass `parseRoleSpec` and a `typeof === "string"`
  check before `droppedLanguages`, and the Ledger card renders them as React text, with no
  `dangerouslySetInnerHTML`.
- **The snapshot's output.** Unchanged by the fix: no id, path or recipient. The existing
  leak test still passes.

## Gates

- `node scripts/run-unit-tests.mjs "scripts/economics/**/*.test.mjs"`: 10 of 10 pass, 4 of
  them new.
- `npm run typecheck`: pass. Its `schemas:gen` step rewrote three generated files with CRLF
  line endings and no content change. I restored them; they are not part of this change.
- `npm run lint`: pass, with 0 errors and 49 warnings. The warnings were already there.
- `npm run test:unit`: 13008 of 13008 pass.
- `node scripts/run-unit-tests.mjs "scripts/kpi/**/*.test.mjs"`: 85 of 85 pass.

## Left for an owner

- P1, P2, P3, J1 and J2 wait on the open Approvals for candidate-pipeline-board and
  ai-assisted-jd-authoring.
- `docs/architecture/economics/README.md:28` still describes the copy accurately ("copied
  … then deleted"). It does not mention the retry on a torn copy or the refusal after three
  attempts. That file is outside this task's paths.
