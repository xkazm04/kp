# UAT Scorecard — run 2026-07-02-full

Character-driven acceptance over kp @ main (`3395b4c`, post ship-loop m1–m3). Ship bar: **"public product path."**
Method: L1 theoretical (28 character×journey pairs, mass-parallel) → L2 empirical (6 journeys driven live on `:3009`, 13 character-passes) → reconciliation sweep (7 cross-surface concepts) → 3 targeted probes.

- **Roster:** 10 Characters (helena-buyer, petra-recruiter, tomas-hiring-manager, marek-coordinator, lucie-dpo-compliance, katerina-ta-analytics, jana-sourcer, eva-eng-hiring-lead, tereza-candidate, sam-dev-candidate).
- **Findings:** 301 rows in `findings.json` (195 L1 + 93 L2/probes + 13 reconciliation) → **238 unique issues** after L1↔L2 dedup: **3 blockers · 83 majors · 71 minors · 16 polish · 65 strengths**. Verdicts: 296 confirmed, 5 uncertain, 0 refuted.
- **L1 tally:** 28/28 pairs walked · 2 L1-pass (Tomáš/interview-schedule-prep, Tereza/voice-interview) · 26 L1-conditional · 0 L1-fail.
- **L2 tally:** 6 journeys fully driven = 13 character-passes · **2 L2-fail (both Helena buyer journeys)** · 11 L2-conditional. Live-confirmed negatives: 3 blockers, 43 majors, 28 minors.

---

## Per-journey scorecard (all 14 journeys at L1; 6 reached L2)

Grounding = AI-context coverage from the L1 audit (sources reaching the prompt / total the job needs). Time-saved = vs the manual, LLM-less way, per the Character's declared anchor.

| # | Journey | Characters (L1) | Cert reached | L1 verdict | L2 verdict | Grounding | Est. time-saved (promise) | Live? |
|---|---------|-----------------|--------------|-----------|-----------|-----------|---------------------------|-------|
| 1 | **evaluate-and-buy** | Helena | **L2** | L1-cond (2 blockers) | **L2-FAIL** | 6/11 | ~2–3 wk → ~22 min *to a decision* | decision live on dev only; **pilot unreachable** |
| 2 | **guided-simulation** | Helena, Petra | **L2** | L1-cond | **L2-FAIL** (both) | 6/9 | ~35 min demo-prep / weeks vetting → 20 min | **≈0** — run crashes at Interview→Offer every time |
| 3 | **offer-onboarding** | Petra, Tomáš, Tereza | **L2** | L1-cond (×3) | **L2-conditional** (×3) | 4/8 | ~40 min/offer (recruiter); ~15 min (mgr); ~30 min (candidate) | ~25–35 min live IF link delivered; candidate **≈0** by default |
| 4 | **candidate-apply-status** | Tereza, Sam | **L2** | L1-cond (×2) | **L2-conditional** (×2) | 9/11 | 20–30 min portal → 2–3 min chat | ~20–28 min (Tereza) / ~15–18 min (Sam) live on chat path |
| 5 | **pipeline-advance** | Petra, Marek | **L2** | L1-cond (×2) | **L2-conditional** (×2) | 5/8 | ~8–10 min/touch; ~35 min/wave | ~6–8 min/touch live; wave **≈0 for cs cohorts** (English letters) |
| 6 | **screening-decisions** | Marek, Lucie | **L2** | L1-cond (×2) | **L2-conditional** (×2) | 4/6 wave · 3/6 card | ~90–120 min/wave; ~4–6 h/audit | ~2 h/wave; ~4–6 h/audit live (conditioned on 3 unsigned findings) |
| 7 | jd-to-shortlist | Petra, Jana, Kateřina | L1 | L1-cond (×3) | — | 4.5–6/8 | ~2.5–3 h/role (Petra); ~3–5 h (Jana); ~30–60 min (Kateřina) | not driven |
| 8 | cv-analysis-jobfit | Petra, Eva | L1 | L1-cond (×2) | — | 6/9 · +4/6 GitHub | ~23 min/CV (Petra); ~40 min/CV (Eva) | not driven |
| 9 | group-eval-fairness | Tomáš, Lucie | L1 | L1-cond (×2) | — | 7/10 | ~40 min/panel | not driven |
| 10 | interview-schedule-prep | Marek, Tomáš | L1 | **L1-pass** (Tomáš) / L1-cond (Marek) | — | 6/8 | ~10–13 min/iv (Marek); ~20 min (Tomáš) | not driven |
| 11 | voice-interview | Petra, Tereza | L1 (+probe) | **L1-pass** (Tereza) / L1-cond (Petra) | probe: TP-L2-VOICE-01 | 4/6 | ~35–40 min/screen | leak confirmed via code+data (not force-minted) |
| 12 | sourcing-rediscovery | Jana | L1 (+probe) | L1-cond | probe: TP-L2-SRC-01/02 | 3–6/8 · draft 4/8 | ~6–8 h/role | reach-out 400+silent-Screened confirmed via code chain |
| 13 | analytics-calibration | Kateřina, Lucie | L1 | L1-cond (×2) | — | 5/7 · 5/8 | ~8–14 h/cycle; ~10–16 h/audit | not driven (calibration n=0 confirmed in reconciliation) |
| 14 | dev-case-hire | Eva, Sam | L1 | L1-cond (×2) | — | 5/6 authoring · 3/7 eval | ~1.5–2 h saved (Eva); 4× over Sam's 30-min bar | not driven |

