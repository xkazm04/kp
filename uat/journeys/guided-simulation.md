---
name: guided-simulation
promotion: discovery
surfaces: [Guided Pipeline Simulation, app/features/simulation]
characters: [helena-buyer, petra-recruiter]
language: both
---

# Guided simulation — a keyless JD→Hired run that builds belief

## Goal (in the user's words)
- **Helena (en):** "Before I trust a demo deck, show me the actual product driving itself from a job
  to a hire — keyless, no signup — so I believe the pipeline is real, not a mockup."
- **Petra (cs):** "I want to show a stakeholder what the tool does in two minutes without exposing
  our candidate data or burning AI credits."

## Definition of done (user POV)
- A keyless, end-to-end run that walks JD → screen → group-eval → offer → Hired with REAL clicks on
  the actual app (spotlight + explain drawer), ending on a real "do it with your roles" CTA.
- It builds belief the pipeline is genuine (real surfaces, real transitions), not a scripted video.
- Reachable WITHOUT auth or AI keys (the buyer's reachability strength).

## Entry state / preconditions
- **Keyless, no auth required** — this is the buyer's first-touch surface and the proof point. Helena
  reaches it with zero setup (her reachability win); Petra can launch it from inside the app too.
- The sim uses its own seeded company template + sim store, NOT the tenant's real candidate data.

## What L1 must check (structural, code-grounded)
- **Reachability (the strength):** the guided sim is the one rich surface Helena reaches without auth/keys. The bottom
  `SimBar` is a minimizable footer that drives the run (`app/features/simulation/SimBar.tsx:8-13`), with `SimSpotlight`,
  `SimExplainDrawer`, `SimGroupEval`, `SimOfferFrame`, `SimDecisionWave` as the staged frames (context file list). Confirm
  no part of the run requires a key or a login.
- **Real clicks, not a video (the crux for belief):** the sim performs ACTUAL clicks on the app's own controls — e.g. the offer
  step reads back the real minted token and opens the candidate's actual `/offer/[token]` page to click Accept inside it
  (`app/api/sim/offer-link/route.ts:7-13` comment + `getOpenOfferForEntry`). Verify the JD→Hired path traverses real surfaces
  (`/api/sim/inbound`, `/api/sim/screen-draft`, `/api/sim/offer-draft`, `/api/sim/offer-link`) rather than faked frames — a
  scripted-only demo would undercut the "is this real" job.
- **Grounding audit:** the drafts (`/api/sim/screen-draft`, `/api/sim/offer-draft`) — are they generated from the sim's company
  template + the walked candidate, or static lorem? Static drafts are acceptable for a keyless demo (`scope_note`) but note it,
  since "thin context" here is by-design, not a defect.
- **Honest reset + non-destructive:** `/api/sim/reset` exists so the run is repeatable and leaves no tenant residue. Confirm the
  sim store is isolated from real pipeline data — a sim that mutated seeded candidates would be a major finding.
- **Climax CTA:** the done state leads with a real conversion CTA into the app (`SimBar.tsx:48-55`), not a dead "Run again".

## What L2 must confirm (live-only)
- **l2_priority — keyless end-to-end:** with NO auth and NO keys, run the full JD→Hired walk; assert each step lands on a real
  surface (the offer step truly opens `/offer/[token]` and clicks Accept), and it finishes on the CTA. This is the buyer's belief test.
- **Real latency vs. demo pacing:** the run should feel live but not stall — if a sim step times out waiting on a (keyless) draft,
  that's a finding even though quality is `scope_note`.
- **No data leak:** confirm the run never surfaces or mutates the tenant's real seeded candidates.
- **Bilingual:** Helena en, Petra cs — the bar copy + explain drawer render in the active language (note: some `SimBar` strings are
  hardcoded English, e.g. the CTA at `:51` — a leaked-string finding for Petra's cs run).
- **Rendering:** spotlight, explain drawer, offer frame, group-eval frame render in both themes; the footer height anchoring holds (`:24-38`).

## Out of scope / known
- Sim draft quality is keyless-by-design → `scope_note`, not a senior-quality finding.
- Productizing the sim as a reusable onboarding tour (backlog idea) — out of scope for this discovery pass.
