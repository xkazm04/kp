> **Archived 2026-07-30.** This plan is executed: the stage model added
> `Accepted` (decision #2), the JD draft/publish split (Phase 1), the
> Channels tab + inbound webhooks (Phase 2), data-driven decision config +
> screen-wave auto-reject (Phase 3, see `app/_lib/decision-config-store.ts`,
> `app/_lib/screen-wave.ts`), and interview/offer group-eval wiring (Phases
> 4–5) are all shipped on `main`. See `docs/features/pipeline/README.md` and
> `docs/features/jobs/README.md` for the current state. Kept here as the
> historical rationale for the phase ordering and the cross-cutting
> decisions.

# Pipeline evolution plan (from "Personas - KP" review)

Phased plan responding to the per-step feedback in `Personas - KP.csv`. Each phase
has an **App** track (real functionality) and a **Simulation** track (the demo
walkthrough must mirror the real flow). Sized S / M / L.

## Guiding finding
Much of this is **already half-built by the parallel session** (currently
uncommitted in the working tree). The plan **wires existing pieces into the
pipeline + simulation** rather than rebuilding:
- **Inbound intake** — `app/_lib/apply.ts` + `/api/apply/[id]` (conversational apply → creates a `Sourced` pipeline entry, event `applied`). This IS channel #1.
- **Self-scheduling** — `app/_lib/schedule-store.ts` (`proposeSlots`, `schedule_invites`, reminders).
- **AI voice interview** — `app/_lib/voice/*`, `/api/interview/*`, `interview_sessions` (+ `scorecard_review` Interview→Offer gate).
- **Analytics funnel** — `app/features/sub_analytics/*`, `/api/analytics`, decision log with auto/human + rationale.
- **Rediscover** — `/api/jobs/[id]/rediscover` (re-surfaces past candidates at `AI-matched`).
- **Group evaluation** — `group-eval-run.ts` + `GroupEvalModal` (compare candidates for a role).

## Cross-cutting decisions
1. **Auto-match fate.** Keep proactive auto-match as ONE optional channel ("proactive sourcing") alongside inbound apply. *(Decided.)*
2. **Stage model.** **Add `Accepted` as a new first stage** (inbound applications) and **keep `Sourced`** for proactive sourcing/rediscover — lower blast radius, supports both. *(Decided.)*
3. **JD vs Job.** Add `status` (`draft`|`published`) to the ingested job record (keep `jds` prose + `jobs` structured separate). *(Recommended — confirm at Phase 1.)*

## Decided starting point
Start with **Phases 4 + 5 (quick wins)** — wire the already-built interview
automation + offer group-evaluation into the flow + simulation. Then 1 → 3 → 2 → 6.

---

## Phase 1 — JD lifecycle: draft → publish (+ company template)
CSV rows: *Job description*, *Source*. Effort: **M**. Foundational.

**App**
- Add `status` (`draft` | `published`) to the JD/job record (`jds` db.ts:102 / `job-ingest.ts` jobs). `saveJd` defaults to `draft`; a `publishJd` action flips to `published` and makes it receivable + sourceable. Today it's published-on-save (db.ts:572) and immediately sources — split that.
- Manage state in the **Jobs tab** (CSV: "display rather /?tab=jobs"): list draft vs published; Publish button.
- **Company format template**: a reusable JD template (sections/branding) the builder applies (`sub_library/JdBuilder.tsx`).

**Simulation**
- *Design* step: render a richer, template-formatted JD ("simulate output") instead of the bare canned markdown.
- *Source* step: navigate to `?tab=jobs`, show the JD as **draft**, real-click **Publish** → it enters the pipeline (replaces today's implicit source-on-save).

**Leverages**: `saveJd`, JD builder, structured job ingestion (#1).

---

## Phase 2 — Inbound intake & pipeline front redesign (channels + "Accepted")
CSV row: *Auto-match*. Effort: **L**. Architectural — needs the cross-cutting decisions.

**App**
- New **Channels / Integrations tab**: manage inbound channels — the apply link (built), email intake, job-board, calendar/email integration. Show "listening" state per channel.
- Pipeline front: **"Accepted"** = application received via a channel. Per decision #2, rename `Sourced→Accepted` or add `Accepted` ahead of `Sourced`.
- Reframe proactive matching (auto-match / rediscover) as one **optional channel**, not the default front (per decision #1).

**Simulation**
- *Auto-match* step → **Channels** tab: show channel setup + "listening", then simulate a CV arriving by driving the **`/apply`** flow (or injecting an application) → candidate lands at **Accepted**.

**Leverages**: `apply.ts`, `/api/apply`, `candidate-pool.ts`, `rediscover` (all parallel work).

---

## Phase 3 — Configurable per-phase decisions + screening auto-reject + audit
CSV row: *Screening*. Effort: **L**.

**App**
- Make `POLICY` (automation.py:32) **data-driven**: a decision-config store (per phase, optionally per role/market) replacing hard-coded thresholds. Expand the "decision module" with a config UI.
- **Screening auto-reject**: reject bottom **X%** AND below **Y%** match (both configurable), **preserving the fairness gates** (early-career never auto-rejected, automation.py:120/153). Every auto-decision logged with **rationale** (audit) — the Analytics decision log already records auto/human + tone.
- Accepted (screening pass) → **Interview**.

**Simulation**
- *Screening* step → show the **Analyze** tab (initial CV scoring) instead of Decisions; narrate "first automated decision wave"; show a couple auto-rejected with rationale.

**Leverages**: `evaluate_entry` + `POLICY`, `AnalyzeTab` scoring, `pipeline_events` + analytics decision log.

---

## Phase 4 — Interview automation & calendar
CSV row: *Interview*. Effort: **M** (mostly wiring + seed; features exist).

**App**
- At the interview gate, offer **automate** (send self-schedule link → AI voice interview → scorecard) vs **manual slot** (the calendar Confirm). Calendar-integration polish.
- **Seed more interview-stage data** so the calendar is populated for demos.

**Simulation**
- *Interview* step → present the two options and exercise the real ones: self-schedule + AI voice (or the manual Confirm click already wired).

**Leverages**: `schedule-store.ts`, `voice/*`, `interview-run.ts`, `ScheduleTab` (parallel work, largely built).

---

## Phase 5 — Offer group evaluation & Decisions-by-JD filter
CSV row: *Offer*. Effort: **M**.

**App**
- Reuse **group evaluation at the offer stage**: compare a role's candidates incorporating the **interview scorecard** (not just match score), then extend the offer to the top pick. Today group-eval runs at the Sourced→Screening key-decision (DecisionsTab:117).
- Decisions tab: **filter per opened JD**.

**Simulation**
- *Offer* step → run **group evaluation** for the role (open `GroupEvalModal` comparison) before the "Send offer" click.

**Leverages**: `group-eval-run.ts`, `GroupEvalModal`, `scorecard-v2`.

---

## Phase 6 — Profile / Match tab disposition
CSV general note. Effort: **S** (decision + cleanup).

`Profile` (intake builder) and `Match` (rank vs corpus) are standalone, unused in the pipeline flow. Options:
- **Integrate**: `Match` becomes the proactive-sourcing channel (Phase 2); `Profile` feeds the apply/intake builder.
- **Demote**: move both under a "Tools" nav group (keep, de-emphasize).
- **Remove**: drop from the main workspace.

---

## Suggested sequencing
- **Phase 1 first** (foundational, unblocks the JD→receivable model).
- **Phases 4 & 5 are low-risk quick wins** (reuse parallel work, immediately sim-visible) — do anytime.
- **Phase 3** (decisions) after the stage model is settled.
- **Phase 2** (intake redesign) once decisions #1–#3 are made — biggest blast radius, do deliberately.
- **Phase 6** as cleanup.

## Coordination note
Phases 2/4/5 overlap files the parallel session is actively editing (apply,
schedule-store, analytics, ScheduleTab, db.ts). Sequence to avoid clashes;
prefer wiring + additive changes over rewrites of their in-flight files.