> full-onboarding-lifecycle (HR-20 cohort journey) is out of this run's scope — covered by `runs/2026-06-20-hr20-onboarding`.

---

## Findings ranked by IMPACT (frequency × reachability × trust_erosion), grouped by theme

Ranked by computed impact, **not** raw severity — an every-run papercut can outrank an unreachable "major". L2-confirmed findings weighted over L1. Each carries id · severity · impact · evidence · suggested acceptance.

### Theme A — The buyer path is dark: built, not launched (ship blocker (c))

1. **EB-H1-01 · blocker · imp6 · L2-confirmed** — Public product path not launched. On production config `/` is an operator password wall and `/landing` redirects into the gate; the Spark landing renders on the dev deploy *only* because `NODE_ENV !== "production"` keeps the dev gate on (`devAuth.ts:28`, `proxy.ts:53-82`, `app/page.tsx:6-14`). The page Helena praised is served at **no production URL**. → *Accept:* the marketing landing serves at a stable public URL with no auth in production.
2. **EB-H1-02 · blocker · imp6 · L2-confirmed** — No marketing→pilot conversion path. Every CTA — including "Talk to sales" and "Start free" — dead-ends at the single-operator password form; no signup, no trial, no contact capture, workspace creation locked (`workspace-lock.ts:24-27`). → *Accept:* at least one CTA reaches a working signup/contact/trial that provisions or captures a lead.
3. **EB-H1-03 · major · imp5 · L2-confirmed** — The one prod-served marketing page (`/about`) carries no demo CTA; its only actions are Sign in / Start free (both → the wall). → *Accept:* `/about` links to the keyless demo.
4. **EB-H1-06 · minor · imp4** / **EB-H1-07 · minor · imp3** — "Talk to sales" opens the operator password form; the door brands itself "KP" while every marketing surface is "KandiDate" (off-brand SEO/OG at root). → *Accept:* sales CTA reaches contact capture; brand + OG consistent.

### Theme B — The demo un-sells itself: it crashes deterministically mid-run (ship blocker (c), amplified)

5. **gsim-l2-101 · blocker · imp6 · L2-confirmed (L1-missed → surface-model gap)** — Every auto-play sim run dies at the Interview→Offer seam. The screen step double-advances via a `screening_review` accept that sets a calendar gate and lands the survivor at Offer one stage early (`SimulationProvider.tsx:493-495` + `pipeline.ts:1322-1331`), then `advanceTo` bare-accepts an entry already at Offer → the loop never observes "Offer" and throws. Phases 6–7, the `/offer/[token]` page, the candidate's Accept, and the conversion CTA never play; the terminal frame a buyer sees is a red developer error. → *Accept:* a keyless sim run reaches the "hired 🎉" climax with the offer page + accept exercised.
6. **gsim-l2-102 · major · imp5 · L2-confirmed** — The demo produces a **hire with no offer**: the bare accept at Offer bypasses the extend-offer gate (`pipeline.ts:1332-1340`), contradicting the product's own rule and the /about story ("a person extends it, and the candidate accepts"). A product-API gap, not just a sim bug. → *Accept:* Offer→Hired requires an approved `offer_review` on every path.
7. **gsim-l1-004 · major · imp5** — No ROI/outcome quantification anywhere in the run; the climax (when it worked) was "Done — candidate hired 🎉" with zero numbers. **gsim-l1-005 · major · imp6** — the compliance machinery (Art. 22 / HITL / GDPR) runs on-screen but is **never named** to the viewer. **gsim-l1-002 · major · imp5** — the SimBar starts collapsed and never auto-expands, so the climax CTA is invisible. → *Accept:* the ending shows the run's own numbers; the screen step names the compliance model; the panel auto-opens.

