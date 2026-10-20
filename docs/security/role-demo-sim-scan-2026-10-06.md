# Security scan — the goal-1 demo's simulated-interview path (2026-10-06)

**Scope.** The write path that merged as `22ece7a7`: the goal-1 demo run now creates
interview sessions, stores transcripts and seals scorecards, and runs the `claude` CLI on
the operator's own seat. Files read in full:

- `app/_lib/interview-sim/role-demo.ts`, `app/_lib/interview-sim/instrument.ts`
  (`assertThrowawayDb` / `throwawayDbProblem`), `app/_lib/interview-sim/providers.ts`,
  `app/_lib/interview-sim/engine.ts` (the dump),
- `scripts/kpi/role-demo-run.mjs`, `scripts/kpi/role-demo-run-child.mjs`,
  `scripts/kpi/role-demo-run-reading.mjs`,
- the interview-store functions they call — `createInterviewSession`,
  `completeInterviewSession`, `latestScoredCandidateInterviewByEntry`
  (`app/_lib/db/interviews.ts`) and `finalizeCandidateInterviewScoring`
  (`app/_lib/interview-scorecard-commit.ts`),
- what the engine does at the gates the demo approves: `commitRoleRunStageGate`,
  `runInterview`, `runScorecard`, `runOfferDraft` (`app/_lib/role-run-engine.ts`),
  `commitRoleRunGate` (`app/_lib/role-run-gates.ts`).

**Verdict summary.** Two of the three guarantees this path claims rested on circumstance
rather than on a check, and one claim it prints was false. Four fixes landed on the day of
the scan, each with a test that fails without it; one finding (2b) was left **open** for the
operator because closing it was a scope decision rather than a defect fix. The operator
answered it the same day — "seeded entries only" — and its fix landed under
[ADR-0011](../architecture/decisions/0011-one-role-runs-end-to-end.md)'s 2026-10-06
amendment; see §2b. One item remains open and is named there: the `provider: 'openai'`
mislabel of check 4, which cannot be corrected without a vocabulary change.

| # | Check | Verdict |
| --- | --- | --- |
| 1 | Never a real database | **fixed** |
| 2 | Never a real candidate — comms | **fixed** (defence in depth; nothing had ever been sent) |
| 2b | Never a real candidate — what the CLI receives | **fixed** in `51041e015` — the operator's way, "seeded entries only" |
| 3 | No transcript or scorecard text in output | **fixed** — the happy path held, both error paths did not |
| 4 | Workspace scoping | **holds**; the `provider: 'openai'` mislabel is **open** |
| 5 | Gate the tests | **fixed** |

---

## 1. Never a real database — **fixed**

**What was there.** `simulateInterviewForEntry` called `assertThrowawayDb()` as its first
statement, before any read and well before the first write
(`createInterviewSession`, `role-demo.ts:204`), and the child really does run on the copy:
`role-demo-run.mjs:171` spawns it with `KP_DB_PATH` pointed at the scratch file, and
`throwawayDbProblem` re-checks that `KP_DB_PATH` *equals the path `db-path.ts` froze*
(`instrument.ts:69`) — so a `KP_DB_PATH` set after the stores opened is caught, not
trusted. That part was sound.

**The hole.** `throwawayDbProblem` is a **path heuristic** and nothing more. It refuses
`DEFAULT_DB_PATH`, `data/kp.sqlite` and anything else inside the repository's `data/`
directory (`instrument.ts:70-75`) — and that is the whole of what it knows. A database at
`/var/lib/kp/kp.sqlite` or `D:\kp\kp.sqlite` passed it, and pointing `KP_DB_PATH` outside
the repository is the documented way to relocate the database (`.claude/CLAUDE.md`,
"Project Overview"). So any caller *other than* `role-demo-run.mjs` — a script, a REPL, a
test with no unit-db, a future route — could have played a simulated interview straight
into a production database and sealed a model-written scorecard onto a real candidate's
entry, with `setApproval(…, "scorecard_review")` opening that entry's scorecard gate on it
(`interview-scorecard-commit.ts:71`).

