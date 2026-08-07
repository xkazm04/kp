# Role Intake Dialog — the hiring need as a first-class entity

Status: **Phases 0, 0.5 and 1 shipped** (2026-08-07). This doc records the
design direction for redesigning JD creation + candidate scoring around a
dialog-captured hiring need. Phase 0.5 research lives in
`docs/development/role-intake-research.md`; the shipped Phase 1 feature is
documented in `docs/features/intake/README.md` (text intake dialog in the
Library tab: `role_intakes` store, `pipeline/jobfit/intake.py` engine with the
evidence-backed persona, live brief panel, Promote → the existing JD build).
Next: Phase 2 (voice plane + requestor-persona eval harness), Phase 3
(brief-as-reference across the pipeline).

Phase 0 (shipped): `RoleBrief` schema in `pipeline/jobfit/rolebrief.py`
(codegen'd to `roleBriefSchema`/`roleSpecSchema` in
`app/_lib/schemas.generated.ts`), structured-job threading into CV analysis
(`--job-json` on the analyze CLI; the honesty cross-check consumes authored
must/nice + prerequisite/learnable grading), and the TS `RoleSpec` unification
(`app/_lib/rolespec.ts`).

## The diagnosis

Today the app is JD-first, and the codebase audit shows the cost of that in
three hard facts:

1. **The need is captured only as a replay blob.** The JD builder takes a
   free-text `needText` (min 11 chars, `app/_lib/jd-limits.ts`), persists it in
   `jds.build_input_json` solely so Retry/Duplicate can replay the prompt, and
   nothing downstream ever reads it. There is no `requisition`, `hiringNeed`,
   or intake entity anywhere — every `intake` in the codebase is
   candidate-side.

2. **Structure is generated once, then thrown away by the consumer that needs
   it most.** The build chain produces a `RoleSpec`
   (`pipeline/jobfit/devcase/models.py`) and ingests a structured `JobRecord`
   at `jd-<slug>` — but CV analysis (`app/_lib/analyze-run.ts::cliArgs`)
   passes **only the markdown body** to Python. `pipeline.py` then re-derives
   requirements from prose with `detected_skills()` regex and flattens
   `must_have`/`nice_to_have`/`prerequisite`/`learnable` to uniform
   `must_have`+`prerequisite`. The `jdSlug` travels along but is used only for
   logging and filing. The structure exists on disk at analysis time and is
   simply not consulted.

3. **The real-world need is lost upstream of the app entirely.** The role is
   negotiated in conversations between team leads and HR; by the time someone
   types `needText` into the builder, the dealbreakers, the team context, and
   the "what does success look like" have already been compressed into a
   paragraph. The JD is the first artifact *presented*, not the first artifact
   that *exists*.

Meanwhile the app already owns strong dialog machinery — but only pointed at
candidates: the voice adapter layer is fully generic
(`app/_lib/voice/types.ts`), a stateless text-plane interview loop exists in
the eval harness (`pipeline/jobfit/eval/interview_eval.py::simulate`), the
devcase chat route is a shipped server-side LLM multi-turn loop
(`app/api/devcase/session/[id]/chat/route.ts`), and the apply flow has a
gap-driven follow-up loop (`app/_lib/completeness-followup.ts`) that asks
targeted questions to fill schema holes.

## The design

**Make the hiring need a stored, structured, dialog-captured entity — the
RoleBrief — and demote the JD to a rendered projection of it.** Master one
dialog core and point it both directions: at candidates (existing interview)
and at requestors (new intake).

```
team lead / HR ──chat/voice dialog──▶ RoleBrief (structured, per-field provenance)
                                          │
                          ┌───────────────┼──────────────────┐
                          ▼               ▼                  ▼
                    JD (rendered      JobRecord         reference during hiring:
                    projection,       (ingested,        scoring weights, interview
                    editable prose)   matchable)        grounding, decision audit
```

### 1. The entity: `role_intakes`

New table (workspace-scoped — needs a colocated `*-tenancy.test.ts` per the
tenancy manifest rule):

- `id`, `workspace_id`, `title`, `status` (`open` → `complete` → `promoted`),
  `created_at`, `created_by`
- `transcript_json` — `VoiceTurn[]` (the existing cross-plane contract from
  `app/_lib/voice/types.ts`; works for both text and voice sessions)
- `brief_json` — the evolving RoleBrief
- `coverage_json` — which slots are filled, at what confidence
- `jd_slug` / `job_id` — set on promotion, so everything downstream can walk
  back from a job to the conversation that defined it

### 2. The schema: RoleBrief

Canonical and Pydantic-authoritative in `pipeline/jobfit/` (codegen'd to Zod
via the existing `schemas:gen` path — this is also the moment to pay down the
RoleSpec-threading debt: today there are two divergent TS `RoleSpec`
declarations and the value crosses four `Record<string, unknown>` boundaries;
backlog idea `dcf2460d` covers the remainder).