### Theme C — Tenancy is mostly global: one shared chain across workspaces (ship blocker (a))

8. **REC-09 · major · imp5 · confirmed** — Definitive tenancy inventory: **53 tables → 2 scoped (`analyses`, `profiles`) · 5 exempt · 46 global gaps.** `decision_records`, `offers`, `group_evals`, `interview_sessions`, `schedule_invites`, `onboarding_*`, `consent_events`, `dev_outbox` carry **no workspace column at all**; `pipeline_entries` has the column but `listPipeline` + analytics read globally. The manifest (`tenancy.ts:22-35`) admits it and fail-closes multi-workspace boot. → *Accept:* every candidate-PII / decision table is workspace-scoped before a second tenant exists.
9. **SD-L1-010 · major · imp2 (low reach today, hard must-fix before multi-tenant) · L2-confirmed** — `/api/decisions/*` carry **no in-route auth or tenant scope**, unlike sibling `/api/automation` (`requireOperator()`). Lucie's live probe: unauthenticated `GET /api/decisions/records` → HTTP 200 returning all 26 sealed records incl. real ČS candidate refs; `POST screen-wave` dry-run → 200. → *Accept:* decisions routes require operator + workspace scope; `decision_records` gains a tenant column.
10. **EB-H1-04 · major · imp6 · L2-confirmed** — The anonymous keyless demo session reads the seeded tenant's entire dataset: 53 named candidates, scores, offers, sealed decision history (shot 21). "Isolation" is marker-and-lock, not data-layer. **REC-11 · major · imp6** — `(SIM)` is a purge key, not a filter key: zero read/aggregate surfaces exclude sim rows, so "Vít Malý (SIM)" counts as a live hire in "hired this week", the funnel, forecast, ROI and cost-per-hire until a manual Reset. → *Accept:* demo/sim sessions are data-isolated; every aggregate excludes `(SIM)` and cross-tenant rows.

### Theme D — Comms are simulated end-to-end: "sent" is a lie by default (ship blocker (b))

11. **REC-10 · major · imp6 · L2-confirmed** — Systemic delivery-truth inventory: the channel layer defines `queued` as a **terminal non-delivery** state ("the outbox IS the delivery target; nothing dequeues it", `comms.ts:13-42`); no relay without `COMMS_WEBHOOK_URL`; recipient is a **display name, not an address**. Live: `dev_outbox` = 12 rows, **all queued, zero sent**, while **8 surface families** say "sent/emailed/odesláno". → *Accept:* either a real sender ships, or every "sent" claim degrades to the Comms-Center honesty pattern.
12. **capst-l1-001 · major · imp6 · L2-confirmed** — Candidate comms never delivered by default; the outbox is a recruiter-only sink. Every message this run (2 acks, 1 rejection) queued-terminal, addressed to the candidate's name. The status "Interview" line tells her to *watch an email inbox* that will never receive anything. → *Accept:* delivery works, or the copy stops promising email.
13. **capst-l1-002 · major · imp6 · L2-confirmed** — Quick-apply leads get **no status link anywhere** and are told "We've emailed you a confirmation" (false, both locales). The whole `<a>` inventory on the done screen is one enrichment link. → *Accept:* quick-apply mints and shows a status link; no false email claim.
14. **capst-l2-102 · major · imp5 · L2-confirmed (L1-missed)** — The GDPR erasure link in every candidate email is a **dead relative path** (`/data/er-…`) on default config (`comms-dispatch.ts:97`, `public-base-url.ts:30-42`) — while the status link beside it is absolute. The disclosure promises rights via a link that cannot resolve. → *Accept:* the erasure link is absolute on every deployment.
15. **pa-l2-null-locale-english-letters · major · imp6 · L2-confirmed** — 60/65 pipeline entries carry `locale NULL → en`, so Czech candidates get **English** rejection + invite letters under the bank's name while the recruiter drawer reads "✓ odesláno". The template machinery works — it localizes to the wrong locale for nearly the whole funnel. → *Accept:* candidate letters resolve locale from job/workspace when the entry's is null.
16. **OO-L1-01 · major · imp6 · by-design/L2-confirmed** — The money path is simulated by default: all 4 offer/onboarding/reminder emails terminated in the local outbox, addressed to the candidate's name, host-less links. *Ceiling:* even after a relay ships, links need a configured public base URL. → *Accept:* offer emails deliver with absolute links on a configured deployment.

