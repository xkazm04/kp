---
run: 2026-07-20-cases-scoring
character: marek-coordinator
journey: screening-decisions
cert_level: L1
verdict: L1-conditional
grounding: 4/10
time_saved_min: 110
time_saved_confidence: medium
language: cs
branch: vibeman/ambiguity-ui-wave1 (read-only; uncommitted WIP untouched)
---

# Marek Beneš × Screeningová pravidla a vlna — L1 (theoretical, code-grounded)

## Surface model

Entry → wave, followed by import chain:

| Affordance | Backing code |
|---|---|
| Decisions tab shell, role rows | `app/features/sub_decisions/DecisionsTab.tsx:928` (`onScreenWave`), row button `RoleDecisionRow.tsx:100-103` |
| "Rules" modal (config) | `DecisionsTab.tsx:1063` → `DecisionRulesModal.tsx:21`; loads/saves `GET|POST /api/decisions/config` (`DecisionRulesModal.tsx:29,40`) |
| Rule fields: auto-reject on/off, bottom-%, "only if match below" | `DecisionRulesModal.tsx:87-120`; clamped client-side 0..100 (`:104,:117`) and re-synced from the server's canonical clamp (`:48-49`) |
| Plain-Czech rule sentence + family-floor chips | `DecisionRulesModal.tsx:130-161`, helpers `floor-disclosure.ts` (`familyFloorEntries`, `familyFloorSummaryList`) |
| Fairness guarantee copy | `DecisionRulesModal.tsx:166-169`; enforced in code at `app/_lib/archetypes.ts:36-41` (`FAIRNESS_PROTECTED_ARCHETYPES` from `pipeline/jobfit/archetypes.json`) + fail-closed `isKnownArchetype` (`archetypes.ts:57-59`) |
| Wave modal | `DecisionsTab.tsx:1065-1069` → `ScreenWaveModal.tsx:41` |
| Dry-run on open + on every control change (350 ms debounce) | `ScreenWaveModal.tsx:106-141`, POST `{dryRun:true}` at `:114-118` |
| Threshold controls: enable checkbox, bottom-% slider, max-match slider | `ScreenWaveModal.tsx:318-336` |
| Live count "Zamítl by N z M" | `ScreenWaveModal.tsx:349-363` (`aria-live="polite"`) |
| Reject list rows | `ScreenWaveModal.tsx:211-239` — renders `label`, `matchScore`, optional comms-failed / stale / family-floor chips, and `reasonText(d)` |
| Keep list rows | `ScreenWaveModal.tsx:241-259` |
| Commit (two-step) | primary button `ScreenWaveModal.tsx:284-292` → confirm modal `:374-407` → `commit()` `:143-177` |
| Commit API | `app/api/decisions/screen-wave/route.ts:18` — `requireOperator` `:19`, tenant scope `:25`, `validateScreeningOverride` `:38-39`, dryRun `:43`, approval token `:50-65` |
| Wave engine | `app/_lib/screen-wave.ts:141-416` — cohort read `:190`, unscored exclusion `:214`, worst-first sort `:215`, `screenBottomCount` `:223`, `tieSafeBottomCount` `:230`, reject predicate `:255`, approval token `:259`, CAS commit `:346`, seal `:357-368`, comms `:377` |
| Reconsider queue (undo) | `DecisionsTab.tsx:944-1006`; data `GET /api/decisions/reconsider` (`reconsider/route.ts:19`), reinstate `POST /api/pipeline/{id} {action:"reinstate"}` (`DecisionsTab.tsx:193-205`) |
| Per-candidate drill-in (evidence) | `AnalysisSummaryModal.tsx:39` — opened **only** from the decision-queue card `DecisionsTab.tsx:903` (`onInspect`), wired at `AiReviewCard.tsx:276-279` |
| Sealed audit record | `app/api/decisions/records/route.ts:37` (operator-gated, per-tenant hash chain, `?candidate=` dossier) |

