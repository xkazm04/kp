# L1 — Petra Nováková (recruiter) × offer-onboarding

- **Run:** 2026-07-02-full · main @ 3395b4c · cert level L1 (theoretical, code-grounded, no browser)
- **Verdict:** **L1-conditional** — the journey completes structurally end-to-end, but two majors (silent send, offer-letter senior-quality/grounding) carry to L2.
- **Grounding score (offer-draft AI surface):** **4/8**
- **Estimated time saved (if it all works live):** **~40 min per offer · medium confidence** (manual: ~20 min letter + ~15 min comp sanity + ~15 min send/track/chase ≈ 50 min → app: draft click + approve + automated countdown/reminder/lapse ≈ 5–10 min)

## Surface model (follow-the-import-chain)

1. **Draft offer** — CandidateDrawer action `offer`, gated to stage `Offer`
   (`app/features/sub_pipeline/CandidateDrawer.tsx:36`) → `runAutomationTask("offer")`
   (`app/_lib/automation-run.ts:232-235`) → Python `draft_offer`
   (`pipeline/jobfit/automation.py:716-778`): salary = role's `salary_band` (or seniority
   fallback band `:704-709`), positioned in-band by match strength (`:725-726`), rationale
   recorded (`:728-731`), LLM letter prompt (`:733-737`) with deterministic fallback
   (`:740-755`). Result → `setApproval(entry, "offer_review", …)` + `offer_drafted` event
   (`automation-run.ts:233-234`). Full draft incl. subject/body is previewable in the drawer
   result (`app/features/sub_pipeline/CandidateResultView.tsx:86-110`).
2. **Approve & send** — Decisions queue `AiReviewCard` (offer variant: number, band bar,
   rationale, per-offer deadline input 1–90 days — `app/features/sub_decisions/AiReviewCard.tsx:21,55-100`)
   → `act(… ttlDays)` (`app/features/sub_decisions/DecisionsTab.tsx:176-214,191`) →
   `POST /api/pipeline/[id]` accept at Offer/offer_review → `extendOffer`
   (`app/api/pipeline/[id]/route.ts:22-77`): atomic `getOrCreateOpenOffer`
   (`app/_lib/offers-store.ts:268-276`, unique open-offer index `:67-71`), deadline stamped
   at mint (`offers-store.ts:133-135` via `app/_lib/offer-policy.ts:32-36,51-53`), decision
   sealed (`route.ts:57-66`), link via `publicBaseUrl` (`route.ts:71`), `dispatchOffer`
   appends the tokenized response footer + records `offer_sent`
   (`app/_lib/comms-dispatch.ts:235-246`).
3. **Delivery channel** — `sendComm` → local **Outbox (terminal `queued`)** by default; a
   real relay only when `COMMS_WEBHOOK_URL` is set (`app/_lib/comms.ts:36-42,97-100`).
   Recipient = contact → label → id → literal `"candidate"` (`comms-dispatch.ts:49-68`).
   Outbox body (with the link) is readable/expandable in the Comms Center
   (`app/features/sub_channels/CommsCenter.tsx:261`).
4. **Candidate responds** — `/offer/[token]` → `POST /api/offer/[token]` → `respondToOffer`
   (`app/_lib/offer-finalize.ts:18-151`): accept = CAS-claimed → Hired (`:57-66`), outcome
   recorded, onboarding run started idempotently (`:104`), welcome comm with
   `/onboarding/{token}` footer (`:111`, `comms-dispatch.ts:423-437`), ATS mirror (`:128`).
   Decline = guarded terminal (`offers-store.ts:321-336`).
5. **Hand-off back to Petra** — the hire appears in the Onboarding tab runs list with
   progress + **questionnaire pending/done chip** (`app/features/sub_onboarding/OnboardingTab.tsx:163-171`,
   `app/_lib/onboarding-store.ts:247-261`); candidate answers pre-fill the run detail
   (`OnboardingTab.tsx:385,467-485`); intake submission stamps
   `onboarding_intake_submitted` on the timeline (`app/_lib/onboarding-candidate.ts:64-67`).
   One-shot pre-boarding nudge on the heartbeat (`app/_lib/preboarding-reminders.ts:20-48`,
   `instrumentation-node.ts:94-100`). Ambient state: TodayRail offer-review / offers-out
   rows (`app/features/sub_pipeline/TodayRail.tsx:48-50`), drawer timeline offer chapter
   (`app/_lib/candidate-timeline.ts:69-77`).

## Reachability (resolved before judging)

Internal user, dev gate on, no per-role nav gating — Pipeline (drawer), Onboarding and the
TodayRail are squarely in her binding. The approve/send affordance lives on **Decisions**,
which her binding doesn't list (it lists Jobs/Match/Analyze/Pipeline/Schedule/Interview/
Onboarding) — but the TodayRail on Pipeline deep-links her there
(`TodayRail.tsx:76-85`), and kp has no gating, so I judge it reachable-shared with Tomáš
rather than `unreachable`. Fixture: seeded pipeline with an entry at Offer stage (env.md).

## Grounding audit — offer-draft AI surface: 4/8

