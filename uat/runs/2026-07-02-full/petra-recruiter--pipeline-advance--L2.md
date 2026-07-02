# L2 empirical — petra-recruiter × pipeline-advance

- **Run:** 2026-07-02-full · live kp @ http://localhost:3009 · cert level L2 (real browser, cs locale, dev gate)
- **Verdict:** **L2-conditional** — the board mechanics and the drawer's unified story are genuinely trustworthy live; the money-path shortcut (`advance top N`) is confirmed to mint a phantom hire and destroy a drafted offer, and the Hired guard still lies to her about why it refused.
- **Time saved (re-measured live):** **~6–8 min per candidate touch** (drag is instant + persists; the full story opens in one drawer in ~2 s; the offer draft took **20 s** vs ~15 min by hand) ≈ **2–2.5 h/week** at her load · **medium-high** confidence. Discounted from L1's 8–10 min because the score contradictions (below) force her to re-check numbers she should be able to trust.
- **Grounding (re-scored):** **5/8** unchanged (automation-run.ts axes identical); live samples on the grounded path were GOOD — the offer letter and outreach both quoted real profile facts.
- **Fixtures:** own additive entries (m-cand-013-job-000 @Offer/99, m-cand-011-job-004, m-cand-014-job-004); seeded candidates touched read-only or additively (one scheduling invite on pe-008). **Evidence residue left deliberately:** m-cand-013-job-000 sits at Hired with no offer record — it *is* finding pa-advance-top-bypasses-offer-flow. (Also: two fixture labels were created mojibake by my own tooling and repaired in-place — screenshots l2-pa-01/02 show the corrupted labels; that was the driver's fault, not the app's.)

## What I walked (in character)

