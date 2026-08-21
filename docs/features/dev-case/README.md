# Assignments (Dev Case) — LLM-era work-sample assessment

An assignment lifecycle for hiring in a world where "is the code
correct" is the wrong question — 100% of a candidate's code can plausibly be
LLM-generated. Instead of grading raw output, Dev Case grades *how* the
candidate drove the work: problem framing, tooling fluency, verification
habits, and whether demonstrated skill transfers to the role being hired for.
It is generalized beyond software (marketing/finance/sales/design cases exist
too), riding the same lifecycle.

The system also runs six "LLM-era controls" so an unverifiable, fully-AI-authored
submission cannot be waved through as a strong hire — see [Anti-delegation
controls](#anti-delegation-controls-shipped) below. All six are shipped.

## Entry points

- Recruiter workspace — the **Assignments** tab (`?tab=assignments`; renamed from
  `?tab=dev`, which still resolves via `LEGACY_TAB_ALIASES` in
  `app/features/shell/tabs.ts` — the module was never dev-only, and "Dev cases"
  mis-sold the office/marketing/finance cases it also ships):
  `app/features/tools/devcases/DevTab.tsx`, routed through `DevTabSwitcher.tsx` /
  `DevTabDefineView.tsx` (need intake + analysis) / `DevTabCasesView.tsx` (case
  list) / `DevCaseDetail.tsx` (per-case lifecycle, submissions, evaluation).
- Outbox — `OutboxSection.tsx` (filter state, dead-letter chip, pager) over
  `OutboxRows.tsx`, with the ordering/filter rules in the pure `outboxView.ts` and
  the re-dispatch button in `ResendButton.tsx` (also used by the Channels comms
  modal). Every message the pipeline sent, dead letters sorted to the top, paged 20
  at a time via `app/_components/table/TablePager.tsx`. It previously rendered a
  bare `.slice(0, 50)`, so on a busy workspace a dropped rejection or offer could
  sit past row 50 with nothing on screen admitting it existed.
- Candidate apply/work surface — `app/devcase/apply/[token]/page.tsx` +
  `DevApplyForm.tsx`; the in-browser editor is `LiveWorkSurface.tsx`.

## Flows

1. **Need intake → reality reflection.** Recruiter describes a need (stack,
   responsibilities, an optional codebase ref) via `DevNeedForm.tsx` →
   `useDevTabNeedAnalysis.ts` → `pipeline/jobfit/devcase/analyze.py`
   (`analyze_need`), reflecting the stated need against real signals
   (`realStack` **or** `coreResponsibilities` — relaxed to also ground
   non-software roles). When the picked JD descends from a promoted
   role-intake, the picker fetches its RoleBrief
   (`GET /api/jds/[slug]?brief=1`) and the need is filled STRUCTURALLY —
   stack from graded must-haves, responsibilities from 90-day outcomes,
   `roleFamily` from the classified spine, plus
   `DevNeed.statedRequirements` (the requestor's own must/nice + hardness +
   weight grading), which `design_role` anchors the RoleSpec's must-haves to
   (see `docs/features/intake/README.md`). JD-only needs behave as before.
2. **Case + role design.** `pipeline/jobfit/devcase/design.py` (`design_case`,
   `design_role`, prompts `case-design-v6` / `role-design-v4` — v4 adds
   grounding rules from the 2026-08-11 bench: every must-have must trace to
   stated input, illustrative tools stay out of requirements, seniority is read
   off the JD's own signals) produces a `CaseScenario` (brief,
   starting materials, covert tooling-probes, rubric) anchored to the ROLE
   being hired, not the codebase's domain — a v2 fix (see
   `docs/_archive/dev-d3-hardening-findings.md`) — plus a mid-session
   **requirement change** (`midFlightUpdate`, v6) that makes pure one-shot
   generation structurally insufficient.
3. **Human gate.** The role/case is a Decisions approval
   (`app/api/devcase/lifecycle/route.ts`, `.../[id]/approve/route.ts`) before
   it is published/sent.
