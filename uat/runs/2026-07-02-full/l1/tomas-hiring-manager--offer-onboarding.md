# L1 — Tomáš Dvořák (hiring manager) × offer-onboarding

- **Run:** 2026-07-02-full · main @ 3395b4c · cert level L1 (theoretical, code-grounded, no browser)
- **Verdict:** **L1-conditional** — his approve step is genuinely one-click with a clear
  recommendation, but the confirmation after the click is silent (major) and he approves a
  letter he can't read from the card (minor).
- **Grounding score (offer-draft AI surface):** **4/8** (same surface as Petra's audit)
- **Estimated time saved (if it all works live):** **~15–20 min per offer + days of e-mail
  latency · medium confidence** (LLM-less way: comp back-and-forth over an email thread;
  app: one card with number + band + rationale + deadline lever, one click)

## Surface model (his slice)

- **Where the decision reaches him:** the Decisions queue, filtered to
  `approvalKind === "offer_review"` (`app/features/sub_decisions/DecisionsTab.tsx:119-127`),
  plus the TodayRail nudge "offer reviews → open Decisions"
  (`app/features/sub_pipeline/TodayRail.tsx:48,76-85`).
- **What the card gives him:** tag "Balíček nabídky", the recommended number + currency,
  a band bar showing where in the role band the number sits, the one-line rationale
  ("Match X/100 places the offer at ~Y% of the band…"), and the per-offer deadline input
  (1–90 days, default 7) — `app/features/sub_decisions/AiReviewCard.tsx:38-47,55-100`;
  rationale generated deterministically in `pipeline/jobfit/automation.py:728-731`.
- **What one click does:** `onAccept(ttlDays)` → `POST /api/pipeline/[id]`
  (`DecisionsTab.tsx:176-214,191`) → `extendOffer` mints/reuses ONE open offer (atomic,
  `app/_lib/offers-store.ts:268-276`; DB-enforced single open offer per entry `:67-71`),
  stamps the deadline (`:133-135`), seals the offer-terms decision
  (`app/api/pipeline/[id]/route.ts:57-66`), dispatches the letter with the tokenized
  accept/decline link (`route.ts:71-72`, `app/_lib/comms-dispatch.ts:235-246`) and clears
  the approval (`route.ts:75`). Reject on the same card routes the respectful rejection
  comm (`route.ts:262`).
- **After his click:** the Hired move belongs to the candidate, not to him
  (`app/_lib/offer-finalize.ts:57-66`); a manual Hired shortcut is structurally refused
  (`route.ts:102-107`); a stale decline on an old link can never demote someone he already
  hired (`offers-store.ts:321-336`). Aging offers surface on the TodayRail as "offers out"
  (`TodayRail.tsx:50`), lapse on their own (`instrumentation-node.ts:69-78`) and remind the
  candidate at T-48h (`app/_lib/offer-reminders.ts:19-46`) — nothing for him to chase.
- **Stale-view safety:** his decision carries `expectedStage`; a concurrent change 409s
  with the fresh entry instead of blind-overriding (`route.ts:213-223`).

## Reachability (resolved before judging)

Decisions (offer approval), Pipeline (read) and Onboarding are all inside his declared
binding; kp has no per-role nav gating, so his path is TodayRail/Decisions → one card.
Fixture: a seeded entry at Offer stage holding an `offer_review` approval. Nothing in his
journey is `unreachable`.

## Walkthrough vs his scored criteria

- **completion** ✓ — review + approve/reject an offer in a few obvious clicks; no tutorial:
  the card is self-describing (tag, number, band bar, one green button).
- **effort (no recruiter work)** ✓ — he types nothing except (optionally) adjusting the
  deadline days; the number, band and rationale are pre-computed.
- **clear recommendation** ✓ — a single number with its basis and a visual position in the
  band; his "co po mně chcete a kdo je nejlepší?" question is answered by the card layout
  (what: send/reject; anchor: the number + rationale).
- **fair comparison** n/a here (group-eval is a different journey step).
- **clarity of the decision + confirmation** ✗ **MAJOR (OO-L1-02, shared with Petra)** —
  the button says "Odeslat nabídku", and after the click the card silently disappears
  (`DecisionsTab.tsx:178` removes it after 260 ms; the response's `offerExtended`/`link` is
  discarded). He gets no "offer sent to Tereza K., valid until …" — for a man who drops in
  4× a quarter, an unconfirmed send means an email to the recruiter to ask whether it
  worked, which defeats the tool.
- **what am I approving?** — **minor (OO-L1-07)** — the approval payload contains the
  letter's `subject`/`body` (they render in the drawer's draft view,
  `CandidateResultView.tsx:108-109`) but the Decisions card never shows them
  (`AiReviewCard.tsx:65-101`). His click sends a letter in the company's name that he has
  not seen. He mostly cares about the number — but "Send offer" without the offer text is
  a trust papercut. Code check: present-but-missed → confusion.
- **language / jargon** ✓ — the card is plain Czech ("Balíček nabídky", "Reagovat do …
  dní", "pásmo X–Y CZK"); no HR-speak (messages/cs.json `decisions.aiReview`).
- **time-saved** ✓ — well inside his 15-minute window; the deadline lever
  (`AiReviewCard.tsx:85-100`) is exactly the "force a decision, free the headcount" tool a
  line manager wants (commit b7c40a8 verified end-to-end: input → route `:50` → mint
  `offers-store.ts:133-135` → candidate countdown `app/offer/[token]/page.tsx:267-280`).

## Findings raised here

OO-L1-02 (major, shared), OO-L1-07 (minor), OO-L1-08 (polish, shared) — plus strengths
OO-L1-S3/S4/S6. See `offer-onboarding.findings.json`.

## Character feedback (first person, Tomáš)

> Tohle je poprvé, co mi HR nástroj dal to, co chci: jedno číslo, u něj proč, pásmo,
> do kdy má kandidát odpovědět, jedno tlačítko. Nastavil jsem 5 dní — pobočka nepočká —
> a bylo to. Žádné tabulky, žádné školení. A líbí se mi, že "Přijat" nastane, až když
> kandidát fakt kývne, ne když někdo omylem přetáhne kartičku.
>
> Co mě štve: kliknu "Odeslat nabídku" a karta prostě zmizí. Odesláno? Komu? Do kdy?
> Nevím — a já se mezi dvěma poradami nebudu doprošovat systému. Napište mi tam větu:
> "Nabídka pro Terezu K. odeslána, platí do 7. 7." A ještě něco: posílám dopis, který jsem
> neviděl. Číslo schválím rád, ale text jde ven pod hlavičkou mé banky — aspoň náhled mi
> ukažte. Jinak? Za 15 minut hotovo, to se mi nestalo nikdy. Řekl bych o tom kolegům —
> hned potom, co mi to tlačítko začne odpovídat.
