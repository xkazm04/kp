# Role intake — the dialog that fills a RoleBrief

Phase 1 of [the role-intake concept](../../concepts/role-intake-dialog.md): a
coaching-register conversation with a hiring requestor (team lead / HR) that
captures the hiring need as a structured **RoleBrief**, then promotes it into
the existing JD build. Conversation design is normed by
[docs/development/role-intake-research.md](../../development/role-intake-research.md)
— change the persona rules there first.

## Entry points

- `?tab=intake` — **Job intake**, the authoring tab (sidebar: Library → Job
  intake). Two modes behind one switcher: the **intake dialog** (default) and
  **Generate**, the manual JD builder for a recruiter who already has the text.
  Both panels stay mounted, so switching can never discard a half-typed draft or
  an in-flight dialog (`jdsLedgerNav.ts` pins that; only a Duplicate advances
  `builderKey` and remounts the builder).
- The tab opens on **Generate** instead of the dialog when the URL carries a JD
  handoff — `?duplicate=<slug>` (the ledger's Duplicate), `?jdTask=<id>` (a
  finished background build, from the tasks tray) or the `?jdTitle=/?jdNeed=/…`
  prefill the guided demo's design step uses. The rule is one pure predicate,
  `opensOnGenerate` (`jdsIntakeTabEntry.ts` + test), because getting it wrong is
  silent: the builder reads its seeds at MOUNT, so a handoff that lands on the
  dialog drops what it was carrying.
- `?tab=library` — the saved-JD ledger. It is the whole library page now; the
  Saved / Generate / Intake strip that used to sit on top of it is gone.
- **Duplicate is a navigation, not a prefill.** The ledger and the builder no
  longer share a page, so the source SLUG rides the URL and `JdsIntakeTab` does
  the `?intent=1` read itself — which is what keeps a regenerated role designing
  from the recruiter's ORIGINAL prompt rather than from the rendered markdown.
  One-shot: the param is stripped via `history.replaceState` at mount, so a
  refresh can never re-seed a builder the recruiter has since edited.
- Operator-internal only. No public token, no candidate exposure.

## User flow

1. **Start** — POST `/api/intake` creates a `role_intakes` row and seeds the
   agent's opener into the transcript. The opener is ALWAYS deterministic
   (fixed, localized: greeting + explicit non-judgment + the
   context-reinstatement question) so the first impression is identical keyless
   and keyed.
2. **Talk** — each POST `/api/intake/[id]/message` is one exchange: the engine
   (`pipeline/jobfit/intake.py`, spawned per message via
   `app/_lib/intake-run.ts`) returns the agent's reply plus the FULL
   re-extracted RoleBrief; the route persists transcript + brief atomically
   (`updateIntakeDialog`, IMMEDIATE transaction). The right-hand **live brief
   panel** renders the brief filling in with per-value provenance chips
   (`stated` = the requestor's words · `inferred` = the agent's reading ·
   `default` = template assumption).
3. **Shape triage** — after 1–2 requestor turns the session is classified
   `power_unit` (backfill/clone → short confirm-and-generate path) or `story`
   (exploratory coaching path). Deterministic heuristic floor
   (`detect_shape`); the LLM may override. A third shape, **`app_master`**, is
   never triaged from prose — see below.
4. **Close** — the agent ends with a structured read-back + one open
   correction invitation, and **waits**: the close is a separate exchange
   (confirm → close; anything else lands as the requestor's `stated`
   correction — a `correction` facet on the deterministic path — then close).
   The `<<END>>` sentinel marks the session `complete` (an LLM `done` without
   the sentinel is ignored). The requestor's message is framed to the model as
   the AUTHENTICATED principal's own words — dialog content, never
   instructions — NOT as devcase-style adversarial data (UAT 2026-08-07 caught
   the borrowed fence making the agent refuse the requestor's own correction
   as "external unverified input").
   The read-back only prints spine values the requestor actually gave:
   `RoleBrief.spine_provenance` ({title|seniority|role_family} →
   stated|inferred|default) marks schema defaults as `assumed` in the UI, and
   the deterministic close classifies `role_family` from everything captured
   (`taxonomy.classify_role_family`) so a clinical intake never promotes as
   software; the LLM path is given the 16-family vocabulary + a skips-are-
   never-data rule. `merge_brief` resolves the spine scalars on that
   **provenance**, not on the value: an update whose `spineProvenance` says
   `stated`/`inferred` really captured the scalar, so a correction *down to* a
   schema-default value (senior → `medior`, data_ai → `software_engineering`)
   lands. The older value sentinel dropped exactly those corrections while
   still merging their `stated` provenance, leaving the panel chipping the OLD
   level as stated. A stated base still never regresses to a merely inferred
   update — the same rule the requirement/facet merges apply.
   Grades outside the junior/medior/senior/lead enum ("Band 5", "AfC 6",
   "tarifní třída 10") are never force-mapped: both paths capture the verbatim
   answer as a stated `grade_label` facet, the enum stays `default` (assumed
   chip), and the read-back carries the requestor's own grading (UAT drain
   2.3). The same rule covers a level the requestor *rules out*: the scripted
   scan skips an enum token that carries a negator (or a `than`/`než` contrast)
   in front of it, so "Not junior — we need a senior" and "lead, not senior"
   capture senior and lead instead of the rejected token, and an answer that
   only negates ("ne junior") stays a verbatim `grade_label` with the enum
   unmarked. Czech `ne, senior` (a correction) is deliberately not read as
   `ne senior` (a negation) — the separator after the negator must be
   whitespace. While a reply is generating, the thinking bubble gains a quiet
   second line after ~8 s naming the real wait (~30–40 s live) — latency
   honesty for the evaluation-anxious requestor (UAT drain 2.4); the persona
   carries an explicit LLM-era rule: role-existence doubt is a story opener
   anchored in 90-day outcomes (UAT drain 2.6).
5. **Promote** — POST `/api/intake/[id]/promote` runs the SAME backgrounded
   build as `/api/jds/generate` (placeholder JD row → detached `jd_build`
   task → best-effort ingest), with the brief threading the `DevNeed`'s
   structured fields (`stack` = must-have skills, `responsibilities` = 90-day
   outcomes) via `JdBuildInput.brief`. Body flags: `caseDesign: true` adds the
   work-sample design; `marketResearch: false` opts out of the (Czech-market)
   comp band for non-Czech roles. The intake row is stamped with
   `jd_slug`/`job_id` so a job can be walked back to the conversation that
   defined it.

## Shape `app_master` — composing a role from the codebase (P3)

The third shape (contract + rubric:
[docs/features/app-master/README.md](../app-master/README.md); plan:
[docs/concepts/app-master.md](../../concepts/app-master.md) §3). It does not
start from a blank conversation, it starts from an **app** — the one input no
JD has ever had.

