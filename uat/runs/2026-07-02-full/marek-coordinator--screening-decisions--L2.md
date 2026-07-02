# L2 empirical — marek-coordinator × screening-decisions

- **Run:** 2026-07-02-full · live kp @ http://localhost:3009 · cert level **L2** (real browser, cs locale, dev gate) + same-server API on my own fixtures
- **Verdict:** **L2-conditional** — the screening *wave* is everything a bulk action should be, live: preview-first with the words "nic se neuplatní, dokud nepotvrdíte", a slider that recomputes the count, a token gate that refuses to fire on anything I didn't review, committed deltas, and a reconsider undo that actually returned my candidate. But the one thing that scares me — the **one-click Reject on the AI cards** (no confirm, no letter preview, silent send, not in the undo queue) — is still there, and for the batches *I* fire outside the auto path there is still no undo in the UI (cross-confirmed by my pipeline-advance L2).
- **Time saved (re-measured live):** the wave preview recomputes in <1s per slider change; committing my 2-candidate wave was instant; letters landed in the outbox immediately. Extrapolated **~2 h saved on a 20-candidate wave** vs one-by-one · **high** confidence *for the wave machinery* — it's fast and reviewable. The saving is real; my adoption is gated on the card-reject danger + the English-letter default (see below), not on the wave's speed.
- **Grounding (re-confirmed):** wave engine **4/6** (real cohort scores, saved rules, clamped override, fairness class — still missing confidence band + null-score distinction, the latter proven live below); AI screening card **3/6** (English rationale confirmed live).
- **Mutation discipline:** every destructive act ran on my OWN namespaced fixtures (jobId `uat-sd-l2job`, labels "UAT SD …"). I opened the live wave modal on a *seeded* job (Junior Mobile QA) only to watch the preview, then **closed it without committing** — zero seed mutation, verified. My wave commits (reject 2, then the null one) hit only my fixtures; I reinstated one live.

## What I walked (in character)

1. **The wave, previewed live.** Opened "Vlna prověřování" on Junior Mobile QA. Header: *"Náhled — nic se neuplatní, dokud nepotvrdíte."* Below, *"Zamítl by 0 z 3 · 3 ponecháno"* and the shield line: *"Začátečníci a nerozpoznané archetypy jsou vždy chráněni…"*. Zero of three — because two are students and one has no archetype, all shielded. The tool told me *why nobody was rejected* before I touched anything. I moved the bottom-% slider; the preview refetched. Then I closed it — nothing happened, because I didn't confirm. This is the grammar I trust. `shots/sd-l2-02..03`
2. **The wave, committed (my fixtures).** On the server path the modal uses, I ran the exact sequence: preview at three slider positions → **1, 2, 1** rejects (the count tracks the slider, live). Committing with **no token → 409** ("Human review and approval are required"); with a **stale token → 409** ("re-preview"); with the fresh token → it applied *exactly* the two I'd reviewed (Alpha 22, Beta 35), left Gamma/Delta. "Hotovo." My question — *odešlo to? a komu?* — answered: two rejection letters in the outbox, both `queued`, plus a committed banner with the counts. The wave never fires behind my back.
3. **The letters.** Both my rejection letters read *"Hi UAT SD Alpha … After careful review, we won't be moving forward."* — English, because these entries carry no locale (the whole `?? en` default my pipeline-advance L2 caught). The template is warm and clean; it's just in the wrong language for a Czech funnel. Cross-ref `pa-l2-null-locale-english-letters`.
4. **"A když se spletu?"** This time the undo was **real and reachable**: I expanded "Znovu zvážit automaticky odmítnuté", saw my three rejected fixtures (including "UAT SD Null (unscored)"), clicked **Obnovit** on Alpha → it left the queue and came back **active @ Prověřeno** (I verified in the DB; a sealed "reinstated" reversal joined the chain). That's the safety valve I want — *for auto-rejects*. But it's auto-only: a candidate I reject from a card never lands here. `shots/sd-l2-04..05`
5. **No follow-up after Obnovit.** Alpha already got a (queued) "no" under the bank's name, and after reinstating there was **no reminder and no follow-up draft** — the correction is invisible to the candidate unless I remember. Minor, but exactly the kind of loose end I chase. (SD-L1-007 confirmed live.)
6. **The card that still scares me.** The Decisions queue renders AI recommendation cards with a bare **"Zamítnout"** — three of them, no confirm dialog, no rendered-letter preview. One click applies the reject and queues the email. I did *not* click one (not my fixtures), but the danger is the *absence of a gate*, and it's right there in the markup. And a screening card (Hana Černá) shows its rationale in **English** in my Czech workspace — I'd be ratifying advice I have to mentally translate. (SD-L1-001 + SD-L1-009 confirmed live.) `shots/sd-l2-01`