### Theme E — Sealed audit records lie: fabricated 0-scores, omitted AI, misattributed actor (ship-critical for a bank; trust_erosion high)

17. **SD-L1-002 / REC-03 · major · imp4→imp5 · L2-confirmed (strongest form)** — Systemic `matchScore ?? 0` fabrication at **7 decision sites**. Lucie created a Screened entry with `matchScore=null`; the wave rejected it as "match 0", and the **immutable sealed record now permanently reads "shoda 0 < práh 45", `inputs.score:0`** — a measurement never taken, indistinguishable from a genuine 0. Fixing only screen-wave leaves group-eval crowning on a fabricated 0. → *Accept:* one shared `rankableScore()` excludes nulls from cohorts and never seals a fabricated 0.
18. **SD-L1-003 · major · imp6 · L2-confirmed (both locales)** — The auto-rejection email has **no automated-decision disclosure and no contest/human-review channel** (Art. 22(3)); template identical for auto and manual; "after careful review" misrepresents a threshold rule. → *Accept:* adverse-automated notices disclose automation + a human-review route.
19. **gsim-l2-103 · major · imp5 · L2-confirmed** — The tamper-evident chain seals the demo **engine's** advances as "advanced · human:recruiter" and the decision log renders rows labeled HUMAN whose own text says "Auto-advanced" (`route.ts:249-259` defaults every API accept to `human:recruiter`). For a "provable, not promised" buyer, the audit misattributing *who acted* is the sharpest cut. → *Accept:* programmatic callers seal as system/auto, never human.
20. **SD-L1-004 · major · imp5 · L2-confirmed** — The sealed record of a **human** decision omits the AI recommendation it ratified (AI verdict lived in mutable `approval_detail`, cleared on decision). A right-to-explanation request means reconstructing what the human saw — the exact work the tool promised to end. **SD-L1-005 · minor · imp5** — `approvedBy` is the generic constant "operator (single-operator deployment)"; route accepts any client string. **pa-l2-command-mutations-unsealed · major · imp5 · L2-confirmed** — command-bar rejects notify the candidate but write **zero** `decision_records` while the identical board action seals — audit completeness is surface-dependent. → *Accept:* the human record embeds the ratified AI payload; every mutating surface seals identically.

### Theme F — Silent success on the money click; phantom hires

21. **pa-advance-top-bypasses-offer-flow / P1 · major · imp5 · L2-confirmed (forensically complete)** — `advance top 1` turned an Offer-stage candidate with a freshly drafted offer into a Hired employee: **zero offer rows, drafted letter destroyed (approval NULL), zero comms, zero onboarding, zero sealed decision** — and the Today rail celebrates the phantom by name. Preview showed name+score but **not the stage**. → *Accept:* command-bar advance respects the offer gate and seals; preview shows the target stage.
22. **OO-L1-02 · major · imp5 · L2-confirmed (smoking gun on the wire)** — "Send offer" is silent success: the server returns `{ offerExtended:true, link:"…/offer/tk-…" }` and `DecisionsTab.act()` **discards it** (`DecisionsTab.tsx:176-214`); the card just fades. The only recovery is hunting the Channels tab — where the honest banner says the messages aren't sent. → *Accept:* the send click surfaces the minted link + a delivery-state confirmation.
23. **OO-L2-10 / REC-01 · major · imp6 · L2-confirmed** — "Match score" has **three unreconciled producers** rendered as one number: stored entry score (board/drawer/approval header), a fresh offer-pricing recompute (prices the salary), and the CV-analysis score (timeline). Live, every Offer/Hired row disagrees — Anna 57 board / 49 rationale / 70 analysis; and the offer is priced off the number the header doesn't show. → *Accept:* each surface names its source, or the offer rationale cites the header's number.
24. **REC-04 / OO-L2-11 · major · imp5/imp4 · L2-confirmed** — TodayRail claims "offers with candidates — awaiting their responses" from stage position alone (`TodayRail.tsx:50`), never reading the offers store; live, 2 of 3 Offer-stage entries have no offer row. A genuine check (`getOpenOfferForEntry`) exists and is unused. → *Accept:* the rail counts extended offers from the offers store.