| # | Source the letter should use | Reaches the prompt? | Evidence |
|---|---|---|---|
| 1 | Candidate identity | ✓ | `automation.py:734` |
| 2 | Role title + company | ✓ | `automation.py:734-735` |
| 3 | Role's REAL salary band (not a placeholder) | ✓ | `automation.py:718-721` (job `salary_band`, taxonomy-anchored; generic fallback only when absent `:704-709`) |
| 4 | Fit-scaled figure **with a stated basis** | ✓ | `automation.py:725-731` (rationale shown to reviewer, `AiReviewCard.tsx:84`) |
| 5 | Candidate language | ✗ (wrong source) | CV-languages heuristic `automation.py:110-112,727`, not the entry's stored `locale` the comm chrome uses (`comms-dispatch.ts:240-243`) — can produce a mixed-language email |
| 6 | Candidate CV evidence (strengths to echo) | ✗ | prompt carries none (`automation.py:733-737`) |
| 7 | Terms beyond salary (start date, benefits, contract, contact) | ✗ | nothing exists to feed it |
| 8 | The decision deadline | ✗ | ttlDays is chosen AFTER the draft (`AiReviewCard.tsx:21`); neither letter nor footer states it (`comms-dispatch.ts:241-243`) |

## Walkthrough vs her scored criteria

- **completion** ✓ — draft → approve → send → Hired → hand-off, no re-entry loop; Hired
  can't be faked by a manual stage move (`route.ts:102-107`), so the funnel stays honest.
- **salary basis** ✓ — number + band + explicit rationale at the approval point
  (`AiReviewCard.tsx:69-84`). Band provenance (real vs fallback band) isn't disclosed — noted.
- **no hallucinated skills** n/a-pass — the letter doesn't name skills at all (thin, but
  nothing fabricated; deterministic fallback is fully templated `automation.py:740-755`).
- **no silent success** ✗ **MAJOR (OO-L1-02)** — `act()` throws away the server's
  `{ offerExtended, link }` (`DecisionsTab.tsx:176-214` vs `route.ts:76`); the card just
  fades out. No toast, no link, no "sent to whom / deadline what". The drawer has
  TokenLinkPanels for voice + scheduling but none for the live offer link
  (`CandidateDrawer.tsx:88-89,818,882`) — the only place to retrieve the link is the Comms
  Center outbox body. *"A stalo se vůbec něco?"* — her exact pet peeve, on the money step.
- **senior-quality of the headline output** ✗ **MAJOR (OO-L1-04, OO-L1-03)** — the letter
  states name/role/company/figure and nothing else: no validity date, no start date, no
  benefits, no named contact (grounding 4/8). And its language is guessed from CV
  languages, not the candidate's stored locale — an English letter over a Czech footer is
  structurally possible.
- **time-saved** ✓ — plausibly ~40 min/offer + all the chasing automated (T-48h nudge,
  auto-lapse, pre-boarding nudge — all on the unconditional heartbeat,
  `instrumentation-node.ts:69-100`).
- **language** ✓ mostly — all recruiter surfaces + deterministic comms fully localized
  (messages/cs.json `offer`, `decisions.aiReview`, `comms.*`, `onboarding` complete); the
  LLM letter language is the seam above.
- **clarity (state visibility)** — offer chapter on the drawer timeline, BUT an expired
  offer renders as "Nabídka odeslána" twice (no `offerExpired` label:
  `candidate-timeline.ts:69-77` emits status `expired`, `CandidateDrawer.tsx:939-940`
  collapses it to `offerExtended`; key absent from messages/cs.json) — **minor (OO-L1-06)**.

## Findings raised here

OO-L1-02 (major), OO-L1-04 (major), OO-L1-03 (major, shared), OO-L1-06 (minor),
OO-L1-08 (polish), strengths OO-L1-S1..S6 — see `offer-onboarding.findings.json`.

## Character feedback (first person, Petra)

> Konečně nabídková fáze, která se chová jako systém, ne jako sdílená tabulka. Číslo má
> základ — pásmo role, pozici v pásmu podle fitu, a tu větu "proč zrovna tolik" bych
> napsala stejně. Termín platnosti si nastavím po nabídce, odpočet kandidátovi běží,
> připomínka odejde sama a propadlá nabídka se sama uzavře. Přijetí rovnou založí
> onboarding a vidím, jestli nováček vyplnil dotazník — to je předání, jaké chci.
>
> Ale ten hlavní klik — "Odeslat nabídku" — je přesně to ticho, které nesnáším. Karta
> zmizí a... stalo se vůbec něco? Komu? S jakým termínem? Odkaz si musím jít vyhrabat do
> Odchozí pošty, a když nikdo nenastavil relay, tak ta "odeslaná" nabídka nikdy neopustila
> náš server — a já to z té obrazovky nepoznám. A ten dopis: milý, ale prázdný. Bez
> platnosti, bez nástupu, bez benefitů, bez podpisu konkrétního člověka. Tohle bych
> klientovi banky neposlala bez přepsání — a jazyk hádaný z CV místo z profilu kandidáta
> mě jednou spálí. Přijala bych to? Ano, ale až mi tlačítko řekne, co udělalo.