**The wave's decision payload** (`screen-wave.ts:29-59`, mirrored `ScreenWaveModal.tsx:14-31`):
`entryId, label, archetype, matchScore|null, action, rationale, reasonCode, reasonParams, commsFailed?, stale?, staleSince?`. That is the complete set of facts a preview row can show. There is **no** confidence, no matched/missing skills, no score provenance, no CV/profile completeness in this shape.

## Grounding audit — 4/10

The wave is deterministic math over a precomputed match score (no LLM call at this surface), so "grounding" = which of Marek's real context reaches the reject decision and the row he reviews.

| # | Context the decision should use | Reaches the wave? | Evidence |
|---|---|---|---|
| 1 | Candidate's real match score | ✅ | `screen-wave.ts:215,254` |
| 2 | Archetype / fairness protection | ✅ fail-closed | `screen-wave.ts:255,286`; `archetypes.ts:36-41,57-59` |
| 3 | Per-role-family floor override | ✅ incl. per-row chip | `screen-wave.ts:254,307`; `ScreenWaveModal.tsx:73-84` |
| 4 | JD-edit staleness of the score | ✅ server-derived | `screen-wave.ts:198-205`; chip `ScreenWaveModal.tsx:60-68` |
| 5 | Score **provenance** (analysis vs snapshot, when) | ❌ in the wave (present in reconsider rows) | absent from `screen-wave.ts:29-59`; present at `reconsider/route.ts:66-67` + `DecisionsTab.tsx:974` |
| 6 | **Confidence band / uncertainty** of the score | ❌ | `Confidence` exists (`MatchTypes.ts:41-47`) and renders in `AnalysisSummaryModal.tsx:140-145`, but is not in the wave payload nor in the predicate (`screen-wave.ts:254-257`) |
| 7 | Matched / missing skill evidence + provenance | ❌ | available at `AnalysisSummaryModal.tsx:167-192`, never in the wave |
| 8 | Claimed-but-unproven skills (adjacency vs unsubstantiated) | ❌ | `AnalysisSummaryModal.tsx:197-217`; absent from the wave |
| 9 | Score breakdown (where the fit comes from) | ❌ | `AnalysisSummaryModal.tsx:155-158` (`ScoreBreakdown`); absent from the wave |
| 10 | Prior pipeline history / recruiter notes on the entry | ❌ | not read anywhere in `screen-wave.ts` |

**4/10.** Everything present is about *the rule*; almost everything absent is about *the person*. The machinery for 6–9 already exists in this repo and is one component away — it simply never crosses into the wave.

## Reachability

Resolved before judging. Marek is an internal operator; `app/features/tabs.ts` has no per-role nav gating, so the Decisions tab, rules modal, wave modal, reconsider queue and the analysis modal are **all reachable** for him once the dev gate is seeded (`uat/env.md` — `kp_dev_authed=1`) and a ČS role has a scored `Screened` cohort (`seed_jobs_csas.py` + `seed_pipeline.py`). All routes he touches are `requireOperator`-gated and pass for an operator session (`screen-wave/route.ts:19`, `reconsider/route.ts:20`, `records/route.ts:38`). No finding below is `unreachable`. The candidate-facing consequence of his rejections (`/status/[token]`) is Tereza's surface and is excluded.

One reachability nuance that *is* the point of this run: `AnalysisSummaryModal` is reachable **from the queue**, not **from the wave** (`DecisionsTab.tsx:903` is the only `onInspect` call site). Marek can reach the evidence — just never at the moment he's deciding.

## Findings

