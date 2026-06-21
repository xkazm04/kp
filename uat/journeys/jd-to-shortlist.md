---
name: jd-to-shortlist
promotion: discovery
surfaces: [Jobs tab, Match tab, "Job Postings & Lifecycle", "Candidate Profile & Job Matching", "Sourcing, Campaigns & Rediscovery"]
characters: [petra-recruiter, jana-sourcer, katerina-ta-analytics]
language: cs
---

# Z inzerátu k odůvodněnému shortlistu

## Goal (in the user's words)
"Mám otevřenou roli. Chci seřazený seznam kandidátů, kde u každého vidím skóre
shody A důvod proč — ne jen číslo. Takový, co můžu poslat manažerovi a obhájit ho."

## Definition of done (user POV)
- A ranked candidate list for a real ČS role, each row with a match **score**.
- Each candidate carries **reasoning** (verdict + strengths + gaps + interview probes)
  that visibly references *this* CV and *this* JD — not boilerplate.
- Petra can copy/hand the top N to a hiring manager and defend each pick.
- A recruiter-ingested/published job ranks too (not only the static seed corpus).

## Entry state / preconditions
- Dev gate on (`kp_dev_authed=1`) → workspace at `/`.
- ČS job corpus + a seeded candidate pool (v2 profiles and/or saved analyses) loaded
  per env.md (`seed_jobs_csas.py` + `seed_pipeline.py`/`seed_candidates.py`).
- Gemini key present, or the run is `scope_note`'d to deterministic-only reasoning.

## What L1 must check (structural, code-grounded)
- **Surface model:** Match tab intake (profile vs analysis source, the run button)
  in `app/features/sub_match/MatchTab.tsx:52` (`runMatchFor` → POST `/api/match`),
  and the Jobs-side candidate scan via `app/api/jobs/[id]/candidates/route.ts:30`
  (`rankPoolForJob`). Both reachable for all three internal Characters (no role gating).
- **Grounding audit — the score:** `/api/match/route.ts:41` shells `match_cli` with
  the candidate's `writeMatchInput` payload and hands the **live DB corpus** over as
  `--jobs-json` (`route.ts:47`) so an ingested job is scored against its real record,
  not a stale seed. Confirm the candidate payload is the FULL profile, not a stub.
- **Grounding audit — the reasoning (central):** follow `MatchCard`'s reasoning
  affordance → `/api/match/reasoning/route.ts` → `runReasoning`
  (`app/_lib/reasoning-run.ts:32`). It content-addresses the job
  (`reasoning-cache-key.ts`) AND the candidate (`input.keyPart`) so a verdict is
  bound to real inputs. Flag the **degrade seam** at `reasoning-run.ts:63`: past the
  `ai_candidates` allowance it pushes `--no-llm` and serves a deterministic template —
  the same path a missing key takes. Is that disclosed as "template, not AI-reasoned"?
- **Reachability:** the Jobs candidate scan needs `buildCandidatePool()` to be
  non-empty (`route.ts:19`) — with no seeded candidates it returns the "No saved
  candidates yet" note, which is an empty-state finding, not a pass.

## What L2 must confirm (live-only)
- l2_priority: pick a real ČS role, run the scan, and assert the reasoning **uses
  this candidate** — names skills from their CV, gaps tied to the JD's requirements,
  probes that only make sense for this person. Generic verdict = senior-quality `quality-gap`.
- Re-run for an **ingested** (non-seed) job and confirm it ranks (the `--jobs-json`
  hand-off works end to end), not just seed roles.
- Latency: a cold reasoning call spawns Python + Gemini — budget **30–130s**; an early
  client timeout is itself a finding. Confirm a cached verdict returns fast (`cached:true`).
- Kateřina's lens: is the score's **basis** legible (per-dimension breakdown), or just a
  number she can't calibrate against outcomes?

## Out of scope / known
- Sourcing/outreach actions on the candidate rows belong to `sourcing-rediscovery.md`.
- Keyless run → reasoning falls to the deterministic template; tag `scope_note`, judge
  structure only, don't score senior-quality on the narrative.