### Theme G — AI narratives are English in a Czech workspace; letters below the senior bar

25. **Language cluster (imp4–5, all L2-confirmed where driven):** `OO-L1-04` — offer letter below the senior bar (no deadline in a 24-hour offer, no start date, no benefits, no named human, masc. "takového kolegu" to a woman); `OO-L1-03` — offer email is two languages (Czech letter + English chrome); `gsim-l1-006` — entire sim narration hardcoded English (zero i18n in `app/features/simulation`); `SD-L1-009` / `PET-CVJF-02` / `GEF-L1-01` / `dch-l1-003` — AI screening rationale, analyze decision-layer strings, group-eval narrative, and the whole dev studio are English inside the Czech UI; `pa-command-bar-english-only` (minor→major at L2) — the Czech command bar teaches example commands its own parser rejects. → *Accept:* candidate-facing + decision-layer AI output resolves the workspace/candidate locale end to end.

### Additional confirmed majors worth tracking (theme cross-refs)

- **vi-petra-brief-leak / TP-L2-VOICE-01 · major · imp5/imp6 · confirmed** — the interviewer's private assessment (red-flags marked "never say aloud", "missing must-have", "aspiration mismatch", provenance tags) is embedded in the candidate-mode interview `instructions`/`run_of_show_json` and returned to the **candidate's own browser** via `/connect` (`VoiceInterview.tsx:548`). A candidate reads how they were pre-judged in the Network tab. → *Accept:* candidate prompt is a safe projection; internal run-of-show never crosses to the client.
- **SD-L1-001 · major · imp6 · L2-confirmed** — one-click Reject on an AI review card: no confirmation, silent candidate email, no undo, not in the reconsider queue.
- **pa-no-batch-undo-at-point-of-fire · major · imp5 · L2-confirmed (L1-missed)** — human/command bulk rejects have **no UI undo anywhere**; reconsider joins on `auto_rejected` only. Fix landed (`reinstate` API) ≠ fix reachable.
- **pa-no-rendered-message-preview / MAREK-ISP-2 · major · imp5** — candidate-notifying bulk gates preview WHO but never WHAT (no rendered-letter dry-run); bulk invite fires with no confirm at all.
- **dch-l1-001 / dch-l1-002 · major · imp6** — the paste-from-LLM authenticity tell is dead end-to-end; the dev-case evaluation never reads the candidate's actual work.
- **EVA-CVJF-01 / JTS-L1-03 · major · imp4/imp5** — GitHub evidence never joins the headline verdict; analysis-sourced shortlist reasoning gets no CV narrative though the prompt demands citing CV facts.
- **REC-02 · major · imp5 · L2-confirmed** — analytics calibration measures a score that never acts (`analyses.score × disposition`); live n=0 despite 105 analyses + 6 hires. The dial reads "not yet calibrated" forever while the acting scores have no error bar.
- **REC-06 · major · imp5** — the salary figure loses its period ("/month") exactly at the money moments (candidate offer page + approval card).

---

## What passed — strengths worth protecting (65 total; do not touch)

The build's honesty and its guardrails are its signature. These earned trust across Characters:

