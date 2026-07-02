# L2 — Tomáš Dvořák (hiring manager) × offer-onboarding

- **Run:** 2026-07-02-full · main @ 3395b4c · cert level L2 (empirical, live browser on :3009, cs locale, DEV_AUTH=1)
- **Verdict:** **L2-conditional** — his approve leg is genuinely a sub-minute, one-card, one-click decision with the number, the band and the deadline lever all working live. But the click stays silent (confirmed with the discarded server response), the card sends a letter he never saw (confirmed — and this letter had a gender error in his bank's name), and the card shows two contradicting match numbers.
- **Time saved, re-measured:** **~15 min per offer + days of e-mail latency · medium-high** — the live review-and-approve took under 90 seconds against the card; well inside his 15-minute window. The caveat is what the silence costs him afterwards.
- **Environment note:** same wedged-server start as Petra's leg (see her journal); his approve was exercised on the recovered healthy server. On the wedged server his approve POST (`/api/pipeline/[id]`) would have 500'd — worth knowing that when this app's dev server degrades, it is precisely the *decision* endpoints that die first.

## What he did (live, with artifacts)

1. **Decisions queue** (`/?tab=decisions`, shot `l2-offer-t1-send-adam-01-decisions*`): the offer card for Adam Sedláček is self-describing — tag **BALÍČEK NABÍDKY**, **53 000 CZK** headline, the candidate, a band bar, *"pásmo 50 000–80 000 CZK"*, a one-line rationale, and the **"Reagovat do … dní"** input. No tutorial needed; his "co po mně chcete?" is answered by the layout.
2. **The deadline lever (commit b7c40a8) — verified end-to-end with two distinct values:** Petra's offer went out at **1 den** → `expires_at` exactly +24 h → the candidate page renders a **coral** countdown "zbývá 24 hodin"; his went out at **5 dní** → exactly +120 h → **steel** countdown *"Odpovězte prosím do 7. 7. 2026 19:47. zbývá 120 hodin."* (shots `l2-offer-z1-adam-01-offer-page*`, `l2-offer-z2-anna-01-offer-page*`; offers table deltas measured). The lever is real, per-offer, and reaches the candidate.
3. **One click, then silence:** "Odeslat nabídku" → the card faded; **no confirmation of any kind** (`confirmationSeen: false`, shots `-03/-04`). The server responded `{ offerExtended: true, link: "…/offer/tk-PRWTztdw…" }` — captured on the wire, discarded by the UI (`DecisionsTab.tsx:176-214`). OO-L1-02 confirmed live from his seat: a man who's here 4× a quarter now has to *trust* that something happened, or email the recruiter — which defeats the tool.
4. **What he approved without seeing (OO-L1-07 confirmed live):** the card's full text was captured — number, band, rationale, deadline, two buttons. **No subject, no letter body, no expander.** The letter that then went out in Česká spořitelna's name (readable only in the Comms Center) greeted Petra's candidate with a masculine *"takového kolegu"* — exactly the class of embarrassment a preview would have caught.
5. **The numbers he anchors on disagree (OO-L2-10, new):** his card says **59 SHODA** at the top and *"Match 51/100 places the offer at ~10 % of the band"* underneath (Anna's: 57 vs 49). The salary is computed from the second number (`automation.py:725-731` recomputes the match at draft time) while the header shows the stored board score. At these values both clamp to the same 10 % of band — the CZK amount happens to be identical — but the card as shown asks him to stake a comp decision on a self-contradicting basis. Also: that rationale line is **English** on his Czech card (OO-L2-13).
6. **The guardrails he never sees but benefits from, re-verified live:** a manual move to Najat/a is refused — `POST set_stage → Hired` returned **422** with the instructive *"Hired is set when the candidate accepts an offer… Move them to Offer and extend an offer."* (probed live); the Hired transition happened only when the candidate accepted; a week-of-hires rail row credited it. His "Přijat until they actually say yes" instinct is enforced by the system (OO-L1-S6 live).

## Walkthrough vs his scored criteria (live)

- **completion** ✓ — review → deadline → approve in <90 s, zero training.
- **effort (no recruiter work)** ✓ — he typed one number (5), nothing else.
- **clear recommendation** ✓/✗ — one number with a basis and a band position ✓; but two match scores on one card contradict each other (OO-L2-10) and the basis sentence is in English (OO-L2-13).
- **clarity of the decision + confirmation** ✗ **MAJOR, confirmed live** — no "Nabídka pro Adama odeslána, platí do 7. 7."; the card just vanishes (OO-L1-02).
- **what am I approving?** ✗ minor→confirmed — the letter is not viewable from the card (OO-L1-07); the gender slip in the actual letter shows the risk is not hypothetical.
- **language / jargon** ✓ mostly — card chrome is plain Czech; the rationale line is the one English intrusion.
- **time-saved** ✓ — comfortably inside 15 minutes; the deadline lever is exactly his "force a decision, free the headcount" tool, now proven to reach the candidate's countdown.

## Findings raised/confirmed here

Confirmed live: OO-L1-02 (shared, his criterion), OO-L1-07, OO-L1-S4 (lever e2e), OO-L1-S6 (Hired guard 422).
New L2-only on his surface: OO-L2-10 (contradicting match numbers on the approval card), OO-L2-13 (English rationale in cs UI).

## Character feedback (first person, Tomáš)

> Neuvěřitelné, ale bylo to hotové, než mi vystydlo kafe. Jedna karta: číslo, proč, kde v pásmu,
> do kdy má kandidát odpovědět. Dal jsem pět dní, kliknul, hotovo. A vidím, že to není divadlo —
> kandidátovi fakt běží odpočet do 7. 7. a "Najat" si nikdo ručně nenaklikne, to mi systém rovnou
> zatrhl s vysvětlením. Takhle má vypadat nástroj pro člověka, co nemá čas.
>
> Co mě štve, a řeknu to natvrdo: kliknu "Odeslat nabídku" a ono NIC. Karta zmizí. Server tu
> odpověď měl — a obrazovka mi ji nedala. Já se mezi poradami nechodím doprošovat záložky
> "Kanály". A druhá věc: schválil jsem dopis, který jsem neviděl — a on pak jde ven pod hlavičkou
> mé banky s "takového kolegu" pro slečnu Bartošovou. Aspoň náhled, prosím. A ať se ta dvě skóre
> na kartě dohodnou, které z nich mi počítá mzdu. Jinak? 90 vteřin na nabídku. Kolegům to ukážu —
> hned jak to tlačítko začne odpovídat.
