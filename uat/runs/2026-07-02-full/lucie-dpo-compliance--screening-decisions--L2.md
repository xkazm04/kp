# L2 empirical — lucie-dpo-compliance × screening-decisions

- **Run:** 2026-07-02-full · live kp @ http://localhost:3009 · cert level **L2** (real browser + same-server API on my own fixtures, DB read-only inspection, one unauthenticated probe)
- **Verdict:** **L2-conditional** — the Article 22 machinery is not a demo: under real probing the human-approval token gate refuses to fire (409 without a token, 409 on a stale one), a preview mutates nothing, the tamper-evident chain re-verifies after every commit and even seals the reversal, and the fairness shield fails closed on live data. No blocker triggers (HITL + a sealed record are genuinely present). But the three things I said I couldn't sign are all **confirmed live**, and one — the unscored-candidate rejection — I proved by sealing one into the immutable chain myself. Plus the unauthenticated probe returned the whole cross-tenant record set. I would not certify before 2 August without fixes; I would call it "promising, with named conditions" — which is more than I usually say about AI hiring.
- **Time saved (re-measured live):** my audit collapsed to **one click** — the DecisionRecordsPanel headlined "řetězec ověřen" and exported all 27 sealed records with a localized rationale in a single file. Est. **~4–6 h saved per audit cycle** on this slice · **medium** confidence, still conditioned on SD-L1-004: for a human-ratified AI decision I would *again* reconstruct what the AI told the human.
- **Grounding (re-confirmed):** wave engine **4/6** — I confirmed the missing null-score distinction live (below); AI card **3/6**.
- **Mutation discipline:** all writes on my own namespaced fixtures (`uat-sd-l2job`, "UAT SD …"); DB inspected read-only; the unauthenticated probe was a plain no-cookie GET/POST, read-only in effect (a dry-run).

## The Art. 22 machinery, tested live (the good news)

- **Human-in-the-loop gate holds under attack.** On the real server path I committed a wave three ways: **no token → HTTP 409** ("Human review and approval are required before committing an automated rejection wave"); **stale token → HTTP 409** ("the candidate set changed — re-preview"); **fresh token → 200**, applying *exactly* the set I previewed. A dry run at three thresholds returned 1/2/1 rejects and mutated nothing (cohort stayed 4 active, 0 records, 0 outbox rows). This is a signature of the reviewed set, not a checkbox.
- **The chain is real and self-healing.** After three commits and a reinstate, `/api/decisions/records` reported `chain: {ok:true, count:27, brokenAtSeq:null}`. The reinstate sealed its *own* "reinstated" link (seq 27) — an overturned rejection is not an audit hole. The panel headlined the verdict and exported the whole chain in one click, with a Czech localized rationale beside the byte-stable English (SD-L1-S6 confirmed).
- **Fairness gate fails closed, on live data.** The wave on Junior Mobile QA previewed **"Zamítl by 0 z 3"** — two students (protected) and one null-archetype candidate (unknown → shielded), all spared, with the shield note shown. Exactly the reflex I don't see from vendors.

## The three I still can't sign (all confirmed live)

- **SD-L1-002 — an unscored candidate is auto-rejected on a fabricated "match 0", and I watched it get sealed.** I created a Screened entry with `matchScore=null` (archetype `bau`, so the archetype shield does *not* save it). The wave listed it as **"match 0"**, rationale *"Would auto-reject · bottom 20% of 3 → 1 (rank 1) and match 0 < 45 threshold."* — indistinguishable from a real zero. I committed it. The immutable record now reads, permanently, EN *"match 0 < 45"* / cs *"shoda 0 < práh 45"*, `inputs.score: 0`. An adverse automated decision computed **and sealed** on a measurement that was never taken. This is the one I cannot defend to a regulator. And the undo surface is blind to it too (SD-L2-001): the reconsider row for that candidate shows **no score at all**, not an "unscored" flag — so neither the preview nor the safety valve distinguishes a never-measured person from a genuine low scorer.
- **SD-L1-003 — the rejection notice, both locales, has no automated-decision disclosure and no contest route.** I read the live outbox bodies. EN (auto-reject): *"After careful review, we won't be moving forward at this stage."* cs: *"Po pečlivém zvážení v tuto chvíli nebudeme pokračovat dál."* Neither says automation was involved; neither offers a route to request human review (Art. 22(3)). The template is identical for auto and manual. "Careful review" arguably *misrepresents* a threshold rule. The internal reconsider queue exists — but the data subject is never told it does.
- **SD-L1-004 — the human decision record omits the AI it ratified.** I exported the live dossier. Every human `advanced`/`rejected` record carries only `inputs {fromStage, detail}` — no model, no verdict, no confidence, nowhere. The AI recommendation the recruiter acted on lived in mutable `approval_detail` and is cleared on decision. For a right-to-explanation request on a human-ratified AI call, I'm back to reconstructing what the human saw — the exact work this tool was supposed to end.

Plus two named seams, both confirmed in the sealed record + dossier:
- **SD-L1-005** — `approvedBy` reads **"operator (single-operator deployment)"** (KP_OPERATOR_NAME unset); the central "who reviewed this" claim names nobody, and the route would accept any client-supplied string.
- **SD-L1-008** — the per-candidate dossier works at the API (`?candidate=` returned exactly 1 record) but the panel has **no candidate-scope control** live; a DSAR answer is export-everything-and-filter.

## The ship-bar probe (explicit result)