- **Honest-delivery reference implementation (REC-S2, OO-L2-S7, SR-L1-S6):** the Comms Center's red banner "tyto zprávy se NEodesílají kandidátům" is the pattern every other surface should copy — the build names its own seam, in Czech, one tab from the send.
- **Article 22 machinery is structural, not copy (SD-L1-S1..S7, SD-L2-S1, AC-L1-S4/S5/S6):** server-enforced human-approval token gate that held under real probing (409 no-token / 409 stale / 200 fresh, zero mutation), fail-closed fairness shield ("0 z 3" on a protected cohort, live), a tamper-evident chain that re-verifies after every commit **and seals the reversal**, one-click bilingual dossier export. Lucie: "Tohle bych regulátorovi na stůl položila."
- **Candidate apply + status experience (capst-l1-007/008/009, capst-l2-103):** conversational apply grounded in the real role, CV pre-fill as editable defaults, a no-ghosting status timeline that moves live and ends honestly, and a real, plain-Czech `/data/[token]` self-service erasure page. Sam: "the best I've used from a bank, full stop."
- **Offer/onboarding guardrails (OO-L1-S1..S6, verified live):** per-offer deadline lever wired end-to-end (1d→+24h coral / 5d→+120h steel countdowns on the candidate page), Hired protected as a 422-refused terminal, accept→questionnaire→verbatim-answers-on-recruiter-tab loop, deliberate decline dialog with safe focus.
- **Pipeline board integrity (pa-strength-cas-move-integrity, unified-drawer-timeline, live-poll):** CAS-guarded moves that survive a hard refresh, a real unified drawer timeline (analysis + interview + invites + offers merged), a server-side move surfacing on the open board in 28.2s.
- **Sim spine + grounding honesty (gsim-l1-010..013):** genuinely keyless real-click spine over real endpoints/tokens/pages; labelled halts (no fake success); the explain drawer's per-phase diagrams + accruing criteria table — "the single best explainability device I've seen in this category" (Helena).
- **CV-analysis integrity (PET-CVJF-S1..S4, EVA-CVJF-S1..S3):** the prior hallucinated-matched-skill seam is now source-gated with disclosure; salary is a basis-carrying number end to end; the dial is pinned to the component sum; degradation is disclosed, never silent.
- **Billing + marketing reconciliation (EB-H1-08/09/10, live):** webhook-only entitlement, purchases correctly disabled when unconfigured, pricing reconciles to the koruna with the billing engine, and the bank buyer's compliance story is public, concrete, and uncontradicted.
- **Sourcing provenance (SR-L1-S1..S5):** once-only consent-gated outreach, unscorable candidates surfaced not dropped, per-skill provenance badges answering "found them HOW?", campaign-pack stated-facts-only honesty.

---

## Appendix — refuted / uncertain / re-scoped

- **Refuted:** none — 0 findings were refuted at L2. All 296 kept findings are `confirmed`.
- **Uncertain (5):** `TP-L2-SRC-02` (in-app-role outreach 404 — code chain strong, live 404 not force-reproduced to avoid mutation + Claude spend); `vi-petra-scorecard-language` + `vi-tereza-agent-opening-language` (locale directive dropped — code-confirmed, live call not minted); `gsim-l1-010` (strength partially confirmed — phases 1–5 real, 6–7 unreachable behind gsim-l2-101); `OO-L1-06` (expired-offer double-label — no offer could lapse in a ≥24h-TTL session, stands on code).
- **Re-scoped at L2:** `EB-H1-05` major→**minor** (the canned confidence-72 screening draft never renders to the viewer in auto-play — created and auto-consumed in ~1s; the code gap stands); `gsim-l1-009` → **imp1** (undisclosed deterministic stand-ins effectively invisible in auto-play).
- **Upgraded at L2 (L1 surface-model gaps):** `pa-no-batch-undo-at-point-of-fire` (minor→major — reinstate UI-unreachable for human rejects); `pa-command-bar-english-only` (minor→major — the Czech examples fail the parser); `gsim-l2-101/102/103`, `capst-l2-102`, `capst-l2-101` were all **L1-missed** — recorded as surface-model gaps (L1 read each endpoint but never composed stage arithmetic across steps, nor audited inline literals / response-body construction).
- **Env note:** the run reused a live shared server (`:3009`, ours = PID 20380); a mid-run wedge (stale Turbopack cache) was recovered per protocol. Two findings (`OO-L2-12`, `EB-L2-11`/`OO-L2-15`) partly reflect degraded-server behavior — flagged as env-exposed, not core product, except the historic-error-shown-as-current rendering which is a real UI defect. A ≥24h min offer TTL made offer-lapse findings unobservable live (stand on code).