1. **Ranní tabule.** `/` lands on Pipeline, all Czech, stat chips + Today rail. Two sores on arrival, neither mine to re-prove: the automation strip still renders a 14-day-old **"no such column: slot_at"** as if current (cross-ref OO-L2-15/EB-L2-11), and the rail counted my fixture under *"2 nabídky u kandidátů — čeká se na odpovědi"* before any offer existed (cross-ref OO-L2-11 — the rail reads stage, not the offers store). `shots/l2-pa-01-board.png`
2. **Přetáhnu kandidátku o fázi dál.** Drag Prověřeno→Pohovor: card lands instantly, **hard refresh → still there**; drag back → sticks; drawer history shows **both** moves ("přesunut/a do fáze Pohovor náborářem", "… do fáze Prověřeno náborářem"). The DoD's no-silent-loss core **holds live**. `l2-pa-03/04/05/06b`
3. **Otevřu zásuvku.** First instinct — click the name — threw me to the **Match tab** (a full context switch); the drawer lives behind a sparkles icon that only appears on hover and is labeled "Akce AI", though it holds the history, letters, notes and consent (new minor, pa-l2-drawer-discoverability). Once open, the drawer is the best thing on this board: analysis with deep link + disposition, invites, offers, full letters with honest "OUTBOX" badges.
4. **Tabule žije sama.** With the board open and untouched, a server-side stage move surfaced in **28.2 s** — one 30 s poll tick, no reload. (The journey file says SSE; there is none — cursor polling, and it's good enough.) `l2-pa-10`
5. **Pošlu ho na pohovor.** From Roman Malý's drawer: "Vytvořit odkaz pro plánování" → link + **"✓ Odkaz na výběr termínu odeslán kandidátovi"**, Outbox row exists, timeline gains the invite. Except — the letter the "Czech" confirmation refers to went out **in English** ("Pick your interview time… Hi Roman Malý"), because board-sourced entries have `locale NULL → en` (major, pa-l2-null-locale-english-letters). And the invite renders twice in the history, once Czech, once as raw "schedule invite sent" (minor). `l2-pa-11/12`
6. **K nabídce.** "Připravit nabídku" on my 99-match fixture: **20 s**, a warm Czech letter, salary **116 000 CZK** with the band (110–165k) visible — a number with a basis, as demanded. But the rationale line is English and says **"Match 29/100"** under a drawer header reading **99 SHODA** and a timeline analysis of **92** — three contradictory numbers for one candidate on one surface, and the offer was priced off the 29 (cross-ref OO-L2-10 / reconciliation.md). `l2-pa-13`
7. **"Advance top 1."** Preview showed name, 99 %, job — **not even the stage** (the API sends it; the UI drops it), no hint of consequence. Confirm → "Hotovo — zpracováno 1 kandidát." Forensics: **Hired with zero offer rows, the drafted letter destroyed (approval NULL), zero comms, zero onboarding, zero sealed decision** — and the Today rail now celebrates *"3 kandidáti tento týden přijati — … Karolína Hájeková"*. P1 confirmed end to end. `l2-pa-14/15/16`
8. **Přetáhnu do Najat/a.** Banner: *"Kandidáta se nepodařilo přesunout — tabule byla obnovena."* — false (nothing concurrent happened). Drawer path: *"Kandidáta se nepodařilo přesunout."* — nothing. The server's actual explanation (correct rule, English-only) dies in both catch blocks. P2 confirmed. `l2-pa-08/09`
9. **Feed.** "A. V. byl/a přesunut/a…" — with Aneta **V**eselá and Aneta **Č**erná live in one lane, initials were at their limit inside a single test run; rows aren't clickable. P3 confirmed. `l2-pa-07`

## Scored acceptance criteria (identical to L1, judged live)

| Criterion | L2 result |
|---|---|
| completion — advance without dead-end | **pass** — drag/drawer/bulk all complete; Hired detour still unexplained (P2) |
| senior-quality/trust — reasoning cites the real CV | **pass (samples)** — offer letter + outreach quoted real CV facts; grounded path exercised |
| trust — zero hallucinated skills | **pass (samples)** — every named skill traceable to the profile in both letters |
| senior-quality — score with drivers | **fail live** — three contradictory scores (99 board / 92 analysis / 29 offer rationale) with no reconciliation; the drivers exist one click away but the numbers disagree |
| trust — salary with basis | **pass** — 116 000 CZK with the 110–165k band and (an English) rationale |
| clarity — no silent success | **fail on the money path** — "Hotovo — zpracováno 1 kandidát" hid a phantom hire; Hired refusal mis-explained |
| time-saved — faster than manual | **pass** — ~6–8 min/touch live |
| language — Czech UI + output | **partial** — board/drawer Czech; command bar English-only with self-defeating Czech examples; candidate letters English for NULL-locale entries; offer rationale + 422 text English |

## Findings this lens confirmed/raised

Confirmed: **P1** (advance-top phantom hire — enriched: no seal, stats pollution, preview hides stage), **P2** (both clients + English 422), **P3** (initials, non-navigable). **P4** stands live-unverified (no offer can lapse in-session; renderer code unchanged; cross-ref OO-L1-06). **P5** sharpened minor→major (the bar's own Czech examples fail with English "Didn't catch that."). New this pass: **pa-l2-null-locale-english-letters** (major), **pa-l2-invite-event-raw-english-duplicate**, **pa-l2-drawer-discoverability**. Strengths confirmed: CAS move integrity, unified timeline, live poll + preview grammar.

## Character feedback (first person, live)

> Ta tabule je poctivá i naživo. Přetáhla jsem člověka, obnovila stránku — a on tam zůstal. Vrátila jsem ho — a v zásuvce vidím oba tahy, podepsané "náborářem". Server mi změnil kandidáta pod rukama a tabule to za půl minuty tiše srovnala sama. Tohle je poprvé, co nástroji věřím, že mi nepřepíše práci.
>
> Zásuvka je přesně to "všechno na jednom místě", co jsem chtěla — analýza s odkazem, pozvánka, celé dopisy i s tím, že jsou jen ve frontě. Jen ji schovali za ikonku hvězdiček, která se ukáže, až když na řádek najedu myší, a jmenuje se "Akce AI". Klikla jsem na jméno a byla jsem najednou v Párování. Napodruhé už to vím; nová kolegyně to hledat bude.
>
> A teď to horší. Nabídka se napsala za dvacet vteřin, česky, se mzdou a pásmem — dobře. Ale ta samá karta mi tvrdí tři čísla: 99 shoda nahoře, 92 v analýze, a v odůvodnění mzdy anglicky "Match 29/100" — a mzda se spočítala z těch 29. Které číslo mám hájit před manažerem? A pak jsem napsala "advance top 1" a systém mi z kandidátky s rozepsanou nabídkou udělal zaměstnankyni. Bez nabídky. Bez e-mailu. Rozepsaný dopis prostě zmizel a statistika týdne si ji připsala jako přijatou — jmenovitě. "Hotovo — zpracováno 1 kandidát." To není hotovo, to je průšvih, který najde manažer dřív než já.
>
> A když jsem ji zkusila přetáhnout do Najat/a ručně, řekli mi, že "tabule byla obnovena". Nebyla. Prostě tam je pravidlo — správné pravidlo! — tak mi ho řekněte česky, server tu větu umí… anglicky.
>
> Adoptuji? Tabuli a zásuvku ano, hned. Příkazový řádek nepustím k ničemu, co umí měnit fáze, dokud neopraví tu zkratku do Najat/a — a dokud dopisy mým českým kandidátům nepřestanou odcházet anglicky, zatímco mně zásuvka česky tvrdí, že je "odesláno".

## L2 evidence index

`shots/l2-pa-01..16` + aria/text sidecars; raw 422 body in run log; DB forensics (offers=0, approval NULL, decision_records=0, dev_outbox=0 for m-cand-013-job-000); measured: offer draft 20.1 s, advance round trip ~6 s, live poll reflection 28.2 s.