4. **Candidate works the case.** Either a git-based submission (repo trace) or
   the in-product **Live Work Surface** (`LiveWorkSurface.tsx`) — every
   open/edit/decision-log/submit/paste event is server-recorded
   (`pipeline/jobfit/devcase/process_events.py`), so there is a first-party
   observed trace with no reliance on a private git log.
5. **Evaluation.** `pipeline/jobfit/devcase/evaluate.py` +
   `reflect.py` run `reflect_commits → assess_tooling → evaluate_submission →
   score_transfer` (or the observed-event equivalent), producing dimension
   scores, an authenticity band, and a transfer score. Results surface as
   review cards in `app/features/tools/devcases/DevEvalPanel*.tsx`,
   `DevCompareSubmissions.tsx`, `DevCohortProbePanel.tsx`.
6. **Promotion.** `app/api/devcase/promote/route.ts` + `dev-control.ts`
   (autonomy level, promote floor) — auto-promotion is gated: a submission
   flagged `suspect` by the authenticity score, or with a broken integrity
   chain, is held for a live ownership-verifying interview rather than
   advanced on transfer score alone.

   **A hold holds the profile write too.** Promotion also bridges the take-home
   into the candidate's saved profile — `mintObservedFromSubmission`
   (`app/_lib/devcase-run.ts`) turns the demonstrated must-haves into
   `observed`-provenance evidence, the engine's highest-trust signal (taxonomy
   weight 1.0, confidence up to 0.95, plus an early-career routing lift). Python's
   `apply_live_case` gates that on the transfer score (`>= 65`) and its propagated
   evidence-confidence (`> LOW_CONFIDENCE`) only — it cannot see the authenticity
   band, which is computed on the TS side. So the mint carries the **same
   `suspect` gate as the promote verdict**: a submission held because we can't tell
   the candidate authored it never writes observed evidence onto a profile that
   outlives this posting. Re-promoting mints normally once a human has cleared the
   band. Pinned in `app/_lib/devcase-promote.test.ts`.
7. **Outcome loop.** `app/_lib/dev-outcomes.ts` is the isolated store that pairs a
   predicted score with what actually happened (`hired` / `rejected` / `withdrawn` /
   `pending`, plus an optional 1..5 `performance` rating); `calibrate()` turns those
   rows into the promote-floor rationale the control room reads
   (`GET|POST /api/devcase/outcomes`, `app/control/CalibrationPanel.tsx`), and
   `recordPipelineOutcome` auto-writes a row when a promoted `ds-<submissionId>`
   entry reaches a terminal stage.

   **The control room is no longer the only writer of the `performance` rating.**
   The module also exports `recordHirePerformance()` / `hireOutcomeRef()` /
   `countRatedHires()`, used by `POST /api/pipeline/outcomes` so a recruiter can
   record how a hire worked out from the recruiting workspace (UAT `KAT-L1-002` —
   see [`../pipeline/README.md`](../pipeline/README.md)). Same store, same
   vocabulary, same tenant scoping, and no schema change: `dev_outcomes` already
   carried every column. The calibration corpus `/control` reads therefore now also
   accrues ordinary board hires whose rating a human entered. A board hire is keyed
   `pe:<entryId>`; a devcase-promoted hire keeps its bare submission id, so the
   recruiter's rating **updates** the auto-written row rather than minting a second
   decided outcome that `calibrate()` would count twice.

## Anti-delegation controls (shipped)

Six controls, referenced in code comments as "LLM-era controls #1–#6":

