# L2 — Petra Nováková (recruiter) × offer-onboarding

- **Run:** 2026-07-02-full · main @ 3395b4c · cert level L2 (empirical, live browser on :3009, cs locale, DEV_AUTH=1)
- **Verdict:** **L2-conditional** — the money path completes live end-to-end (draft → approve+send → candidate accept → Hired → onboarding hand-off with answers back on her tab), and the automation chasing (T-48h nudge, deadline, intake chip) demonstrably runs itself. The L1 majors all confirmed live: the send is silent (the server literally hands the UI the link and the UI throws it away — captured), the letter is below her senior bar, and the comms mix languages. New at L2: the approval card shows two contradictory match numbers.
- **Grounding score (offer-draft AI surface), re-measured live:** **4/8** (unchanged — confirmed empirically: cs letter from CV-language guess over an en footer; no CV evidence, no terms, no deadline in the letter)
- **Time saved, re-measured:** **~25–35 min per offer · medium** (draft 21 s + approve ~1 min + chasing fully automated ≈ the L1 ~40 min promise, minus the Comms-Center link hunt and minus the rewrite pass the letter still needs)
- **Environment note (affects this whole run):** the session began against a **wedged dev server** (PID 20380, booted by the killed prior agent): every money-path route (`/api/offer/[token]`, `/api/onboarding/*`, `/api/tasks/[id]`, `POST /api/pipeline/[id]`, `/api/status`, `/api/apply`, timeline) returned HTML 500s in 8–12 s. Recovered per the skill's wedged-server protocol (kill PID, delete `.next`, restart on :3009); after recovery every probe returned correct JSON (404/400/422/200). All product verdicts below are from the healthy server; the wedge itself is env, not product — except the degraded-mode UI behavior it exposed (OO-L2-12).

## What I actually did (in order, with artifacts)

