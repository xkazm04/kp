# L2 empirical — petra-recruiter × guided-simulation

- **Run:** 2026-07-02-full · same live evidence as Helena's L2 run (`shots/l2-helena-10..22`, `l2-helena-sim-run.json`) judged through Petra's lens: *"does this demo my tool to a stakeholder in two minutes, in Czech, without touching my data or my credibility?"* Her own entry points (About-tab tour link, palette, step mode) were **not re-driven** — the sim mutates the DB and re-running was prohibited; where her path differs from the auto-play evidence, that's stated per item.
- **L1 handoff:** `l1/petra-recruiter--guided-simulation.md` (L1-conditional; majors gsim-l1-006 language, gsim-l1-007 comms; shared gsim-l1-002)
- **Verdict:** **L2-fail** — the show she'd put in front of a manager **dies on a red developer error at ~1:15** (gsim-l2-101, deterministic — her step-mode run walks the identical engine path), the narration that *does* play is hardcoded English inside her Czech workspace (gsim-l1-006 confirmed), and the run leaves a **phantom hire in the live stats her lead reads** (gsim-l2-105) plus an audit log that says a *human* did things the engine did (gsim-l2-103 — her "what happened and to whom" criterion, broken at the provenance level).
- **Time-saved (re-measured):** L1 estimated ~35 min of demo prep saved per stakeholder show. Live: **≤ 0 today** — a guaranteed mid-show crash, followed by manual cleanup (Reset) and an explanation of why the board now claims a hire that never happened. She would not run this in front of Kateřina or a line manager until 101 is fixed. Confidence **high** (failure is deterministic).
- **Grounding:** unchanged from the shared audit — live-confirmed 5/9 real beats; the three she'd most want a manager to see land (group-eval comparison, offer, accept) never ran.

---

## 1. Her walkthrough of the same evidence