- **Entry**: the Intake sub-tab's **App master** start option
  (`JdsIntakeAppMasterStart.tsx`) takes a GitHub URL or a local path, POSTs
  `/api/repo-scan` (P2's contract → `{scanId, taskId}`), then POSTs
  `/api/intake` with that `scanId`. A second entry point points here from a
  job's Agent-fit tab (`JobsAgentFitTab.tsx`) — that tab answers "how much of
  this JOB could an agent take over", which is a different question.
- **The shape is an ACT, not a triage.** `scan_id` is stamped on the row at
  CREATE and `shape` is `app_master` from the first write, so a reload resumes a
  running scan and no amount of "not sure, we've never had this role" can flip
  the session back to `story` (`detect_shape(turns, app_master=True)`).
- **While the scan runs** the chat shows the shape's own deterministic opener
  plus a scan-progress line (`JdsIntakeChat`'s `statusNote`). The clock is the
  **shared TasksProvider poll** — no second poller: its `tasks` array is
  referentially stable across no-op polls, so `useAppMasterLogic`'s effect fires
  exactly when a task's state moves.
- **…and it can be stopped.** The App-master card offers "Stop the scan" for as
  long as the scan is `queued` or `running`, through the existing task-cancel
  door (`DELETE /api/tasks/[id]`) on the task whose `params.scanId` matches this
  session's — resolved once with `fetchTask`, because the polled list projects
  `params` out. The row lands `failed` / `cancelled`, queued or running alike.
- **The scan line says what actually happened.** `scanStateFor`
  (`jdsIntakeLogic.ts`, pure + unit-tested) maps the row to one `ScanState`, and
  every member of that union is a message key under
  `library.tab.intake.appMaster.scan.*`, so a state with no catalog entry is a
  `tsc` error rather than a blank line. Two families were added to what used to
  be a four-word enum: `failed*` (the row's `errorCode` — "git is not installed
  here", "offline mode refuses remote clones", "the scan was stopped") and
  `fellBack*` (a scan that COMPLETED, but on the file-walk floor because the
  in-repo agent died — the dossier is real and thinner than it looks, and this is
  the moment the requestor can still fix the agent and re-scan). An unrecognised
  code falls to the generic line; a keyless install shows no fallback at all,
  because nothing fell back. Details in
  [`docs/features/app-master/README.md`](../app-master/README.md) §Lifecycle.
- **The poll reads through the route's wrapper.** `GET /api/repo-scan/[id]`
  answers `{ scan }`, and `readRepoScanResponse` (`jdsIntakeLogic.ts`, pure +
  unit-tested) is the one place that unwraps it. It used to be read flat, so
  `status` was `undefined`, the "has it completed?" test never fired, and a
  dossier that finished in about a second never reached its intake — the card sat
  on *"the scan is still reading the codebase"* with nothing wrong in any log.
  An unrecognised body now returns null and surfaces as *"can't reach the scan,
  retrying"* rather than a permanent, silent stall.
- **When the scan completes** the client POSTs `/api/intake/[id]/dossier`
  `{scanId, dossier}`. The server clamps the payload (`repoDossierSchema`), pins
  it to the intake's OWN `scanId`, and merges it into the brief through the same
  `merge_brief` path a dialog turn uses. Seven `codebase_dossier.*` facets land,
  all `provenance: inferred` (a machine read them; the requestor never said
  them): `.stack`, `.declared_gates`, `.contexts`, `.hot_spots`, `.risk_areas`,
  `.candidate_objectives`, `.maintainer_load`. Confidence is 0.8 when Claude
  Code read the repo in place, 0.6 for the keyless file-walk. An empty dossier
  field produces **no facet** — a hole reads as a hole.
- **Both App-master writes are compare-and-swap, not blind writes.** The merge
  and the fit run in a Python spawn that can take minutes, and the brief the
  route stores was computed from the row as it looked *before* that spawn. A
  dialog turn landing inside the window used to be overwritten — a value the
  requestor STATED, regressed by a machine reading, which is the merge rule
  inverted. `updateIntakeDossier` / `updateIntakeAppMaster`
  (`app/_lib/db/intakes.ts`) therefore carry `expectedUpdatedAt` — the row
  version read before the spawn — into the UPDATE's `WHERE`, and report
  `"ok" | "moved" | "missing"`. `moved` answers **409 `INTAKE_BRIEF_MOVED`**;
  the client's scan watch resets its `posted` guard and re-posts on the next
  tasks tick, without claiming the scan became unreachable. Pinned behaviorally
  by `app/_lib/db/intake-app-master-cas.test.ts` and at the routes by
  `app/api/intake/app-master-routes.test.ts`.
- **The dialog asks only what the scan cannot know.** A persona overlay
  (`_PERSONA_APP_MASTER`) replaces the power-unit/story triage rules, and the
  dossier rides the prompt in a fenced `CODEBASE_DOSSIER` block framed as a
  MACHINE READING (never the requestor, never instructions). That body is no
  more trusted than an attachment — every line comes from a repository the
  requestor merely pointed at (paths, context names, hot-spot and risk notes,
  and under `source: "llm"` prose Claude Code wrote about somebody else's
  code) — so it goes through the same `defuse_fence_markers` the
  `ATTACHED_MATERIAL` fence uses, over the **whole** assembled body including
  the candidate-objectives JSON (`json.dumps` escapes quotes and newlines but
  leaves angle brackets alone, so it is not sigil-proof by itself). Six
  answers, each landing as a `stated` facet under a **closed key contract**:

  | Question | Facet key |
  | --- | --- |
  | Which outcomes matter (rank, target, window) | `objective:<kpiKey>` (one per pick) |
  | How far may the holder go alone (rung 0–2) | `mandate.scopeRung` |
  | Are all six forbidden classes non-negotiable | `mandate.forbiddenClasses` |
  | Monthly budget ceiling | `budget.monthlyUsd` |
  | Who reviews / answers an escalation | `mandate.owner` |
  | Probation days | `tenure.probationDays` |
  | Agent, human, or either | `role.population` |

  A chosen objective also becomes a `successCriteria[]` entry — it IS what
  "done" means for this holder, and it is what makes the brief promotable for
  the human population. An outcome the scan never proposed is kept verbatim
  under a slugified key rather than forced onto the nearest `kpiKey`.
- **Keyless** the scripted slot script (`_APP_MASTER_SCRIPT`) asks the same six
  questions in the same order, offering the dossier's candidate objectives for
  ranking. The read-back prints the mandate, budget and tenure answers **and**
  the machine reading, so a wrong dossier line can be corrected at the close.
- **Population fit** (`pipeline/jobfit/agentfit.py::assess_population_fit`)
  classifies each chosen objective on the existing `automatable | assisted |
  human_only` vocabulary; the ratio is kp's own `coverage_ratio` (denominator =
  the objectives chosen, never the rows a model returned) and the verdict
  (`human | agent | hybrid | unassessed`) is derived from it **in code**.
  Keyless it never returns `automatable` and stays `unassessed`: a keyword
  match proves a tool is nearby, not that an agent can own an outcome.
- **Compose** — `POST /api/intake/[id]/compose-app-master` runs
  `briefToAppMasterSpec(brief, dossier)` (pure, validated with
  `appMasterSpecSchema`) and stores `{spec, fit, composedAt}` **plus the merged
  brief the spawn just produced**, in one `.immediate()` write under the
  compare-and-swap above. The brief used to be returned to the client and never
  persisted, so the requestor's screen adopted a brief that reverted on the next
  reload — and a stored spec without the brief it was composed from is a
  decision filed without its evidence. The
  defaults are always the safe end: an unreadable rung stays 2, an unreadable
  forbidden-class answer keeps all six, an undecided population stays `either` —
  and every assumption is recorded in `coercionNotes[]`.
- **Every refusal on this surface carries a code — all nine dialog routes, not
  just the App-master pair.** The dialog half answered English prose with no
  code at all (`"Intake not found."` on six routes, plus a closed session, an
  attachment limit, an index, "text is required", "JD not found." and "nothing
  to extract yet"), and `jdsIntakeLogic` threw every one of them away into a
  single `setError("send")` that the panel rendered as one red *"send failed"*.
  So "you already hold five attachments", "that JD is not in this library" and
  "slow down" were the same sentence, in English, to a Czech, German or French
  reader. Each now answers `jsonRefusal` with its own code, the client keeps the
  code (`IntakeError { kind, code }`) and `JdsIntakePanel` resolves it through
  `useErrorMessage()`; the per-affordance string is only the fallback for a
  failure that carries no code at all (an offline fetch). Pinned by
  `app/api/intake/intake-refusal-guard.test.ts`, which fails on any hand-rolled
  `{ error }` envelope at a 4xx/5xx status in these modules.
- **The dialog writes carry the version they were computed from.** `/message`
  and `/voice-turn` spend a model call between the read that feeds the engine and
  the write that replaces transcript AND brief wholesale, so a brief edit typed
  into the panel — or a turn on the other plane — was silently reverted by
  whatever the spawn returned. Both now pass `expectedUpdatedAt` through
  `casUpdate` and answer `INTAKE_BRIEF_MOVED` (409) instead of clobbering; the
  client re-reads the session rather than painting its stale copy back. `PATCH
  /brief` re-asserts its own read for the same vocabulary. The extraction sweep
  is the deliberate exception — it appends instead of refusing, because a refusal
  there would drop the hang-up recovery turns it carries.
- **The three spawning dialog routes are cancellable.** `request.signal` reaches
  `runIntakeExchange`, `runIntakeVoiceTurn` and `runIntakeTranscriptExtract`, and
  an aborted request answers 499 with no store-error log — the same treatment the
  App-master pair already had.
- **Every refusal on the two App-master routes carries a code.** They answered
  bare English strings, so `JdsIntakeAppMasterCard` had one line — *"could not
  compose the spec"* — for five different next actions: wait for the scan
  (`INTAKE_SCAN_NOT_LANDED`, 409), answer the dialog (`INTAKE_BRIEF_EMPTY`,
  400), start an App-master session (`INTAKE_NOT_APP_MASTER`, 400), wait out the
  throttle (`TOO_MANY_REQUESTS`, 429), or nothing at all because the session is
  frozen (`INTAKE_FROZEN`, 409). The dossier route adds
  `INTAKE_NOT_FROM_SCAN` / `INTAKE_SCAN_MISMATCH` / `INTAKE_DOSSIER_INVALID`,
  and both answer `INTAKE_NOT_FOUND` (404). All are `REFUSAL_ERRORS`
  (`app/_lib/api-response.ts`, docs/architecture/api-contracts.md §1.1) with an
  `errors.<CODE>` entry in each of the four catalogs; the card resolves them
  through `useErrorMessage()`, the way the dispatch control already did.
- **Compose is cancellable.** `runIntakeAppMasterSync` always accepted an
  `AbortSignal`; both routes dropped `request.signal`, so a compose that can run
  for three minutes kept a Python process (and possibly a paid `agent_fit` call)
  alive for a screen nobody was watching. Both routes now thread it, the card
  shows a **Cancel** beside "Composing…", and an aborted request answers 499
  with no store-error log — a deliberate cancel is not an incident.
- **The card shows the mandate, not a count of it.** `mandate.approvalGates`
  (executed by Personas), each objective's target · unit · direction · window,
  `tenure.reviewCadenceDays`, `tenure.retireCriteria` and
  `budget.reservationPolicy` are all composed into the spec, and the card used to
  render one number out of them — the objective COUNT — directly above a control
  that hires an accountable owner. The Mandate section renders each of those,
  every label through next-intl in the four catalogs, and an **absent value
  renders nothing**: no zero, no dash, no invented default. The field mapping is
  pure and pinned — `mandateSections` in `app/_lib/app-master/mandate-view.ts`
  (`mandate-view.test.ts`) — so the JSX stays typography. Capped lists (the fit's
  per-objective rows, the dossier's stack/gates/hot-spots/risks/objectives) carry
  a **"+N more"** that expands in place, the affordance
  `MatchCardSkillChips` already uses: a silent truncation is a claim about how
  much the scan read.
- **Hire** — the human population promotes through the existing JD build
  (`/promote`, unchanged). The **agent population's dispatch to Personas is P4**:
  the card shows a disabled "Dispatch to Personas" control saying so. No fake
  success.

## Keyless behavior (product property)

No provider → the dialog degrades to a deterministic scripted slot script
(same RoleBrief target, requestor answers land as `provenance: stated`), via
the shared `generate_with_fallback` contract. The UI shows a quiet
"guided checklist" note when a turn came from the deterministic path — and
that note now says WHICH degradation. `/message` and `/voice-turn` forward the
engine's `fallbackReason`, `JdsIntakePanel` classifies it with the same
`companionFallbackClass` the companion dock uses, and the three outcomes read
differently: no model configured (a settings trip), the model did not answer
(worth one retry), and an unrecognised diagnostic (the generic sentence). The
raw diagnostic is never rendered — it is classified, then localized.

**The script speaks all four app locales.** `_Q`, `_AM_SLOT_FACET`, the facet
labels, the read-back, the close, the "the scan proposed these" header and the
attachment acknowledgement carry native `en`/`cs`/`de`/`fr`; the confirm and
skip vocabularies recognise `ja`/`stimmt`/`oui`/`d'accord` and
`nein`/`überspringen`/`passer`/`aucune`, so a German "ja" at the read-back
closes the session instead of being recorded as a stated correction. Keyless is
the whole product for an operator without a key, and it used to hand a German
or French one English prose through a silent `.get(lang, ...["en"])`.

`SCRIPT_LANGS` is DERIVED from `_Q` rather than declared, and
`FourLocaleScriptTest` (`pipeline/jobfit/tests/test_intake.py`) fails when it
stops matching `i18n.LANG_NAMES` — so adding a fifth app locale without
scripting it is a red test, not a silent English session. Until it is scripted,
a request for that locale is DISCLOSED: the turn carries `fallbackLang` (the
language actually served, `_script_lang`), surfaced on `IntakeExchange` /
`IntakeVoiceTurn` in `app/_lib/intake-run.ts`. The field is absent whenever the
requested locale is scripted — an exception report, not a decoration. Both turn
routes put it on the wire and the tri-pane renders a stand-in-language line
naming the served language (through `Intl.DisplayNames`, in the reader's own
language), so "you are reading German because the checklist has no Polish" is a
stated fact rather than a silent substitution. Pinned by
`app/api/intake/intake-degradation-contract.test.ts`.

### The composed need text speaks the session's language

`needTextFromBrief` (`app/_lib/intake-brief.ts`) flattens the brief into the
JD build's `needText` — the string persisted as `build_input` and replayed on
every task re-run. Its four structural labels ("Done in 90 days", "Must have",
"Nice to have", the "Context" fallback) were English constants, so a Czech,
German or French session persisted English headings stapled to prose in another
language. They now come from a four-locale literal table keyed on the session's
`lang`, which `/promote` and `jd-build-run` both pass; a language the table does
not carry falls to `en`. Deliberately not next-intl: the string is a server
artifact composed where no request locale is in scope.

### Per-turn budgets

Every intake spawn used to inherit `python-runner`'s ten-minute HANG backstop.
That is the right bound for a repo scan and the wrong one for a conversation: a
stalled provider held the requestor on a spinner for nine minutes past the point
the answer was worth having, with the paid completion still running behind it.
`app/_lib/intake-run.ts` now routes every spawn through one `runIntakeSpawn`
helper and states a budget per thread — opening 30 s (deterministic), dialog
turn 120 s, voice turn 45 s (speech pace), transcript extraction 180 s,
app-master sync 180 s. Overrunning one throws `IntakeTimeoutError`, which
`/message` and `/voice-turn` answer as `INTAKE_TURN_TIMEOUT` (504) — a named
decision the composer can offer a retry for, not a generic store error.

### The stored transcript is bounded

`pipeline/jobfit/intake.py` renders only the newest `MAX_TRANSCRIPT_TURNS = 48`
turns into any prompt, so a turn older than that has had zero influence on the
conversation for as long as it has been stored — yet every turn was appended
forever, re-serialized into the spawn workdir twice per exchange and returned
whole on every session read. `app/_lib/intake-transcript.ts` caps the stored
transcript at exactly that window (`MAX_STORED_TURNS = 48`), applied inside
`updateIntakeDialog`, `updateIntakeVoiceSweep` and the re-open write; the spawn
writes `transcriptWindow(...)`, the same bound. Equal windows are what keeps
`sourceTurn` citations numbered identically on both sides of the boundary.

Compaction is DISCLOSED, never silent: one leading `system` turn carries the
machine token `kp:transcript-compacted:<n>`, which `JdsIntakeChat` resolves into
the reader's language. A second compaction absorbs the count instead of stacking
markers. Pinned by `app/_lib/intake-transcript.test.ts`.

Both `intake_cli.py` and `jobs_cli.py` now answer failures with the shared
`{error, status, code}` envelope from `pipeline/jobfit/_cli.py`
(`emit_error` / `invalid_input`), so a malformed `--attachments-json` or an
empty ad reaches `python-runner.ts` as `400 invalid_input` instead of an
anonymous 500 the runner had to guess a code out of.

## API / lib surface

| Piece | Path |
| --- | --- |
| Dialog engine (persona, extraction, merge, triage, scripted fallback) | `pipeline/jobfit/intake.py` |
| Per-exchange CLI | `pipeline/jobfit/intake_cli.py` (shared `{error,status,code}` envelope via `_cli.emit_error`) |
| Four-locale scripted path | `pipeline/jobfit/intake.py` (`_Q`, `SCRIPT_LANGS`, `_script_lang`, `_LABELS`, `_READBACK_STRINGS`, `_CLOSE_STRINGS`); tests: `FourLocaleScriptTest` |
| LLM use case | `role_intake` (`llm/capabilities.py`, `app/_lib/llm-config.ts`) |
| TS runner | `app/_lib/intake-run.ts` |
| Brief → JD-build projection (pure) | `app/_lib/intake-brief.ts` |
| Store | `app/_lib/db/intakes.ts` (`role_intakes`; tenancy: every query workspace-scoped, `intakes-tenancy.test.ts`) |
| Routes | `app/api/intake/route.ts` (create/list), `[id]` (read), `[id]/message` (exchange), `[id]/promote`, `[id]/brief` (PATCH — human edit), `[id]/reopen`, `[id]/dossier` (App master: a completed scan lands), `[id]/compose-app-master` (App master: spec + fit) |
| App master: dossier facets, persona overlay, slot script | `pipeline/jobfit/intake.py` (`dossier_facets`, `merge_dossier`, `_PERSONA_APP_MASTER`, `_APP_MASTER_SCRIPT`) |
| App master: population fit | `pipeline/jobfit/agentfit.py::assess_population_fit` (`agent_fit` use case) |
| App master: brief → spec (pure) | `app/_lib/intake-brief.ts::briefToAppMasterSpec` (`intake-brief.test.ts`) |
| App master: scan watch + compose (client) | `app/features/library/jds/intake/jdsIntakeAppMaster.ts` |
| App master: route trust boundaries | `app/api/intake/app-master-routes.test.ts` (source guard) |
| App master: refusal codes | `REFUSAL_ERRORS` in `app/_lib/api-response.ts` (`INTAKE_NOT_FOUND`, `INTAKE_FROZEN`, `INTAKE_BRIEF_MOVED`, `INTAKE_NOT_FROM_SCAN`, `INTAKE_SCAN_MISMATCH`, `INTAKE_DOSSIER_INVALID`, `INTAKE_NOT_APP_MASTER`, `INTAKE_SCAN_NOT_LANDED`, `INTAKE_BRIEF_EMPTY`) + the shared `TOO_MANY_REQUESTS`; rendered via `useErrorMessage()` |
| App master: write-path race guard | `app/_lib/db/intake-app-master-cas.test.ts` (behavioral, temp SQLite) |
| Dialog refusal codes | `REFUSAL_ERRORS` (`INTAKE_CLOSED`, `INTAKE_TEXT_REQUIRED`, `INTAKE_BRIEF_INVALID`, `INTAKE_BRIEF_NOT_READY`, `INTAKE_ALREADY_OPEN`, `INTAKE_ATTACHMENT_LIMIT`, `INTAKE_ATTACHMENT_INDEX`, `INTAKE_JD_NOT_FOUND`, `INTAKE_NOTHING_TO_EXTRACT`, `INTAKE_VOICE_NOT_CONFIGURED`) + the shared `INTAKE_NOT_FOUND` / `INTAKE_FROZEN` / `INTAKE_BRIEF_MOVED` / `TOO_MANY_REQUESTS` |
| Dialog refusal + cancel guard | `app/api/intake/intake-refusal-guard.test.ts` (source guard over all nine routes) |
| Dialog write-path race guard | `app/_lib/db/intake-dialog-cas.test.ts`, `app/_lib/db/intake-voice-sweep.test.ts` (behavioral, temp SQLite) |
| App master: mandate section model (pure) | `app/_lib/app-master/mandate-view.ts::mandateSections` (`mandate-view.test.ts`) |
| Edit sanitizer + edit-provenance diff (pure) | `app/_lib/brief-edit.ts` |
| Export builder (pure) | `app/_lib/intake-export.ts` |
| Close sentinel strip (pure) | `app/api/intake/reply-sentinel.ts` (`stripEndSentinel`, `voice-close-guard.test.ts`) |
| Rate limit | `intake-message:<ip>` 30/10min on the message route (pinned in `app/api/rate-limit-contract.test.ts`); `intake-create:<ip>` 30/10min (the opener spawns Python) and `intake-promote:<ip>` 20/10min (the paid `jd_build`) — both limiters shipped, contract pins still to add; `intake-dossier:<ip>` 20/10min and `intake-compose:<ip>` 30/10min (both spawn Python and can spend on `agent_fit`), pinned in `app/api/intake/app-master-routes.test.ts` |
| UI | `app/features/library/jds/intake/` (`JdsIntakePanel`, `JdsIntakeChat`, `JdsIntakeBriefPanel`, `jdsIntakeLogic`) |

## Data model

`role_intakes`: `id, workspace_id, title, status(open|complete|promoted),
lang, transcript_json (VoiceTurn[] — "interviewer" = agent, "candidate" = the
requestor), brief_json (RoleBrief), attachment_json (IntakeAttachment[]),
shape(power_unit|story|app_master|NULL), jd_slug, job_id, created_at,
updated_at`. The RoleBrief schema is Pydantic-authoritative
(`pipeline/jobfit/rolebrief.py`) and codegen'd to `roleBriefSchema`
(`app/_lib/schemas.generated.ts`).

Three nullable columns carry the App-master shape, added by an idempotent
`ALTER TABLE` inside `app/_lib/db/intakes.ts` itself (the
`skill-profiles`/`decision-record` pattern) rather than in `core.ts`'s shared
list — one owner per table, so a concurrent phase landing its own table never
shares the diff:

| Column | Holds |
| --- | --- |
| `scan_id` | the `repo_scan` the session was started from. Stamped at CREATE, before any dossier exists, so a reload resumes a running scan |
| `dossier_json` | the `RepoDossier` that scan returned (`repoDossierSchema`). NULL while it runs or if it failed; the dialog reads it every turn. Validated with `repoDossierSchema` on **read** as well as at the write route — a shape that no longer matches the generated declaration is recorded in `getRowHealth()` and the column reads as absent, rather than reaching the dialog as a half-valid object |
| `app_master_spec_json` | the composed record `{spec: AppMasterSpec, fit: PopulationFit, composedAt}`. Re-composing REPLACES it — a spec is a snapshot of the brief at compose time. Deliberately **not** validated on read: this is an `AppMasterCompose` wrapper *around* the generated spec, and `appMasterSpecSchema` describes the inner `spec` only, so validating with it would reject every row. Unvalidated is the honest state until the wrapper has a declaration of its own |

## Eval harness (Phase 2)

`pipeline/jobfit/eval/intake_eval.py` + `intake_scenarios.json` — the
12-persona requestor bank from the research doc (vague requester,
over-specifier, solution jumper, …) driven against the real
`run_intake_turn`. Offline mode (`--no-llm`: deterministic agent + golden
requestor answers) certifies the keyless path and the reliability invariants
(completed, one-question-per-turn, no premature `<<END>>`, grounded read-back,
brief completeness, shape triage + power-unit turn budget, role-family
classification, dealbreaker→requirements capture) — gated by
`tests/test_intake_eval.py`. Every scenario declares its role `family` and its
stated `dealbreakers`: the `role_family` check asserts the classified family
matches with non-default spine provenance (the software_engineering schema
default cannot vacuously pass its own family), and `requirements_captured`
asserts a transcript that stated a hard dealbreaker produced a non-empty
`requirements[]` (the UAT L2-NEW-2 / L1-HRBP-17 regressions, standing since
2026-08-25). Those two checks are emitted only for a scenario that declares
those keys, so the declaration itself is pinned across BOTH banks by
`test_every_scenario_carries_both_standing_assertions` — without it a scenario
added without a `family` or `dealbreakers` would silently lose both assertions
and still report PASS. Live mode runs both sides on the `role_intake`
provider; live runs are single-sample probes (shape/turn-budget expectations
go soft, the family/requirements checks stay hard), the offline mode is the
gate.

`requirements_captured` is checked **per stated condition**, not merely
non-empty: `brief_core` already demands one must-have, so a bare
`len(requirements) >= 1` could not fail unless `brief_core` failed too — it
would pass on exactly the L2-NEW-2 shape (every stated dealbreaker filed as
`dealbreaker_context` prose, one unrelated requirement picked up instead).
`unrouted_dealbreakers` therefore asserts each declared dealbreaker got its own
`requirements[]` row, matching the extraction contract's ROUTING clause
(`intake.py` prompt v2 — "facets are never an alternative home"). Matching is
tolerant in both directions, so a live agent narrowing "Flutter or React
Native" to "Flutter" still passes; only prose is a miss. This pins the
**routing** half of L2-NEW-2 — the reading half (`briefDealbreakerEvidence`
tolerating both homes downstream) is deliberate defense in depth, not a licence
for the extraction to skip the row.

**Market-breadth bank**: `intake_scenarios_gen.py` generates a deterministic
100-scenario bank spanning ALL 16 taxonomy role families × seniority ×
need shape (backfill vs first-ever-role story) with concrete per-family
content (licensure-bound nurses, shift-planning frontline leads, month-end
accountants, …). `--generated 100` runs it; the full hundred is gated
offline in `test_intake_eval.py` (848 checks).

## Brief as reference (Phase 3)

A job promoted from an intake grounds downstream conversations:
`promotedBriefForJob` (`app/_lib/db/intakes.ts`) resolves the brief via the
`job_id` back-link, and `briefIntentSummary` (`app/_lib/intake-brief.ts`)
rides the experienced-path interviewer brief (`composeBrief`'s `roleIntent`)
as interviewer-internal context — never the candidate-safe brief. Like the
promote gate, it reads dealbreakers and 90-day outcomes from **both homes**
(`briefDealbreakerEvidence` / `briefOutcomeEvidence` — the graded arrays *and*
the `dealbreaker_context` / `success_90d` facets the extraction usually picks,
UAT L2-NEW-2); reading only `requirements[]` left the interviewer ungrounded on
exactly the facet-carried briefs live sessions produce. Facet prose is trimmed
to 200 chars per line so the digest stays short inside the agent brief.

**Dev-case seam** (closes UAT L1-EVA-3): the brief survives as a structured
object into work-sample design. (a) Promote offers "also design the
work-sample case" (checkbox → `caseDesign` in the promote body, same
backgrounded build). (b) The Dev tab's JD picker fetches
`GET /api/jds/[slug]?brief=1` (workspace-gated, like `?intent=1`) and fills
the `DevNeed` from the brief — stack from graded must-haves, responsibilities
from 90-day outcomes, `roleFamily` from the classified spine — instead of
markdown re-extraction. (c) The graded dealbreakers themselves ride
`DevNeed.statedRequirements` (`devcase/models.py::StatedRequirement`):
`design_role` anchors the RoleSpec's must-haves to them (weight-ordered on
the deterministic path, instructed on the LLM path), which is what the
transfer assessment then weighs demonstrated capability against.

## Voice plane (input mode — transport-only providers, our brain)

Architecture contract:
[docs/architecture/voice-conversation-plane.md](../../architecture/voice-conversation-plane.md).
The requestor can TALK the intake ("Talk instead" beside the composer). The
provider session is a pure **speech transport in relay mode** — it transcribes
utterances and speaks the lines we inject, never answers on its own
(`relay: true` ⇒ `create_response: false`; the session instruction is a
persona-free relay directive, the intake persona never leaves our
infrastructure). Conversation direction is OURS, in two LLM threads:

- **Fast thread** — each transcribed utterance POSTs to
  `/api/intake/[id]/voice-turn` → `intake_cli --voice-turn` →
  `run_voice_turn` (use case `role_intake_voice`, plain text, 30 s timeout):
  persona + a CAPTURED/MISSING brief digest + recent turns → the next spoken
  utterance, injected via the transport's `speakText`. The exchange persists
  server-side BEFORE the reply is spoken, so a drop or transport swap loses
  at most the utterance in flight. A spoken confirmed read-back (`<<END>>`)
  closes the session like the text plane — and the sentinel itself is stripped
  at the route boundary (`stripEndSentinel`, shared with `/message`): the
  transport is told to say the reply "exactly, verbatim", so an unstripped
  token would be read ALOUD as the closing line, stored in the transcript and
  spoken again by `spokenOpener` on the next connect. `done` carries the close.
- **Periodic extraction thread** — every couple of exchanges (and at hang-up)
  the client fires `/api/intake/[id]/voice-complete` with no body:
  `extract_transcript` runs over the STORED transcript through the same
  coerce + `merge_brief` path as text, so the **live brief panel fills during
  the call** (lagging a turn or two — honest by design). With `{turns}` the
  same route is the drop-recovery path (append strays, then extract). It
  accepts a session `/voice-turn` just flipped to `complete` — the closing
  sweep and the hang-up recovery both arrive after the close, so refusing them
  lost the last exchanges; only `promoted` is frozen, and this route still
  never closes a session itself (`voice-close-guard.test.ts`).

The two threads run CONCURRENTLY — the client fires the sweep and the next
spoken turn from the same place — so the sweep's write is shaped for that:
`updateIntakeVoiceSweep` (`app/_lib/db/intakes.ts`) carries only the turns THIS
request brought and re-reads the stored transcript inside its own write
transaction. It used to write `[...transcriptReadBeforeTheSpawn, ...turns]`
through `updateIntakeDialog`, which erased any `/voice-turn` pair that landed
during the seconds-long extraction — words spoken into a live call, gone from
the only record a call has (`app/_lib/db/intake-voice-sweep.test.ts`). The
row version read before the spawn still rides along, so the write REPORTS a
concurrent turn (`moved`); nothing is refused, because refusing would drop the
hang-up recovery turns the payload carries. The response answers with the
STORED transcript, since the panel adopts it wholesale. Client-side,
`completeTurn` now holds a due sweep until no fast turn is dispatching
(`pendingExtract`) — that removes the self-inflicted overlap and one
concurrent paid call, but not an utterance the requestor simply speaks
mid-sweep, which is why the store is where the guarantee lives.

Extraction cost, stated plainly: every sweep re-reads the WHOLE transcript
(`extract_transcript` is given the full turn list), so a 20-exchange call runs
~10 batch extractions over a growing transcript. Slicing to "only turns since
the last sweep" is not a free win and is NOT done: the model assigns
`sourceTurn` indices over the turns it is handed (the click-to-turn chips read
them) and `detect_shape` judges the same list, so a sliced sweep would
misattribute every citation it produces. What the deferral removes is the
redundant concurrency, not the O(n) per sweep.

Client pieces: `JdsIntakeVoice.tsx` (thin driver) over two pure, unit-pinned
modules — `voiceOrchestration.ts` (the CONVERSATION: serializes fast turns,
coalesces utterances spoken mid-turn, extraction cadence, barge-in via
`cancelSpeech`) and `voicePhase.ts` (what the requestor SEES: the
idle→connecting→live→processing machine, the failure it is showing, the mic /
blocked-audio cues, and the cancellable post-close hang-up) — over the shared
transport (`app/_components/voice/transport/openai.ts` — `speakText` /
`cancelSpeech` are the relay additions). On connect the agent SPEAKS the
pending question from the text thread (`spokenOpener`) — voice continues the
same conversation.

Three rules the client half enforces, all unit-pinned:

- **Nothing spoken is thrown away.** Only a DELIVERED utterance is persisted
  server-side, so when a `/voice-turn` POST is refused (429) or blips, the
  orchestrator puts that utterance back at the FRONT of the queue
  (`completeTurn(state, done, failed)`): the next utterance carries it along
  (`enqueueUtterance` coalesces a non-empty queue when idle) and a hang-up
  recovers it with the rest of the queue. It is never re-dispatched on its own
  — a rate-limited turn must not become a retry loop against a paid endpoint.
  A close keeps the queue for the same reason (recovery), it just stops
  dispatching.
- **A failure says WHICH failure.** The voice plane resolves failures exactly
  like the text plane: a non-ok route answer becomes `{code, status}` and is
  rendered through `useErrorMessage`, so a 429 says "slow down", a keyless
  install says so, and a provider fault says that (`apiFailure`). The one
  failure the requestor can fix themselves — a browser microphone denial — is
  classified apart from a provider outage by the shared `micErrorText` and
  carries the allow-the-microphone recovery line (`interview.voice.errMicDenied`
  / `errMicNotFound` / `errMicBusy`, reused verbatim from the candidate voice
  screen). A `/voice-turn` failure leaves the call UP (the orchestrator requeues
  the words); only a connect failure ends it. The availability probe
  distinguishes an install that answered "no provider" from a probe that did not
  land at all (`readAvailability` → `unconfigured` vs `unknown`) — the second
  offers a re-check instead of claiming the server is keyless.
- **A voice result belongs to ONE session.** Both threads resolve long after
  they were fired (an extraction sweep is a model call), by which time the
  requestor may have gone Back and opened another intake — so `onExchange` /
  `onSweep` carry their intake id and `foldVoiceExchange` / `foldVoiceSweep`
  (`jdsIntakeLogic.ts`, `jdsIntakeLogic.test.ts`) drop what no longer matches,
  the same guard the text plane's `activeIdRef` applies.

Providers: **OpenAI Realtime implemented; ElevenLabs designed-not-wired** —
with the brain out of the provider its client-sent-prompt seam is no longer a
blocker (it would receive the same persona-free relay line); residual
audio-transits-provider exposure is a Terms-of-Service disclosure item (line
in the architecture doc), not an architecture dependency.

Keyless/voiceless behavior: no voice key → quiet "not configured" note, text
untouched (a probe that could not be read says *that* instead, with a re-check —
`voice.checkFailed` / `voice.recheck`). No LLM mid-call → the scripted slot engine IS the fast thread
(deterministic, milliseconds, extracts inline). No LLM at extraction → the
transcript is stored, the brief stays **unchanged**, the UI says so
(`voice.storedNote`). Rate limits (all pinned in
`app/api/rate-limit-contract.test.ts`): connect 6/10min per intake — flat, no
self-hosted raise, because this route mints OpenAI Realtime credentials and
only those (a locally configured ElevenLabs is unreachable from it, so
"nothing billable is minted" is false here) — fast turns 60/10min per intake,
extraction sweeps 20/10min per IP.

## Editable brief + re-openable sessions (UAT drain §2.1)

The requestor can FIX what was captured without a new session:

- **Edit mode** in the live brief panel (`JdsIntakeBriefEdit.tsx`): title,
  seniority (closed vocab), requirement skill/kind, facet values; delete and
  add entries. A typed edit is `stated` by definition — but only CHANGED or
  NEW entries flip (`withEditProvenance`, `app/_lib/brief-edit.ts`): untouched
  entries keep their provenance/confidence/`sourceTurn`, so an edit pass can't
  launder inferred values into "stated". Server: `PATCH
  /api/intake/[id]/brief` clamps SHAPE at the trust boundary
  (`sanitizeEditedBrief` — vocab/range/caps mirroring the Python coerce);
  the transcript is never touched by an edit.
- **The form closes only on a CONFIRMED save.** `saveBrief` reports whether
  the PATCH landed; edit mode (and the inline title field) stays open holding
  the typed work when it did not, since the form is the only copy of the
  requestor's corrections — a 409/400/offline used to unmount it and leave a
  one-line error where a page of retyping should be.
- **Re-open** (`POST /api/intake/[id]/reopen`): a `complete` session flips
  back to `open` with a system turn appended so the transcript honestly
  records the gap; the message route accepts again.
- **Promoted sessions stay frozen** — the JD exists; edit is hidden with a
  clear note. Re-promoting an edited brief is deliberate future work (an
  edited brief silently diverging from a published JD would be the dishonest
  middle ground).

## Defensibility (UAT drain §2.2 — "obhájím to před ředitelem — čím?")

- **`source_turn` is written on both paths**: the deterministic script stamps
  the exact transcript index that answered each slot; the LLM path gets a
  NUMBERED transcript (`[N] REQUESTOR: …`) + the new message's index and cites
  `sourceTurn` per requirement/facet (`_EXTRACTION_RULES`).
- **The panel shows the grading**: each requirement row expands to
  weight/confidence/rationale; a "turn [N]" chip on requirements and facets
  **jumps the chat to the cited bubble** and flashes it — the
  click-to-evidence moment.
- **Export**: a markdown download (brief with provenance + grading + turn
  citations, then the numbered transcript) built client-side
  (`app/_lib/intake-export.ts`) — the artifact for the director/inspector
  meeting. A defaulted seniority is visibly flagged in the export.

### A facet's confidence is shown when the reading is uncertain

Requirements have carried weight + confidence since the defensibility pass;
facets did not, and one producer depends on them doing so. `_dossier_facet`
(`pipeline/jobfit/intake.py`) grades an App-master codebase facet **0.8** when
Claude Code read the repo and **0.6** when the heuristic file-walk did, under a
comment stating that "the confidence the panel chips must say so". The chips
could not: both readings are provenance `inferred` by construction (never
"stated" — a machine read this), so the panel rendered the identical chip for
both and the number had no consumer at all. `JdsIntakeBriefPanel` now renders a
quiet confidence chip on a facet row, reusing the existing
`library.tab.intake.defense.confidence` key (as a bare percentage beside the
label in the two new bodies). Confidence `1` renders nothing — a
value the requestor stated out loud is the common case, and a "100%" chip on
every line would bury the one number that carries information.

## Attached reference material ("Materials")

A session can carry up to 5 attachments — a pasted **note** (a colleague's
brief, a legacy JD text) or a **saved JD** picked from the library, resolved
SERVER-side from the workspace's `jds` row (the client sends only the slug;
`app/api/intake/[id]/attachments/route.ts`, caps: text ≤20k chars, title
≤120; promoted sessions frozen). Stored in `role_intakes.attachment_json`
(`IntakeAttachment` in `app/_lib/db/intakes.ts`). The pane clears its fields
only once the server has accepted the attachment — hitting the 5-attachment
cap, the 20k text cap (`INTAKE_ATTACHMENT_TOO_LONG`, carrying `max`) or a
frozen session keeps the pasted note in the textarea instead of destroying it.

The COUNT cap is disclosed the same way the text cap is: the pane carries a
`{used} of {max}` chip (`attachments.countOfMax`, `ATTACHMENT_LIMIT` imported
from `attachment-limits.ts`, never re-typed) and DISABLES both add controls at
the cap, with the route's own `INTAKE_ATTACHMENT_LIMIT` message resolved through
`useErrorMessage` underneath. Before that the pane imported the text cap only, so
a sixth attachment looked addable and the click bought one round trip and a
generic red line. Pinned by `JdsIntakeAttachmentsPane.test.ts`.

Material is stored **as given**. Two consequences, both deliberate:

- Over-cap note text is REFUSED, never truncated. The route used to `.slice()`
  the overflow away silently, so a pasted long thread was accepted while the
  agent grounded on a document whose tail was gone. The composer discloses the
  cap before the send (`attachments.textCap`, reading `ATTACHMENT_TEXT_MAX`
  from the route's own `attachment-limits.ts`) and the refusal restores the
  typed text. A **JD** body still slices — it is resolved server-side from the
  library, not typed by anyone.
- An untitled note is stored untitled. The route used to default the title to
  the English literal `"Note"`, persisting one locale's word into every
  workspace's data; the stand-in is now a render-time fallback in the pane
  (`attachments.noteFallbackTitle`), so it reads in the reader's language. No
  migration: rows created before this keep the literal they were given. Same contract in the composer: a refused exchange
(`send` → false) hands the typed message back rather than losing it with the
rolled-back optimistic bubble.

### The brief edit survives a reload

The edit form is the only copy of the requestor's typed corrections, which is
why a refused save keeps it mounted — and, since `intakeBriefDraft.ts`, why a
reload no longer empties it: every change lands in a per-intake `sessionStorage`
draft carrying the `updatedAt` it was typed against, restored on mount and
cleared on save or cancel. A draft typed against a DIFFERENT row version is
discarded rather than replayed (a voice sweep or a `/message` turn may have
written the brief meanwhile, and restoring over that is a silent revert — the
same reasoning as the store's compare-and-swap). Every storage access is
wrapped: sessionStorage is absent under SSR and throws outright in some privacy
modes. Pure half unit-pinned in `intakeBriefDraft.test.ts`.

The pane's three form controls (note title, note body, JD picker) carry no
visible `<label>` — it is a compact rail — so each names itself with an
`aria-label` reusing the very key its placeholder renders. A placeholder is not
an accessible name: it is not exposed as one by every AT and it vanishes once
the field has content, so re-entering a half-typed note title announced only
"edit text". Same idiom as the inline title field in `JdsIntakeBriefTitle`, and
no catalog entry is added — the spoken name is the visible hint.

Grounding: the dialog prompt gains a fenced `ATTACHED_MATERIAL` block
(`intake.py::_attachments_block`, budget-truncated to ~8k chars total) framed
as THIRD-PARTY reference data — the agent may mine it, but values proposed
from it enter the brief as `inferred` (rationale citing the attachment) and
only become `stated` once the requestor confirms them in dialog/read-back;
where the material contradicts the live requestor, the requestor wins. The
fence survives its own payload: attachment text is third-party-authored, so
every maximal run of 3+ angle brackets in it is spaced out before
interpolation (`defuse_fence_markers`, shared from
`devcase/provenance.py` beside `fenced_untrusted`) — a body carrying the
literal `<<<END_ATTACHED_MATERIAL>>>` marker can no longer close the fence
early and have its remainder read as prompt instructions. The same defusing
runs over the App-master `CODEBASE_DOSSIER` body. Both fences are pinned by
`pipeline/jobfit/tests/test_prompt_fences.py`, which drives each real prompt
builder with a break-out payload and proves the assertion non-vacuous by
re-running it with the defusing neutralised. The
voice fast thread sees attachment TITLES only (latency budget); the periodic
extraction thread (`extract_transcript`, via `/voice-complete`) carries the
same fenced block with full bodies — it is where a voice session's materials
actually get mined into the brief. **Keyless the
attachments are stored and acknowledged once but never mined** — the scripted
path cannot read prose without a model, so nothing is silently invented; the
acknowledgement invites pasting key points as answers instead. That
acknowledgement is *prepended* to the turn's reply, so read-back detection
matches the read-back's first line anywhere in the agent turn rather than as a
prefix — a prefix-only test missed an ack-decorated read-back and folded the
requestor's "ok" into the last scripted slot, inventing a stated
`budget_band: "ok"` facet and repeating the read-back instead of closing.

## The live brief is an ANNOTATED document

`JdsIntakeBriefPanel.tsx` is the FRAME — header, edit/frozen states, the
App-master slot, the empty state — and `JdsIntakeBriefBody.tsx` draws the brief.
The body is the winner of a `/prototype` round run against the shipped flat
sections and a ranked "Scorecard"; both losers and the switcher between them were
deleted at consolidation.

**The reading model.** One column of plain bulleted sentences, with every piece of
evidence about a line — where it came from, how sure the engine is, which turn
said it — pushed into a narrow right-hand MARGIN that runs the panel's height. The
eye reads content down the left and glances sideways only when it doubts a line.
Colour is the SECTION, not the row (moss = the 90-day commitments, coral = the
hard lines, steel = the flexible ones, stone = context), following the design
system's own contract; the prose itself is never tinted.

The provenance vocabulary is stated ONCE as a legend and then carried as a 6px dot
on the toned axis the design system already defines (moss = stated · amber = the
agent's reading · steel = template fill) — which is what removes the per-line
"you said" / "assumed" chips, printed 14 times in a live App-master brief. The
ROLE row follows the same rule: `JdsIntakeBriefTitle` renders dots, and the old
`ProvenanceChip` is gone.

The shaping rules are pure and pinned (`jdsIntakeBriefModel.ts` +
`jdsIntakeBriefModel.test.ts`), so the body decides how the brief is DRAWN and
never what it counts:

- **De-duplication.** The engine emits the 90-day sentence twice — once as a
  `successCriteria` entry, once as an `objective:*` / `success_90d` facet — so
  the flat Context list reprinted the requestor's own commitment verbatim a few
  lines under the first copy (observed in the App-master and Czech backfill
  briefs alike). `prepareFacets` drops a facet that near-duplicates a criterion
  or merely restates the role's title/seniority, and drops an exact repeat of a
  facet it already kept — while KEEPING two different answers under one key
  (`why_now` really is asked twice in some sessions).
- **Label trimming.** `objective:gate_pass_rate` carries "gate pass rate — 95%
  within 60 days" under the label "gate pass rate"; the head is trimmed so the
  three words print once.
- **Grouping.** Facet keys are namespaced (`mandate.owner`, `budget.monthlyUsd`,
  `codebase_dossier.stack`), and the flat list threw that away. They now cluster
  by namespace — labels from `library.tab.intake.brief.groups`, falling back to
  `labelize()` for a namespace no catalog names yet — ordered inside each group
  by the engine's own `importance` grade, with `context`-graded lines dropped to
  steel.
- **The spine badge counts what is RENDERED.** `briefItemCount` replaces the
  panel's inline sum, so a folded brief leaf can never promise an item the open
  leaf de-duplicated away.

## The ledger is a table on the shared kit

The intake ledger (no session open) was a stack of full-width buttons — one card
per session, unfiltered, unsorted, unpaged — which reads fine at a demo's
half-dozen and not at the 19 a working library already holds.
`JdsIntakeSessionsTable.tsx` puts it in the same register as every other ledger in
the studio (ProfileRoster, the Channels comms ledger, the Assignments outbox):
the shared `ColumnHead` (which owns `aria-sort`), spreadsheet-style `ColumnFilter`
triggers living IN the headers rather than in a toolbar, and the shared 20-row
`TablePager` — nothing here re-derives paging arithmetic or a comparator. Role
sorts and searches; Shape and Status filter but do not sort (they are categories,
not rankings); Turns and Updated sort; a row click opens the session.

`updatedAt` is nullish on a session nothing has touched since it was created, so
the sort accessor falls back to `createdAt` — handing the comparator a `null`
would sort every untouched session to the bottom in BOTH directions
(`compareCells`' missing-value rule), which is right for an unknown and wrong for
a date we hold.

Two smaller corrections on the same surface:

- **The lede is a tooltip on the title**, not a paragraph under it. It explains
  the surface to a first-time reader and then repeats itself on every later visit
  above the one thing a returning reader came for.
- **App master is an action card.** Its entry was a borderless ghost button over an
  explanatory paragraph, so the whole block read as a caption — the one route into
  the third intake shape looked like something to read rather than something to
  press. It is now one pressable target (icon sticker · name · explanation ·
  chevron) that lifts its border on hover, and the form's primary action is a
  primary button.

## Session layout — chat · brief · JD draft · materials

The session view is the **Triptych** (`JdsIntakeLayoutTriptych.tsx` over the
shared contract in `intakeLayoutShared.ts`): three foldable leaves — JD draft ·
conversation · live brief — each folding to a clickable spine that still badges
what THAT leaf holds; materials live in a disclosure at the foot of the draft
leaf, reachable from the spine and from beside the conversation. Column
visibility persists per browser in `localStorage`, never server-side.

Each leaf has ONE title row: the leaf's name and, for the draft, its status tag
(`draftChip` on `IntakeLayoutProps`). The draft pane used to print its own title
underneath the leaf header — "Job description" over "Job description draft" —
followed by a two-line explainer of what the pane was, and only then the posting
inside a SECOND bordered card. That is three chrome layers between the header and
the words the requestor came to read, so the pane is now document-only: the chip
moved up into the leaf header, the explainer is gone, and the markdown renders
straight into the leaf (`Markdown` emits its own root, so the entrance animation
rides that instead of a wrapper).

The **JD draft** (`JdsIntakeDraftPane.tsx` +
`app/_lib/intake-draft.ts`) is a DETERMINISTIC client-side render of the
current RoleBrief in the posting shape of the real build's `composeMarkdown`
— it updates after every exchange at zero LLM cost, is tagged a draft (the
final JD, with market-salary research, is still generated at Promote), never
prints a `default`-provenance seniority as a decided level, and notes when a JD
attachment will be superseded at promote. Motion follows
the repo standard (AnalyzeWorkspace.tsx): a leaf's width tweens between leaf
and spine while its content crossfades, chat bubbles and status notes fade in
and out, the draft crossfades on brief change —
all flattened under `prefers-reduced-motion`. Both themes are covered at the
token/recipe level (dark rounded-2xl / sticker shadows on the new surfaces).

### Per-session state does not survive a session switch

`JdsIntakePanel` is mounted **once** (dynamically, by `JdsSavedLedger`) and swaps
`active` underneath itself — there is no `key`, so nothing inside it remounts when
the requestor goes Back and opens a different intake. The async half of this was
already handled: every late voice/compose result is folded through the
identity-checked `applySession`, "so a result must name the session it belongs to."
`useAppMasterLogic`'s **synchronous** state now follows the same rule. `scanState`,
`composeError`, `dispatchState` and the resolved scan `taskId` are cleared in a
render-phase guard keyed on the intake id (the `jobsTabDeepLink.ts` shape — an effect would let one frame render the
previous session's claims). `paired` is not reset: the Personas bridge is
workspace-level, not per-session. Pinned by `jdsIntakeLogic.test.ts`.

## Known gaps

- Dialog languages are the four the product ships (`i18n/locales.ts`), resolved
  once by `app/_lib/intake-lang.ts::intakeLang` and pinned by
  `intake-lang.test.ts` — every route used to clamp `lang === "cs" ? "cs" :
  "en"` by hand, six copies of it plus one in the panel, so a German or French
  operator got an English intake agent although `pipeline/jobfit/i18n.py` has
  named their language in `LANG_NAMES` all along. **Keyless the promise is
  narrower and deliberately so**: the deterministic slot script
  (`pipeline/jobfit/intake.py` — `_Q`, `_readback`, `_close_reply`) carries en
  and cs only and falls back to its English text for de/fr, so a provider-less
  `de` session is asked its questions in English while the brief it fills is
  the same one. With a provider — the default — the whole dialog, the voice
  fast thread, the extraction sweep and the promoted JD build are German or
  French end to end. Two clamps remain OUTSIDE this: the App-master `dossier`
  and `compose-app-master` routes still resolve cs-or-en for the merge/fit
  spawn, so an App-master session's dossier facets stay English on a de/fr
  session (a one-line fix in each, owned by the App-master lot).
- The voice plane is **not live-verified**: built and unit/contract-tested,
  but no OpenAI Realtime key was available in the build sessions, so no real
  call has been placed. The audio-in-the-loop harness hook is designed in the
  architecture doc (Future work). The ElevenLabs transport is designed, not
  wired.
- The visual pass in both themes is pending (built from shared
  recipes/tokens; browser verification wasn't available in the build session).
  This includes the tri-pane layout, the JD-draft pane, the attachments pane
  and their motion — code-level token/dark-variant rigor only so far.
- Keyless attachment mining is deliberately absent (acknowledged, not mined);
  the one-shot "propose a brief from a pasted legacy JD" ingest lane stays a
  concept-doc open question.
- Promoted sessions cannot be edited or re-opened (frozen by design; see
  above) — re-promote-to-update-the-JD is future work.
- Deterministic-path corrections at the read-back land as a `correction`
  facet; a structural field edit is the brief-panel edit mode's job.
- Decision-audit surfacing of the intake back-link is future
  work.
- **App master**: agent-population dispatch is P4 (a disabled, labelled control
  today). The dossier reaches the intake **through the client** — it is clamped
  by `repoDossierSchema` and pinned to the intake's own `scanId`, the same trust
  posture as `PATCH /brief`, but a server-side read of the scan store would be
  stricter and should replace it once that store is a stable dependency. The
  population-fit thresholds (agent ≥ 0.75, human ≤ 0.25) are asserted, not
  calibrated. The App-master card has not had a browser pass in either theme.
  `coercionNotes[]` is still built as ENGLISH prose server-side
  (`app/_lib/intake-brief.ts`) and rendered verbatim, so the one part of the
  spec card that explains the composer's assumptions does not translate — the
  remaining English-on-the-wire leak in this surface now that every refusal
  carries a code.