**Unauthenticated, fresh curl, no cookies, no dev gate:**
- `GET /api/decisions/records` → **HTTP 200, all 26 sealed records** returned, including real ČS candidate refs (e.g. `m-cand-007-…`) and `chain.ok:true`.
- `POST /api/decisions/screen-wave` dry-run → **HTTP 200** (a would-reject preview on any tenant's cohort, unauthenticated).

In *this* dev deployment `KP_OPERATOR_PASSWORD` is unset, so the proxy gate is off entirely. The sharper, code-level finding (SD-L1-010): the decisions routes carry **no in-route auth** — while the sibling `/api/automation/[task]` calls `requireOperator()` (which even rejects anonymous demo sessions), `screen-wave`/`records`/`reconsider` call nothing. So on the password-set multi-tenant path, a demo/anonymous session that passes the proxy would still reach them, and `decision_records` has **no workspace column** (one global chain) → a cross-tenant read of every candidate's adverse-action record. Low reachability in single-operator today; a hard must-fix before multi-tenant.

## Scored acceptance criteria (applied identically every run)

| Criterion | L2 result |
|---|---|
| trust/blocker — scored+rejected with NO disclosure, NO HITL, NO record | **not triggered** — token-gated HITL + sealed record present live → no blocker |
| trust — AI-use disclosure + consent before processing | apply-surface (other journey); **rejection-time disclosure absent, both locales → SD-L1-003 major** |
| trust — provenance on every headline AI output | wave: **pass** (policy version + approver + timestamp sealed, chain verified); human-ratified AI decisions: **fail → SD-L1-004**; approver generic → SD-L1-005 |
| completion — HITL override on the reject path, recorded, reversible | **pass** — token gate + reconsider/reinstate walked live, reversal sealed (seq 27) |
| senior-quality — record regulator-handable as-is | **conditional** — auto-reject records yes (bar SD-L1-002/005); human-decision records too thin |
| clarity — group/fairness explains ranking | out of scope → group-eval-fairness |
| missing — exportable/inspectable audit trail | **pass** — verified chain + one-click dossier export confirmed live |

## Findings this lens confirmed/raised

Confirmed live: **SD-L1-002** (sealed a "match 0" record myself — strongest evidence), **SD-L1-003** (both-locale outbox bodies, no disclosure/contest), **SD-L1-004** (dossier: human record has no AI payload), **SD-L1-005** (approvedBy generic constant in the seal + dossier), **SD-L1-008** (API scoping works, no UI consumer), **SD-L1-010** (unauthenticated 200 on records + screen-wave; in-route-auth asymmetry vs /api/automation). New L2: **SD-L2-001** (null-score reject shows no score / no "unscored" flag in the reconsider queue — the human gate is blind on both ends). Strength: **SD-L2-S1** (Art.22 gate + chain hold under real probing; fairness shield fail-closed on live data). Cross-refs (not re-proven): command-bar rejects skip the chain while card/drawer rejects seal (pipeline-advance L2) — so audit completeness is *surface-dependent*, a real inconsistency I'd want closed.

## Character feedback (first person, live)

> Přišla jsem to zkusit rozbít a nešlo to tam, kde to obvykle jde. Commit bez tokenu server odmítl, se starým tokenem taky — razítko sedí přesně na tu množinu, kterou člověk viděl. Náhled nezměnil ani řádek v databázi. Řetěz se po třech potvrzeních i po vrácení zpět znovu ověřil jako neporušený, a to vrácení se do něj zapečetilo jako vlastní článek. Export celého dossieru na jedno kliknutí, česky. A ochrana „fail-closed" — vlna napsala „Zamítl by 0 ze 3", protože dva jsou studenti a jednoho neumí zařadit, tak nechá být všechny. Tohle bych regulátorovi na stůl položila.
>
> A přesto tři podpisy nedám. Vytvořila jsem kandidáta bez skóre a dívala se, jak ho vlna vyhodí jako „match 0" — a to číslo se mi teď navždy pečetí v neměnném záznamu jako „shoda 0 < práh 45". Naměření, které nikdy neproběhlo, zapsané jako fakt. Ve frontě „znovu zvážit" u něj není skóre vůbec — takže ani záchranná brzda nepozná, že šlo o nezměřeného člověka. Za druhé: dopis, česky i anglicky, mlčí o automatizaci a nenabízí žádnou cestu k lidskému přezkumu. Za třetí: když člověk potvrdí doporučení AI, do záznamu se zapíše jen „z fáze X" — co mu AI řekla, se smaže.
>
> A ještě jedna věc, kterou musím napsat nahlas: zavolala jsem na `/api/decisions/records` bez jediné cookie a dostala jsem všech dvacet šest zapečetěných záznamů, včetně skutečných jmen kandidátů. V tomhle nasazení je brána vypnutá, ale ty cesty samy o sobě žádnou autorizaci nemají — na rozdíl od `/api/automation`. Než tenhle produkt uvidí druhého klienta, tohle musí být zavřené. Opravte ty tři věci a zavřete tu bránu, a před 2. srpnem to podepíšu.

## L2 evidence index

`shots/sd-l2-01-decisions`, `sd-l2-02/03-wave-preview` (shield "0 z 3"), `sd-l2-04/05-reconsider` (reinstate + null-row-no-score), `sd-l2-06-analytics-records` (verify badge, no scope control), **`sd-l2-dossier-export.json`** (27 records; null-candidate rationale "match 0 < 45" / "shoda 0 < práh 45"; human records inputs `{fromStage,detail}` no AI payload; approvedBy generic). API: 409/409/200 token sequence; dry-run zero-mutation; unauth GET /api/decisions/records → 200 (26 records) + POST screen-wave → 200; chain verify ok:true count 27. Drivers: `shots/sd-l2-run.mjs`, `sd-dossier-grab.mjs`.
