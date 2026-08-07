# L2 — Tereza Králová (candidate) × offer-onboarding

- **Run:** 2026-07-02-full · main @ 3395b4c · cert level L2 (empirical, live browser on :3009, **DEV_AUTH=0**, cs locale, fresh context, real minted tokens — embodied as the two seeded offer candidates: accepted Anna Bartošová's offer `tk-lInC0Gx5…`, inspected Adam Sedláček's `tk-PRWTztdw…`)
- **Verdict:** **L2-conditional** — the tokenized pages she actually touches are the best candidate experience in this run: official-looking offer, real number, honest countdown, plain-Czech AI disclosure, a decline that asks first, and an accept that lands on a *fillable next step* instead of "ozveme se". But everything that would have *reached her mailbox* is broken in her language and in its links: the chrome of all three emails is English, and two of the three carry host-less links she could never click.
- **Grounding score:** 4/8 (unchanged; the mixed-language email is the live proof of the language-authority split)
- **Time saved, re-measured:** **IF the link reaches her: ~30 min of status-chasing avoided + the next step known the second she accepts** (her live accept→questionnaire→submitted took under 3 minutes). **On the default deployment: ~0** — all four messages terminated in the internal outbox, addressed to her *name*, and would never have arrived (OO-L1-01). Her token had to be hand-delivered for this leg to exist at all.
- **Environment note:** on the wedged pre-recovery server her `/api/offer/[token]` GET/POST returned HTML 500s — she would have seen the retryable "Tuto nabídku se nepodařilo načíst" card forever. All verdicts below are from the recovered server.

## Leg 1 — /offer/[token] (live)

