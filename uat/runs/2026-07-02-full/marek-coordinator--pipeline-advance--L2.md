# L2 empirical — marek-coordinator × pipeline-advance

- **Run:** 2026-07-02-full · live kp @ http://localhost:3009 · cert level L2 (real browser, cs locale, dev gate)
- **Verdict:** **L2-conditional** — the batch machinery, previews and audit surfaces are real and live; but three of his own scored criteria fail live: the dry-run never shows the letter, the letters for Czech candidates go out in English, and for the batches HE fires there is no undo anywhere in the UI. Plus the typed-command path skips the sealed decision chain entirely.
- **Time saved (re-measured live):** command-bar reject of a 2-candidate cohort: preview → confirm → done in **~40 s**, letters reviewable in the Comms Center in ~1 min — extrapolated **~25–30 min per 20-candidate wave** vs ~40 min one-by-one · **medium** confidence. **For Czech-candidate cohorts the saving collapses to ≈0 as-is** — every deterministic letter goes out English (locale NULL), so he would not run the wave at all until that's fixed.
- **Grounding (re-scored):** **5/8** unchanged; the one LLM letter he'd sign live (Tereza's outreach) was genuinely grounded — real CV facts, correct Czech, real captured address — marred only by a dead relative GDPR link (cross-ref capst-l2-102).
- **Mutation discipline:** the only destructive act (reject) ran scoped to my own two fixtures via "reject below 40 on Mobile QA" (preview asserted exactly 2 before confirm); the board bulk-reject confirm was captured and **cancelled** (zero mutation, verified); one fixture reinstated via API.

## What I walked (in character)

