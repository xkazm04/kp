# UAT Synthesis — run 2026-07-02-full

Cross-Character synthesis over 10 Characters · 14 journeys · 28 L1 pairs · 6 L2 journeys (13 character-passes) · a 7-concept reconciliation sweep · 3 targeted probes. 301 findings → 238 unique. Ship bar: **"public product path."**

The one-line verdict: **the machinery is real and its honesty is genuine, but the product is not yet a product a stranger can buy, a candidate can hear from, or a bank can put a second tenant on.** All three known top blockers were found live.

---

## (a) Cross-cutting themes (deduped)

1. **The buyer path is dark — built, not launched.** The Spark landing, the four compliance pillars, the reconciled pricing all render beautifully — but only because the dev deploy keeps the gate off. On production config `/` is an operator password wall, `/landing` redirects into it, and **every** conversion CTA ("Talk to sales", "Start free", the post-demo button) dead-ends at a single-operator password form. There is no signup, no trial, no contact capture, and workspace creation is locked. The evaluation story is excellent; there is nothing behind it to become a customer. (EB-H1-01/02/03/06, gsim-l1-003)

2. **The flagship demo un-sells itself — it crashes deterministically at minute ~1:15.** Every keyless auto-play run dies at the Interview→Offer seam (a composed off-by-one: a `screening_review` accept double-advances the survivor to Offer, then a bare accept skips the extend-offer gate). Phases 6–7, the offer page, the candidate's real Accept, and the conversion CTA never play; the buyer's terminal frame is a red developer error. The five phases that *do* run are the best demo the buyer says she's seen — which makes the crash the sharpest wound in the run. (gsim-l2-101, plus gsim-l2-102 phantom hire)

3. **Comms are simulated end-to-end — "sent" is a lie by default.** The channel layer defines `queued` as terminal ("nothing dequeues it"); no relay without `COMMS_WEBHOOK_URL`; recipients are display *names*, not addresses. Live: 12/12 outbox rows queued, zero sent — while 8 surface families say "sent/emailed/odesláno". Candidates get no delivered acknowledgement, no delivered status link, and the GDPR erasure link inside those undelivered emails is itself a dead relative path. One surface (Comms Center) tells the truth in Czech — the reference the other eight should copy. (REC-10, capst-l1-001/002, capst-l2-102, OO-L1-01)

4. **Tenancy is mostly global — 2 of 53 tables scoped.** Only `analyses` + `profiles` are workspace-scoped; `decision_records`, `offers`, `group_evals`, `interview_sessions`, `onboarding_*`, `consent_events`, `dev_outbox` have no workspace column at all; the command palette's `searchEntities` even leaks the two scoped tables through unfiltered raw SQL. The `/api/decisions/*` routes carry no in-route auth (unlike `/api/automation`) — an unauthenticated GET returned all 26 sealed records with real candidate names. The manifest admits it and fail-closes multi-workspace boot; the honesty is real, the readiness is not. (REC-09, SD-L1-010, EB-H1-04)

5. **"Match score" has three divergent producers — and the one that acts is the one you can't see.** A stored entry score renders on the board/drawer/offer-approval header; a *fresh* recompute prices the salary and is quoted in the rationale; the CV-analysis score shows in the timeline. Live, every Offer/Hired row disagrees (Anna 57 board / 49 rationale / 70 analysis) and the offer is priced off the number the header never shows. Meanwhile calibration measures a *fourth* pairing (`analyses.score × disposition`) that nothing in the pipeline writes — so the dial reads "not yet calibrated" forever while the acting scores carry no error bar. (REC-01/02, OO-L2-10)

6. **Sealed audit records omit, misattribute, and fabricate — the one thing a bank can't wave through.** A never-scored candidate is auto-rejected on a fabricated "match 0" that is then *permanently sealed* into the immutable chain ("shoda 0 < práh 45", a measurement never taken). The sealed record of a human decision omits the AI recommendation it ratified. The demo engine's advances are sealed as "human:recruiter". Command-bar rejects notify the candidate but write zero decision records while the identical board action seals. The tamper-evident chain is genuinely strong — which is exactly why what it records being wrong matters most. (SD-L1-002/004, REC-03, gsim-l2-103, pa-l2-command-mutations-unsealed)

