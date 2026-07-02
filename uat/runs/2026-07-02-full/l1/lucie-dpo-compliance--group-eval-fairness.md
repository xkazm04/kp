# L1 theoretical — Lucie Procházková (DPO / compliance) × group-eval-fairness

- **Run:** 2026-07-02-full · main @ 3395b4c · cert level: **L1** (no browser)
- **Journey:** `uat/journeys/group-eval-fairness.md` · language: cs
- **Lens:** EU AI Act high-risk ranking (2 Aug 2026 deadline), GDPR Art. 22 human
  oversight, defensibility of the pick.
- **Verdict: L1-conditional** — the oversight architecture is unusually good for a
  demo (human seals, advisory modes, tamper-evident chain, honest fairness scope),
  but four majors carry forward: model-identity provenance, silent degrade on ranker
  failure, cross-track ranking, and a KO-failed field still visually crowned.
- **Grounding score (journey): 15/22 ≈ 7/10** (same per-surface numbers as Tomáš's
  report §2; her additional check — does the *decision record* receive the decisive
  inputs — scores thin: `inputs: {score, candidates, roleTitle}` only,
  `group-eval-run.ts:426`).
- **Time saved (designed): audit of this decision class ~2–3 days of interview-and-
  reconstruct → ~2–3 h reading built-in records ≈ 1.5–2 days per review cycle ·
  medium confidence** — contingent on the provenance gap: without model identity she
  still reconstructs one axis by hand.

---

## 1 · Surface model — the compliance-relevant chain

(Full affordance model in the Tomáš report §1; here the oversight spine.)

- **Who decides:** the AI only *recommends*. Advance/Reject — in the modal
  (`PerCandidateTabs.tsx:74-98`) or the queue — always goes through
  `POST /api/pipeline/[id]` with a human click, CAS-pinned to the snapshot stage
  (`DecisionsTab.tsx:176-214`), and is **sealed** as `kind: advanced|rejected,
  actor: "human:recruiter"` with the recruiter's optional reason
  (`app/api/pipeline/[id]/route.ts:245-260`). Reversal exists and is sealed too
  (`reinstated`, :176-189; reconsider queue `DecisionsTab.tsx:415-449`).
- **What the AI seals:** in default "recommendation" mode the recommended lead is
  sealed as `kind: group_eval_lead, actor: "auto:group-eval"` — a recommendation
  record, not a rejection (`group-eval-run.ts:417-427`). In committee /
  eligibility-list modes the AI is **advisory by construction**: it never seals a
  winner (`group-eval-governance.ts:23-25`), seals `group_eval_advisory` instead
  (`group-eval-run.ts:428-441`), the modal shows an explicit governance banner
  (`GroupEvalModal.tsx:104-109`) and the eligibility list names its own ceiling —
  statutory preferences can't be computed, apply them before certifying
  (`group-eval-governance.ts:41-55`).
- **Audit trail:** hash-chained decision store with atomic sealing and whole-chain
  verification (`decision-record-store.ts:108-144,173-191`), read via
  `GET /api/decisions/records` (`app/api/decisions/records/route.ts:14-23`),
  rendered with a verify badge + **one-click dossier export** in Analytics
  (`app/features/sub_analytics/DecisionRecordsPanel.tsx:52-104`) — both tabs are in
  my surface binding.
- **Fairness view:** cross-scheme matrix — every candidate re-scored under every
  candidate's bounded weighting, ranked by mean (`recruiter.py:28-47` →
  `matching.fairness_matrix`; rendered `FairnessPanel.tsx:14-107`), with the weight
  source disclosed (AI-tuned vs rule-based pill, :36-38), divergence-from-headline
  called out (:30,91-93), and an **honest scope note**: it tests weighting
  robustness, not demographic bias — the app holds no such data
  (`messages/cs.json:1606`). Complemented by the jurisdiction picker + four-fifths
  calculator in the Rules modal (`ComplianceSection.tsx:36-208`, reachable from the
  Decisions header, `DecisionsTab.tsx:323-330,496`).
