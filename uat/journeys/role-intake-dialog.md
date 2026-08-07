---
name: role-intake-dialog
promotion: discovery
surfaces: ["Library → Intake (JDs console sub-tab)", "Saved JDs ledger (promoted output)"]
characters: [tomas-backend-team-lead, eva-eng-hiring-lead, hr-healthcare-clinic-hrbp]
language: cs
---

# Z pocitu „něco nám chybí" k obhajitelnému zadání role

## Goal (in the user's words)
"Vím, že tým potřebuje posilu, ale neumím to napsat. Chci si o tom s někým
promluvit — normálně, ne formulářem — a na konci mít strukturované zadání,
které HR vezme a rozběhne, a pod které se podepíšu, protože je z MÝCH slov."

## Definition of done (user POV)
- One sitting: dialog → structured RoleBrief → **Promote** → a JD draft lands
  in Saved JDs (and a matchable job behind it).
- The **live brief panel** fills as they talk, with each value marked
  **stated / inferred / default** — inference never dressed as their words.
- A backfill request stays SHORT (≤ 8 exchanges); vagueness earns the longer
  coaching register, not the other way around.
- The close is a **grounded read-back** they can correct, and the correction
  lands.
- Works in **Czech**, keyless degrades to the guided script honestly (with a
  visible note), and buttons/panels render to the design system's bar.

## Entry state / preconditions
- Dev gate on (`kp_dev_authed=1`) → workspace → `/?tab=library` → Intake
  sub-tab. `role_intakes` table exists (fresh DB self-creates it).
- LLM: local Claude CLI default OR keyless (both are in-scope; keyless runs
  judge the scripted path and `scope_note` the register).

## What L1 must check (structural, code-grounded)
- **Surface model:** the Intake sub-tab mounts via the Saved/Generate/Intake
  `SegmentedControl` (`app/features/library/jds/JdsSavedLedger.tsx`), Tier-3
  dynamic (`intake/JdsIntakePanel.tsx`); chat = `JdsIntakeChat.tsx`, live
  brief = `JdsIntakeBriefPanel.tsx`, state/API = `jdsIntakeLogic.ts` →
  `/api/intake*` routes → `app/_lib/intake-run.ts` →
  `pipeline/jobfit/intake_cli.py` → `intake.py`.
- **Grounding audit — the persona:** `intake.py`'s system brief must encode
  the research rules (one question/turn, reflect-then-ask, reuse their words,
  ladder musts, park solutions, name contradictions, 90-day de-spec, grounded
  read-back + `<<END>>` gate) — cite the constants. Score how much of the
  requestor's context reaches the prompt (current brief + full transcript +
  fenced new message).
- **Provenance honesty (trust):** per-value `stated|inferred|default` from the
  engine's extraction rules through `roleBriefSchema` to the UI chips
  (`ProvenanceChip`) — confirm the chain, and that the deterministic path
  marks requestor answers `stated`.
- **Promote seam:** `briefReadyToPromote` gating → `/api/intake/[id]/promote`
  → the SAME backgrounded `jd_build` as Generate, with `JdBuildInput.brief`
  filling the DevNeed structurally; back-link stamped (`jd_slug`/`job_id`).
- **Reachability:** operator-internal (no token); rate limit on message;
  tenancy — every `role_intakes` query workspace-scoped.
- **Keyless:** the deterministic slot script serves the same schema; UI shows
  the degraded note (`degradedNote`).

## What L2 must confirm (live-only)
- l2_priority: **the register, live** — drive a real dialog in-character (one
  behavior mode from the Character's declared list): does it reflect before
  asking, reuse the Character's own Czech words, ladder the first stated
  must-have, park a premature solution, and close with a read-back naming what
  was actually said? A canned question-parade = senior-quality `quality-gap`.
- l2_priority: **the live brief panel** updates after each exchange and the
  provenance chips match reality (a stated answer shows `stated`).
- l2_priority: **shape economics** — a backfill opener collapses to the short
  path; count the exchanges.
- l2_priority: **Promote end-to-end** — the JD appears in Saved JDs
  ("Analyzing" → ready), the job exists, the intake shows "promoted".
- Latency per exchange (LLM path spawns Python + model: budget 10–60s; an
  early client timeout is a finding). Visual bar: buttons sized per recipe
  contract, both themes.

## Out of scope / known
- Voice intake (not built — concept Phase 2 remainder; `scope_note`, not a
  defect). Re-opening a completed session (known gap, documented).
- de/fr dialog content (en/cs only by design; UI chrome is 4-locale).
- The CI-side reliability invariants are already gated
  (`pipeline/jobfit/eval/intake_eval.py`, 100-scenario bank) — L2 does not
  re-prove them; it judges what CI can't (felt register, live rendering,
  real latency, Czech naturalness).