7. **AI narratives speak English inside a Czech workspace; the offer letter is below the senior bar.** Sim narration, screening rationale, analyze decision-strings, group-eval prose, the whole dev studio, and — most damagingly — candidate letters (60/65 entries locale-NULL→en) render in English to Czech candidates under the bank's name. The offer letter itself carries no deadline (in a 24-hour offer), no start date, no benefits, no named human, and a masculine greeting to a woman. The i18n plumbing exists and is simply not threaded to these surfaces. (gsim-l1-006, OO-L1-03/04, pa-l2-null-locale, SD-L1-009, PET-CVJF-02, GEF-L1-01, dch-l1-003)

8. **Silent success on the money click; phantom hires downstream.** "Send offer" returns the minted link on the wire and the UI discards it — the card just fades. `advance top N` turns an Offer-stage candidate with a drafted offer into a Hired employee with zero offer rows, zero comms, zero seal, and the Today rail celebrates the phantom by name. The board's honest guardrails (CAS moves, 422-protected Hired) coexist with command-bar shortcuts that bypass all of them. (OO-L1-02, pa-advance-top-bypasses-offer-flow, gsim-l2-102)

9. **The candidate is pre-judged in their own browser.** The voice-interview `/connect` returns the recruiter's private assessment — red-flags marked "never say aloud", "missing must-have", "aspiration mismatch" — into the candidate's browser, readable in the Network tab. (TP-L2-VOICE-01)

---

## (b) Impact-ranked backlog (frequency × reachability × trust_erosion, not raw severity)

| # | id | sev | journey | one-line |
|---|----|-----|---------|----------|
| 1 | EB-H1-01 | blocker | evaluate-and-buy | Public path unlaunched — prod `/` is an operator password wall; landing served at no prod URL |
| 2 | EB-H1-02 | blocker | evaluate-and-buy | No marketing→pilot path — every CTA dead-ends at the operator password |
| 3 | gsim-l2-101 | blocker | guided-simulation | The demo crashes deterministically at Interview→Offer; climax + CTA never play |
| 4 | REC-10 | major | reconciliation | `queued` is terminal; 12/12 outbox unsent while 8 surfaces claim "sent" |
| 5 | capst-l1-001 | major | candidate-apply-status | Candidate comms never delivered; status "watch your email" points at a void |
| 6 | capst-l1-002 | major | candidate-apply-status | Quick-apply gives no status link + a false "we emailed you" (both locales) |
| 7 | pa-l2-null-locale-english-letters | major | pipeline-advance | 60/65 entries locale-NULL → Czech candidates get English letters under the bank's name |
| 8 | REC-01 / OO-L2-10 | major | reconciliation / offer | Three divergent match scores on one card; offer priced off the hidden one |
| 9 | SD-L1-002 / REC-03 | major | screening-decisions | Never-scored candidate auto-rejected on a fabricated "match 0" — sealed permanently |
| 10 | SD-L1-003 | major | screening-decisions | Auto-reject email: no automated-decision disclosure, no contest route (Art. 22) |
| 11 | EB-H1-04 / REC-11 | major | evaluate-and-buy | Anonymous demo reads 53 real candidates; (SIM) hire pollutes live analytics |
| 12 | REC-09 | major | reconciliation | 53 tables → 2 scoped / 46 global gaps; decision/offer/PII tables tenant-blind |
| 13 | pa-advance-top-bypasses-offer-flow | major | pipeline-advance | `advance top N` mints a phantom hire, destroys the drafted offer, seals nothing |
| 14 | OO-L1-02 | major | offer-onboarding | "Send offer" silent success — server returns the link, UI discards it |
| 15 | gsim-l2-103 | major | guided-simulation | Audit seals the engine's advances as "human:recruiter" |
| 16 | OO-L1-04 | major | offer-onboarding | Offer letter below the senior bar — no deadline/start/benefits; gender slip |
| 17 | capst-l2-102 | major | candidate-apply-status | GDPR erasure link in every candidate email is a dead relative path |
| 18 | TP-L2-VOICE-01 | major | voice-interview | Recruiter's private candidate assessment leaks to the candidate's browser via /connect |
| 19 | SD-L1-004 | major | screening-decisions | Sealed human-decision record omits the AI recommendation it ratified |
| 20 | REC-02 | major | analytics-calibration | Calibration measures a score that never acts; live n=0 with 6 hires on disk |

Runners-up (impact 4–5, confirmed): gsim-l1-005 (compliance never named in demo), gsim-l1-006 (sim English-only), pa-no-batch-undo-at-point-of-fire (no UI undo for human bulk rejects), SD-L1-001 (one-click card reject, silent, no undo), REC-04/OO-L2-11 (TodayRail claims offers-out from stage alone), dch-l1-001/002 (paste-tell dead; eval never reads the work), REC-06 (salary loses its period at the money moment).