- **Knockout integrity (engine):** ko-aware sort (`group-eval-run.ts:351-361`), lead
  crowned only when KO passes (:366), sealed only when a ko-passing lead exists
  (:417-418), "no lead" summary when the whole field fails (:401-402),
  differentiators anchored on the ko-passing lead only (:378-380).

## 2 · Reachability (before judging)

My binding: Decisions (records/audit), Analytics (decision logs), and consent/
disclosure surfaces where AI touches a candidate. The group-eval modal, Rules modal,
and DecisionRecordsPanel are all inside that set (tabs ungated,
`app/features/tabs.ts:103`). Candidate-facing consent/disclosure surfaces are
**out of this journey's scope** (they belong to apply/screen-wave journeys) — I do
not judge them here. No `unreachable` tags needed.

## 3 · Walkthrough against my scored criteria

| Criterion | Verdict | Evidence |
|---|---|---|
| trust/blocker — no score+reject with no disclosure, no human, no record | **pass** | reject path is human-clicked, sealed, reasoned, reversible (`route.ts:245-262`; `group-eval-run.ts:417-441` never rejects anyone) |
| trust — AI-use disclosure + consent before processing | **out of scope here** | candidate consent lives on apply/screen surfaces; within this journey the recruiter-facing AI labelling exists (AI/rule pill, `AiVerdict.tsx:34`) |
| trust — provenance on every headline output (model/version, inputs, timestamp, human) | **FAIL → major (GEF-L1-04)** | timestamp ✓ (`GroupEvalModal.tsx:67-72`), source class ✓, but "llm" renders as a static "Claude/Gemini" guess (`helpers.ts:4`, `messages/cs.json:1539`); sealed record's policyVersion is just `llm|partial|deterministic` and inputs snapshot is 3 shallow fields (`group-eval-run.ts:420-426`) — no model id, no eval-payload reference |
| completion — human-in-the-loop override on reject, recorded, reversible | **pass** | inline decide → human seal; reinstate + `reinstated` seal (`route.ts:176-189`) |
| senior-quality — regulator-handable record as-is | **CONDITIONAL** | chain + export ✓; but the group-eval seal lacks the decisive per-dimension/KO inputs it "actually saw" (contract at `decision-record-store.ts:19` vs `group-eval-run.ts:426`), and `lead`/`advisory` reason codes have no Czech mirror in the dossier view (`DecisionRecordsPanel.tsx:43-49`) |
| clarity — group eval explains *why* one outranks another | **pass** | per-dimension bars, matched/missing per skill with provenance-aware strength, differentiators, weight rationales (`ComparisonTable.tsx:204-232`, `FairnessPanel.tsx:95-104`) — not a black box |
| missing — exportable audit trail across AI touch-points | **pass** | dossier export + chain verdict (`DecisionRecordsPanel.tsx:52-62,94-104`) |

## 4 · Fairness-specific probes (journey's L1 mandate)

- **"Fails open, not silently off":** two layers behave differently. The **LLM weight
  proposer** fails open to the deterministic proposer with the source *disclosed*
  (pill, `FairnessPanel.tsx:36-38`; `weight_proposal.py:9-15`) — correct. But a
  **whole-ranker failure** is swallowed with a `console.warn`
  (`group-eval-run.ts:288-291`): fairness goes `null` and the panel silently renders
  nothing (`FairnessPanel.tsx:16`), `koPassed` goes `undefined` and is treated as
  *not failed* (:355-359), yet a lead is still crowned **and sealed** from stale
  matchScores (:366,417-427). The only signal is the "deterministic" source pill —
  nothing says "fairness and knockout were not checked on this run".
  **→ GEF-L1-05, major.**
- **Knockout integrity:** the engine is right (§1), but the **table contradicts it**
  in the all-KO-failed edge: `ComparisonTable` crowns column 1 unconditionally
  (`isLead={i === 0}`, `ComparisonTable.tsx:181`) and the Lead pill is checked
  *before* the KO pill (:33-39) — so a field where nobody passes must-haves shows a
  crowned "Vedoucí" directly under a summary saying there is no lead
  (`group-eval-run.ts:401-402`). Exactly the artefact I'd be handed in a dispute.
  **→ GEF-L1-03, major (low frequency, high trust erosion).**
