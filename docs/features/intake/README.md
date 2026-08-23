# Role intake — the dialog that fills a RoleBrief

Phase 1 of [the role-intake concept](../../concepts/role-intake-dialog.md): a
coaching-register conversation with a hiring requestor (team lead / HR) that
captures the hiring need as a structured **RoleBrief**, then promotes it into
the existing JD build. Conversation design is normed by
[docs/development/role-intake-research.md](../../development/role-intake-research.md)
— change the persona rules there first.

## Entry points

- **UI**: `/?tab=library` → JDs console → **Intake** sub-tab
  (`app/features/library/jds/intake/JdsIntakePanel.tsx`, Tier-3
  dynamic-imported behind the Saved/Generate/Intake `SegmentedControl` in
  `JdsSavedLedger.tsx`).
- Operator-internal only — no public token, no candidate exposure.

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
- **The dialog asks only what the scan cannot know.** A persona overlay
  (`_PERSONA_APP_MASTER`) replaces the power-unit/story triage rules, and the
  dossier rides the prompt in a fenced `CODEBASE_DOSSIER` block framed as a
  MACHINE READING (never the requestor, never instructions). Six answers, each
  landing as a `stated` facet under a **closed key contract**:

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
  `appMasterSpecSchema`) and stores `{spec, fit, composedAt}` on the row. The
  defaults are always the safe end: an unreadable rung stays 2, an unreadable
  forbidden-class answer keeps all six, an undecided population stays `either` —
  and every assumption is recorded in `coercionNotes[]`.
- **Hire** — the human population promotes through the existing JD build
  (`/promote`, unchanged). The **agent population's dispatch to Personas is P4**:
  the card shows a disabled "Dispatch to Personas" control saying so. No fake
  success.

## Keyless behavior (product property)

No provider → the dialog degrades to a deterministic scripted slot script
(same RoleBrief target, requestor answers land as `provenance: stated`), via
the shared `generate_with_fallback` contract. The UI shows a quiet
"guided checklist" note when a turn came from the deterministic path.

## API / lib surface

| Piece | Path |
| --- | --- |
| Dialog engine (persona, extraction, merge, triage, scripted fallback) | `pipeline/jobfit/intake.py` |
| Per-exchange CLI | `pipeline/jobfit/intake_cli.py` |
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
| `dossier_json` | the `RepoDossier` that scan returned (`repoDossierSchema`). NULL while it runs or if it failed; the dialog reads it every turn |
| `app_master_spec_json` | the composed record `{spec: AppMasterSpec, fit: PopulationFit, composedAt}`. Re-composing REPLACES it — a spec is a snapshot of the brief at compose time |

## Eval harness (Phase 2)

`pipeline/jobfit/eval/intake_eval.py` + `intake_scenarios.json` — the
12-persona requestor bank from the research doc (vague requester,
over-specifier, solution jumper, …) driven against the real
`run_intake_turn`. Offline mode (`--no-llm`: deterministic agent + golden
requestor answers) certifies the keyless path and the reliability invariants
(completed, one-question-per-turn, no premature `<<END>>`, grounded read-back,
brief completeness, shape triage + power-unit turn budget) — gated by
`tests/test_intake_eval.py`. Live mode runs both sides on the `role_intake`
provider; live runs are single-sample probes (shape/turn-budget expectations
go soft), the offline mode is the gate.

**Market-breadth bank**: `intake_scenarios_gen.py` generates a deterministic
100-scenario bank spanning ALL 16 taxonomy role families × seniority ×
need shape (backfill vs first-ever-role story) with concrete per-family
content (licensure-bound nurses, shift-planning frontline leads, month-end
accountants, …). `--generated 100` runs it; the full hundred is gated
offline in `test_intake_eval.py` (648 checks).

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

Client pieces: `JdsIntakeVoice.tsx` (thin driver) over the pure orchestrator
`voiceOrchestration.ts` (serializes fast turns, coalesces utterances spoken
mid-turn, extraction cadence, barge-in via `cancelSpeech`) and the shared
transport (`app/_components/voice/transport/openai.ts` — `speakText` /
`cancelSpeech` are the relay additions). On connect the agent SPEAKS the
pending question from the text thread (`spokenOpener`) — voice continues the
same conversation.