---

## (c) Value ledger — what the product PROMISES vs what's LIVE

Rolled up across journeys. "Promise" = the design's upside if every seam worked; "Live" = what a Character actually banked this run.

| Journey | Promise (time-saved) | Grounding | Live reality |
|---------|----------------------|-----------|--------------|
| evaluate-and-buy | ~2–3 wk vetting → ~22 min decision | 6/11 | **decision reachable on dev only; pilot unreachable, demo crashes** |
| guided-simulation | weeks vetting / ~35 min demo-prep → 20 min | 6/9 | **≈0** — deterministic mid-run crash; ≤0 for Petra (cleanup + phantom hire) |
| offer-onboarding | ~40 min/offer (recruiter) · ~15 min (mgr) · ~30 min (candidate) | 4/8 | ~25–35 min recruiter / ~15 min mgr live; **candidate ≈0** (nothing delivered) |
| candidate-apply-status | 20–30 min portal → 2–3 min | 9/11 | **~20–28 min live on the chat path** (the run's best-realized value); quick path = a black hole |
| pipeline-advance | ~8–10 min/touch; ~35 min/wave | 5/8 | ~6–8 min/touch live; **wave ≈0 for Czech cohorts** (English letters) |
| screening-decisions | ~90–120 min/wave; ~4–6 h/audit | 4/6 · 3/6 | ~2 h/wave; ~4–6 h/audit live — **conditioned on 3 findings Lucie won't sign** |
| jd-to-shortlist · cv-analysis · group-eval · schedule-prep · voice · sourcing · analytics · dev-case | 30 min – 8 h each | 3–7/10 | **L1 only** — structurally sound, majors carried; not live-confirmed |

**Headline:** the design promises **hours-to-days saved per journey at 3–9/11 grounding**; **live, the only journey banking its full promised value is candidate-apply-status via the conversational path (~20–28 min/application at 9/11 grounding)**. Every other driven journey is **conditional or fails** on delivery, tenancy, locale, or the demo crash — the value is built, the last mile is not connected. Grounding is honest and often high (candidate 9/11, group-eval 7/10, cv-analysis 6/9); the gaps are delivery/provenance, not thin context.

---

## (d) Strengths worth protecting (say what NOT to touch)

- **Honesty as an architectural stance.** The Comms Center's red "these messages are NOT sent" banner, the billing "isn't configured — purchases disabled" state, disclosed degradation on analyze, the (SIM) markers, the "not a legal certification" footnote. The build repeatedly names its own seams — and every Character trusted it *more* for it.
- **The Article 22 machinery is real, not decorative.** Server-enforced human-approval token gate that held under adversarial probing (409/409/200, zero mutation), fail-closed fairness shield, a tamper-evident chain that re-verifies after every commit and seals its own reversals, one-click bilingual dossier. A DPO said she'd put it in front of a regulator.
- **The conversational candidate experience.** Grounded apply, CV pre-fill as editable defaults, a no-ghosting status timeline that moves live, a real self-service erasure page. Two candidate Characters called it the best bank apply flow they've used.
- **Board + offer guardrails.** CAS-guarded moves that survive refresh, the unified drawer timeline, the per-offer deadline lever (verified live with distinct 24h/120h countdowns), Hired protected as a 422-refused terminal.
- **CV-analysis integrity + salary basis.** The prior hallucinated-skill seam is source-gated; the score dial is pinned to its component sum; salary carries a basis end to end.

---

## (e) Honest ceilings (what it still can't do, even where a fix "landed")

- The per-offer **deadline lever works** — but the offer it stamps still can't be *delivered* (outbox-terminal) and the letter it deadlines omits the deadline in its own body.
- The **status timeline is excellent** — but its durable copy lives only in an email that never leaves, so a candidate who closes the tab loses it.
- The **decision chain is tamper-evident** — but it seals fabricated 0-scores, omits the ratified AI, and misattributes engine actions to humans; and it's one global chain, unauthenticated at the route.
- **Grounding is high on paper** (9/11, 7/10) — but the numbers reaching the prompt still aren't reconciled to each other across surfaces, so a well-grounded output can still contradict the card beside it.
- The **demo spine is genuinely keyless and real** for five phases — but has never once been observed reaching its climax; the belief-critical beats are unverified.
- **Tenancy fail-closes multi-workspace boot** — an honest guard, but it means the multi-tenant product cannot ship until 46 tables are scoped, not merely flagged.

---

## (f) Panel verdict — the shared sentiment across all 10 voices

**Adopt? Not yet — but with unusually specific, unusually reachable conditions, and with real enthusiasm underneath.** Across every Character the pattern is identical: *the engine keeps earning trust each time I inspect it; the last mile un-earns it.* Recruiters and managers would adopt the board, drawer, and offer-approve **today** but won't let the command bar or a Czech-candidate wave near production. Candidates rate the flow the best they've used but can't receive a word from it. The compliance officer would certify "with named conditions" — higher praise than she usually gives AI hiring — once the fabricated score, the missing disclosure, and the open route are closed. The buyer takes it to her board **the day** the demo stops crashing, the demo stops reading real PII, the front door launches, and one button has somewhere to go. Nobody rejected the product; everybody rejected shipping it as-is. The gap between the two is a short, concrete punch-list, not a rethink.

**Sharpest Character felt-verdicts:**

- **Helena (buyer), evaluate-and-buy — L2-FAIL:** *"For sixty seconds this was the demo I've asked four vendors for and never gotten… Then it died… an audit trail that misattributes machine actions to humans is the one thing a bank buyer cannot wave through, because that trail is the thing I'd be citing to my regulator… The day those four things are true, I take this to the board — and I don't say that twice a year."*

- **Petra (recruiter), guided-simulation — L2-FAIL:** *„To před manažera nedám… v auditním logu je devět záznamů ‚HUMAN — Recruiter accept', které neudělal žádný člověk. Já ten log používám, když se manažer ptá, kdo co rozhodl. Jestli lže v demu, proč bych mu věřila jinde?"* (I can't put this in front of a manager. The audit log shows nine "HUMAN — Recruiter accept" records no human made. I use that log when a manager asks who decided what. If it lies in the demo, why would I trust it elsewhere?)

