# L2 empirical — helena-buyer × evaluate-and-buy

- **Run:** 2026-07-02-full · live deploy `http://localhost:3009` (dev, `DEV_AUTH=0`, locale en) · cert level: **L2 (empirical, live browser)**
- **L1 handoff:** `l1/helena-buyer--evaluate-and-buy.md` (L1-conditional, blockers EB-H1-01/02 carried)
- **Verdict:** **L2-fail** — the *evaluation story* is live and genuinely strong (landing, /about, compliance pillars, sourced ROI, reconciled pricing, honest billing), but all three journey-enders are now live-confirmed: the demo **breaks mid-run in front of her** (gsim-l2-101 — her explicit blocker trigger), **every conversion path dead-ends at the operator password** (EB-H1-02/06), and on production config **the funnel isn't served at all** (EB-H1-01). Plus the question Legal asks first — demo isolation — is answered live in the negative (EB-H1-04).
- **Time-saved (re-measured):** to a *decision*: ~2–3 weeks of vendor vetting → **~22 min self-serve, confidence high** (the walk below really happened in one session, keyless). To a *pilot*: **unreachable** — no signup, no contact capture, no working checkout; unchanged from L1. The L1's caveat holds exactly: this only exists on a dev-gate deploy; on today's production config the path does not exist.
- **Grounding (vs L1's 6/11 across the sim's buyer-visible AI beats):** only the screen-wave slice was exercised live — and it is **real** (9 genuine per-candidate scores + tiered rationales). The canned screen draft (L1's 1/4 beat) never rendered to the viewer; the offer draft and group eval never ran (the sim died first). Live-visible reasoning this run: real. Live-verified coverage of the promise: partial.

---

## 1. The walk (reconstructed from captured evidence, in Helena's head)

**Beat 1 — /about, cold (shot `l2-helena-01-about-cold`).** The public concept page renders exactly as designed: seven steps with mechanism-level copy ("hard knock-out gates and archetype-aware scoring — deterministic and explainable, never keyword bingo"; "A fairness gate runs first"; "role band × fit · no LLM in the number"; closing "AI does the reading at every step. A human signs every decision."). My Eightfold/SeekOut fluff radar stays quiet. But the page's only actions are **Sign in** and **Start free** (aria: no other link) — *no demo CTA* on the one page production would actually serve. EB-H1-03 confirmed live.

**Beat 2 — `/` cold (shot `l2-helena-02-root-cold`).** On *this* deploy the full Spark landing renders: hero ("AI for hiring that keeps humans in charge"), "Watch the live demo", the four compliance pillars (Human in the loop "by design, not by a setting" / EU AI Act / GDPR & Article 22 / Provable, not promised) closing with the self-disclaimer "this reflects the product's design and controls, not a legal certification", the enterprise ROI band (60–70% · ~23 h · 40–51 h, with a named source line and "Your own measured savings show live in Analytics → ROI"), and four metered tiers in CZK+USD. `/landing` and `/landing/spark` (shots 03/04) deliver the identical page — they bounce into the same gate (`app/landing/page.tsx:6-8`). **The honest prod statement:** this renders only because `NODE_ENV !== "production"` keeps the dev gate on (`app/_lib/auth/devAuth.ts:28`); in production `/` always mounts the dashboard and the fail-closed proxy sends an anonymous visitor to the operator password form (`app/page.tsx:6-14`, `proxy.ts:53-82`) — the page I'm praising is served at **no production URL**. EB-H1-01 confirmed.

**Beat 3 — "Talk to sales" (shot `l2-helena-05-talk-to-sales`).** The highest-intent click in the whole funnel lands on: *"KP — Operator sign-in — This workspace is protected. Enter the operator password to continue."* Note even the brand flips from KandiDate to "KP" at that door (EB-H1-07's seam, live). EB-H1-02 + EB-H1-06 confirmed live.

**Beat 4 — "Start free" on /about (shot `l2-helena-07-about-startfree`).** On this dev deploy the button runs `signInDev()` (`AboutCurve.tsx:91`) and drops me — an anonymous stranger — straight into the **seeded tenant's full workspace**: 13 positions, 45 active candidates with full Czech names and scores, offers, an activity log of rejections. In production the same button is just the password wall. Either way it is not a signup: there is no tenant creation, no trial, no contact capture anywhere (`workspace-lock.ts:24-27`).

**Beat 5 — the keyless demo (`GET /api/demo`, sim-run.json + shots 10–20).** Entry works exactly as promised: 200, no credentials, lands `/?sim=auto` with the JD builder genuinely prefilled and auto-playing (shot 10 — spotlight caption, explain drawer open, real form). Phases Design→Source→Intake→Screen→Interview traverse real tabs in 42 s. The screening beat (shot 14-b) shows a **real** decision wave: "9 matched · 0 auto-rejected · 9 advanced" with per-candidate scores and tiered rationales, and the fairness line "Early-career candidates are never auto-rejected — the fairness gate holds". Then, ~1 min 15 s in, the bar turns red: **"Failed: Could not advance entry m-cand-007-jd-dhbye8rf to 'Offer' within 4 steps (stalled at 'Hired')."** The offer page, the candidate Accept, the finale, the conversion CTA — none of it ever plays (`done:false` after the script waited the full 8 minutes; `getStartedHref:null`). A demo that breaks in front of me is my stated walk-away trigger. Deterministic engine bug, code-confirmed — see gsim-l2-101 in `guided-simulation.l2-findings.json`.

**Beat 6 — Pipeline mid-demo (shot `l2-helena-21-sim-pipeline`).** The question my Legal team would ask first — "can the anonymous demo see real candidate data?" — answers itself: my keyless demo session renders the seeded tenant's **entire** board. 14 positions, 53 active candidates by full name with scores, "2 offers with candidates — Adam Sedláček, Anna Bartošová", the week's hires, and (via Analytics, shot 14-b) the full sealed decision history. EB-H1-04 confirmed live on this deploy class. Also visible in the automation strip, both before and during the demo: a raw database error — *"Interview reminders · On · checked today · **no such column: slot_at**"* (new finding EB-L2-11).

**Beat 7 — Billing mid-demo (shot `l2-helena-22-sim-billing`).** Renders for my anonymous session: honest note *"Billing isn't configured — running in local development mode. Purchases are disabled."*, plan catalog identical to the landing to the koruna (0 / 490 / 1 190 / 120 CZK, meters 5-1 / 100-5-30 / 400-20-120, 100-min pack 790), usage meters, and — correctly — every purchase button `[disabled]` rather than erroring. Two papercuts: the Free plan shows "Interview minutes 0 of 0 used · **Quota exhausted**" on first touch (EB-L2-13), and back on Analytics the live ROI meter reads "**Recruiter time saved 5% · ≈2.3 h/hire**" while the pricing band I just read claims 60–70% (EB-L2-12 — an honest meter on demo seed data, but it contradicts the pitch inside the pitch).

---

## 2. L1 handoff — l2_priority answers, one by one

| # | L1 question | L2 answer | Verdict |
|---|---|---|---|
| 1 | Cold root, logged out: what renders at `/`? | On this dev deploy: the full Spark landing (shot 02); `/landing`, `/landing/spark` bounce into the same gate (03/04 + `landing/page.tsx:6-8`). On production config (code, unchanged): dashboard → fail-closed proxy → operator password (`devAuth.ts:28`, `page.tsx:6-14`, `proxy.ts:53-82`); the login wall itself live-rendered in shot 05. | **EB-H1-01 confirmed** (dev-vs-prod seam stated honestly: the asset exists and renders; prod serves it nowhere) |
| 2 | "Watch the live demo": mints + auto-starts? Full run within budget? | Mint: **yes** — GET `/api/demo` → 200, keyless, `/?sim=auto` auto-plays (sim-run.json). Full run: **no** — deterministic failure at the Interview→Offer seam at ~1:15; phases 6–7 never play; terminal frame is a red error (shot 20). | Mint confirmed; **"doesn't break" refuted** → criterion 1 blocker (gsim-l2-101) |
| 3 | Mid-demo Pipeline: whose rows? | The seeded tenant's — all of it (shot 21: 53 named candidates, offers, hires; Analytics shows the sealed decision history). Demo "isolation" is marker-and-lock, not data-layer. | **EB-H1-04 confirmed live** |
| 4 | Screening beat: what reasoning is visible? Labeled as simulated? | The **real** wave modal (shot 14-b): 9 real scores, tiered per-candidate rationales, fairness line. The canned confidence-72 draft **never renders** in auto-play (created and auto-consumed in ~1 s; Decisions badge blips 15→16→15 across shots 14-b/15). Nothing labels stand-ins beyond "(SIM)" and the "Pipeline simulation" pill. | **EB-H1-05 re-scoped** — live-visible reasoning is real; the undisclosed canned layer exists in code but is effectively invisible in auto-play → severity minor at L2 |
| 5 | Billing mid-demo | Renders for the anonymous session; `configured:false` note honest; all purchase CTAs `[disabled]`, no errors; catalog ↔ landing 1:1. | **EB-H1-08/09 strengths confirmed live** (+ EB-L2-13 papercut) |
| 6 | Every conversion CTA live | "Talk to sales" → operator sign-in (shot 05). "Start free" on /about → dev: `signInDev()` into the seeded workspace (shot 07); prod: `/login` (`AboutCurve.tsx:91`). Post-demo CTA: never rendered (run failed); code target is `/login` (`SimBar.tsx:52`). No signup/contact/checkout path exists anywhere in the live evidence. | **EB-H1-02 + EB-H1-06 confirmed live** |
| 7 | LandingLangSwitch + Spark art direction, English throughout | EN/CS switch present on landing + /about (aria `[pressed]` group); /about renders fully in Czech (shot 06). Spark art direction renders (shot 02; full-page capture shows scroll-reveal blanks — a capture artifact of animated sections, not a defect). Buyer session was English throughout. | Confirmed (dark theme not exercised this run — noted as uncovered) |

---

## 3. Scored acceptance criteria (hers, applied as written)

| # | Criterion | L2 verdict |
|---|---|---|
| 1 | **completion/trust** — sim runs keyless e2e, doesn't break | **FAIL → blocker.** Keyless entry confirmed; the run breaks deterministically at ~1:15 with a red developer error; the crux beats (offer page, candidate Accept) never play. (gsim-l2-101) |
| 2 | **trust/senior-quality** — real reasoning, not fluff | **PASS-leaning, narrowed.** What actually rendered — the wave modal — is real, per-candidate, tiered. The misleading canned layer never surfaced. But the run died before group-eval/offer, so "reasoning I can pressure-test end-to-end" was never delivered. |
| 3 | **missing** — concrete compliance story | **PASS on marketing surfaces** (shots 01/02: 4 pillars, Art. 22, disclosure, honest non-certification footnote). Still absent *inside* the demo (gsim-l1-005 confirmed live) — and undermined by beat 6: the demo session reading tenant PII is the opposite of the isolation answer Legal needs (EB-H1-04). |
| 4 | **time-saved** — ROI math shown and sourced | **PASS with a wrinkle.** 60–70% / ~23 h / 40–51 h render with a source line (shot 02); the live Analytics → ROI panel exists and works — but shows 5% during the demo, contradicting the headline in-session (EB-L2-12). |
| 5 | **trust** — pricing maps to value | **PASS.** Landing ↔ Billing reconcile 1:1 live (shots 02 ↔ 22); billing engine honest and correctly disabled unconfigured. |
| 6 | **clarity** — differentiation legible | **PASS (thin, unchanged).** The mechanism-forward story renders live; no direct competitive frame. |
| 7 | **effort** — pilot/no-pilot in ~20 min self-serve | **PASS for the decision, FAIL for the pilot.** I reached a defensible decision in ~22 min. The decision is "cannot pilot": every path to becoming a customer ends at an operator password (shots 05/07). |

## 4. Findings

Full schema in `evaluate-and-buy.l2-findings.json`. Headline (impact-ranked):

1. **EB-H1-01 · blocker · confirmed** — prod front door is a password wall; landing served at no prod URL (live: shots 02/03/04 prove the asset renders on dev; code: `devAuth.ts:28`, `proxy.ts:53-82`).
2. **EB-H1-02 · blocker · confirmed live** — no marketing→pilot path; "Talk to sales" and every CTA end at the operator sign-in (shots 05/07).
3. **gsim-l2-101** (filed under guided-simulation) — the demo run itself breaks; scores here as criterion-1 blocker.
4. **EB-H1-04 · major · confirmed live** — anonymous demo session reads the seeded tenant's full PII (shot 21).
5. **EB-L2-11 · major · NEW (L2-only)** — interview-reminders automation failing; raw SQL error "no such column: slot_at" rendered in the Pipeline automation strip, pre-sim and mid-demo (shots 07/21; `SchedulerControl.tsx:474-477`, `schedule-store.ts:396-402`).
6. **EB-H1-03 · major · confirmed** — no demo CTA on /about (shot 01 aria); silent gated-refusal half stands on code.
7. **EB-H1-06 · minor · confirmed live** — "Talk to sales" → operator password (shot 05).
8. **EB-L2-12 · minor · NEW** — live ROI meter (5%) contradicts the 60–70% headline inside the same demo session (shot 14-b vs shot 02).
9. **EB-H1-05 · minor (downgraded from major) · re-scoped** — the canned screening draft never renders in auto-play; live-visible reasoning was the real wave. Code gap (undisclosed determinism, fabricated confidence 72 at `sim/screen-draft/route.ts:17-23`) remains open.
10. **EB-H1-07 · minor · confirmed** — off-brand seam live at the login door ("KP" vs KandiDate, shot 05); root SEO/OG unchanged in code.
11. **EB-L2-13 · polish · NEW** — Free plan renders "Interview minutes 0 of 0 used · Quota exhausted" on first touch (shot 22).

**Strengths confirmed live:** EB-H1-08 (billing correctness — honest unconfigured state, disabled purchases, no errors, anonymous-session-safe render), EB-H1-09 (pricing reconciliation holds to the koruna live; ROI sourced; compliance self-disclaimer renders), EB-H1-10 (the compliance story a bank buyer needs is public, concrete, uncontradicted — shots 01/02).

Accepted-gaps check: none of the above match the baseline (tokenized-page 404s).

## 5. Helena's feedback (first person, over the live product)

"I gave it the twenty minutes. Here's what I'll tell my team.

The story survives contact with the product — that's rarer than you'd think. The about page and the landing say *how* the machine decides, not just that it's AI; the compliance section reads like someone briefed a DPO and then had the nerve to add 'this is not a legal certification', which bought more trust than the four pillars above it. The pricing page and the billing engine underneath agree to the koruna, and when billing isn't configured it says so and disables the buttons instead of pretending. The demo started for me with no key, no login, and for one minute it was the best vendor demo I've seen this year — a real form filled itself, a real board moved, and the screening wave showed me nine real scores with a fairness rule I could quote.

Then it died. A red line of developer text — 'could not advance entry m-cand-007 to Offer, stalled at Hired' — and the offer, the candidate's acceptance, the whole finale I was promised never happened. My rule is written down: a demo that breaks in front of me is a closed tab. Worse: while the demo was broken I clicked around, and my anonymous session could read your entire seeded pipeline — fifty-three named candidates, their scores, their offers. If my Legal team asks 'can the demo see real candidate data', today the live answer is *yes, all of it*. And there was a raw SQL error sitting in the middle of the pipeline screen — 'no such column: slot_at' — under a reminders job that claims it's 'On'. Your own analytics told me the automation saves 5% while your pricing page told me 60–70%, in the same session. And when I finally went to buy — or even just talk to sales — every single door asked me for an *operator password*.

Verdict: no pilot, and today there's nothing launched to pilot. But I want to be precise, because the distinction matters: the *machinery* keeps earning trust every time I inspect it, and the honesty in the seams is real. Fix the demo crash, put a wall between the demo session and real data, launch the front door, and give one button a place to go. The day those four things are true, I take this to the board — and I don't say that twice a year."

## 6. Appendix — evidence & adversarial notes

- Evidence set: `shots/l2-helena-01..07` (.png/.aria.txt/.text.txt), `shots/l2-helena-10..22`, `shots/l2-helena-sim-run.json`, `shots/sim-run.mjs` (the driving script — entry via GET /api/demo, no dev auth, locale en).
- Adversarial: the sim failure is **not** residue or latency — deterministic double-advance, code-traced (see gsim-l2-101; entry id ties to this run's JD `jd-dhbye8rf`, sealed records timestamped 14:22 today). The `slot_at` error renders identically **pre-sim** (shot 07) — standing defect, not sim-induced. The PII exposure is on an open dev deploy — expected configuration for the UAT env — so it's scored as the live demonstration that isolation is env-flag-deep, not as a prod breach.
- Not covered this run: Spark Dark theme on marketing; a genuinely gated/prod deploy (none exists to drive); the post-demo CTA click (unreachable while gsim-l2-101 is open).
- Driver artifact: sim-run.mjs's statusLog captured only "Search…" (its status regex matched the sidebar first) — script bug, not product evidence; phase timings and terminal state were taken from shots/DOM instead.