```json
[
  {
    "id": "SD-L1-CS-01",
    "journey": "screening-decisions",
    "character": "marek-coordinator",
    "cert_level": "L1",
    "type": "missing-feature",
    "dimension": "trust",
    "severity": "major",
    "title": "The reject preview explains the CUTOFF, never the CANDIDATE — no drill-in from a reject row",
    "expected": "From a previewed reject row, open that person's evidence (score breakdown, matched/missing skills, provenance) without leaving the wave.",
    "got": "Each reject row is a plain <li> with label, score, chips and reasonText — which renders 'bottom {pct}% of {n} -> {count} (rank {rank}) and match {score} < {threshold}'. That is arithmetic about the rule, not evidence about the person. The row has no onClick, no button, no link.",
    "evidence": [
      "app/features/sub_decisions/ScreenWaveModal.tsx:222-237",
      "app/features/sub_decisions/ScreenWaveModal.tsx:194-204",
      "app/_lib/screen-wave.ts:312 (rationale string = cutoff math only)",
      "app/features/sub_decisions/DecisionsTab.tsx:903 (the ONLY onInspect call site — the queue card, not the wave)",
      "app/features/sub_decisions/AnalysisSummaryModal.tsx:155-217 (the evidence that exists but never reaches the wave)"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "l2_priority": "Open the wave on a seeded ČS role and attempt, live, to inspect one previewed reject without committing. Confirm no click target exists on the row and that reaching that candidate's evidence requires closing the wave.",
    "suggested_acceptance": "Reject row is a button that opens the existing AnalysisSummaryModal (read-only variant) over the preview; wave state and approvalToken survive the round trip."
  },
  {
    "id": "SD-L1-CS-02",
    "journey": "screening-decisions",
    "character": "marek-coordinator",
    "cert_level": "L1",
    "type": "missing-feature",
    "dimension": "completion",
    "severity": "major",
    "title": "No per-candidate override — Marek can move the global line, but cannot spare one person",
    "expected": "Having spotted one candidate who is wrongly below the line, exclude just her from this wave and commit the rest.",
    "got": "The wave has exactly three controls: an enable checkbox and two global sliders. There is no per-row exclude/keep affordance, and the committed set is read from `wouldReject`, a Set derived purely from the predicate — the client cannot subtract from it. To spare one person Marek must slacken the global threshold (sparing everyone above her) or commit and then reinstate her afterwards, i.e. send her a rejection email first (dispatchRejection at screen-wave.ts:377) and apologise later.",
    "evidence": [
      "app/features/sub_decisions/ScreenWaveModal.tsx:318-336 (the complete control set)",
      "app/_lib/screen-wave.ts:247-258 (wouldReject built from the predicate alone)",
      "app/_lib/screen-wave.ts:301 (commit loop reads only wouldReject)",
      "app/api/decisions/screen-wave/route.ts:50-65 (body carries jobId/override/dryRun/approvalToken — no per-entry list)",
      "app/_lib/screen-wave.ts:377 (rejection comms dispatch on commit)"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "l2_priority": "Live: confirm the only way to spare a single previewed reject is to move a global slider, and measure what else that slider move spares (the collateral count).",
    "suggested_acceptance": "Per-row 'ponechat' toggle; excluded entryIds ride the commit body and are folded into the approval-token signature so the seal still attests to exactly the set the human approved."
  },
  {
    "id": "SD-L1-CS-03",
    "journey": "screening-decisions",
    "character": "marek-coordinator",
    "cert_level": "L1",
    "type": "quality-gap",
    "dimension": "senior-quality",
    "severity": "major",
    "title": "The honest-but-sparse profile is indistinguishable from the genuinely weak one — confidence exists in the engine and never reaches the wave",
    "expected": "A candidate scored 41 ± 22 on a two-page CV should look different in the reject list from one scored 41 ± 4 on a full dossier — and ideally should not be auto-rejected on the point estimate alone.",
    "got": "The matcher computes a confidence band with human-readable drivers, and AnalysisSummaryModal renders it. The wave's ScreenDecision shape carries no confidence field, the modal renders none, and the reject predicate compares the bare point estimate to the floor. Two candidates whose bands overlap the threshold in opposite directions are shown identically as a name and a number. The system's own honesty machinery for unmeasured people (the `unscored` keep, screen-wave.ts:206-214,400-411) proves the team understands this distinction — it just stops at null and never covers 'measured, but barely'.",
    "evidence": [
      "app/features/sub_match/MatchTypes.ts:41-47 (Confidence: low/high/level/drivers)",
      "app/features/sub_decisions/AnalysisSummaryModal.tsx:140-145 (band + drivers rendered there)",
      "app/_lib/screen-wave.ts:29-59 (ScreenDecision — no confidence)",
      "app/features/sub_decisions/ScreenWaveModal.tsx:14-31 (client mirror — no confidence)",
      "app/_lib/screen-wave.ts:254-257 (predicate on the point estimate)",
      "app/_lib/screen-wave.ts:206-214 (the null-score honesty that shows the concept is understood)"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "l2_priority": "Seed one thin-CV and one rich-CV candidate with adjacent scores straddling the floor; confirm the live preview renders them identically and both are auto-rejected.",
    "suggested_acceptance": "Thread `confidence` into ScreenDecision; render a band chip on rows whose interval crosses the effective floor, and (product decision) either shield or explicitly flag 'uncertain — review' for wide bands, the same fail-closed shape isFairnessProtected already uses."
  },
  {
    "id": "SD-L1-CS-04",
    "journey": "screening-decisions",
    "character": "marek-coordinator",
    "cert_level": "L1",
    "type": "confusion",
    "dimension": "trust",
    "severity": "minor",
    "title": "Score provenance is shown on the reconsider row but not on the reject row — the honest label arrives only after the email has gone",
    "expected": "If a snapshot-at-add score is worth labelling when Marek reviews a rejection, it is worth labelling before he causes one.",
    "got": "The reconsider queue stamps every row with canonical score + ScoreProvenanceLabel ('from CV analysis · date' vs 'snapshot at add'). The wave preview, which is where the decision is actually made, carries no provenance at all — only the JD-staleness chip.",
    "evidence": [
      "app/api/decisions/reconsider/route.ts:28-38,66-67",
      "app/features/sub_decisions/DecisionsTab.tsx:970-975 (ScoreProvenanceLabel)",
      "app/_lib/screen-wave.ts:29-59 (no scoreProvenance on ScreenDecision)",
      "app/features/sub_decisions/ScreenWaveModal.tsx:226 (row renders the bare number)"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "l2_priority": "Confirm live that a snapshot-scored candidate appears in the preview with a bare number and no provenance label.",
    "suggested_acceptance": "withCanonicalScores already runs in the wave (screen-wave.ts:201) — carry scoreProvenance onto ScreenDecision and reuse ScoreProvenanceLabel on the row."
  },
  {
    "id": "SD-L1-CS-05",
    "journey": "screening-decisions",
    "character": "marek-coordinator",
    "cert_level": "L1",
    "type": "missing-feature",
    "dimension": "effort",
    "severity": "minor",
    "title": "The reconsider queue also has no drill-in — the undo path asks Marek to reinstate on the same thin facts that rejected her",
    "expected": "Before reinstating, see why she scored what she scored.",
    "got": "A reconsider row shows label, job title, score + provenance, rejection date, the sealed cutoff reason, and a Reinstate button. No path to the candidate's evidence; the row is not a link and no onInspect is wired here.",
    "evidence": [
      "app/features/sub_decisions/DecisionsTab.tsx:957-1001",
      "app/api/decisions/reconsider/route.ts:61-70 (projection — no skills/breakdown/confidence)"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "l2_priority": "Live: from the reconsider queue, count the clicks needed to see a rejected candidate's matched/missing skills.",
    "suggested_acceptance": "Make the reconsider row's name open AnalysisSummaryModal for that entry."
  },
  {
    "id": "SD-L1-CS-S1",
    "journey": "screening-decisions",
    "character": "marek-coordinator",
    "cert_level": "L1",
    "type": "strength",
    "dimension": "trust",
    "severity": "polish",
    "title": "The irreversibility ceremony is genuinely excellent — dry-run by default, CAS approval token, two-step confirm, fail-closed fairness, real undo",
    "expected": "n/a — protecting this.",
    "got": "Preview runs on open and on every control change with zero mutation; a commit must echo the approval token signed over the exact reject set and is refused 409 with a forced re-preview if the set moved; a second explicit confirm modal gates the fresh-set click; approvedBy is server-derived and body.approvedBy is ignored; fairness shielding is server-side and fails closed on unknown archetypes; unscored candidates are excluded rather than coerced to a fabricated 0; a comms failure is isolated per candidate and badged by name; every reject seals into a per-tenant hash chain; and reinstate is a real undo. Czech copy for all of it is complete.",
    "evidence": [
      "app/features/sub_decisions/ScreenWaveModal.tsx:106-141,152,157-161,374-407",
      "app/api/decisions/screen-wave/route.ts:19,38-39,43,50-65",
      "app/_lib/screen-wave.ts:206-214,255,259-271,346-351,375-384,357-368",
      "app/features/sub_decisions/DecisionsTab.tsx:193-205",
      "messages/cs.json decisions.wave.* (previewSubtitle, confirmBody, shieldNote, familyFloorTitle — all present)"
    ],
    "code_check": "n-a",
    "verdict": "confirmed",
    "resolution": "by-design",
    "ceiling": "The ceremony protects the SET. It does not help Marek judge any INDIVIDUAL in it — every guarantee above is about whether the batch he approved is the batch that fires, none about whether that batch is right.",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" }
  }
]
```

