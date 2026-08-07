# UAT run 2026-08-07-intake — role-intake dialog (SUMMARY)

Journey `role-intake-dialog` × 3 Characters (Tomáš — first-time team-lead
requestor · Eva — eng hiring lead · healthcare-clinic HRBP), first run of the
**conversational-surface behavior overlay** (rubric §last). L1 mass-parallel
(3 subagents) → L2 live (drive-intake.mjs, Czech power-unit backfill, 7 real
LLM exchanges + promote, on :3000).

## Scorecard

| character | L1 | L2 | time-saved (est.) | grounding |
| --- | --- | --- | --- | --- |
| tomas-backend-team-lead | **L1-conditional** | (via shared L2 run) | ~2–2.5 h/role · medium | 3/3 dialog ctx |
| eva-eng-hiring-lead | **L1-conditional** | **L2-conditional** | ~60–90 min/role · medium | 7/9 incl. downstream |
| hr-healthcare-clinic-hrbp | **L1-conditional** | (via shared L2 run) | ~45–90 min/role · low-med | 9/10 |

Live latency: 31–40 s per exchange (7/7 settled; no timeout). Promote → JD +
background build confirmed live. Visual bar: clean in Studio Light, buttons
correct after the recipe-contract fix.

## Impact-ranked backlog (confirmed findings)

1. **L2-INT-1 · major** — the devcase-borrowed injection fence makes the agent
   treat the REQUESTOR's own message as "external unverified input": a
   post-read-back correction was refused on camera. (Honest silver lining: the
   paranoid facet was correctly chipped `úsudek AI`.)
2. **L1-CONV-2 · major (3/3 characters)** — deterministic close invites a
   correction and locks the composer in the same turn (`<<END>>`+`done`
   simultaneous → 409 on the reply).
3. **L1-HRBP-2 · major** — `role_family` silently stays `software_engineering`
   for non-tech roles, through promote into the JD/job.
4. **L1-CONV-3 · major (3/3)** — spine scalars carry no provenance; default
   `medior` renders as if captured, into the sign-off read-back.
5. **L1-EVA-2 · major** — Czech power-unit markers miss inflected forms
   (trailing `\b`), keyless backfills fall to the 11-exchange story script.
6. **L1-EVA-3 · major (scope: Phase-3 continuation)** — the brief dies as a
   structured object at the dev-case seam (promote never offers caseDesign;
   Dev tab re-extracts from markdown).
7. **L1-HRBP-6 · minor** — promote hardcodes `marketResearch: true` (wrong-
   market comp band on non-Czech roles). Ceiling: market layer is Czech-only.
8. **L2-INT-4 · minor** — LLM path stores skip words as stated facets
   ("Why now: přeskočit") + facet-label code-switching.
9. **L2-INT-5 · minor** — 30–40 s per exchange behind a static "Přemýšlím…".

Env drift caught by the run: `/` is now server-gated on `kp_entered` — the
overlay's documented dev-auth path alone lands on the landing (env.md updated;
drivers must seed the cookie).

## Strengths worth protecting (don't touch)

The live register genuinely clears the research bar: correct power-unit triage
from an inflected Czech opener (LLM path), one question per turn, the
requestor's own words reused ("v podstatě stejného člověka" → "Referenční
profil: … 'v podstatě stejný člověk'"), a grounded read-back, and — the
product's signature — **provenance chips that never lied on camera**, including
marking the agent's own refusal reasoning as `úsudek AI`. Keyless honesty
(identical opener, disclosed degradation, everything typed = `stated`) held.
Guardrail spine (tenancy, pinned rate limit, fenced transcript, IMMEDIATE
writes) verified by all three L1 passes independently.

## Panel verdict

All three would pilot it tomorrow — none would roll it out org-wide until a
correction actually lands: the shared sentiment is *"it listens beautifully,
but the one thing I asked it to change, it kept."* The register bet (coaching,
not interrogation) is validated live; the trust bet (provenance) is validated;
the correction loop is the adoption gate.