RoleBrief = RoleSpec extended with what a JD never captures:

- **Requirements with teeth**: reuse the existing `JobRequirement` vocabulary
  (`kind: must_have|nice_to_have`, `hardness: prerequisite|learnable`) instead
  of flat string lists — this is exactly the distinction scoring currently
  flattens.
- **Context**: team shape, who they'd work with, why the role exists now,
  headcount, urgency, budget band (the CZK compensation layer feeds here).
- **Success criteria**: what "great after 90 days" looks like — the interview
  and devcase generators want this far more than a responsibilities list.
- **Per-field provenance**: `{value, confidence, provenance:
  stated|inferred|default, sourceTurnIdx}` — every field knows whether the
  requestor *said* it, the model inferred it, or it's a template default. This
  is what makes the brief trustworthy as a hiring-long reference, and it is
  the honest-degradation story: keyless, everything is `provenance: default`
  or `stated`.
- **Dynamic by construction** (Phase 0 decision): needs vary too much for a
  fixed form, so the schema is a minimal required spine (title / seniority /
  family) + graded `requirements` + `facets` — an open-vocabulary
  `{key, label, value, importance: core|valuable|context}` list with SUGGESTED
  keys (`team_context`, `why_now`, `urgency`, `budget_band`, `success_90d`,
  …) that are never enforced. A "power unit" backfill states five fields and
  stops; a complex senior role grows facets without a schema change. The
  must-vs-valuable balance is carried by `kind` × `hardness` × `weight` on
  requirements and `importance` on facets, not by which fields exist.

### 3. The dialog core — one engine, two directions

The strategic move: extract a **shared structured-dialog core** used by both
the candidate interview and the HR intake, rather than building a second
one-off.

- **Loop**: port the harness engine
  (`interview_eval.py::simulate` — brief as `system`, full history re-rendered
  as `task`, stateless, `<<END>>` sentinel) from `eval/` into
  `pipeline/jobfit/` proper, driven per-turn from a Next route via
  `spawnPython` + `buildLlmConfigEnv()`. This inherits the whole
  provider/keyless/offline ladder for free; a TS-native loop would bypass
  `KP_LLM_CONFIG` routing and has no precedent in the repo.
- **Route pattern**: clone the devcase chat route discipline — persist history,
  fence the new message, dual rate-limit windows, chained process events. The
  intake variant is authenticated internal (`requireOperator()` +
  `currentWorkspace()`), *not* a tokenized capability link — the whole
  expiry/revoke/consent stack of `/api/interview/connect` collapses away.
- **Per-turn extraction (the genuinely new piece)**: after each requestor
  turn, run a slot-update extraction (`complete_json` with `expected_keys` +
  a `coerce()` floor — the house convention) that merges into the RoleBrief;
  compute gaps; pick the next question as the highest-value unfilled slot.
  This generalizes the `CompletenessGap` → targeted-question loop that
  already ships in apply follow-ups, made conversational.