- **Consistent scoring across candidates:** same ranker, same job, one process
  (`recruiter-run.ts:21-51`) ✓ — but the headline order flat-sorts early-career
  (potential-scored) against experienced (history-scored) candidates on one `score`
  (`group-eval-run.ts:351-361`), a mix the engine's own module declares incomparable
  and even ships a safe API for (`recruiter.py:19-25,87-89,93-103` —
  `rank_candidates_by_track`, unused here). The table then labels the career row
  from the first candidate carrying it (`ComparisonTable.tsx:127-137`), asserting
  one semantic over two. Mitigations exist (archetype tag, potential badge,
  early-career risk note :385, the fairness matrix) but the *ranking* — the thing
  the EU AI Act classifies as high-risk — is the mixed one. **→ GEF-L1-02, major.**
- **Governance-mode drift:** the header selector applies only to the *next fresh
  run* (`DecisionsTab.tsx:222-240`); opening an already-evaluated role shows the
  cached eval under whatever mode it ran with, with no cue that the selector and the
  payload disagree (drift notice covers pool changes only, `Notices.tsx:11-18`).
  A committee chair can believe committee mode is on while reading an auto-sealed
  recommendation. **→ GEF-L1-06, minor.**

## 5 · Ship-bar evidence (public product path)

The eval store and the decision chain are **tenant-blind**: `group_evals` is keyed by
`role_key` alone (`app/_lib/group-eval.ts:18-24`), `decision_records` has no
workspace column (`decision-record-store.ts:56-71`), and both read routes do no
auth/tenant scoping (`app/api/decisions/group-eval/route.ts:11-23`,
`app/api/decisions/records/route.ts:14-23`) while the product advertises
multi-workspace auth (`uat/env.md:49-50`). On a public deployment, one bank's
shortlist evaluation and decision dossier would be readable by every workspace —
for a DPO that is a reportable breach, not a bug. Demo-scoped today (dev gate), so
impact-ranked low — but it must be on the ship checklist. **→ GEF-L1-08, scope-noted.**

## 6 · Character feedback (first person)

> Přiznávám, že jsem přišla připravená škrtat — a našla jsem architekturu, kterou
> od dodavatelů běžně nedostávám ani na slidech. Zamítnutí dělá člověk, kliknutím,
> s důvodem, a pečetí se do řetězu, který si umím ověřit a exportovat jedním
> tlačítkem. AI doporučení je zapečetěné *jako doporučení*, ne jako rozhodnutí.
> Režim komise a pořadníku říká nahlas, že AI nevybírá — a panel férovosti je první,
> který jsem viděla, jak sám přizná, co neměří: demografii, protože ta data nemá.
> Tohle je přesně ta upřímnost, kterou před regulátorem obhájím.
>
> Co neobhájím: "Zdroj: Claude/Gemini". Který model? Která verze? To není
> provenience, to je pokrčení rameny — a v zapečetěném záznamu zbyde jen slovo
> "llm" a tři čísla. Dál: když ranker spadne, férovost i knockout prostě zmizí
> a systém přesto korunuje a zapečetí vedoucího — ticho je v compliance nejdražší
> zvuk. A ta tabulka, která v rohovém případě nasadí korunku kandidátovi, o kterém
> souhrn o řádek výš říká, že neprošel povinnými požadavky? To je přesně ten
> screenshot, který jednou dostanu já — od právníka protistrany.
>
> Verdikt: základy bych podepsala, certifikaci zatím ne. Doplňte identitu modelu do
> záznamu, pojmenujte degradovaný běh a srovnejte korunku s knockoutem — pak se
> bavíme o 2. srpnu bez pocení.

**L1-conditional.** Majors GEF-L1-02/03/04/05 carry to L2; top L2 questions: live
fairness matrix + weight-source pill, dossier export contents for a `group_eval_lead`
record, mode-drift on a cached eval.