**Fix.** `assertRoleDemoScratchDb` / `roleDemoScratchDbProblem` (`instrument.ts`), called
at the simulator's own entry in place of the old guard (`role-demo.ts:184`). It inverts the
question: `KP_ROLE_DEMO_SCRATCH_DB` must name the very database the stores opened — the
**positive marker** the demo's parent half sets on the copy it made
(`role-demo-run.mjs`, the spawn's `env:` block) and that nothing else may set. The
heuristic still runs underneath; both have to hold. A refusal is a **throw**, not a row, so
a caller cannot mistake it for a handled skip.

**Consequence if unfixed.** A model-written scorecard and a transcript of a conversation
that never happened, sealed onto a real candidate's record, with the entry's scorecard
review gate opened on it. Irreversible in the decision chain.

**Test.** `scripts/kpi/__tests__/role-demo-interviews.test.mjs` — "the simulator refuses a
database no demo parent declared a throwaway copy": with the marker unset it asserts the
throw and that no session was minted, and it pins the three predicate cases (marker naming
another file; a marker cannot bless the operator's DB; the marked unit-db passes).

## 2. Never a real candidate

### 2a. Outbound comms — **fixed** (nothing had ever been sent)

**What the gates actually do.** Nothing on the demo path dispatches a message. The
engine's S4 drafts and parks with `inviteRef: null` and a comment saying why
(`role-run-engine.ts:216-222`); `commitRoleRunStageGate` verifies and spends the approval
token and then only **appends a ledger artifact** (`role-run-engine.ts:501-519`);
`commitRoleRunGate` touches nothing but the token store (`role-run-gates.ts:128-150`); S6
drafts terms and stops, and `createOffer` is never called by the run. The only comms
dispatch in the automation layer is `task === "outreach"` (`automation-run.ts:802-806`),
and the demo path runs `prep` and `scorecard` only. No email, no webhook, no calendar
invite, no notification. **So nothing has ever been sent.**

**Why it was still fixed.** That is a fact about today's call graph, not a guarantee. The
child inherits the operator's `COMMS_WEBHOOK_URL` and runs on a **copy of their relay
configuration** (`comms-relay.ts` resolves env → stored config), so the only thing between
an approved invite and a real person's inbox was the absence of a send call — and the
stored config in the copy is live, signing secret included.

**Fix.** `commsEgressSealed()` / `KP_NO_COMMS_EGRESS=1` short-circuits `resolveRelay()`
ahead of env and stored config, so a sealed process cannot deliver whatever is configured:
every message queues in that process's own `dev_outbox` and is honestly recorded `queued`.
The parent sets it on every child it spawns. Deliberately **not** `KP_OFFLINE`, which also
seals the model calls the simulated interview needs. Documented at
[comms §1.1](../features/comms/README.md).

**Test.** "the demo child is sealed against comms egress, however the relay is configured"
— the resolver under a configured `COMMS_WEBHOOK_URL`, plus a pin on the spawn's `env:`
block (a process boundary a unit test cannot cross), asserting all three variables are set
on the **copy**, never on the source.

### 2b. What the `claude` CLI receives — **fixed (operator's choice: option 1)**

**The finding.** The copy is a copy of `data/kp.sqlite`, so it holds **whatever the
operator's board holds** — real candidates, real CVs, real contact details. Which branches
are played is decided by which interview invites the stand-in approved on that board, so on
a real install these are real people, chosen by the policy and not by any demo fixture.
For each, `candidatePersona` renders `JSON.stringify(profile.payload)` — the whole CV
profile, clipped at 8000 characters — into the **system prompt** of a `claude -p` call
(`role-demo.ts`, `candidatePersona` → `providers.ts` `systemFile`), on the operator's own
Claude seat. The entry's **private** interviewer brief goes out the same way.

Per the brief I did **not** change which entries are played. What I did change is the
claim: the reading printed "candidate played by the model from the **seeded** CV", and
`providers.ts` asserted the simulator is "a dev-only instrument on synthetic candidates,
never on a real person's data". Both were false on this path, and a false assurance is
worse than none — it is the line an operator or the next agent would rely on. The wording
is now "from the CV on the entry", and `providers.ts` says what is actually true.

**For the operator to decide** (either closes it):

1. Restrict the demo to entries it can prove are demo data (a `seed_marks`-backed or
   explicitly-flagged slate), and refuse the rest with a recorded reason — the shape every
   other refusal on this path already has; or
2. Accept it as a disclosed dev-instrument behaviour, and say so where the operator runs
   it (a line in the run's own output naming the provider the CV is sent to, and a
   regulatory-backlog entry — the CV→provider hop is already in the candidate-data path
   map).

Note the pre-existing asymmetry it rests on: `pipeline/jobfit/claude_cli.py`'s production
consumer-terms veto does not apply here, and `providers.ts` says so — on the stated grounds
that the data is synthetic, which on this path it was not.

**Closed 2026-10-06 in `51041e015` — the operator answered "Seeded entries only", which is
option 1.** Recorded as an amendment to
[ADR-0011](../architecture/decisions/0011-one-role-runs-end-to-end.md).

**The fix.** `seedOriginProblem` / `loadSeedCorpus`
(`app/_lib/interview-sim/seed-origin.ts`), called from `simulateInterviewForEntry` after the
scratch-DB guard and the entry/profile lookup and **before** the provider preflight,
`candidatePersona`, any session and any model call. An entry is played only when the code can
PROVE it is seed data: its id, `candidate_id` and `candidate_label` match a record in
`data/seed_pipeline/pipeline.json` (including `seedPipeline`'s `?? "Candidate"` label
default) **and** the candidate's stored CV payload equals its record in
`data/seed_candidates/candidates.json`, compared as canonical JSON — the form
`seedCandidates` stores is the record verbatim, so nothing is normalized away. The job the
entry sits on is deliberately not part of the proof: moving a seeded candidate to another job
is board state and says nothing about whose CV it is. **Fail-closed:** if either fixture file
is missing or unreadable, every entry is refused; the demo does not fall back to playing
them. A refusal is an ordinary recorded row — `not simulated: not seed data (CV not sent to
the provider): <which check failed>` — whose reason names no CV content, no label and no id;
it does not consume the per-run cap (nothing was spent), and the reading reports how many
branches were refused this way.

**Two weaker signals, considered and rejected,** with the reasoning in the module's own
header so the next reader does not re-derive it: the `seed_marks` rows are not proof, because
`adoptedExistingSeed` stamps the `pipeline` mark on a database that merely already had
pipeline rows; and the `pe-*` / `cand-*` id shape is not proof, because `seedPipeline` inserts
`OR IGNORE` over a committed vocabulary, so a row a human or an import created can carry such
an id and keep its own candidate.

**Option 2's disclosure was taken as well, since it costs one line and is true either way:**
the printed reading and the `--json` reading now state where the CV of a played entry goes —
the Claude CLI (`claude -p`) on this machine's Claude seat, no other provider, no API key
(`SIM_PROVIDER_LINE`, `role-demo-run-reading.mjs`). The claims this change made false were
fixed with it: `providers.ts`'s "dev-only instrument on synthetic data" is now a checked
statement rather than an assertion, and `candidatePersona`'s "WHOSE CV" comment says the
proof instead of the hazard.

**Tests** (`scripts/kpi/__tests__/role-demo-interviews.test.mjs`, shown red with the check
removed): an **unseeded** entry carrying a sentinel in its CV makes NO provider, preflight or
scorer call at all (injected tripwire deps that record every invocation), mints no session,
records the refusal, and puts neither the sentinel, nor CV text, nor the candidate's label in
the row; a **pristine seeded** entry read live off the board passes the predicate, and the
same entry **with its profile edited** is refused — again with zero invocations and no
session; `null` fixtures refuse everything; key order is not a difference, content is; and the
run's provider line is present in both readings. Every other fixture in the file now plays
genuinely seeded `pe-*` rows, because an entry built by `createPipelineEntry` is refused by
construction.

## 3. No transcript or scorecard text in the output — **fixed**

**The happy path held** and was already tested: rows carry seven keys only
(`SimulatedInterviewRow`), `formatSimulatedInterviews` prints counts, recommendation,
verdict source and end reason, `runScorecard`'s S5 card carries `entryId`, `sessionId`,
`recommendation`, `rubricVersion`, `rubricKeys`, `source` — no evidence, no quotes — and the
existing sentinel fixture covered the rows, the formatted lines, the headline and the
artifacts.

**Both error paths leaked.** Two of them, and the first is the real one:

1. `clip(dump.error)` in the "did not complete" row (`role-demo.ts`, before the fix).
   `dump.error` is the thrown provider message sliced to 2000 chars (`engine.ts:431`), and
   the Claude CLI provider **built that message out of the model's own output**:
   `` `Claude CLI output was not JSON: ${out.slice(0, 300)}` `` and the error-subtype branch
   quoting `e.result` (`providers.ts:85-93`, before the fix). On this path the model's
   output is the **candidate speaking from their CV** — printed to the operator and sealed
   into the `--json` reading.
2. `messageOf(err)` in the "scorer failed" row. The scorer is `runAutomationTask` →
   `spawnPython`, whose error text can carry whatever the subprocess wrote to stderr, and
   what it was handed is `buildScorecardNotes(transcript)`.

Measured, not argued: with the fixes reverted the new fixture reports
`not rated: the simulated call did not complete (error: Claude CLI output was not JSON:
ZEBRA-SENTINEL-9902 I led the payments service at Northwind.)` and
`not rated: the scorer failed (python scorer failed on notes: Hello, I am an AI interviewer
for Northwind Payments…)`.

**Fix.** A failed call reports `endedBy` alone; `parseCliEnvelope` reports the size and the
exit code instead of the bytes; and `reasonOf` quotes a message only when the error's
**type** guarantees it holds no interview text, naming the class and withholding the message
otherwise. A redaction barrier rather than a sanitiser: there is no way to inspect a message
from the whole scoring stack and know what is in it. Every refusal still carries a reason —
the redaction is not silence. `child.stderr` echoed by the parent on a failed child
(`role-demo-run.mjs:179`) is unchanged and left as-is: it is a crash diagnostic on the
operator's own terminal, not a record anyone publishes, and suppressing it would make a
broken child unreadable.

**Test.** "a failing provider and a failing scorer put NO interview text in the row's
reason" — a provider that throws with a sentinel inside the model's words on branch 1, a
scorer that throws with the transcript on branch 2, asserting both error paths were taken,
that something was redacted, and that the sentinel reaches neither the rows, the formatted
lines, the headline, the artifacts nor the stand-in decisions. Plus `parseCliEnvelope`
directly, on both of its quoting branches.

## 4. Workspace scoping — **holds**

Every read and write on the path is either workspace-bound or keyed by a globally unique id
the simulator itself minted in that workspace, and **every query uses bound parameters** —
no value is interpolated into SQL anywhere on the path.

| Hop | Scoping |
| --- | --- |
| `getPipelineEntry(entryId, workspaceId)` | `WHERE id = ? AND workspace_id = ?` (`db/pipeline.ts:2840`) |
| `getProfileRecord(candidateId, workspaceId)` | `WHERE id = ? AND workspace_id = ?` (`db/profiles.ts:193`) |
| `latestPublishedKit(jobId, workspaceId)` | tenant-scoped delegate (`interview-kit.ts:17`) |
| `buildGroundedInterview` / `buildInterviewKit` | the run's `ws` is passed explicitly; both re-read the entry under it (`interview-run.ts:406`, `interview-agenda.ts:598`) |
| `createInterviewSession({ …, workspaceId })` | takes the **entry's** workspace when an entry is present (`db/interviews.ts:441-448`) — and `getPipelineEntry` above already proved the entry is in `ws`, so the two agree |
| `latestScoredCandidateInterviewByEntry(entryId, ws)` | `WHERE entry_id = ? AND workspace_id = ? AND mode='candidate' AND status='completed'` (`db/interviews.ts:655`) |
| `completeInterviewSession` / `attachInterviewScorecard` | by session id alone — the repo's documented pattern for the globally unique id (`db/interviews.ts:439`), and the id is one this call just minted in `ws` |
| `finalizeCandidateInterviewScoring` | `session.workspaceId ?? getEntryWorkspace(entryId)`; the session carries the entry's workspace, so the fallback is not reached |

No lookup by id alone where the id could be a caller's input. The cap is per-simulator and
per-run (`createRoleDemoSimulator`), and `runDemoOnCopy` passes one `ws` through everything.

**Open: `provider: 'openai'` on a session served by the Claude CLI** (`role-demo.ts:204`).
This is a real provenance mislabel: `provider` is the column the cost-attribution ledger and
the completion telemetry read (`setInterviewSessionProvider`'s own comment,
`db/interviews.ts:797-804`), and `/connect` maintains it precisely so attribution points at
*what served*. **Not fixed, because it cannot be a one-line truthful change**:
`VoiceProviderId` is a closed vocabulary of exactly `["openai", "elevenlabs"]`
(`voice/types.ts:13`), derived by `coerceProviderId`, `VOICE_PROVIDER_ORDER`, the
availability map and `VOICE_PROVIDER_TRAITS`, so there is no honest value to write and
inventing one is a schema plus adapter change. Mitigations already in place: the session's
candidate label ends ` (simulated)`, and this path writes no usage-ledger row (it never goes
through `/connect`), so nothing bills or attributes cost to OpenAI today. A truthful fix is
either a `simulated` flag on the row or a third provider id; both are a deliberate change,
not a correction.

## 5. Gate the tests — **fixed**

`scripts/kpi/__tests__/*.test.mjs` (`explainability-reason-coverage`,
`role-demo-interviews`, `role-demo-run-reading`) were collected by nothing: `npm run
test:unit`'s globs are `app|packages|edge|i18n`, which is exactly why so many `ci.yml`
steps are one `scripts/` directory each. The three safety invariants above are pinned in
that directory **and nowhere else**, so until this change the guards were unverified on
every push.

Added as a step in `.github/workflows/ci.yml`'s node-quality job, beside the other
`scripts/` fixture steps:

```yaml
- run: node scripts/run-unit-tests.mjs "scripts/kpi/**/*.test.mjs"
```

Through the launcher rather than `node --test`, so it gets the same scrubbed environment
and per-test timeout as the main suite. `package.json` was **not** touched (it carries
uncommitted work in the shared checkout); `check-guidance.mjs`'s `nodeScriptIndex` resolves
the step back to the npm script that wraps that launcher, so `guidance:check` stays
reconciled in both directions (verified: 36 gates, clean) and the gate table needs no new
row. The `test:unit` row in `AGENTS.md` now says which globs it does **not** reach and
names this step, so the next reader is not left to infer it.

`npm run test:perf`'s CI-budget half passes — the new step is inside an existing job, so no
job ceiling changed. `npm run test:agent` passes; the new path is under the `scripts/`
prefix its protected set already derives.

---

## Two gates that are red on `main`, not from this change

Both reproduced at the base commit `22ece7a71` in a detached worktree:

- `npm run test:perf` — the static import-graph budget, ~30 findings, e.g.
  `app/page.tsx: 1799 first-party modules, ceiling 1455` and
  `app/api/tasks/route.ts: 3583 KB … ceiling 3151 KB` at the base (3585 KB after this
  change: the +2 KB is this scan's comment block in `comms-relay.ts`, on a line that was
  already over by 430 KB). The CI wall-clock half of the same command passes.
- `npm run test:docs` — `check-doc-sync.test.mjs`: `missing doc:
  docs/design/app-contest-kit.md`, a doc `feature-doc-map.json` maps and the tree does not
  have (it is uncommitted work in the operator's checkout).