- **Brief (system prompt)**: reuse the composition convention and the
  harness-validated persona constants (`PERSONA_ONE_QUESTION`,
  `PERSONA_CRAFT_RULES`, language lock) — but the stance *inverts*: the
  candidate interviewer withholds (no feedback, no scores); the intake agent
  **reads back, summarizes, and confirms** ("So the dealbreaker is Czech at
  C1, and Kubernetes is trainable — correct?"). The requestor is the private
  side; no sanitizer needed.
- **Agenda**: `RunOfShow`/`ChronologyBlock` (`app/_lib/run-of-show.ts`) is
  structurally an intake agenda — reuse it to give the dialog a shape
  (context → must-haves vs trainables → success criteria → team & process →
  read-back) and to show progress in the UI.
- **Keyless degradation** (product property): with no provider, the dialog
  degrades to the deterministic scripted-chat machine
  (`ConversationalApply`'s script + declarative branching + draft
  persistence) targeting the same RoleBrief — a guided form in chat clothing,
  `provenance: default/stated` throughout, following
  `generate_with_fallback`'s `(artifact, source)` contract.

### 4. Voice

Nearly free: the adapter layer (`getVoiceAdapter`, failover, language lock,
transcript parser) is fully generic. Needed: an authenticated `connect`
variant, an intake brief-builder, and skipping the candidate-specific
machinery (consent record, minute billing — or a separate meter, TBD). Voice
is Phase 2, after the text plane proves the extraction loop.

### 5. UI

A new **Intake** surface in the Library tab (sibling of Saved/Generate in the
JDs console, or a third child tab):

- Left: the conversation (extract a shared chat-bubble primitive into
  `app/_components/` — the markup currently exists inlined twice, in
  `ConversationalApply` and `ScheduleInterviewTranscriptTurns`).
- Right: the **live brief panel** — the RoleBrief filling in slot by slot as
  the dialog runs, with confidence/provenance chips and inline editability
  (the requestor can type into a slot directly; that's a `stated` value).
  This panel is the product's signature moment: the manager *watches the
  structure being built* and corrects it in place.
- Finish → review → **Promote**: runs the existing `runJdBuild` with a
  properly-filled `DevNeed` (fixing today's asymmetry where the builder path
  and the Cases-tab path fill the same type in incompatible ways), producing
  the JD + ingested JobRecord, both stamped with the intake id.
- Both themes, verified per the design law; en + cs dialog first
  (`normalize_lang` supports those), 4-locale UI chrome parity as always.

### 6. Downstream rewiring — where the payoff lands

1. **Scoring stops flattening requirements.** `analyze-run.ts::cliArgs` gains
   `--role-json` / `--job-id` alongside the JD text; `pipeline.py`'s honesty
   cross-check and keyword coverage consume real `kind`/`hardness`-graded
   requirements instead of regex re-derivation. *(This is worth shipping even
   with zero dialog work — Phase 0.)*
2. **Interview grounding gets a source.** The interview brief builders today
   read five scalars off the job; success criteria + dealbreakers from the
   RoleBrief are exactly the grounding `buildGroundedInterview` lacks.
3. **Devcase gets a real need.** `DevNeed` is fed from the brief instead of a
   newline-split textarea.
4. **Decisions get an audit anchor.** "We said C1 Czech was a dealbreaker on
   June 3rd" is a query against `role_intakes`, with the source turn linked.
5. **Drift becomes detectable.** JD edited after intake → staleness chip
   (the `jdLastEditedAt` mechanism already exists for interview prep);
   scoring rubric drifts from stated must-haves → surfaced, not silent.

## Pre-Phase-1 gate: conversational-tone research

Decided 2026-08-07: before any Phase 1 build, run a research pass on the
*conversation design* for the requestor side — hard data where it exists plus
the psychology behind it. The candidate interviewer's register does not
transfer:

- **Less strict, less "professional-procedural."** The candidate interview is
  deliberately withholding (no feedback, no scores, fixed script). The intake
  dialog sits closer to a **therapy/coaching session than an interrogation**:
  open questions, reflective listening, reading back and confirming, following
  the requestor's thread rather than a rigid checklist — the agenda
  (RunOfShow) is a safety net, not a script.
- **Two very different session shapes to detect and serve.** Some intakes are
  just "add a power unit" — a known role, an existing team, five facts; the
  dialog should recognize this in the first turns and finish in minutes.
  Mid/senior roles carry complex stories (reorgs, half-defined mandates,
  succession, "we don't know if this is one role or two") that need the slow,
  exploratory register. Session-shape detection is itself a research question.
- **Requestors increasingly cannot compose the role at all.** With LLM tools
  reshaping what junior/mid work even is, many team leads genuinely don't know
  what to ask for. The dialog must be able to *lead* — propose archetypes,
  test hypotheses ("is this closer to X or Y?"), and elevate the requestor's
  half-formed need into a defensible brief — without putting words in their
  mouth (that's what per-field `provenance: inferred` + read-back
  confirmation are for).

Research deliverables before Phase 1 starts: (a) a review of intake/kickoff
methodologies used by recruiters and of motivational-interviewing/coaching
techniques applicable to elicitation; (b) a register/tone spec for the intake
persona (the counterpart of `PERSONA_*` constants); (c) a requestor-persona
bank for the eval harness (vague requester, over-specifier, contradicts-self,
12-must-haves, can't-articulate-seniority, power-unit fast path); (d) the
session-shape detection heuristic.

## Phasing

| Phase | Scope | Why first |
| --- | --- | --- |
| **0** ✅ | RoleBrief schema (Pydantic→Zod), thread `--job-json` into analyze, retire the duplicate RoleSpec | Immediate scoring win; no UX risk; pays the rolespec debt |
| **0.5** | Tone/psychology research pass (see the gate above) | The dialog's register is the product; getting it wrong burns requestor trust once |
| **1** | Text intake dialog: `role_intakes` table + tenancy test, ported dialog loop, per-turn extraction, live brief panel, Promote→JD | The core bet, cheapest plane to iterate on |
| **2** | Voice intake (authenticated connect), requestor-persona eval bank in the harness (vague requester, over-specifier, 12-must-haves, seniority-confused…) mirroring `interview_eval` | Voice is additive once extraction is proven; eval bank guards quality |
| **3** | Brief-as-reference: interview grounding, devcase need, decision audit, drift chips | Compounding value across the pipeline |

## Open questions

- Does the intake dialog spend a meter (like interview minutes) or ride free
  as an operator feature? Leaning free-in-plan, since it's internal.
- One `RoleBrief` per JD, or many intakes refining one brief over time
  (re-opening the dialog when the role changes)? Leaning: the intake is
  append-able — reopening adds turns and re-extracts, revisions snapshot like
  `jd_revisions`.
- How hard to push inference: should the agent propose a draft brief from a
  pasted legacy JD (ingest direction) so existing corpora onboard into the
  same schema? Likely yes, as a later ingest lane.