- **The card reads official** (shot `l2-offer-z2-anna-01-offer-page.png`): letterhead strip, **ČS monogram**, "Česká spořitelna", the role, *"Připraveno pro Anna Bartošová"*, **48 000 CZK** locale-formatted, and the prompt in warm Czech. On Adam's offer the same card shows 53 000 CZK (distinct fixtures, no clone-stamping).
- **The countdown is honest and stateful, verified on both TTLs:** Anna's 24 h offer renders **coral** — *"Odpovězte prosím do 3. 7. 2026 19:46. zbývá 24 hodin."* (`className … text-coral` captured); Adam's 120 h offer renders steel — *"…do 7. 7. 2026 19:47. zbývá 120 hodin."* Czech date format, correct plural ("hodin"). The per-offer deadline truly reaches her (OO-L1-S4 confirmed live).
- **AI disclosure before deciding, in plain Czech** ✓ — *"K asistenci při screeningu a pohovorech používáme umělou inteligenci … Každé rozhodnutí … přezkoumává a činí člověk; nic nepříznivého se nerozhoduje automaticky. Kdykoli můžete požádat o přezkoumání člověkem."* + GDPR line. Exactly the disclosure she wants (strength, live).
- **Decline is deliberate, not a dark pattern (tested on Adam's offer, then cancelled):** "Odmítnout" → an `alertdialog` (*"Odmítnout tuto nabídku? Tuto akci nelze vrátit zpět."*) with **focus landing on the safe "Zpět"** (captured: `focused: "Zpět"`, `alertdialog: true`; shot `l2-offer-z1-adam-02-decline-confirm.png`). "Zpět" returned her to the intact offer. OO-L1-S2 confirmed live.
- **Accept** → *"🎉 Nabídka přijata — Vítejte ve společnosti Česká spořitelna!"* with the moss CTA **"Zahájit nástup"** linking `/onboarding/tk-lInC0Gx5…` — the SAME token, inline on the page (shot `l2-offer-z2-anna-02-accepted.png`). Reopening the link cold shows the accepted state persistently (truthfulness ✓, shot `l2-offer-z4-anna-reopen-01*`).

## Leg 2 — /onboarding/[token] (live)

- The questionnaire opened populated and **fully Czech** (shot `l2-offer-z3-onboarding-01-questionnaire.png`): *"Vítejte v týmu, Anna Bartošová!"*, role at company, and the six default fields all localized (Preferované jméno, Velikost trička, Stravovací požadavky, Preference vybavení, Nouzový kontakt, Potvrďte datum nástupu).
- Filled all six, submitted → *"Děkujeme — vše je hotovo. Vaše údaje jsme uložili a předali týmu…"* with **"Upravit údaje"** to edit again (shot `-03-saved.png`). Server-side the intake row carries every answer verbatim, and the recruiter's tab flipped to **DOTAZNÍK VYPLNĚN** with the answers pre-filled — her effort demonstrably reached a human's desk. The dead-end is truly closed (OO-L1-S1 confirmed live).

## The seam — what would have reached her mailbox (live bodies, Comms Center + outbox)

Four messages were generated for "her" during this journey. All four: `channel=outbox, status=queued` (terminal — the workspace itself admits *"tyto zprávy se NEodesílají kandidátům"*), addressed to **"Anna Bartošová"** — a display name, not an address. Their content, live:

| Message | Language | Link |
|---|---|---|
| Offer letter | **Czech letter** + **English** response footer + **English** GDPR footer | offer link **absolute** ✓; data link **host-less** ✗ |
| T-48h reminder (auto-fired 37 s after send — the only message stating her deadline) | **English only** | `/offer/tk-…` **host-less** ✗ |
| Welcome / onboarding | **English only** ("Hi Anna Bartošová, We're delighted…") | `/onboarding/tk-…` **host-less** ✗ |
| GDPR footer (all) | English | `/data/er-…` **host-less** ✗ |

OO-L1-01 and OO-L1-03 confirmed live, in the sharpest possible form: the one email telling her the offer dies tomorrow is in the wrong language with a link that doesn't resolve. Also live: the chrome never declines her name — *"Připraveno pro Anna Bartošová"*, *"Vítejte v týmu, Anna Bartošová!"*, "Hi Anna Bartošová" — a native reads template, not human (OO-L2-14); and the letter itself calls her *"takového kolegu"* (masculine).

**Unobservable this session:** offer expiry (min TTL is 24 h; no DB writes allowed) — OO-L1-05's silent lapse and OO-L1-06's timeline label stand on code re-check (`offers-store.ts:171-206` records events, calls no dispatcher), not on live observation.

## Walkthrough vs her scored criteria (live)

- **offer/accept → concrete next step** ✓✓ — her declared major, closed and verified live: page-CTA → populated questionnaire → submitted → confirmed.
- **no dead-ends / silence** ✗ **MAJOR** — default deployment delivers nothing; her whole leg existed only because the token was hand-carried (OO-L1-01, by-design but decisive for her).
- **comms sound human + Czech** ✗ **MAJOR** — mixed-language offer email; English-only reminder and welcome; undeclined names; one gender slip (OO-L1-03 + OO-L2-14).
- **trust / AI disclosure** ✓ — pre-decision, plain Czech, human-in-the-loop named.
- **decline deliberate** ✓ — confirmed live incl. focus behavior.
- **status truthfulness** ✓ — reopen shows the accepted state; the flaky-phone reconcile path exists (code, `page.tsx:105-118`).
- **silent terminal transition** ✗ (code-standing) — an expired offer would still tell her nothing (OO-L1-05).

## Character feedback (first person, Tereza)

> Ta stránka s nabídkou je poprvé za celé hledání práce, kdy jsem měla pocit, že se mnou někdo
> počítá. Logo banky, moje pozice, částka černé na bílém, a upřímně: i ten červený odpočet
> "zbývá 24 hodin" — radši vím, na čem jsem, než abych se dohadovala. Že u toho rovnou stálo,
> kde všude sáhla AI a že poslední slovo má člověk — česky, srozumitelně — to mi sedlo. Když jsem
> zkusila Odmítnout, zeptali se mě, jestli to myslím vážně, a kurzor mi sám skočil na "Zpět".
> A po Přijmout žádné "ozveme se" — rovnou dotazník, vyplnila jsem ho za dvě minuty večer u
> telefonu a druhá strana ho fakt viděla. Tohle je přesně ono.
>
> Jenže pak jsem si přečetla, co mi "poslali". Dopis česky — a hned pod ním "To accept or
> decline this offer…" anglicky. Připomínka, že mi nabídka zítra propadne — celá anglicky,
> s odkazem, který nikam nevede. Uvítací e-mail taky anglicky, "Hi Anna Bartošová" — tak mě
> nikdo živý neoslovuje. A hlavně: ve skutečnosti by mi nepřišlo NIC — ty zprávy zůstaly
> v jejich systému, adresované mým jménem místo adresy. Ta krásná stránka za zavřenými dveřmi,
> ke kterým mi nikdo neposlal klíč. Doručte mi to, česky a s funkčními odkazy — a já vám
> podepíšu, že lepší nástup jsem nezažila.