## Headline question — is Marek's oversight real or ceremonial?

**Ceremonial, by a hair — and the hair is one component wide.**

The honest split: kp has built a *procedurally* real human-in-the-loop and an *epistemically* empty one. Procedurally it is better than most products I have read: the commit cannot fire without a token signed over the exact reject set (`screen-wave.ts:259-271`), a set that shifts underneath him produces a 409 and a forced re-preview (`ScreenWaveModal.tsx:157-161`), and the approver is bound to the server-derived operator identity with `body.approvedBy` explicitly ignored (`screen-wave/route.ts:56-65`). Nobody can rubber-stamp a stale set, and no one can forge who reviewed it. That is a real Art. 22 gate for the question *"did a human approve this batch?"*

But the regulator's other question — *"on what basis?"* — is where it goes hollow. Ask precisely what Marek sees when the preview lists who would be rejected. `ScreenWaveModal.tsx:222-237` renders, per person: a **name**, a **score**, chips, and `reasonText(d)`. And `reasonText` (`:194-204`) resolves to the reject catalog string interpolated from `reasonParams` built at `screen-wave.ts:319-327` — `pct, n, count, rank, score, threshold`. Rendered, that is *"Zamítl by · spodních 20 % ze 40 → 8 (pořadí 3) a shoda 41 < 55."*