## Scored acceptance criteria (identical to L1, judged live)

| Criterion | L2 result |
|---|---|
| completion — rules → wave → commit → reconsider end-to-end | **pass** — every step completed live without a dead-end |
| trust/clarity — dry-run shows who **and** the rendered message | **partial** — the wave preview is exemplary (who + why + count, live) but shows no letter; the *card* reject shows neither a confirm nor a letter |
| clarity — confirmation + audit trail per action | **pass for the wave** — committed banner + sealed records + reconsider; **fail for card reject** (silent, and command rejects skip the chain per sibling) |
| trust — undo/recall on irreversible actions | **pass for auto-rejects** (reinstate worked live + sealed the reversal); **gap for card/manual rejects** (reconsider is auto-only — cross-ref sibling) |
| senior-quality — rejection copy I'd sign under ČS's name | **conditional** — deterministic, warm, on-brand, but English for null-locale entries; I would not sign the English letter to a Czech candidate |
| trust — scheduling slot validation | out of this journey's scope |
| time-saved — batched and still reviewable | **pass** — fast preview/commit, fully reviewable; my adoption gate is trust, not speed |
| language — Czech UI + candidate messages | **partial** — wave UI + rationales fully Czech ("Automaticky zamítnuto · spodních 20 %…"); screening-card rationale English; null-locale letters English |

## Findings this lens confirmed/raised

Confirmed live: **SD-L1-001** (one-click card reject, 3 gate-less buttons; danger observed without firing), **SD-L1-007** (reinstate → no follow-up nudge, walked end-to-end), **SD-L1-009** (English screening rationale in the cs UI, real card). Strength confirmed live: **SD-L2-S1** (the token gate held under real 409/409/200 probing; fairness shield "0 of 3" on a protected cohort; chain re-verifies). Cross-refs (not re-proven): reconsider is auto-only + command rejects unsealed (pipeline-advance L2), null-locale English letters (pipeline-advance L2), outbox is queued-terminal (reconciliation).

## Character feedback (first person, live)

> Ta vlna je pořád radost. Otevřel jsem ji a hned nahoře stálo *„Náhled — nic se neuplatní, dokud nepotvrdíte"*, pod tím *„Zamítl by 0 z 3"* a věta, proč — protože to jsou začátečníci a jednoho systém neumí zařadit, tak ho radši nechá být. Nástroj mi řekl, proč nikoho nevyhazuje, ještě než jsem se ho zeptal. Posunul jsem posuvník, počet se přepočítal. A když jsem vlnu naostro pustil na svých vlastních lidech, bez tokenu mě to nepustilo, se starým tokenem taky ne — muselo to být přesně to, co jsem viděl. Tohle podepíšu.
>
> A poprvé za celý běh mi fungovalo i „vrátit zpět": rozbalil jsem „Znovu zvážit", klikl „Obnovit" a člověk se vrátil do Prověřeno, a v tom zapečetěném řetězci je i záznam, že se to otočilo. Jen — nikde ani slovo, že už mu předtím odešlo zamítnutí. To si musím pamatovat sám.
>
> Dvě věci mě ale drží zpátky. Ty karty: jedno kliknutí na „Zamítnout", žádné potvrzení, žádný náhled dopisu, a kandidátovi tiše odejde e-mail — a když to nebyl automat, ve frontě „Znovu zvážit" ho nenajdu. A ty dopisy: „Hi UAT SD Alpha… After careful review" — anglicky, na české tabuli, pod hlavičkou banky. Vlnu nasadím zítra. Karty a jazyk až po opravě.

## L2 evidence index

`shots/sd-l2-01-decisions` (AI cards + reject buttons + reconsider), `sd-l2-02/03-wave-preview` (live preview + shield note + slider), `sd-l2-04/05-reconsider` (expand + Obnovit), `sd-l2-06-analytics-records`, `sd-l2-dossier-export.json`. API round-trips: dry-run 1/2/1 rejects across slider positions (zero mutation verified); commit 409(no-token)/409(stale)/200(fresh); reinstate → DB active@Screened + sealed reversal seq 27. Bespoke driver: `shots/sd-l2-run.mjs`.
