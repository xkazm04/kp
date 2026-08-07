# L1 — Helena Bauer (Head of TA, Erste/ČS — prospect buyer) × guided-simulation

- **Run:** 2026-07-02-full · main @ 3395b4c · cert level: **L1 (theoretical, code-derived)**
- **Verdict:** **L1-conditional** — the keyless real-click spine is structurally genuine (her core "is this real" test passes on paper), but four majors gut the buyer outcome: the entry is dark on any production deploy, the climax CTA ends the run hidden in a collapsed panel and then dead-ends at an operator password login, no ROI math ever appears, and the compliance machinery is demonstrated but never named for the one buyer who must hand it to legal.
- **Grounding score:** **6/9** steps drive real machinery (see audit); 3 deterministic stand-ins, disclosed to the viewer only via the "(SIM)" title suffix and one diagram label.
- **Time saved (designed):** weeks of vendor vetting (demos-with-SEs, RFPs, reference calls) → **one ~20-min self-serve session** (the run itself plays ~3–5 min in auto mode) · confidence **medium** — but **live value today ≈ 0 on a production deploy**, because she cannot reach the entry at all (gsim-l1-001).

## Surface model (affordances → code)

| Affordance | Backing code |
|---|---|
| Marketing CTA "Watch the live demo" | `app/landing/spark/SparkLanding.tsx:275-281` → `<a href="/api/demo">` · label `messages/en.json:276` |
| `/api/demo` — anonymous demo entry | `app/api/demo/route.ts:19-47` — rate-limited (`:22`), mints an isolated demo-workspace session cookie on gated deploys (`:36-45`), redirects to `/?sim=auto` |
| **Fail-closed lock** | gated deploy (KP_SECRET) + no `KP_DEMO_ENABLED`/`KP_MULTI_WORKSPACE` → redirect to `/`, **no session, no sim** (`app/api/demo/route.ts:32-34`, `app/_lib/workspace-lock.ts:42-46`) |
| `/?sim=auto` forces the workspace past the gate | `app/page.tsx:23-39` (`forceDashboard`), `app/_components/auth/HomeGate.tsx:28` |
| Auto-start, play mode (not step) | `SimulationProvider.tsx:692-699` — fires once, `stepMode=false`, `start()` |
| SimBar (controls, stepper, status, CTA) | `app/features/simulation/SimBar.tsx:13-190`; **collapsed by default** (`:17`), expand only via the pill (`:81-93`) |
| Done-state conversion CTA | `SimBar.tsx:46-58` — "Get started — do it with your roles" → `/login` (`:52`) |
| Step engine (spotlight → nav → real click → server-verify → gate) | `SimulationProvider.tsx:337-349` (`step`), `:229-245` (`clickEl` — native `.click()` on the app's real controls), `:215-227` (`waitEntry` — polls the server, throws labelled halts), `:261-271` (`advanceTo`, bounded by the real 5-stage pipeline `:74`) |
| Spotlight / explain drawer / candidate iframe / group-eval / decision-wave overlays | `SimSpotlight.tsx:14-104`, `SimExplainDrawer.tsx:14-101`, `SimOfferFrame.tsx:17-108`, `SimGroupEval.tsx:8-21`, `SimDecisionWave.tsx:10-68`; mounted in `app/features/Workspace.tsx:295-300` |
| JD→Hired step list | `constants.ts:76-84` — design → source → match(intake) → screen → interview → offer → hired, each pinned to a real tab |

**The walk, step by step (all real endpoints):** reset (`/api/sim/reset` → `app/_lib/sim-store.ts:38-67`) → JD builder prefilled via URL params (`SimulationProvider.tsx:360-374`) → saved through the real `/api/jds/save` (`:387-392`) → **real click** on the draft's "Source into Pipeline" button, API fallback (`:398-405`) → real deterministic sourcing over the live candidate pool (`app/api/jobs/[id]/publish/route.ts:66-80` → `app/_lib/devcase-run.ts:532-557`) → scripted inbound applicant from the real pool (`app/api/sim/inbound/route.ts:17-37`) → the **real screen-wave engine** with preview → approval-token → commit (`SimulationProvider.tsx:476-486` → `app/api/decisions/screen-wave/route.ts:32-49`) → real self-schedule token page in an iframe, candidate picks a slot (`:514-529`) → **real group_eval task** started + polled (`:276-321`) → real click on "Send offer" (`:569-576`) → reads back the real minted token (`app/api/sim/offer-link/route.ts:10-15`) → opens the candidate's actual `/offer/[token]` page in an iframe and **real-clicks Accept inside it** (`:594-609`) → Hired.

## Grounding audit (canned vs live — and is it disclosed?)

| Step | Data | Real? |
|---|---|---|
| JD content | canned constants + company template (`constants.ts:8-35`, `company-template.ts:4-40`) | canned text, saved via the real API |
| Sourcing | real deterministic matcher (KO + multi-factor) over the **live candidate DB** (`devcase-run.ts:536`, `publish/route.ts:66-80`) | **real** |
| Inbound applicant | real pool candidate, **scripted score** (floor invariant-pinned, `constants.ts:57-70` + `constants.test.ts`) (`inbound/route.ts:26`) | half |
| Screen wave | the **real decisions engine**, real per-candidate rationales, Art. 22 preview→token→commit (`screen-wave/route.ts:32-49`) | **real** |
| Screening recommendation | canned draft, `confidence: 72`, generic rationale, **no LLM** (`app/api/sim/screen-draft/route.ts:17-24`) | canned |
| Interview | real invite token + real `/schedule/[token]` page (`SimulationProvider.tsx:515-529`) | **real** |
| Group eval | the real task machinery, deterministic ranking when keyless (`app/_lib/group-eval-run.ts:23-30`) | **real** |
| Offer draft | deterministic, salary from the real job band midpoint with a stated basis (`app/api/sim/offer-draft/route.ts:18-32`) | half |
| Offer accept | real minted token, real candidate page, real click (`offer-link/route.ts:7-15`, `SimulationProvider.tsx:594-609`) | **real** |

**= 6/9 real.** Disclosure to the viewer is thin: the "(SIM)" title suffix (`constants.ts:7-8`), the bar label "Pipeline simulation" (`SimBar.tsx:90`), and one diagram's "Matcher (deterministic)" (`diagrams.ts:26`). The captions never say "sample data, no AI keys used" — the canned `confidence: 72` reads as AI output (gsim-l1-009).

## Reachability (resolved before judging — this is the finding)

My binding: public surfaces only, no key, no login. The chain the journey promises exists end-to-end **in code** — but:

- **Production:** the dev gate is off (`devAuth.ts:28`), so `/` always mounts the dashboard and **the landing (with the demo CTA) is served at no URL** (`app/page.tsx:6-14`); `/landing` redirects to `/` (`app/landing/page.tsx:6-8`). I hit an operator login, not a pitch.
- **Gated deploy:** even with the `/api/demo` URL in hand, the default refuses to mint the session and bounces me to `/` (`api/demo/route.ts:32-34`; opt-in only via `KP_DEMO_ENABLED`, `workspace-lock.ts:42-46` — an honest fail-closed lock, since tenancy is half-built and the anon session could read real PII through ~28 unscoped tables, `workspace-lock.ts:1-9`).
- **Dev/open deploy (the UAT env):** fully reachable and genuinely keyless — landing → CTA → `/api/demo` → `/?sim=auto` → auto-play.

So the journey is judged **within the dev deploy**, with the production darkness recorded as the top finding (gsim-l1-001), not silently assumed away.

## Cognitive walkthrough (in character)

1. **Will I try it?** On the dev deploy, yes — "Watch the live demo" is the hero's second CTA (`SparkLanding.tsx:278`). On production there is nothing to try. That is the whole ballgame.
2. **Notice the control?** The run auto-plays with a spotlight ring + caption bubble (`SimSpotlight.tsx:67-102`) and the explainer drawer opens itself (`start()` sets `explainOpen: true`, `SimulationProvider.tsx:633`). Strong first impression. But the control bar — pause, status log, and later the CTA — is a collapsed pill I have to discover (`SimBar.tsx:17,81-93`).
3. **Label ↔ intent?** Captions narrate each act on the surface it happens on ("Recruiter clicks 'Send offer' — a secure accept/decline link goes to …", `SimulationProvider.tsx:571`). The stepper names the seven stages. Good.
4. **Feedback?** Every phase logs what happened to whom (`:454`, `:490`, `:581`, `:610`); failures halt with labelled messages instead of walking on (`:224`, `:268`), and a timed-out group eval says so honestly instead of blanking (`:299-310`). I notice — and respect — that it never fakes success.
5. **Did the result advance my job?** Partially. I watched a candidate actually walk JD→Hired across real surfaces — my "real, not a mockup" test passes. But the climax is "Done — candidate hired 🎉" (`:616`) in a hidden panel: no numbers, no time-to-fill claim, no screening-cut math, and the CTA behind the pill goes to a password form I can't use (`SimBar.tsx:52`, `app/login/page.tsx:17-45`).
6. **Do I trust it enough to act?** The mechanism, yes — deterministic matcher honestly labelled, human-approval gate actually exercised (`:476-485`, audit-labelled "Guided demo (auto-approved)" `:484`), fairness gate visibly narrated (`SimDecisionWave.tsx:21-24`). But nobody says "Art. 22" or "human-in-the-loop" to my face — it lives in code comments (`SimulationProvider.tsx:469-471`) — and I can't take a code comment to legal.

## Scored acceptance criteria (applied identically every run)

| Criterion | Verdict |
|---|---|
| completion/trust — sim runs keyless e2e, no break | **pass (structural, dev deploy)** — keyless spine confirmed in code; every step has an API fallback; l2 must confirm live. On prod: unreachable → gsim-l1-001 |
| trust/senior-quality — real reasoning, not a black box | **partial pass** — real screen-wave rationales, criteria table from the real registry (`criteria.ts:39-64`), diagrams per phase; but canned drafts pose as AI with no disclosure → gsim-l1-009 |
| missing — compliance story present and concrete | **fail (major)** — mechanisms demonstrated, never named → gsim-l1-005 |
| time-saved — ROI math shown and sourced | **fail (major)** — no number anywhere in the run → gsim-l1-004 |
| trust — pricing maps to value | **not judged here** — Billing is a separate journey; noted, not scored against this one |
| clarity — differentiation legible | **partial** — the mechanism-forward drawer *is* the differentiation, but it's never stated as one; belongs mostly to the landing journey |
| effort — pilot/no-pilot decision in ~20 min self-serve | **pass (structural)** — the run plays in ~3–5 min; whole session fits my budget *if I can reach it* |

## Findings (mine — full schema in `guided-simulation.findings.json`)

- **gsim-l1-001 · major** (blocker-derived, scope-noted as deliberate) — The buyer's first touch is dark on every production/gated deploy: landing unserved, `/api/demo` fail-closed. The best pre-sales asset the product has is invisible to the person it was built for.
- **gsim-l1-002 · major** — The collapsed-by-default SimBar never auto-expands; in the auto-play entry the run *ends* with the conversion CTA hidden behind the pill.
- **gsim-l1-003 · major** — The CTA that is there goes to `/login` — an operator password form with no signup/trial/contact path. Peak intent, dead end.
- **gsim-l1-004 · major** — Zero ROI quantification at the climax (or anywhere): no time-to-fill, no screening-cut, not even this run's own counts rolled up.
- **gsim-l1-005 · major** — Compliance machinery runs but is never named: "Art. 22", "human-in-the-loop", "GDPR" appear in code comments only; the viewer gets "the fairness gate holds".
- **gsim-l1-009 · minor** — Deterministic stand-ins undisclosed in viewer-facing UI; a canned "confidence: 72" reads as AI.
- **Strengths:** gsim-l1-010 (the keyless real-click spine — real endpoints, real tokens, real pages, real clicks; the journey's crux is structurally true), gsim-l1-011 (honest failure handling — labelled halts, honest timeout notices, invariant-pinned demo coupling), gsim-l1-012 (marker-scoped non-destructive reset + a fail-closed demo lock that names its own tenancy seam).

## Character feedback (first person, Helena)

"Credit where due: this is the first 'AI recruiting' demo I've evaluated that would let me verify the core claim myself. It isn't a video — I can see it save a real JD, source a ranked pool through a matcher it openly calls deterministic, run an actual screening wave with per-candidate rationales and a review-then-approve step, and finish with the candidate accepting on their own offer page. When something can't be generated in time it says so instead of faking it. That honesty buys more trust with me than any slide.

But walk my actual twenty minutes. On your production site I never see this — I get a login box. If someone hands me the magic demo link anyway, the finale is a quiet '🎉' behind a collapsed pill, and the one button that wants my business asks me for an operator password. Nobody tells me what I'd save — you had the numbers in your hands, you'd just sourced five and hired one, and you didn't do the math for me. And the compliance story I *must* hand to legal — human approves the wave, early-career never auto-rejected, everything audited — is genuinely in there, I could see its shadow, but the product never says the words. I can't cite a shadow to my board.

Verdict: the engine convinced me the pipeline is real. The packaging around it would lose me in practice — I'd have closed the tab at the login screen and pilot-listed a competitor who let me in. Fix the front door, put a number and the word 'Article 22' on the ending, give the button somewhere to go, and this demo does weeks of your sales team's work in five minutes."