Read that sentence as Marek would. It tells him **why the line is where it is**. It tells him **nothing about the woman on the wrong side of it**. It is a restatement of his own slider setting with her name attached — the system explaining its arithmetic back to itself. Ten reject rows produce ten copies of the same sentence with different numbers substituted. There is no fact in that row that Marek could disagree with; the only thing he can "audit" is whether 41 is less than 55.

So: can he drill into an individual? **Not from here.** The evidence he would need exists in this repo and is good — `AnalysisSummaryModal` shows the weighted score breakdown (`:155-158`), matched skills with provenance labels and per-skill strength (`:167-192`), missing skills, and the claimed-but-unproven bucket that distinguishes a near-miss specialist from an unsubstantiated claim (`:197-217`). But the single call site that opens it is `DecisionsTab.tsx:903`, the one-by-one queue card. The wave's reject `<li>` has no click handler, no button, no link. The evidence and the decision are in the same tab and never meet.

Can he override one person? **No.** The controls are an enable checkbox and two global sliders (`:318-336`); the committed set is read straight from `wouldReject` (`screen-wave.ts:301`), a Set the client cannot subtract from, and the request body has no per-entry channel (`screen-wave/route.ts:26-32`). If he becomes convinced that one candidate is wrong, his options are: slacken the global threshold and spare everyone above her too, or commit — which queues her rejection email (`screen-wave.ts:377`) — and reinstate her after. The undo is real but it is downstream of the apology.

