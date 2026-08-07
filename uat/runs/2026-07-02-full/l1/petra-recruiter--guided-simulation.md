# L1 — Petra Nováková (Corporate Recruiter, ČS) × guided-simulation

- **Run:** 2026-07-02-full · main @ 3395b4c · cert level: **L1 (theoretical, code-derived)**
- **Verdict:** **L1-conditional** — as a two-minute stakeholder show-and-tell it is structurally excellent (real clicks, honest logs, a drawer that teaches the mechanism, a Reset that leaves her board alone), but the entire narration is hardcoded English inside her Czech UI (major), and the demo's screen wave dispatches *real* rejection comms for auto-rejected pool candidates with nothing sandboxing comms in demo mode (major, low reachability today).
- **Grounding score:** **6/9** steps drive real machinery (same audit as Helena's report — sourcing, screen wave, schedule, group eval, offer page are real; JD text, screen draft, offer draft are deterministic stand-ins).
- **Time saved (designed):** ~30–45 min of demo prep per stakeholder show (staging data, screenshots, a walkthrough deck) → a **~3–5 min guided run** she can start from the About tab in one click ≈ **~35 min saved per demo** · confidence **medium** (live pacing + whether it stalls mid-show = L2).

## Surface model (affordances → code) — her entry points

| Affordance | Backing code |
|---|---|
| About tab → "tour" link (localized) | `app/features/sub_about/AboutTab.tsx:39-48` — `sim.start` behind `t("tourLink")`; comment `:15-17` names About as the tour's home |
| Command palette → tour action (matches "tour story demo **prohlídka příběh**") | `app/features/CommandPalette.tsx:180-191` |
| Collapsed SimBar pill "Pipeline simulation" (bottom centre, always mounted in the workspace) | `SimBar.tsx:81-93`; mounted `app/features/Workspace.tsx:295-300` |
| Controls: Start/Pause/Resume/Next/Stop/Reset/Step/Explain | `SimBar.tsx:46-76,159-185`; step-through is the default for manual runs (`SimulationProvider.tsx:87`) |
| Stepper doubles as tab nav per phase | `SimBar.tsx:118-146` → `constants.ts:76-84` |
| Explain drawer: per-phase diagram + accruing decision-criteria table | `SimExplainDrawer.tsx:14-101`, `diagrams.ts:8-`, `criteria.ts:55-76` (weights read from the real archetype registry `criteria.ts:39-51`) |
| Screening wave audit modal (who kept/rejected, score, rationale, fairness note) | `SimDecisionWave.tsx:10-68` fed by the real `/api/decisions/screen-wave` (`SimulationProvider.tsx:476-486`) |
| Candidate-view iframe (self-schedule, offer accept) | `SimOfferFrame.tsx:17-108` — dismissable always; the walk falls back to the API path (`SimulationProvider.tsx:681-684`) |
| Reset ("Clear simulation data") | `SimBar.tsx:166-168` → `/api/sim/reset` → marker-scoped deletes (`app/_lib/sim-store.ts:38-67`); reset awaits the in-flight run first (`SimulationProvider.tsx:657-669`) |

## Does it touch her real data? (her stated fear)

- **Writes:** the run creates a "(SIM)"-marked job, JD, and pipeline entries in the live board (visible on her Pipeline tab while it plays — that's the point). Reset deletes exactly the marker-matched artifacts and their events/offers, nothing else (`sim-store.ts:15,40-63`). Her own requisitions are structurally untouchable by the reset (`DELETE … WHERE job_title LIKE '%(SIM)%'`).
- **Reads:** sourcing and the scripted inbound applicant draw from the **real candidate pool** (`devcase-run.ts:536` `listMatrixProfiles()`, `app/api/sim/inbound/route.ts:19`) — so real (seeded) candidate names appear on screen during the demo. For an internal demo in her own workspace that is defensible; it is what makes it look real.
- **The catch — comms:** the committed screen wave auto-rejects the bottom ~25% of the SIM cohort and **dispatches a real rejection comm per candidate** (`screen-wave.ts:273-287` → `comms-dispatch.ts:194-205` → `comms.ts:37-42`). Keyless dev = a terminal local outbox row (honest dev-inbox contract, `comms.ts:11-17`). But nothing in the sim disables the channel: on a deploy with `COMMS_WEBHOOK_URL` set, her stakeholder demo would relay real rejection messages to real candidates for a job they never applied to (gsim-l1-007). The interview confirmation, offer and onboarding comms ride the same channel (`SimulationProvider.tsx:610`). And Reset does **not** clear the outbox — (SIM) comms accumulate across runs (gsim-l1-008).
- **No AI credits burned:** the whole spine is deterministic/keyless — canned JD (`constants.ts:1-3`), no-LLM drafts (`screen-draft/route.ts:8-9`, `offer-draft/route.ts:8-10`), deterministic group-eval fallback (`group-eval-run.ts:27-29`). Her "don't burn credits" goal holds structurally. ✓

## Reachability (resolved before judging)

Internal user, dev gate on → the workspace and every tab in her binding; the sim is mounted globally in the workspace shell (`Workspace.tsx:124,295-300`), so she reaches it three ways (About link, palette incl. the Czech query "prohlídka", pill). Fixtures: the ČS corpus + seeded pipeline (`uat/env.md`) give the sourcing a real pool. Nothing in her walk is out-of-set. One wrinkle: her two nicest entry points (About link, palette) start the run **without expanding the SimBar panel** — controls, status log and the step-gate "Next" button stay behind the collapsed pill (`SimBar.tsx:17`), and manual runs default to **step mode** (`SimulationProvider.tsx:87`), so a run started from About immediately waits on a "Next" she can't see (folded into gsim-l1-002's L2 check).

## Cognitive walkthrough (in character)

1. **Will I try it?** Yes — the About tab offers the tour right where I'd explain the product to someone (`AboutTab.tsx:39-48`), and the palette finds it under "prohlídka".
2. **Notice the control?** The spotlight + captions carry the show. But if I started from About, the run pauses at each phase waiting for "Next" inside a panel that is still collapsed — first-run me stares at a frozen demo (needs L2 confirmation; gsim-l1-002).
3. **Label ↔ intent?** The stepper's seven phases map exactly to my real tabs — Design→library, Screen→analytics, Offer→decisions (`constants.ts:76-84`). It teaches the app's geography, which is precisely what I want a stakeholder to absorb.
4. **Feedback?** This is the part I respect: every action logs *what happened and to whom* — "Saved as draft · jd-…", "Live · sourced 5 candidates → Accepted", "Screening wave · 2 auto-rejected (with rationale), 4 advanced · early-career protected", "Offer sent · secure link generated" (`SimulationProvider.tsx:393,416,490,581`). No silent success anywhere in the walk. The wave modal shows every decision with its score and rationale (`SimDecisionWave.tsx:30-63`).
5. **Did the result advance my job?** For the "show a stakeholder in two minutes" job — yes, structurally. The explain drawer even builds the decision-criteria table as the pipeline gathers each signal (`criteria.ts:55-76`), which answers the manager question I always get: "what is it actually weighing?"
6. **Do I trust it?** The engine, yes — real endpoints, honest halts (`waitEntry` throws a labelled timeout instead of walking on, `SimulationProvider.tsx:215-227`), a group-eval that says "couldn't be generated in time" instead of showing a blank (`:299-310`). The canned screening draft ("Strong fit — core skills present, seniority aligned", `screen-draft/route.ts:20`) is exactly the interchangeable filler I roll my eyes at — but it's a keyless demo stand-in, scope-noted, and the *offer* number at least states its basis ("role-band midpoint", `offer-draft/route.ts:31`).

## Scored acceptance criteria (applied identically every run)

| Criterion | Verdict |
|---|---|
| completion — reach the goal without a dead-end | **pass (structural)** — the walk completes with API fallbacks at every click site; step-mode-behind-a-collapsed-panel is the one snag → gsim-l1-002 (L2) |
| senior-quality/trust — reasoning specific to candidate + role | **partial** — wave rationales + group-eval ranking are real and per-candidate; the screening draft is generic boilerplate (keyless scope_note, gsim-l1-009) |
| trust — no hallucinated skills | **pass (structural)** — deterministic matcher only reports matched/missing from stored profiles; nothing invents a competency |
| senior-quality — scores carry drivers | **pass-ish** — wave rows show score + rationale + fit tier; group-eval carries breakdowns (`group-eval-run.ts:80-98`) |
| trust — salary shows a basis | **pass** — "Salary positioned at the role-band midpoint" (`offer-draft/route.ts:31`) |
| clarity — no silent success | **pass** — see walkthrough #4; best-in-app logging discipline |
| time-saved — faster than doing it manually | **pass** — ~35 min prep saved per stakeholder demo |
| language — Czech UI + output | **fail (major)** — the entire sim narration is hardcoded English → gsim-l1-006 |

## Findings (mine — full schema in `guided-simulation.findings.json`)

- **gsim-l1-006 · major** — Zero `next-intl` in `app/features/simulation/` (grep: no matches): every caption, status, modal, diagram and control label plays in English inside my Czech workspace — while my *entry points* to it are localized (`AboutTab.tsx:46`, `CommandPalette.tsx:182-190`) and candidate comms are locale-pinned. The one surface built for showing colleagues speaks the wrong language to them.
- **gsim-l1-007 · major (low reachability today)** — The demo's screen wave really dispatches rejection comms for auto-rejected pool candidates; keyless dev contains it to the local outbox, but that's the environment saving me, not the sim.
- **gsim-l1-008 · minor** — Reset clears the pipeline artifacts but not the outbox — every demo run leaves "(SIM)" rejection/offer/onboarding comms piling up in the comms log.
- Shares: **gsim-l1-002** (collapsed panel hides Next/status — bites my About-tab entry, in step mode, hardest).
- **Strengths:** gsim-l1-010 (real-click spine), gsim-l1-011 (honest failure handling + no silent success — my acceptance criterion, passed at the design level), gsim-l1-012 (marker-scoped reset leaves my requisitions alone), gsim-l1-013 (the explain drawer + accruing criteria table teach the mechanism, sourced from the real registry).

## Character feedback (first person, Petra)

„Konečně nástroj, který mi nepřidal tři povinná pole, ale umí se sám předvést. Když za mnou přijde manažer s ‚a co to teda vlastně dělá?', pustím mu tohle: ono to samo vyplní JD, samo naklikne ‚Source into Pipeline' na skutečném tlačítku, board se přede mnou plní, a u screeningu to ukáže přesně to, na co se manažeři ptají — koho to vyřadilo, s jakým skóre a proč, a že juniory to nikdy nevyřadí samo. Každý krok napíše, co udělal a komu. Žádné ‚a stalo se vůbec něco?'. A když něco nestihne, řekne to na rovinu místo prázdného okna. Reset po sobě uklidí a mých pozic se nedotkne — to jsem si v kódu ověřila dvakrát, protože přesně tohle mi Teamio kdysi rozbilo.

Ale — celé to na mě mluví anglicky. Já mám celý den českou aplikaci, kandidáty česky, poznámky česky, a demo, které má přesvědčit *moje* lidi, jim vypráví ‚Screening · automated wave'. Kateřina anglicky umí, půlka manažerů na pobočkách ne. To není detail, to je půlka smyslu té věci. A druhá věc, ze které mi ztuhl úsměv: ta ukázková vlna posílá skutečné zamítací zprávy kandidátům z našeho poolu — dnes to skončí v lokálním outboxu, fajn, ale nikde v simulaci není pojistka, že to tak zůstane, až se zapojí doručování. Demo, které umí omylem poslat bance jménem zamítnutí na roli ‚(SIM)', bych kolegům nepustila, dokud mi někdo neukáže tu pojistku.

Takže: mechanismus výborný, uklízí po sobě, nešahá mi na data, nespálí kredity. Dejte tomu češtinu a zámek na komunikaci v demo režimu, a používám to každý týden."