| # | Control | What it does | Where |
|---|---|---|---|
| 1 | Tamper-evident hash chain | Every Live Work Surface event is chained server-side (SHA-256); a broken chain or backdated client timestamp marks the whole observed trace untrustworthy | `app/_lib/db/core.ts` (schema), `app/_lib/db/devcase.ts` (verify), `app/_lib/devcase-run.ts` |
| 2 | Captured prompt channel | In-session chat (assistant/stakeholder replies) is server-recorded, not client-reported, so tooling-fluency signals can't be fabricated | `pipeline/jobfit/devcase/chat.py`, `prompt_signals.py` |
| 3 | Canaries | The seed materializer plants known-ground-truth flaws; each is graded ADDRESSED / FLAGGED / PROPAGATED / UNVERIFIABLE against the submitted tree | `pipeline/jobfit/devcase/seed_materializer.py`, `artifact_checks.py` |
| 4 | Per-session watermark | A deterministic, session-specific marker in the seed; a **foreign** watermark inside a submission is the tell that a solution circulated between candidates | `app/_lib/db/devcase.ts` |
| 5 | Mid-flight perturbation | A requirement change revealed mid-session (server-timestamped), after which everything is the candidate's observed adaptation to a changed brief — defeats pure one-shot generation | `pipeline/jobfit/devcase/models.py`, `design.py` (case-design-v6), `process_events.py` |
| 6 | Frozen naive baseline | At approval, a bare one-shot LLM solve is frozen per case; submissions are diffed against it (never as a penalty — it aims the authorship interview, since using an LLM is never itself penalized) | `pipeline/jobfit/devcase/baseline.py`, `artifact_checks.py` |