Is the honest-but-sparse profile distinguished from the genuinely weak one? **No, and this is the sharpest form of the failure.** The matcher computes a confidence band with drivers (`MatchTypes.ts:41-47`); `AnalysisSummaryModal.tsx:140-145` renders it. `ScreenDecision` (`screen-wave.ts:29-59`) has no confidence field, so the preview cannot show it, and the reject predicate (`:254-257`) compares the bare point estimate to the floor. A candidate at 41 ± 22 — thin CV, wide band, could genuinely be a 60 — and one at 41 ± 4 are rendered as the identical row and rejected identically. This is exactly the scenario in the question: the best candidate who presented worst is, in this code, a wide confidence band, and the wave is structurally blind to the one number that would have flagged her. What makes it painful rather than merely absent is that the team clearly *understands* the principle — the null-score policy (`:206-214`, `:400-411`) refuses to coerce an unmeasured candidate to a fabricated 0 and keeps her with an explicit "unscored" outcome. The honesty stops at `null` and never extends to "measured, but barely."

So Marek's review launders the model's judgment. He performs a careful, well-instrumented, cryptographically sealed approval of a set he cannot evaluate. And the ceremony's quality makes it worse, not better: the 409 gate, the confirm modal and the hash chain all signal *"this was rigorously reviewed"* to anyone reading the record afterward, when what was reviewed was a count.

**Minimum affordance to make it real** — in priority order, and none of it is new machinery:

1. **Make the reject row open `AnalysisSummaryModal`** (read-only, stacked over the preview via the existing Modal machinery the confirm step already uses at `:374`). One prop from `DecisionsTab.tsx:903`'s pattern. This alone converts "a number" into "a case", and is the single change I would ship first.
2. **Thread `confidence` into `ScreenDecision`** and badge any row whose band crosses the effective floor. `withCanonicalScores` already runs in the wave at `screen-wave.ts:201`; the band is computed upstream. Then decide, as product, whether a wide band should be shielded the way `isFairnessProtected` shields early-career — the fail-closed pattern is already in the file.
3. **A per-row "ponechat" toggle**, with excluded `entryId`s folded into the approval-token signature (`screenWaveApprovalToken`, `:259`) so the seal still attests to exactly the set the human approved. Without this, noticing the mistake in step 1 gives Marek no way to act on it — which would be its own cruelty.

Ship 1 and 3 and the oversight becomes real: he can see a case and act on one person. Ship 2 and the system starts telling him *where to look*, which is what a human-in-the-loop over 200 candidates actually needs.

## Character feedback — Marek Beneš, first person

Tak. Nejdřív to dobré, protože toho je hodně a nechci, aby to zapadlo.

Otevřel jsem vlnu a ona **hned počítala náhled**, sama, bez toho abych o to prosil. Titulek říká *"Náhled — nic se neuplatní, dokud nepotvrdíte."* Posunul jsem posuvník a číslo se změnilo a pořád se nic nestalo. To je přesně ten pocit, kvůli kterému nástroj používám. Pak potvrzení — a ono se mě to zeptalo **podruhé**, a napsalo mi to na rovinu, že to nelze vzít zpět a že se to zapečetí. A ještě jsem se dočetl, že když se mezi náhledem a potvrzením kohorta změní, systém to **odmítne** a donutí mě podívat se na aktuální sadu znovu. Kdo tohle navrhl, ten už někdy hasil malér po hromadné akci. Poznávám to. A česky je to celé, včetně těch drobných chipů — ani jednou jsem nespadl do angličtiny.

A pak jsem se podíval na ten seznam. A tady mi to spadlo.

Vidím jméno. Vidím číslo. A vidím větu, která mi říká *"spodních 20 % ze 40 → 8, pořadí 3, shoda 41 < 55."* Přečtěte si to prosím ještě jednou. **To mi neříká nic o té ženské.** To mi říká, kam jsem si dal posuvník. To už vím, sám jsem ho tam dal před třiceti vteřinami. Dole je jich osm a všech osm má tu samou větu, jen jiná čísla. Já se nemám s čím přít. Buď věřím tomu číslu 41, nebo nevěřím — a rozhodnout to podle téhle obrazovky nejde.