Two rules the client half enforces, both unit-pinned:

- **Nothing spoken is thrown away.** Only a DELIVERED utterance is persisted
  server-side, so when a `/voice-turn` POST is refused (429) or blips, the
  orchestrator puts that utterance back at the FRONT of the queue
  (`completeTurn(state, done, failed)`): the next utterance carries it along
  (`enqueueUtterance` coalesces a non-empty queue when idle) and a hang-up
  recovers it with the rest of the queue. It is never re-dispatched on its own
  — a rate-limited turn must not become a retry loop against a paid endpoint.
  A close keeps the queue for the same reason (recovery), it just stops
  dispatching.
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
untouched. No LLM mid-call → the scripted slot engine IS the fast thread
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

## Attached reference material ("Materials")

A session can carry up to 5 attachments — a pasted **note** (a colleague's
brief, a legacy JD text) or a **saved JD** picked from the library, resolved
SERVER-side from the workspace's `jds` row (the client sends only the slug;
`app/api/intake/[id]/attachments/route.ts`, caps: text ≤20k chars, title
≤120; promoted sessions frozen). Stored in `role_intakes.attachment_json`
(`IntakeAttachment` in `app/_lib/db/intakes.ts`). The pane clears its fields
only once the server has accepted the attachment — hitting the 5-attachment
cap (or a frozen session) keeps the pasted note in the textarea instead of
destroying it. Same contract in the composer: a refused exchange
(`send` → false) hands the typed message back rather than losing it with the
rolled-back optimistic bubble.

Grounding: the dialog prompt gains a fenced `ATTACHED_MATERIAL` block
(`intake.py::_attachments_block`, budget-truncated to ~8k chars total) framed
as THIRD-PARTY reference data — the agent may mine it, but values proposed
from it enter the brief as `inferred` (rationale citing the attachment) and
only become `stated` once the requestor confirms them in dialog/read-back;
where the material contradicts the live requestor, the requestor wins. The
voice fast thread sees attachment TITLES only (latency budget). **Keyless the
attachments are stored and acknowledged once but never mined** — the scripted
path cannot read prose without a model, so nothing is silently invented; the
acknowledgement invites pasting key points as answers instead. That
acknowledgement is *prepended* to the turn's reply, so read-back detection
matches the read-back's first line anywhere in the agent turn rather than as a
prefix — a prefix-only test missed an ack-decorated read-back and folded the
requestor's "ok" into the last scripted slot, inventing a stated
`budget_band: "ok"` facet and repeating the read-back instead of closing.

## Session layout — chat · brief · JD draft · materials

The session view is the **Triptych** (`JdsIntakeLayoutTriptych.tsx` over the
shared contract in `intakeLayoutShared.ts`): three foldable leaves — JD draft ·
conversation · live brief — each folding to a clickable spine that still badges
what THAT leaf holds; materials live in a disclosure at the foot of the draft
leaf, reachable from the spine and from beside the conversation. Column
visibility persists per browser in `localStorage`, never server-side. The
**JD draft** (`JdsIntakeDraftPane.tsx` +
`app/_lib/intake-draft.ts`) is a DETERMINISTIC client-side render of the
current RoleBrief in the posting shape of the real build's `composeMarkdown`
— it updates after every exchange at zero LLM cost, is labeled a working
draft (the final JD, with market-salary research, is still generated at
Promote), never prints a `default`-provenance seniority as a decided level,
and notes when a JD attachment will be superseded at promote. Motion follows
the repo standard (AnalyzeWorkspace.tsx): a leaf's width tweens between leaf
and spine while its content crossfades, chat bubbles and status notes fade in
and out, the draft crossfades on brief change —
all flattened under `prefers-reduced-motion`. Both themes are covered at the
token/recipe level (dark rounded-2xl / sticker shadows on the new surfaces).

## Known gaps

- Dialog languages are en/cs (UI chrome is 4-locale); de/fr dialogs fall back
  to the language directive only.
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
