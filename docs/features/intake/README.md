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
   correction invitation, then the `<<END>>` sentinel marks the session
   `complete` (an LLM `done` without the sentinel is ignored).
5. **Promote** — POST `/api/intake/[id]/promote` runs the SAME backgrounded
   build as `/api/jds/generate` (placeholder JD row → detached `jd_build`
   task → best-effort ingest), with the brief threading the `DevNeed`'s
   structured fields (`stack` = must-have skills, `responsibilities` = 90-day
   outcomes) via `JdBuildInput.brief`. The intake row is stamped with
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

## Known gaps

- Dialog languages are en/cs (UI chrome is 4-locale); de/fr dialogs fall back
  to the language directive only.
- No voice plane yet (authenticated connect variant of the generic voice
  adapter layer — the remaining Phase 2 item).
- The visual pass in both themes is pending (built from shared
  recipes/tokens; browser verification wasn't available in the build session).
- Re-opening a `complete` session (append more turns, re-extract) is not yet
  supported — promote or start a new session.
- Intake intent grounds interviews; devcase design consumes the brief only via
  the promoted `DevNeed`. Decision-audit surfacing of the back-link is future
  work.