1. **Board → drawer** (`/?q=Bartošová`): Anna Bartošová sits in **4. NABÍDKA** on the Junior Fullstack Engineer lane (shots `l2-offer-p1-anna-01-board*`). The drawer opens via the **hover-hidden sparkles button** ("Akce AI pro Anna Bartošová", `PipelineShared.tsx:262-272`, `opacity-0 group-hover:opacity-100`) — clicking her *name* navigates to the Match/Profile workspace instead (shot `l2-offer-p1-anna-02-drawer*` from the mis-click). A first-timer will lose a minute here.
2. **Draft offer** ("Připravit nabídku", Claude CLI per the drawer's own disclosure): server-side the task succeeded in **21 s** (tasks table `t-mr3rnvt3`, 17:16:35→17:16:56). On the wedged server the drawer spun "Pracuji…" for 162 s+ with no error (OO-L2-12); on the healthy server the result view rendered promptly (shot `l2-offer-p2-anna-redraft-04-draft-result*`): provenance chip **CLAUDE CLI**, 48 000 CZK, band bar, band line **pásmo 45 000–70 000 CZK**, rationale, subject, the full Czech letter, and the applied note *"Nabídka připravena — schvalte ji v Rozhodnutích."* — a real preview with a named next step.
3. **Approve & send** (Decisions): the offer card (shot `l2-offer-p3-send-anna-02-card.png`) shows the figure, the band position, the rationale and the **per-offer deadline input**; I set **1 den** and clicked "Odeslat nabídku". The card faded out. **Nothing else happened** (shots `-03-after-click-0s`, `-04-after-click-3s`; `confirmationSeen: false`). The captured network response proves the cruelty: the server returned `{ offerExtended: true, link: "http://localhost:3009/offer/tk-lInC0Gx5…" }` and `DecisionsTab.act()` discarded it (`DecisionsTab.tsx:176-214`). OO-L1-02 **confirmed live**, on the money click.
4. **What "sent" means, verified:** `offers` row minted with `expires_at` exactly **+24 h** (deadline lever honored at its minimum); `dev_outbox` row `kind=offer, recipient="Anna Bartošová" (a NAME, not an address), channel=outbox, status=queued` — terminal. The letter body (Comms Center expand, shot `l2-offer-p4-verify-06-outbox-expanded*`): Czech letter, **absolute** response link (request-origin fallback), **English** response footer, **English** GDPR footer with a **host-less** `/data/er-…` link. The Comms Center itself carries the honest banner *"Není nakonfigurováno doručovací relé — tyto zprávy se NEodesílají kandidátům"* (OO-L2-S7) — the truth exists, one tab away from where I clicked send.
5. **The chasing runs itself:** 37 s after the send, the heartbeat fired the **T-48h reminder** (due immediately for a 24 h offer): it *does* state the deadline ("by Jul 3, 2026, 7:46 PM") — but it's **entirely English** to a Czech candidate and its offer link is **host-less** (`/offer/tk-…`) — undeliverable-and-unclickable if a relay were on (OO-L1-01/03 live).
6. **Hand-off back to me:** after Tereza's leg — TodayRail shows *"2 kandidáti tento týden přijati — Anna Bartošová, Vít Malý"*; the drawer history carries the whole chain (drafted → **Nabídka odeslána** → reminder → **Nabídka přijata** → onboarding started → intake submitted; shot `l2-offer-p5-drawer-hired.png`); the **Onboarding tab** shows Anna's run with **"DOTAZNÍK VYPLNĚN"** (Jan Sedláček / Eliška Králová honestly show NEVYPLNĚN — distinct fixtures), and the run detail has **every answer Tereza typed, verbatim** ("Anička", "M", "Bez lepku…", "Notebook s CZ klávesnicí…", "Petr Bartoš…", 2026-08-03; shot `l2-offer-p5-run-detail-answers.png`). The e-sign block honestly says it's a demo until an eIDAS provider is connected. Commit 3c9f4f8's loop is **live**.

## Walkthrough vs her scored criteria (live)

- **completion** ✓ — end-to-end with no re-entry; manual Hired is 422-refused with an instructive message (probed live: *"Hired is set when the candidate accepts an offer…"*).
- **salary basis** ✓/✗ — number + band + rationale at the approval point ✓; but the rationale says **"Match 49/100"** while the same card header says **57 SHODA** (and the drawer history shows an analysis score of 70). Which number priced this offer? (OO-L2-10, new). Also the rationale is **English** in my Czech UI (OO-L2-13).
- **no silent success** ✗ **MAJOR, confirmed live** — the send click answers with nothing; the link the server returned is discarded; the only recovery is the Channels tab (OO-L1-02).
- **senior-quality of the letter** ✗ **MAJOR, confirmed live** — warm, fluent Czech, correct vocative "Milá Anno" — and then: **no validity deadline in a letter whose offer dies in 24 hours**, no start date, no benefits, no named human, signed "tým České spořitelny", and a gender slip (*"přesně takového kolegu jsme hledali"* — for Anna). I would rewrite this before it left the bank (OO-L1-04).
- **language** ✗ — one email, two languages (cs letter, en chrome); reminder and welcome emails fully English to a cs candidate; timeline verbs half-English ("offer sent" next to "Nabídka odeslána") (OO-L1-03 + OO-L2-13).
- **time-saved** ✓ — 21 s draft, ~1 min approve, reminders/lapse/nudges all on the heartbeat (reminder observed firing live). Real.
- **clarity (state visibility)** ✓ mostly — the record is impeccable (activity feed + drawer history + comms log); only the *moment of action* is mute. The TodayRail before any offer existed claimed *"2 nabídky u kandidátů — čeká se na odpovědi"* off pure stage inference — a false "sent" claim (OO-L2-11); it corrected itself once real approvals/offers existed.

## Findings raised/confirmed here

Confirmed live: OO-L1-01, OO-L1-02, OO-L1-03, OO-L1-04, OO-L1-07 (Tomáš's, seen on my card too).
Unobservable this session (min TTL 24 h; no DB writes): OO-L1-05, OO-L1-06 — code re-checked on the live tree, both stand.
New L2-only: OO-L2-10 (match-number contradiction), OO-L2-11 (rail claims offers-out from stage alone), OO-L2-12 (infinite "Pracuji…" with no error under persistent result-fetch failure), OO-L2-13 (mixed-language recruiter trail), OO-L2-14 (undeclined Czech names in chrome), OO-L2-15 (scheduler panel shows a 14-day-old historic error as current). Strength: OO-L2-S7 (honest relay banner).

## Character feedback (first person, Petra)

> Musím uznat: ten stroj pod tím **funguje**. Návrh za dvacet vteřin, číslo v pásmu s důvodem,
> termín si nastavím po nabídce — a pak už to jede samo: připomínka kandidátce odešla sama za
> minutu, přijetí rovnou založilo onboarding a dotazník od Aničky mi přistál vyplněný v detailu,
> slovo od slova. Deník kandidáta je kompletní příběh. Tohle předání jsem chtěla šest let.
>
> Ale ten hlavní klik je pořád němý. "Odeslat nabídku" — karta zmizí a ticho. Server přitom ten
> odkaz vrátil — viděla jsem to na síti — a obrazovka ho zahodila. Jdu ho lovit do Kanálů, kde se
> mimochodem dozvím, že se ty zprávy **vůbec neposílají**. A ten dopis: milý, hezky česky, jenže
> nabídka platí do zítřka a dopis to *neříká*; žádný nástup, žádné benefity, žádný podpis člověka
> — a Anně píšeme, že hledáme "takového kolegu". Nabídkovou kartu mi navíc podepisují dvě různá
> skóre — 57 nahoře, 49 v odůvodnění — a mzdu počítá to druhé. Které mám hájit před manažerem?
> Přijala bych to? Ano — je to poprvé, co nabídková fáze pracuje za mě. Ale než to pustím na
> klienty banky: ať to tlačítko mluví, ať je dopis úplný a ať se ta čísla shodnou.
