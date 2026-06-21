---
name: interview-schedule-prep
promotion: discovery
surfaces: [Schedule tab, Interview tab, "/schedule/[token]", "Interview Scheduling, Prep & Rubric"]
characters: [marek-coordinator, tomas-hiring-manager]
language: cs
---

# Pozvánka k self-scheduling, výběr slotu a přípravný balíček

## Goal (in the user's words)
"Pošlu kandidátovi odkaz, ať si SÁM vybere termín. Pak chci přípravný balíček a
hodnoticí rubriku — takovou, která se ptá na to, na co bych se ptal já, ne obecné fráze."

## Definition of done (user POV)
- Marek mints a self-scheduling invite from a pipeline entry; it's **delivered** to the
  candidate (an Outbox row, not a link pasted elsewhere).
- The candidate opens `/schedule/[token]` and a **real slot is bookable**; booking
  records the slot on the entry and sends a confirmation.
- A **prep pack + rubric** is generated that asks role/CV-specific questions Tomáš would
  actually ask, with a timed run-of-show and a live checklist.

## Entry state / preconditions
- Dev gate on → workspace at `/`, Schedule tab.
- A pipeline entry at/near the interview stage (seeded pipeline).
- **Seeded interview calendar** so the picker has selectable slots
  (`seed_interview_calendar.py`).
- **A minted token fixture** for `/schedule/[token]` — the public picker is unreachable
  without it (env.md open question #3); resolve the local mint path before L2.

## What L1 must check (structural, code-grounded)
- **Surface model:** recruiter side `app/features/sub_schedule/ScheduleTab.tsx`,
  `ScheduleCalendar.tsx`, `InterviewPrepModal.tsx`, `InviteLifecyclePanel.tsx`,
  `HumanScorecardPanel.tsx`; candidate side `app/schedule/[token]/SchedulePicker.tsx`.
  Recruiter surfaces reachable for Marek/Tomáš; the picker is a tokenized public page
  (candidate-reachable only).
- **Invite delivery:** `/api/schedule/invite/route.ts:28` mints the link AND
  auto-dispatches it to the candidate (`dispatchScheduleInvite`, line 46) with a
  best-effort fallback; rate-limited per-IP (line 20). Confirm a minted-but-not-delivered
  invite is distinguishable (the `dispatched` flag), not silently lost.
- **Slot integrity:** `/api/schedule/[token]/route.ts:152` — only a slot the SERVER would
  offer is bookable (`offeredSlotFor`); the client's `body.slot` is ignored and the label
  re-derived (line 156). Confirm the busy-calendar dead-end is handled (zero slots →
  `noSlots` flag + recruiter alert, line 69) rather than a silent stall.
- **Grounding audit — prep pack (central):** `app/_lib/interview-prep-run.ts:21`
  (`runInterviewPrep`) → `runAutomationTask(entryId, "prep")` produces **CV-derived**
  questions (LLM, deterministic fallback) then a timed run-of-show. Confirm the prompt
  gets the candidate's real CV/profile + role, and that early-career entries get the
  six-phase student script (line 42), not a mismatched chronology. The `source`
  (`llm`/`deterministic`) rides in the payload — verify it's disclosed.
- **Human inputs survive regen:** prep regeneration re-merges `humanScorecard`/
  `userProgress`/`interviewer` (`interview-prep-run.ts:53`) so a Regenerate can't wipe
  Marek's hand-entered scorecard — confirm that seam holds.

## What L2 must confirm (live-only)
- l2_priority: mint an invite, open the real `/schedule/[token]`, **book a slot**, and
  confirm it lands on the entry + a confirmation dispatches (`confirmationSent`); reschedule
  once and confirm the old slot frees (bounded by `MAX_RESCHEDULES`).
- Generate the prep pack and assert the questions are **role/CV-specific** and the rubric
  is gradeable — a generic pack is a senior-quality `quality-gap` Tomáš would reject.
- Latency: prep is an LLM-backed background task — budget **30–130s**; an early timeout
  is a finding. Calendar/slot reads are fast.
- Reachability check: if no token can be minted locally, tag the candidate-side booking
  `unreachable` (fixture gap) — don't score it as a failure.

## Out of scope / known
- The in-browser AI **voice** interview itself → `voice-interview.md`.
- Advancing the entry into the interview stage → `pipeline-advance.md`.
- Keyless: prep questions fall to the deterministic template; tag `scope_note`.
