# L2 empirical — helena-buyer × guided-simulation

- **Run:** 2026-07-02-full · live deploy `http://localhost:3009` (dev, keyless entry via `GET /api/demo`, locale en) · cert level: **L2**
- **L1 handoff:** `l1/helena-buyer--guided-simulation.md` (L1-conditional, majors gsim-l1-001/002/003/004/005 carried)
- **Verdict:** **L2-fail** — the keyless entry and the first five phases are live-confirmed real (the L1's core strength holds as far as it ran), but **every auto-play run dies deterministically at the Interview→Offer seam** (new blocker gsim-l2-101): the offer page, the candidate's real Accept click — the journey's crux — and the conversion CTA never happen. The terminal frame a buyer sees is a red developer error. Two more L2-only trust findings surfaced that L1's surface model missed: the demo "hires" with **no offer ever extended** (gsim-l2-102), and the tamper-evident audit chain attributes the engine's actions to **"human:recruiter"** (gsim-l2-103).
- **Time-saved (re-measured):** L1 promised "weeks of vendor vetting → one ~20-min session" (run ~3–5 min). Live: the run plays 5 of 7 phases in 42 s, fails at ~1:15, and never reaches the belief-critical beats — **time saved toward the 'is this real' job: ≈ 0 until gsim-l2-101 is fixed** · confidence **high** (the failure is deterministic, code-traced, not flaky).
- **Grounding (vs L1's 6/9 real):** live-verified real: sourcing over the live pool, the screen-wave engine (visible, per-candidate), the schedule surface, the analytics surface, the real JD save. Not reached: group eval, offer draft, offer accept — including two of L1's "real" beats. The canned stand-ins (screen draft, offer draft) never rendered to the viewer this run. **Live-confirmed: 5/9 · unverifiable while the blocker is open: 3/9.**

---

## 1. The run as it actually played (from sim-run.json + shots 10–22)

| t | Phase | What the evidence shows |
|---|---|---|
| 0:00 | Entry | `GET /api/demo` → **200, keyless** (no cookies beyond locale), lands `/?sim=auto&tab=library&jdTitle=Senior+Java+Backend+Engineer+(SIM)…` — auto-play, no dev flag, no key. gsim-l1-001's dev-deploy half **confirmed live**. |
| 0:04 | Design JD (shot 10) | The real JD builder, genuinely prefilled (title/company/seniority/need); spotlight caption narrates; explain drawer open with the Design diagram and an *empty* criteria table ("Criteria appear here as the pipeline evaluates each candidate"). The SimBar is a **collapsed pill** — the driver had to click "Open the simulation panel" (gsim-l1-002's auto-play half confirmed). |
| 0:07 | Source (shot 12) | Real Jobs tab; the draft is sourced into the pipeline. |
| 0:20 | Intake (shot 13) | Real Channels tab; the scripted applicant arrives. |
| 0:29 | Screen (shots 14, 14-b) | Parks on **Analytics** (a real, data-bearing surface — funnel, ROI panel, sealed decision records). The wave modal renders the **real** engine's output: "9 matched · 0 auto-rejected · 9 advanced", per-candidate scores 64–75 with tiered rationales ("Promising fit early-career — never auto-rejected" / "Strong fit above the bottom cutoff") and the fairness line. Criteria table now shows 6 rows. |
| 0:42 | Interview (shot 15) | Real Schedule tab; caption "Automating the interview round — Vít Malý self-schedules". Criteria table now 7 rows (Interview scorecard appeared) — the accruing-drawer strength **confirmed live** (gsim-l1-013). |
| ~1:15 | **FAILED** (shot 20) | Bar status: **"Failed: Could not advance entry m-cand-007-jd-dhbye8rf to 'Offer' within 4 steps (stalled at 'Hired')."** Stepper stuck on "5 Interview"; phases 6 Offer / 7 Hired never highlight; the button reverts to "Start simulation". The script then waited out its full 8-minute budget: `done:false`, `getStartedHref:null` — the conversion CTA **never rendered**. |
| after | Residue (shots 21, 22) | The board shows the (SIM) job with 9 real-pool candidates and **"1 candidate hired this week — Vít Malý"** — the pipeline data says the candidate was hired even though the sim says it failed and no offer ever existed (see gsim-l2-102). |

### Root cause (code-traced — this is deterministic, not flaky)

1. The screen step advances the survivor to Interview (`SimulationProvider.tsx:493`), **then** attaches the canned screening draft (`:494` → `sim/screen-draft/route.ts:24` sets `screening_review` regardless of stage), **then** accepts it (`:495`). Accepting a `screening_review` **advances a stage and sets a calendar gate** (`app/_lib/db/pipeline.ts:1322-1331`, default slot "Tue 14:00") — so the survivor lands at **Offer**, one stage past where the engine believes it is. (Live confirmation: the calendar shows SIM Vít Malý at exactly "Tue 14:00", pipeline.ts:1330's hardcoded default; the activity log shows "advanced to Offer" *before* the schedule events.)
2. The interview step then "self-schedules" a candidate already at Offer (the schedule machinery tolerates this — records the slot without regressing the stage, `pipeline.ts:1304-1309`), and closes with `advanceTo(targetId, "Offer")` (`SimulationProvider.tsx:547`).
3. `advanceTo` bare-accepts an entry **already at Offer** with no `offer_review` approval → the generic accept path advances **Offer → Hired** (`pipeline.ts:1332-1340`), skipping the extend-offer human gate entirely; the next three accepts no-op at Hired; the loop never observes "Offer" and throws (`SimulationProvider.tsx:268`).

So the pipeline "succeeds" (a phantom hire) while the demo announces failure — and the two beats the journey exists to prove (the real `/offer/[token]` page, the candidate's real Accept click) never execute.

---

## 2. L1 handoff — l2_priority answers

| L1 item | L2 answer |
|---|---|
| **gsim-l1-001** — confirm the chain live and keyless on dev | **Confirmed**: 200 → `/?sim=auto` → auto-play, zero credentials. Prod darkness unchanged (code: `devAuth.ts:28`, `demo/route.ts:32-34`) — reachability there still requires launch work, not a code fix. |
| **gsim-l1-002** — auto-play to done without touching the pill: is the CTA visible? / About-tab step-mode stall | Auto-play half **confirmed**: the pill stays collapsed on entry (shot 10; the driver had to click it). The done-CTA question is **moot while gsim-l2-101 is open** — there is no done state to hide. About-tab step-mode entry was **not driven** (re-running the sim mutates the DB; prohibited this pass) — the code finding stands as-is. |
| **gsim-l1-003** — click the done CTA: where do you land? | **Unreachable live** — the CTA never rendered (`getStartedHref:null`). Code target unchanged: `/login` (`SimBar.tsx:52`). Confirmed on code; its live impact is currently *behind* the blocker. |
| **gsim-l1-005** — does any Art. 22 / HITL / GDPR string render? | **Confirmed absent, live.** The most compliance-adjacent copy captured anywhere in the run: wave modal "Early-career candidates are never auto-rejected — the fairness gate holds, and every auto-decision carries a rationale" and the diagram labels "AUTO-DECISION (CONFIGURABLE)" / "Reject bottom X% < Y% match · audited" (shot 14-b). The words "Article 22", "human-in-the-loop", "GDPR" appear in no captured frame. |
| **gsim-l1-009** — where do the canned drafts render; anything distinguishing them from AI output? | **Effectively invisible in auto-play**: the screen draft was created and auto-consumed in ~1 s (Decisions badge blips 15→16→15 across shots 14-b/15); the offer draft was never reached. Viewer-visible sim labeling confirmed: "(SIM)" title suffix and the "Pipeline simulation" pill. Finding re-scoped to low reachability. |
| **gsim-l1-010** — the belief crux: does the offer step truly open `/offer/[token]` and click Accept? | **NOT confirmed** — the run dies first, every time. The strength stands live for phases 1–5 (real form, real publish, real wave, real schedule surface); the crown-jewel beat is unverifiable until gsim-l2-101 is fixed. |
| Real latency vs demo pacing | Phases 1–5 in 4.3 / 7.4 / 19.6 / 28.7 / 42.0 s — lively, no stalls. The failure is not a timeout; it's a thrown engine error. |
| No data leak | **Refuted in the other direction**: the keyless session reads the full seeded tenant (see EB-H1-04 in the evaluate-and-buy L2 report), and the sim itself parades real seeded candidates' names through a public keyless demo. |
| Bilingual / rendering | English run only (buyer locale) — clean. Spotlight, drawer, wave modal, stepper all render properly in Studio Light. Czech + Spark Dark not exercised this pass (Czech: see Petra's report; the code finding gsim-l1-006 stands). |

## 3. Scored acceptance criteria (hers)

| Criterion | L2 verdict |
|---|---|
| completion/trust — keyless e2e, no break | **FAIL (blocker)** — keyless yes; e2e no; breaks deterministically (gsim-l2-101) |
| trust/senior-quality — real reasoning | **Partial pass** — the wave's per-candidate output is real and visible; group-eval never ran; canned layers invisible this run |
| missing — compliance story in the demo | **FAIL (major, confirmed live)** — mechanisms shown, never named (gsim-l1-005) |
| time-saved — ROI math in the run | **FAIL (major, refined)** — the climax is now an *error*, not even the numberless "🎉"; note the Screen beat does park on Analytics where a live ROI panel renders (L1's "no number anywhere" was too strong) — but the sim never narrates it, and the number it shows (5%) undercuts the marketing claim (see EB-L2-12) |
| effort — fits a 20-min session | **Pass on pacing** (42 s to phase 5), **fail on outcome** — the session ends on an error |

## 4. Findings

Full schema in `guided-simulation.l2-findings.json`. Impact-ranked headline:

1. **gsim-l2-101 · blocker · NEW (L2-only)** — every auto-play run dies at the Interview→Offer seam; phases 6–7 + the CTA never play. Deterministic double-advance, code-traced. *This was invisible to L1 because the surface model read each step's endpoints but never composed the stage arithmetic across `screen-draft` → `screening_review` accept → `advanceTo` — a genuine surface-model gap worth recording.*
2. **gsim-l2-102 · major · NEW** — the demo produces a **hire with no offer**: bare accept at Offer bypasses the extend-offer gate (`pipeline.ts:1332-1340`), directly contradicting the product's own rule ("Hired is set when the candidate accepts an offer", enforced only for `set_stage`, `app/api/pipeline/[id]/route.ts:97-107`) and the /about story ("a person extends it, and the candidate accepts"). A product API gap, not just a sim bug.
3. **gsim-l2-103 · major · NEW** — the tamper-evident audit chain seals the engine's advances as **"advanced · human:recruiter · 'Recruiter accept from Accepted'"** (9 records, shot 14-b), and the Analytics decision log renders rows labeled **HUMAN** whose own text says **"Auto-advanced"**. For the buyer whose pitch is "provable, not promised", the audit misattributing *who acted* is the sharpest trust cut of the run. (`route.ts:249-259` defaults every API accept to `human:recruiter`; the sim's honest `approvedBy: "Guided demo (auto-approved)"` label exists at `SimulationProvider.tsx:484` but never surfaces.)
4. **gsim-l1-005 · major · confirmed live** — compliance machinery runs, is never named.
5. **gsim-l1-004 · major · confirmed (refined)** — no ROI narration; climax is an error.
6. **gsim-l1-001 · major · confirmed** — prod entry dark (dev chain live-verified keyless).
7. **gsim-l1-002 · major · confirmed (auto-play half)** — collapsed pill never auto-expands; done-half moot behind 101; About/step-mode half not driven.
8. **gsim-l1-003 · major · confirmed on code** — CTA → `/login`; currently unreachable live (behind 101).
9. **gsim-l2-104 · minor · NEW** — the failure copy is developer-voiced ("entry m-cand-007-jd-dhbye8rf… within 4 steps") in the viewer-facing bar; honest halt, wrong audience.
10. **gsim-l1-009 · minor · re-scoped** — canned drafts effectively invisible in auto-play; disclosure gap stands in code.
11. **gsim-l1-007 / gsim-l1-008 · unchanged** — not exercised live (this run auto-rejected 0 candidates, so no rejection comms fired; no Reset was driven). Code evidence stands.

**Strengths (live):** gsim-l1-011 **confirmed** — the engine halted with a labelled error instead of faking success, exactly as designed (the *content* of the label is gsim-l2-104); gsim-l1-013 **confirmed** — the explain drawer's diagrams render per phase and the criteria table demonstrably accrues (0 → 6 → 7 rows across shots 10/14-b/20); gsim-l1-010 **holds for phases 1–5** (real surfaces, real data, real engine output); gsim-l1-012 marker-scoping visible everywhere ("(SIM)" on every artifact), reset untested.

## 5. Helena's feedback (first person, over the live run)

"For sixty seconds this was the demo I've asked four vendors for and never gotten. No key, no login, and it wasn't a video: a real form filled itself in front of me, a real board took nine real candidates, and the screening wave showed me every score with the fairness rule applied — 'early-career, never auto-rejected' — per candidate, not as a slogan. The little 'how it works' panel building up its criteria table as the pipeline learned each signal is the single best explainability device I've seen in this category.

Then, at the interview step, the bar went red: 'Could not advance entry m-cand-007 to Offer, stalled at Hired.' That sentence wasn't written for me, and the two things I most needed to see — the candidate's own offer page and their real click on Accept — never happened. And when I looked closer it got worse, not better: your pipeline now says you *hired* that candidate this week, with no offer ever made — while your sealed audit chain says a *human recruiter* advanced those nine candidates. Nobody did. I watched. A demo can crash and I'll forgive it once; an audit trail that misattributes machine actions to humans is the one thing a bank buyer cannot wave through, because that trail is the thing I'd be citing to my regulator.

So: the engine is real — you've proven that to me five phases deep, and I don't say that lightly. But today the run ends in an error, the finale is unproven, the ending has no number and no Article 22, and the button I'd click has nowhere to go. Fix the crash, make the audit tell the truth about who acted, name the compliance story out loud at the screen step, and put the run's own numbers on the ending. That demo sells itself. This one, today, un-sells itself at minute one-fifteen."

## 6. Appendix — evidence & adversarial notes

- Evidence: `shots/l2-helena-10..15` (pngs; 14-b with aria), `shots/l2-helena-20-sim-done` (+aria), `21-sim-pipeline` (+aria), `22-sim-billing` (+aria), `shots/l2-helena-sim-run.json`, `shots/sim-run.mjs`.
- Adversarial pass on gsim-l2-101: not residue (the entry id ties to this run's JD `jd-dhbye8rf`; sealed records timestamped 14:22 today), not latency (thrown error, not timeout), not a one-off (the double-advance is unconditional in code: `SimulationProvider.tsx:493-495` + `pipeline.ts:1322-1331` compose to a fixed off-by-one every run). Considered and rejected: a concurrent second run (single auto-start guard fired once; one JD, one coherent event trail).
- Adversarial on gsim-l2-103: in a real workspace a recruiter's accept *is* human — the misattribution is specific to programmatic callers (the sim posts plain accepts, `SimulationProvider.tsx:247-252`, and the route hardcodes `actor: "human:recruiter"` for every accept seal, `route.ts:252-254`; `actOnPipelineEntry` only records `auto_*` when passed `actor:"system"`, `pipeline.ts:1292` — nothing passes it here).
- Not covered: step-mode/About entry, Reset, Czech locale, Spark Dark, the done-state CTA — all blocked or out of this pass's mutation budget; each is named in the findings it affects.