1. **"Zamítni všechny pod 60 %."** I typed the bar's own placeholder example, verbatim. Answer: **"Didn't catch that."** — English — followed by *examples suggesting the same Czech commands again*. "posuň první 3" (the second advertised example): same. The feature's documentation teaches incantations its parser rejects; the working spells are English and nothing says so. (P5/M5 sharpened to major.) `shots/l2-pa-17-czech-command.png`
2. **Board bulk reject — dry-run check.** Filter "Čeká na rozhodnutí" → Vybrat → 2 selected → "Odmítnout 2": the confirm step says **"Odmítnout 2 a uvědomit je?"** with a per-kind breakdown ("1 Decision · 1 Calendar" — untranslated kind labels, noted) and honest e-mail disclosure. What it does NOT show: the letter, or even the two names. I cancelled; DB untouched. In the same bar sits **"Odeslat odkazy k objednání (2)" — which fires with no confirm step at all.** (M2 confirmed + bulk-invite nuance.) `l2-pa-18`
3. **The real wave (my fixtures).** "reject below 40 on Mobile QA" → preview: English description, "2 kandidáti", both names with scores — exactly my two, so I confirmed. "Hotovo — zpracováno 2 kandidáti." Then my question — *odešlo to? a komu?* — answered by the **Comms Center**: both letters there, statuses honest, and a banner I want to frame: **"Není nakonfigurováno doručovací relé — tyto zprávy se NEodesílají kandidátům."** The product tells me the truth about its own delivery seam, in Czech. (M6 by-design confirmed; OO-L2-S7 cross-confirmed.) `l2-pa-19/20/21`
4. **The letters themselves.** *"Hi Aneta Veselá, Thank you for your interest in Junior Mobile QA Engineer – George…"* — a Czech candidate, rejected from a Czech board, gets an English letter under the bank's name, because `locale` is captured only at apply and 60/65 entries carry NULL → `en`. The template machinery L1 certified works perfectly — it localizes to the wrong locale for nearly the entire funnel. I would not sign this. (NEW major, pa-l2-null-locale-english-letters.)
5. **"A když se spletu?"** Decisions tab: **no reconsider section, neither candidate listed.** The "Znovu zvážit" queue joins on `auto_rejected` only — human/command rejects (i.e. *my* batches) never appear, and rejected entries also vanish from the board. The undo L1 credited exists as an API (`{action:"reinstate"}` → 200, back to Prověřeno, sealed reversal — I proved it with curl) but no UI I can reach fires it for this path. Fix landed ≠ fix reachable. (M4 upgraded to major.) `l2-pa-22`
6. **Audit.** The typed reject notified the candidate and flipped the entry — and left **zero rows in decision_records**, while the identical reject through the board/drawer seals (route.ts:249-260). Same for "advance top 1" (Petra's run): a terminal hire with no sealed decision. The fastest bulk surface is the one invisible to the tamper-evident chain. Also: the route reports `commsFailed` and the command bar's done-state **discards it** — a partially-un-notified batch reads as a clean "Hotovo". (NEW major pa-l2-command-mutations-unsealed; NEW minor pa-l2-commandbar-drops-commsfailed.)
7. **The letter I'd sign.** Outreach for Tereza Králová (apply-sourced, locale cs, real address): 22 s, fluent Czech, names her actual CV strengths, Czech GDPR footer — except the erasure link is a relative `/data/er-…` that goes nowhere outside the app (cross-ref capst-l2-102). Bonus catch: her quick-apply stub ALSO offers "Připravit oslovení", which spins and fails with raw English "candidate profile not found" in the cs drawer. `l2-pa-23b / l2-pa-23`
8. **Invite dispatch status (drawer).** Minting a scheduling link answers loudly — link + "✓ odesláno kandidátovi" + Outbox row + timeline entry — the *system status* grammar is right; the letter's language (see 4) and the "odesláno" overclaim vs the relay banner are the gaps. `l2-pa-11`

## Scored acceptance criteria (identical to L1, judged live)

| Criterion | L2 result |
|---|---|
| completion — bulk ops end-to-end | **pass** — select/filter/bulk bars, command bar, comms review all completed without dead-ends |
| trust/clarity — dry-run shows who AND the rendered message | **fail (major)** — who: yes; letter: nowhere; bulk invite has no gate at all |
| clarity — confirmation + audit trail | **partial** — counts + Outbox + full letters + honest relay banner are excellent; but commsFailed is dropped by the UI and command mutations skip the sealed chain |
| trust — undo/recall for bulk | **fail (major)** — no UI path for human/command rejects; API reinstate works and seals |
| senior-quality — comms he would sign | **fail (major) for cs candidates** — English letters under the bank's name (locale NULL); the one cs-locale LLM letter was sign-able |
| trust — scheduling slot validation | out of journey (interview-schedule-prep); invite dispatch status honest |
| time-saved — batch beats one-by-one AND reviewable | **conditional pass** — ~25–30 min/wave for en cohorts; ≈0 for cs cohorts until locale fix |
| language — Czech UI + candidate messages | **fail** — command bar self-defeating Czech examples + English errors; candidate letters English by default |

## Findings this lens confirmed/raised

Confirmed: **M1/P1** (advance-top phantom hire, forensics complete), **M2** (no rendered-letter dry-run + bulk-invite zero-confirm), **M6** (outbox-simulated, honesty intact — by-design with ceiling). **M3** stands as code seam with passing live samples (Czech CV → Czech letters) — the sharper live failure is **pa-l2-null-locale-english-letters** (NEW major). **M4** upgraded (reinstate UI-unreachable for human rejects — L1 surface-model gap). **M5/P5** sharpened to major. NEW: **pa-l2-command-mutations-unsealed** (major), **pa-l2-commandbar-drops-commsfailed** (minor), **pa-l2-degraded-stub-action-error** (minor). Strengths confirmed: preview-then-confirm grammar with safe cancel, Comms Center honesty, live poll, retry-preserving selection (structurally; 409 path not hit live).

## Character feedback (first person, live)

> Nejdřív, co si zaslouží uznání: každá brána, kterou jsem naživo prošel, se mě napřed zeptala. Náhled mi ukázal seznam, hromadné zamítnutí se ptalo dvakrát a řeklo na rovinu "a uvědomit je", a když jsem zrušil, opravdu se nestalo nic — ověřil jsem to. A Centrum komunikace mi česky a bez vytáček řeklo, že se zprávy ve skutečnosti nedoručují, dokud není relé. Nástroj, který přizná vlastní šev, je nástroj, se kterým se dá mluvit.
>
> Ale pak jsem si přečetl ty dopisy. "Hi Aneta Veselá…" Moje kandidátka, moje česká tabule, hlavička banky — a dopis anglicky, protože systém zná jazyk jen u lidí, co se přihlásili sami. Šedesát z pětašedesáti lidí v náboru jazyk nemá. Tu vlnu bych nepodepsal, a protože mi náhled ten dopis nikdy neukázal, zjistil bych to až POTOM, v auditu. Přesně tohle je důvod, proč chci dry-run dopisu, ne jen počet.
>
> A když se spletu? Zkusil jsem to. Zamítnutí lidé zmizeli z tabule, v Rozhodnutích po nich není stopa — fronta "Znovu zvážit" je jen pro automat. Obnovit je umí jen API, které jsem si našel v kódu. A do třetice: příkazový řádek, ta nejrychlejší hromadná zbraň, nezapisuje do zapečetěného řetězce rozhodnutí vůbec nic. Kandidát dostal e-mail o zamítnutí a dossier je prázdný. U banky je tohle nález pro compliance, ne poznámka pod čarou.
>
> A "advance top 5"? Viděl jsem, co to udělalo Petře — člověk s rozepsanou nabídkou "přijat", dopis zahozen, statistika si připsala čárku, audit mlčí. Tichý špatný terminální stav — moje noční můra, potvrzená naživo.
>
> Verdikt: malou vlnu pustím — anglicky mluvícím kandidátům, s ručním čtením dopisů v Centru komunikace po odeslání. Naplno až s náhledem dopisu, jazykem podle kandidáta, tlačítkem "Obnovit" tam, kde vlna vystřelila, a pečetí i pro příkazový řádek.

## L2 evidence index

`shots/l2-pa-17..23b` + aria/text sidecars; dev_outbox letter bodies and decision_records counts in run log; reinstate API round-trip (200 → active@Screened + sealed reversal); measured: reject wave (preview→confirm→letters) ~40 s for 2, outreach 22.1 s.