- **Lucie (DPO), screening-decisions — L2-conditional:** *„Vytvořila jsem kandidáta bez skóre a dívala se, jak ho vlna vyhodí jako ‚match 0'… Naměření, které nikdy neproběhlo, zapsané jako fakt… Opravte ty tři věci a zavřete tu bránu, a před 2. srpnem to podepíšu."* (I made a candidate with no score and watched the wave reject him as "match 0" — a measurement that never happened, written as fact. Fix those three things and close the gate, and I'll sign it before 2 August.)

- **Tereza (candidate), offer-onboarding — L2-conditional:** *„Ta krásná stránka za zavřenými dveřmi, ke kterým mi nikdo neposlal klíč. Doručte mi to, česky a s funkčními odkazy — a já vám podepíšu, že lepší nástup jsem nezažila."* (That beautiful page behind a locked door nobody sent me the key to. Deliver it to me, in Czech, with working links — and I'll sign that I've never had a better onboarding.)

- **Sam (candidate), candidate-apply-status — L2-conditional:** *"Approve with two blocking comments — neither of them about the UX… Ship a sender or stop writing 'we'll be in touch.'… Close the delivery seam and fix the link discipline before a real candidate closes the tab."*

- **Tomáš (hiring manager), offer-onboarding — L2-conditional:** *„Neuvěřitelné, ale bylo to hotové, než mi vystydlo kafe… kliknu ‚Odeslat nabídku' a ono NIC. Karta zmizí… Kolegům to ukážu — hned jak to tlačítko začne odpovídat."* (Unbelievable — it was done before my coffee went cold. But I click "Send offer" and NOTHING. The card vanishes. I'll show it to colleagues — the moment that button starts answering.)

---

## Reconciliation-sweep results (cross-surface, no single walkthrough produces these)

7 concepts traced, 13 findings (9 majors): **Match score** DISAGREE (3+ producers, live divergence on every Offer/Hired row, 7 `?? 0` fabrication sites); **Calibration** measures the non-acting score (live n=0); **Stage vocabulary** AGREE on the canonical axis but the sim keeps a third English vocabulary + TodayRail infers offers-out from stage alone; **Salary** DRIFT (period dropped at the money moment; ≥6 surfaces hand-roll CZK); **Consent TTL** DRIFT (hardcoded "12 months" vs configurable `KP_CONSENT_TTL_DAYS`); **Tenancy** DISAGREE (2/53 scoped, `searchEntities` leaks the scoped two); **Delivery truth** DISAGREE (queued-terminal vs 8 "sent" families); **(SIM) hygiene** DISAGREE (purge key, not filter key — a sim hire counts in live funnel/ROI). Two canonical seams DO hold (single stage axis via `useEnumLabel`; the Comms-Center honest-delivery reference) — protect them.
