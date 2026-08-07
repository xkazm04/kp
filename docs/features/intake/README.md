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
   (`detect_shape`); the LLM may override.
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
   never-data rule.
   Grades outside the junior/medior/senior/lead enum ("Band 5", "AfC 6",
   "tarifní třída 10") are never force-mapped: both paths capture the verbatim
   answer as a stated `grade_label` facet, the enum stays `default` (assumed
   chip), and the read-back carries the requestor's own grading (UAT drain
   2.3). While a reply is generating, the thinking bubble gains a quiet
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
| Routes | `app/api/intake/route.ts` (create/list), `[id]` (read), `[id]/message` (exchange), `[id]/promote` |
| Rate limit | `intake-message:<ip>` 30/10min on the message route (pinned in `app/api/rate-limit-contract.test.ts`) |
| UI | `app/features/library/jds/intake/` (`JdsIntakePanel`, `JdsIntakeChat`, `JdsIntakeBriefPanel`, `jdsIntakeLogic`) |

## Data model

`role_intakes`: `id, workspace_id, title, status(open|complete|promoted),
lang, transcript_json (VoiceTurn[] — "interviewer" = agent, "candidate" = the
requestor), brief_json (RoleBrief), shape(power_unit|story|NULL), jd_slug,
job_id, created_at, updated_at`. The RoleBrief schema is Pydantic-authoritative
(`pipeline/jobfit/rolebrief.py`) and codegen'd to `roleBriefSchema`
(`app/_lib/schemas.generated.ts`).

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
as interviewer-internal context — never the candidate-safe brief.

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

## Voice plane (input mode)

The requestor can TALK the intake instead of typing it ("Talk instead" beside
the composer). Flow: POST `/api/intake/[id]/voice-connect` mints short-lived
**OpenAI Realtime** credentials (authenticated-internal — `requireOperator` +
workspace-scoped intake; none of the candidate-link machinery applies: no
token, no consent record, no expiry/revoke, no minute billing) with the
SPOKEN-variant brief `intake_voice_brief` (persona + technique, no JSON
contract — `pipeline/jobfit/intake.py`) delivered server-side; the browser
connects over WebRTC via the shared transport
(`app/_components/voice/transport/openai.ts`, reused —
`JdsIntakeVoice.tsx` is a lean shell, not a fork of the candidate
`VoiceInterview`). On hang-up the accumulated `VoiceTurn[]` posts to
`/api/intake/[id]/voice-complete`, which clamps/caps the turns
(`interview-transcript.ts` helpers), appends them to the dialog, and runs ONE
batch extraction (`intake_cli --extract-transcript` →
`intake.py::extract_transcript`) through the same coerce + `merge_brief` path
as the text plane — prior `stated` content survives; provenance discipline
applies. **Voice is an input mode, not a session type**: the session stays
open and the read-back/confirm close stays with the text plane.

v1 is **OpenAI-only by design**: OpenAI takes the brief server-side, while
ElevenLabs' signed-url flow takes its prompt from the client — a seam the
internal brief has no reason to ride (the interview feature carries a whole
candidate-safe-brief apparatus for it).

Keyless/voiceless behavior: no OpenAI key → the mic button becomes a quiet
"voice isn't configured" note (text path untouched). No LLM provider at
extraction time → the transcript is stored, the brief stays **unchanged**, and
the UI says so (`voice.storedNote`) — a free voice conversation can't be
slot-parsed by the deterministic script, so nothing is silently invented.
Rate limits: credential minting 6/10min per intake (120 self-hosted), one
batch extraction 6/10min per IP — both pinned in
`app/api/rate-limit-contract.test.ts`.

## Known gaps

- Dialog languages are en/cs (UI chrome is 4-locale); de/fr dialogs fall back
  to the language directive only.
- The voice plane is **not live-verified**: built and unit/contract-tested,
  but no OpenAI Realtime key was available in the build session, so no real
  call was placed (mirrors the voice-interview feature's harness needs).
  ElevenLabs voice intake is deliberately out (see above).
- The visual pass in both themes is pending (built from shared
  recipes/tokens; browser verification wasn't available in the build session).
- Re-opening a `complete` session (append more turns, re-extract) is not yet
  supported — promote or start a new session.
- Decision-audit surfacing of the intake back-link is future
  work.