**What holds up (and she'd say so).** The run performs real clicks on her real app: the JD builder genuinely prefilled (shot 10), the Jobs tab genuinely sourcing, the wave modal showing *every* decision with a score and a per-candidate rationale — "Kept · Gabriela Černá · 64 · Promising fit early-career — never auto-rejected" (shot 14-b) — which is precisely the "koho to vyřadilo a proč" answer her managers ask for. The explain drawer builds its criteria table as the pipeline gathers signals (0 → 6 → 7 rows across shots 10/14-b/20) — live confirmation of gsim-l1-013, her favorite artifact. Logging discipline held: every phase caption named what was happening to whom, and when the engine failed it *said so* instead of walking on (gsim-l1-011 confirmed — no "a stalo se vůbec něco?" moment anywhere).

**What kills the show.**
1. **The crash (gsim-l2-101).** At the interview step the bar prints "Failed: Could not advance entry m-cand-007-jd-dhbye8rf to 'Offer' within 4 steps (stalled at 'Hired')" (shot 20). Her step-mode About-tab entry runs the *same* `run()` engine (`SimulationProvider.tsx:351-627`) — step mode only gates between steps — so her show dies at the same seam, deterministically, with a stakeholder watching. And because her entry starts with the panel collapsed **in step mode** (gsim-l1-002, not driven live but unchanged in code: `SimBar.tsx:17`, `SimulationProvider.tsx:87`), her demo would first *freeze* waiting on a hidden "Next", then crash.
2. **English narration (gsim-l1-006, confirmed).** Every string that played is hardcoded English — "Screening · automated wave", "Pipeline simulation", "Start simulation", the failure text, the wave modal, "How it works / Decision criteria" (shots 14-b/20/22; re-grep this pass: zero `next-intl`/`useTranslations` matches in `app/features/simulation/` — all files). Her cs-locale run wasn't driven, but there is no catalog for the strings to come from: the leak is structural. Half the point of the tool — showing *her* Czech-speaking managers — doesn't exist.
3. **Residue in the stats her boss reads (gsim-l2-105, NEW).** The failed run leaves the (SIM) job with 9 entries on her live board and — because of the phantom-hire bug (gsim-l2-102) — the Pipeline digest now announces **"1 candidate hired this week — Vít Malý"** (shot 21 aria:76) and Analytics counts the (SIM) job among real roles, in the funnel, the forecast and the ROI panel (shot 14-b). Nothing filters the `(SIM)` marker anywhere outside the reset (`grep SIM_MARKER` → only `constants.ts` + `sim-store.ts`), and a failed run never prompts cleanup. Until someone hits Reset, Kateřina's weekly numbers include a fake hire.
4. **Provenance mislabeled (gsim-l2-103, NEW, shared with Helena).** Her acceptance criterion is "after every action I see what happened and to whom". The decision log shows rows labeled **HUMAN** whose text reads **"Auto-advanced"**, and the sealed records credit "human:recruiter — Recruiter accept from Accepted" for advances the demo engine made via API (shot 14-b aria; `app/api/pipeline/[id]/route.ts:249-259`). If she can't trust the actor column during a demo, she stops trusting it on real candidates too — that's exactly how she lost faith in Teamio.

**What she checked and found honest.** No AI credits burned (deterministic spine held — no LLM call anywhere in the run). Her real requisitions untouched: the sim wrote only `(SIM)`-marked artifacts (visible on every surface it touched) and the reset remains marker-scoped in code (`sim-store.ts:38-67`) — though Reset itself wasn't driven this pass. The comms risk (gsim-l1-007) did **not** fire live — this run auto-rejected 0 candidates (the fairness gate protected the low scorers), so no rejection comms were dispatched; the missing sandbox is unchanged in code and stays open, as does the outbox-residue finding (gsim-l1-008, unmeasured).

## 2. Her scored criteria, re-scored live

| Criterion | L2 verdict |
|---|---|
| completion — no dead-end | **FAIL** — the run dead-ends in an error before Offer (gsim-l2-101) |
| senior-quality/trust — reasoning specific to candidate + role | **Partial pass** — wave rationales are real, per-candidate, tiered (shot 14-b); but they're score/archetype templates, not CV-fact citations; group-eval (the reasoning showcase) never ran |
| trust — no hallucinated skills | **Pass (as far as it ran)** — nothing invented; deterministic matcher output only |
| senior-quality — scores carry drivers | **Pass-ish** — wave rows show score + tier + fairness rationale; the richer breakdowns live in beats that never played |
| trust — salary shows a basis | **Not reached** — the offer draft (band-midpoint basis) never rendered |
| clarity — no silent success | **Split** — logging is exemplary and the failure was labelled (gsim-l1-011), **but** the provenance layer misattributes actors (gsim-l2-103): the log says *something happened that didn't* (a human decision) |
| time-saved — faster than manual | **FAIL** — a crashing demo costs more than it saves (see re-measure above) |
| language — Czech UI + output | **FAIL (confirmed)** — narration hardcoded English (gsim-l1-006) |

## 3. Findings (her slice — full schema in `guided-simulation.l2-findings.json`)

- **gsim-l2-101 · blocker** — her stakeholder show crashes deterministically mid-run (shared; hits her step-mode entry identically).
- **gsim-l1-006 · major · confirmed** — English-only narration; zero i18n in the sim feature while her entry points are localized.
- **gsim-l2-103 · major · NEW** — HUMAN/auto provenance contradiction in the decision log + sealed records.
- **gsim-l2-105 · minor · NEW** — (SIM) artifacts pollute live stats (a phantom "hired this week", funnel/forecast/ROI) until a manual Reset; no `(SIM)` exclusion exists anywhere in analytics; a failed run never prompts cleanup.
- **gsim-l1-002 · major · confirmed (code)** — collapsed panel + step-mode default still means her About-tab demo freezes on a hidden "Next" (not driven live this pass).
- **gsim-l1-007 · major (low reachability) / gsim-l1-008 · minor** — unchanged; not exercised live (0 auto-rejections this run; no Reset driven).
- **Strengths confirmed live:** gsim-l1-011 (labelled halt, no silent success in the walk), gsim-l1-013 (drawer + accruing criteria table — her best stakeholder artifact), gsim-l1-010 (phases 1–5 genuinely real on her real tabs), marker-scoping visible everywhere (gsim-l1-012, reset untested).

## 4. Petra's feedback (first person, over the live run)

„Pustila jsem si záznam toho, co by viděl můj manažer, a jsem rozpolcená víc než po L1.

Co funguje: ono to fakt kliká po skutečné aplikaci. Skutečný formulář, skutečný board, a ta vlna u screeningu ukáže přesně to, na co se manažeři ptají — každého kandidáta, skóre, důvod, a že juniory to samo nevyřadí. Tabulka kritérií, která se plní podle toho, co pipeline zrovna váží, je nejlepší vysvětlovací pomůcka, jakou v aplikaci máme. A když to spadlo, napsalo to, že to spadlo — žádné tiché nic.

Jenže ono to spadlo. Pokaždé, deterministicky, v půlce — červený řádek s ID entity, kterému nerozumí ani půlka IT. To před manažera nedám. A po pádu mi na boardu zůstane vymyšlený nástup — ‚1 candidate hired this week' — kterého si Kateřina všimne dřív, než stihnu Reset, protože žádný filtr na (SIM) v analytice není. Nabídka přitom nikdy neexistovala: systém povýšil kandidáta na Hired bez nabídky, což je přesně ten zkrat, který jinde sám hlídá. A úplně nejhorší: v auditním logu je devět záznamů ‚HUMAN — Recruiter accept', které neudělal žádný člověk. Já ten log používám, když se manažer ptá, kdo co rozhodl. Jestli lže v demu, proč bych mu věřila jinde?

A pořád na mě — a na moje lidi — mluví anglicky, zatímco odkaz, kterým to spouštím, česky umí.

Takže dnes: nepustím. Spravte pád, dejte demu češtinu, ať po sobě neúspěšný běh uklidí nebo aspoň řekne ‚resetni mě', a ať audit píše pravdu o tom, kdo klikl. Pak je to nejlepší předváděcí nástroj, jaký jsem v ATS světě viděla — a to říkám jako člověk, kterému dvě migrace slibovaly totéž."