Fairness invariants (checked in code, not just prose): using an LLM is never
penalized; over-reliance is inferred only from observed process artifacts
(opens/edits/decision-log), never keystrokes; a merely-missing own watermark
is not penalized (deleting a line isn't proof of anything) — only a
**foreign** watermark or a broken chain is decisive.

### The marketed list is the implemented list

The Cases-tab empty state (`app/features/tools/devcases/DevCasesEmptyLedger.tsx`) is
where these controls are *sold* — it is the first thing a recruiter reads about the
module. It had drifted from the table above in three ways, all corrected: it omitted
**canaries** (#3) and substituted the paste/cadence trace, which is a real mechanism
(`app/_lib/devcase-authenticity.ts`) but **not** one of the six; it described the
watermark as making "a recycled or leaked solution identifiable on arrival", which
overstates a control whose own code calls a missing own mark "a mild note, never
decisive"; and its "baseline diff" blurb described the seed diff
(`app/_lib/devcase-seed-diff.ts`) rather than #6's comparison against the frozen
one-shot solve.

The standing rule for that copy: **the six named items are exactly #1–#6 of the table
above.** The paste/cadence trace is named separately, outside the list. The watermark
claim is scoped to what a *foreign* mark settles — circulation between candidates —
and never states where the marker lives or how it is stamped, since the surface is
recruiter-facing but the claim must not read as a defeat manual. "Held for the live
interview, never auto-advanced" is the real gate (`devcase-run.ts` `suspectAuth` plus
the orchestrator's advance-only comm rule), so it stays.

### Where a reviewer sees them

The six controls were all computed and persisted, but four of them used to
terminate in a DB blob read only by an LLM prompt — a human saw at most the folded
`authenticity` number in a tooltip. `EvalBundle`
(`app/features/tools/devcases/DevTypes.ts`) now declares `integrity` and
`observedChecks`, and the submission evaluation panel renders both:

| Panel | Controls | Renders | File |
|---|---|---|---|
| Log integrity | #1, #4 | Chain verdict (verified / broken at seq / **unverifiable**), backdated-event count with worst clock drift, watermark verdict | `app/features/tools/devcases/DevEvalPanelIntegrity.tsx` |
| What the checks found | #2, #3, #6 | Four-way canary verdicts per planted flaw, overlap with the frozen one-shot baseline, captured-prompt signals | `app/features/tools/devcases/DevEvalPanelChecks.tsx` |

Three presentation rules are enforced by those components rather than left to prose:

- **Honest darkness.** Every check is optional at the producer, and "did not run"
  never renders as a pass. `chain.valid === null` (no hashed events) is shown as
  *unverifiable*, not clean. A case whose seed planted no canaries — which is what
  the deterministic/keyless seed deliberately does, since
  "a template flaw with no real ground truth would grade candidates against noise"
  (`seed_materializer.py`) — says the check did not run. So does a case where the
  LLM was unavailable at approval and no baseline was frozen
  (`devcase-orchestrator.ts` records a `baseline_unavailable` audit).
- **Never a penalty.** Baseline overlap is rendered as a plain figure with an
  interview prompt — no meter, no colour ramp — because the engine is explicit that
  it is not a score. Prompt-channel counts carry the same framing; the one
  negative-leaning signal (`briefPasteRatio`) is labelled as an interview aim.
- The watermark **verdict** is rendered; the watermark **value** never is. Printing
  `watermark.expected` would teach a candidate exactly what to strip.

### Both submission paths carry evidence

The two submission paths do not produce the same telemetry, and the studio used to
render only the git-shaped fields — so the Live Work Surface, the path the product
considers its *strongest* evidence, displayed the least. `processTrace.cadence` and
`seedDiff` both read repo-only fields (`signals.cadence`, `signals.changedPaths`),
and `signals` is null for a session.

| Evidence | Repo path | Live Work Surface |
|---|---|---|
| Cadence | Commits over N hours, "single sitting" burst flag (from the git log) | Iteration pattern + files opened/edited, from the watched event stream (`tooling.signals`, now declared on `Tooling` as `ObservedSignals`) |
| Seed engagement | Changed paths from the commits API | Content diff of the submitted tree against the seed (`devcase-seed-diff.changedPathsFromFiles`) |
| Mid-flight perturbation (#5) | Not applicable | Explicit strip: adapted (edits/decision entries after the reveal) or submitted against the stale brief |

Absence is labelled, never left blank: a live session states that it has **no commit
history by design** rather than leaving the gap where the commit strip sits, the
header reads "in-product session" instead of "0 commits", and a case with no
materialized seed says engagement could not be measured. `perturbationShown: false`
renders nothing at all — the reveal never fired, which is no signal rather than a
failure to adapt.

## Localization of the studio (phase 1)

The candidate-facing surface has always been fully localized (42 `devApply` strings
in all four locales). The recruiter studio was at roughly 18% — seven of 35
components under `app/features/tools/devcases/`. Phase 1 did the seam work rather
than a string sweep: it made the **enums** localizable, on the theory that a
hand-written label map is the defect that keeps coming back.

**The canonical-vocabulary contract.** `DevTypes.ts` declares one tuple per enum —
`LIFECYCLE_STAGES`, `PROBE_KINDS`, `CANARY_KINDS`, `PROBE_STATUSES`,
`RUBRIC_DIMENSION_NAMES` — and `app/features/tools/devcases/DevLabels.ts` is the only
place a value becomes a word. This extends the contract `evaluate.py`
`_ordered_dimensions` established (the engine emits `{name,label,weight,description}`
so the UI hardcodes no dimension metadata) with one deliberate difference: **for a
localized surface the producer can be canonical for the VOCABULARY but never for the
label**, since a label emitted from Python is English by construction. So the producer
owns the key set; the i18n catalog owns the words.

**The guard.** `devcase-vocabulary.test.ts` pins each tuple twice — to its producing
source (`devcase-orchestrator.ts` `STAGES`, `design.py` `PROBE_KINDS`,
`seed_materializer.py` `CANARY_KINDS`, `models.py` `RUBRIC_DIMENSIONS`) and to all
four locale catalogs by set equality in both directions. Both halves are load-bearing:
`npm run i18n:check` compares locales only to each other, so deleting a key from all
four stays green, and `tsc` cannot see a template-string key. Measured on this change:
deleting `devcase.stage.closed` and `devcase.probeKind.legacy_trap` from all four
catalogs leaves `i18n:check` reporting "4 locale(s) in parity" while the guard fails
naming both. `devcase-canary-catalog.test.ts` (the four-way canary verdicts) and
`outbox-kind-catalog.test.ts` are the same pattern and predate it.

Two defects fell out of doing this by derivation instead of by eye:

- **`closed` was missing.** `STAGE_LABEL` listed nine stages; the orchestrator can set
  ten. A case closed through the W5-3 close-out rendered the raw id `closed` in both
  the Cases table and the lifecycle row, in every language.
- **The same enum rendered keyed on one surface and unkeyed on another.**
  `DevLifecycleRow` looked stages up through the catalog while `DevCasesTable` printed
  the hardcoded English map, so a Czech workspace showed "collecting" in the table and
  "sběr řešení" in the row beneath it.

**Probe outcomes are now four states, not three.** `ProbeOutcome.handledWell` is
tri-state and `detected` is independent of it. The old three-way collapse read
`handledWell === null` — which the observed Live Work Surface path emits *by design*,
because it cannot grade handling — as `missed`, turning an assessment that never ran
into a finding against the candidate on the product's strongest evidence path.
`handled` / `unhandled` / `detected` (worked it, handling not graded) / `missed`.
The cohort heatmap (`app/_lib/devcase-cohort.ts`) now applies the same rule: its
`weakRate` is "not handled well / **graded**", with a `graded` count beside it and
`null` when nothing was graded. It used to divide by every evaluated outcome, so a
cohort of Live Work Surface submissions read as 100 % weak on every probe — the same
manufactured finding, one surface over. For the same reason it now skips submissions
whose `perStepSources.tooling === "deterministic"`: the keyless/fallback template
stamps every probe `detected: false`, so including those rows produced a 100 %-miss
cohort — and the panel's "this case is miscalibrated" banner — out of the absence of
an API key.

**Canary kind is rendered.** `CanaryOutcome.kind` rode in the bundle from the start
and was never displayed, so "propagated · src/rates.ts" did not say whether a wrong
constant or a stale doc had survived.

### Known gap: engine-authored English sentences

Roughly 25 user-facing sentences are still constructed in code and rendered verbatim:
every `reasons[]` in `app/_lib/devcase-authenticity.ts` and every `evidence[]` in
`process_events.py` / `prompt_signals.py`. They stay English prose for now — turning
them into codes+params is one coherent change spanning a TS producer and two Python
producers plus their consumers, and half-doing it (codes on one side, prose on the
other) is worse than either end state. The frames around them are translated, so the
authenticity tooltip is not wholly English. Not in phase 1 scope; do it as one unit.

## Surface

| Path | Role |
|---|---|
| `app/api/devcase/route.ts` + `.../comms`, `.../control`, `.../feedback`, `.../inbound`, `.../outcomes`, `.../postings`, `.../promote`, `.../publish`, `.../skill-profile`, `.../source`, `.../submit` | Dev case CRUD + lifecycle actions |
| `app/api/devcase/lifecycle/route.ts` + `[id]/approve`, `[id]/close`, `[id]/redesign` | Decisions-gated lifecycle transitions |
| `app/api/devcase/session/route.ts` + `[id]`, `[id]/chat`, `[id]/submit` | Live Work Surface session API |
| `app/_lib/devcase-session-auth.ts` | Re-checks the owning apply token on every mutating session sub-route |
| `app/_lib/devcase-orchestrator.ts`, `devcase-run.ts` | Drives need→scenario→solve→evaluate→promote |
| `app/_lib/devcase-authenticity.ts` | Process-authenticity scoring (paste-from-LLM tells) |
| `app/_lib/dev-outcomes.ts` | The outcome/calibration store (`dev_outcomes`), opened on its own connection. Two writers: the control room via `/api/devcase/outcomes`, and the hiring board via `/api/pipeline/outcomes` (`recordHirePerformance` / `hireOutcomeRef` / `countRatedHires`). |
| `app/_lib/devcase-probe-audit.ts`, `devcase-compare.ts`, `devcase-cohort.ts`, `devcase-interview-kit.ts` | Evaluation support: probe-outcome audit, submission comparison, cohort stats, interview-kit generation |
| `pipeline/jobfit/devcase/*.py` | The Python LLM pipeline: `analyze.py`, `design.py`, `evaluate.py`, `reflect.py`, `baseline.py`, `artifact_checks.py`, `seed_materializer.py`, `process_events.py`, `devcase_cli.py` |

## Public-surface limits (Live Work Surface)

`/api/devcase/session*` is public by design (`app/_lib/auth/public-routes.ts`) — the
candidate has no account, the apply link **is** the credential. Two rules keep that
honest, both sized so a real candidate never meets them:

- **Authorization.** A session id is not a bearer capability. Every mutating sub-route
  (`[id]` flush = event append + file overwrite, `[id]/chat`, `[id]/submit`) re-checks the
  apply token that minted the session, via `sessionTokenMatches` in
  `app/_lib/devcase-session-auth.ts`; the client sends `token` in each body. A mismatch is
  **403** — deliberately not 404/409, which tell `LiveWorkSurface` the session is dead and
  to re-mint, spinning the per-token/day session quota. Sessions with `token: null`
  (fixtures/dev seeds, never reachable from the product) skip the check, mirroring
  `interview-connect`'s tokenless-lab carve-out.
- **Throttling.** `[id]/chat` makes a real LLM call per message, so it is limited by the
  shared limiter (`app/_lib/rate-limit.ts`) on two windows — **30 per 10 min per session**
  (one candidate's burst) and **3,000 per 24 h per apply token** (the collective aggregate;
  a dev-case token is per-*posting* and shared by every applicant, unlike interview-connect's
  per-candidate token). Together with the pre-existing `MAX_SESSIONS_PER_TOKEN_DAY = 50`
  and `MAX_CHAT_MESSAGES = 400`, this cuts the worst case from ~20,000 unauthenticated
  model calls per leaked link per day to 3,000. Never keyed by IP: candidates sitting a
  timed assessment legitimately share a NAT. Both refusals are the shared 429 envelope and
  the surface renders `devApply.workSurface.chatRateLimited` — a stated limit, never a
  silent failure that reads as lost work; the unsent message is handed back to the input.

Pinned by `app/api/rate-limit-contract.test.ts` (source-level + behavioral) and
`app/api/devcase/session/session-intake-guards.test.ts`.

## Data model

- `dev_cases` (case scenario, `baseline_json`) — SQLite, via `app/_lib/db/devcase.ts`
- `devcase_submissions`, `devcase_lifecycle` — orchestration state
- Live Work Surface event log — tamper-evident hash-chained rows (per `app/_lib/db/core.ts`)

## Known gaps

- No reviewer surface renders the candidate's **chat transcript** or **submitted
  file tree**. `getDevSessionChat` / `getDevSession().files` are read only by the
  chat route and `devcase-run.ts`; there is no authenticated recruiter-facing GET
  for session evidence (`app/api/devcase/session/[id]/route.ts` is POST-only and
  candidate-token-authed). The mechanical verdicts above name the files a canary
  landed in, but a reviewer cannot open them.
- The `architecture` rubric dimension name is still software-flavored even for
  a non-software case (the description text was neutralized, the field name
  wasn't — a cascading rename was deferred).
- Sub-specialty drift (a Frontend role handed a backend-stack repo, iOS handed
  Android) still falls back to "generic engineering" in `design_case` — see
  `docs/_archive/dev-d3-hardening-findings.md` residuals.
- Apply tokens and work sessions never expire: `getPostingByToken`
  (`app/_lib/db/devcase.ts`) has no expiry column, so only `status === "closed"`
  invalidates a link.
- `case.timeboxHours` is advisory — nothing on the server enforces it, so a session can
  stay open indefinitely.
- 3rd-party distribution (publish/pull to email/ATS/job-board) is a local-stub
  adapter interface only, per the original plan (`docs/concepts/dev-extension-future-phases.md`).

## Case-generation calibration

The generator (`analyze → role → case`) is hardened against real, cross-industry
job descriptions by a separate harness — see
[`docs/development/case-calibration.md`](../../development/case-calibration.md).