Zkusil jsem na ni kliknout. Nic. Není to tlačítko, není to odkaz, není tam šipka, prostě řádek. Přitom — a tohle mě štve nejvíc — **ta obrazovka v aplikaci existuje.** Když jdu do fronty a proklikám kandidáty jednoho po druhém, dostanu rozpad skóre, dovednosti co sedí a co chybí, i s tím, odkud to víme, a dokonce sekci "tvrdí, ale nedoloženo", která rozliší člověka z vedlejšího oboru od člověka, co si to napsal do CV. To je přesně to, co potřebuju. Jen se to nedá otevřít **z toho místa, kde se rozhoduje**. Důkazy jsou v jedné záložce a rozhodnutí v druhé a nikdy se nepotkají.

A druhá věc: kdybych **náhodou** poznal, že jedna z těch osmi tam nepatří — nemám co udělat. Nemůžu ji vyškrtnout. Můžu jen povolit práh, čímž ušetřím i těch pět dalších, o které nestojím, nebo to odpálit a pak ji "vrátit" — jenže vrátit ji můžu až potom, co jí odešel zamítací e-mail pod hlavičkou spořitelny. To není undo. To je omluva. *Odešlo to? A komu?* — no, odešlo to i jí, a to jsem věděl dopředu.

A do třetice, tohle mě dost děsí: nikde nevidím, jak **jistý** si tím číslem systém je. Kandidátka s dvoustránkovým životopisem, o které toho víme málo, a kandidát, kterého máme rozebraného do detailu — oba můžou mít 41 a v tom seznamu vypadají naprosto stejně. Přitom aplikace ten interval spolehlivosti umí, viděl jsem ho v detailu kandidáta. Do vlny se prostě nedostal. A ono to je vtipné a smutné zároveň: ti, u kterých skóre **vůbec nemáme**, jsou ošetření vzorně — systém odmítne udělat z prázdna nulu a poctivě je odloží ke skórování. Takže princip tady lidi chápou. Jen skončil u nuly a nedotáhl se k "změřeno, ale mělce". A přesně tam mi utíká ta nejlepší kandidátka, co se jen špatně prodala.

Takže — nasadil bych to? **Ano, ale ne jako screening. Zatím jenom jako čistič úplného dna.** Práh úplně dole, jen na lidi, u kterých je to zjevné i bez čtení. Tam mi to ušetří opravdu hodně — dvě hodiny ručního proklikávání kohorty za deset minut, a to je rozdíl, který cítím každý týden. Ale v pásmu, kde se to láme, kde je rozdíl mezi 41 a 55, tam si to stejně otevřu po jednom v detailu, protože jinak nevím nic. A tím jsem tu úsporu z velké části utratil.

A teď to, co mi nedá spát. Ten proces vypadá **strašně důkladně**. Náhled, potvrzení, druhé potvrzení, zapečetěný záznam, kdo to schválil. Kdyby přišla kontrola a otevřela ten audit, přečte si: *člověk to zkontroloval a schválil*. A ten člověk jsem já. Jenže já jsem zkontroloval **počet**. Můj podpis pod tím zní jako záruka, a přitom jsem jen posunul posuvník a viděl, jak se mění číslo. To je horší než kdyby tam žádná ceremonie nebyla — protože takhle to moje jméno tomu rozhodnutí dodává váhu, kterou nemá čím pokrýt. Já se pod věci podepisuju rád, ale jen pod ty, na které jsem se opravdu díval.

Dejte mi jednu jedinou věc a mluvím jinak: **ať se dá na to jméno v náhledu kliknout.** Ať se mi otevře to, co už máte hotové. A pak mi dovolte tu jednu vyškrtnout, než to odpálím. Když tohle přijde, pouštím vlny naostro na celý nábor a řeknu to i kolegům. Do té doby to mám jako smeták na dno — a to je škoda, protože všechno ostatní kolem toho je udělané líp, než jsem zvyklý.
