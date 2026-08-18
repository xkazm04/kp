# UAT drain — run 2026-08-17-analytics-sections (the consolidated Analytics tab)

Third `/uat drain`. Sources: the three per-Character L1 reports **including their
first-person feedback sections** (Kateřina Svobodová — TA ops & analytics, the
native · Lucie Procházková — DPO / fairness & compliance · Tomáš — hiring
manager, the deliberately out-of-segment consumer lens), `findings.json`
(58 merged rows, ranked), `SUMMARY.md`, `BRIEF.md` and its carry-forward table,
`_L2-PREFLIGHT.md` and `L2-EVIDENCE.md` (orchestrator-measured — authoritative
for every L2 verdict, re-score and false-finding-prevented), and the two prior
drains (`2026-08-07-intake.md`, `2026-08-10-intake-triptych.md` + its
`recertify.md`), whose declines stand unless new evidence appears.

Run shape: L1 ×3 code-grounded walkers → **all three returned `L1-fail`**, so no
journey earned L2 certification and none was attempted. What was driven live was
a **targeted confirmation pass on the three blockers** (arms: **A** = `:3001`
seeded/keyed, **B** = `:3002` empty tenant); seven rows carry `cert_level:
"L1+L2"`. Every live verdict names its arm.

Rule of this document, unchanged: **no invented user needs.** Every opportunity
cites a Character voice verbatim (Czech stays Czech, with a short English gloss)
or a finding id. Every decline records its reason here *and* in
`docs/BACKLOG.md` so it cannot resurface as a fresh idea next quarter. A "what to
fix" claim not already settled in `L2-EVIDENCE.md` was either verified against
the code while writing this (marked **verified**) or is labelled **hypothesis**
for the fixer to check first.

The run's spine, in one sentence: **a correct, honest, well-built mechanism that
reaches no surface** — the leakage disclosure, the holdout clean arm, the
channel-spend input, the zero-transition empty-state guard, nine orphaned
modules. Several items below are **one wire, not a feature**.

---

## 1. Confirmed and fixed (reference only — the ceilings are inputs to §2)

Three carry-forward rows from the never-drained `2026-07-20-cases-scoring` run
went finding → fix → verified this cycle. **None reached
`resolved-verified`**, and the distinction this run turned on is the first row:

| Prior finding | Fix + cited site | Resolution | Ceiling that remains |
|---|---|---|---|
| **`KAT-L1-001`** (blocker · trust) — calibration validated the match score against outcomes the match score itself caused; the Brier score was circular | The **holdout clean arm** is real, non-vacuous and cited at its fix sites: a deterministic sample spared **before** the approval token is signed (`screen-wave-holdout.ts`, `screen-wave.ts:253,276,323-344`), sealed records, a spared-**minus**-later-rejected set (`decision-record-store.ts:391-420`), an `onlyEntryIds` pair filter with the identical inclusion rule (`db/pipeline.ts:389-420`), `?source=holdout` (`calibration/route.ts:42-56`), and a four-sentence per-source `calibrationLeakage` descriptor carrying its **own `ceiling` string** (`calibration.ts:344-401`). `calibration-holdout-arm.test.ts` passes (Lucie ran it) | **`fixed` — explicitly NOT `resolved-verified`** | **No UI reaches it.** The selector union is `"pipeline" \| "analysis"` (`AnalyticsCalibrationPanel.tsx:51`, `AnalyticsCalibrationHeader.tsx:17-18` — verified); `grep -rn "holdout\|leakage" app/features` → **0 hits** (verified); no `sourceHoldout`/`leakage*` key in any of the four locales; the arm is empty (`n:0`) besides; and `QualityInstrument.tsx:44` hardcodes the **contaminated** arm under a display-type verdict. Fix landed ≠ reachable ≠ unblocks the job — L1 could claim only the first, and L2 confirmed the other two are false. → **§2.1** |
| **`KAT-L1-005`** (major · time-saved) — the leadership ROI % rested on two hardcoded constants that could not be re-grounded in the org's own baseline | Half landed: the hourly rate **is** now org-settable from the panel (`AnalyticsAutomationPanel.tsx:170-176` → `POST /api/analytics/targets`, `recruiter_hourly_czk`), read back at `db/analytics.ts:602` | **`fixed` (half)** | The **second** constant did not. `MANUAL_HOURS_PER_HIRE = 42` is a 4th parameter with a default that **no call site passes** (`automation-roi.ts:41,75` vs `db/analytics.ts:602`, which passes three arguments — verified), and there is no target key for it. Rendered live on arm A: „≈ 1.6 h ušetřeno na jedno přijetí, zhruba 4 % z ~42 h" (`l2-economics.text.txt:114`). Plus `Math.min(100, …)` (`automation-roi.ts:103` — verified) renders a 437 % estimate as a clean 100 %. → **§2.10** |
| **`RECON-02`** (major · trust) — "the match score" was four different numbers | The producer map is written down (`match-score.ts:44-80`), both calibration arms name which score they measure (`measuresPipeline` / `measuresAnalysis`), and board, Decisions, screen-wave and the candidate timeline all resolve through `withCanonicalScores` | **`fixed`** (on this surface) | Producer (C) — the fresh Python recompute — is still rendered **bare** in the Matrix grid (`api/matrix/route.ts:13` → `matrix/focus/MatchCard.tsx:62`), so one candidate can legitimately read 57 in Matrix and 49 on the board with nothing on screen explaining why. Kateřina's Matrix binding, not Analytics. → carried, **§2.9** (the sibling "confidence" sweep) |

Two things worth naming about this table, because they are why §2 is ranked the
way it is:

- **Seven other carry-forwards came back `still open` at `recurrence: 2`**
  (`KAT-L1-002`, `KAT-L1-003`, `KAT-L1-004`, `KAT-L1-006`, `RECON-06`,
  `CS-L1-004`, `CS-L1-005`, plus `LUC-GEF-L1-08` and `LUC-GEF-L1-11` from the
  group-eval run). They are not new information — they are the price of the
  undrained run, and eleven rows in this run's `findings.json` carry
  `recurrence: 2`.
- **One strength regressed**: `KAT-L1-S02` ("every number on the page ends in a
  decision") was previously *met* and now is not — recorded as a **regression**,
  deliberately not as recurrence. Tomáš's own framing: „nebyl to dřív defekt,
  byla to síla; je to regrese, a píšu to tak."

---

## 2. Design opportunities

**Ranking rule applied, above impact arithmetic:** `recurrence` first (an unbuilt
gap returning from a prior cycle outranks a first-time finding of equal impact —
11 rows carry it), then **convergence** (10 merges this run: multiple Characters
reaching the same defect independently), then **voice escalation** (where a
first-person section claims a harsher dimension than the finding row scored, the
voice sets the rank). Recommendations are exactly one of `build`, `concept-doc`,
`method-commitment`, `decline-with-reason`.

### Guardrails — the strengths, phrased as constraints on everything below

Not compliments. Conditions every item must satisfy. All are finding rows
(ranks 45–58, the strength half of `findings.json`).

- **G1 — The honesty gate stays the headline, never a caveat.**
  `MIN_CALIBRATION_OUTCOMES = 20`, the refusal to draw a curve below it, and the
  per-quarter „Zatím málo výsledků" for both 2026-Q2 and Q3 on a host where the
  all-time arm reports `calibrated: true`. Kateřina: „proložená hrstkou bodů by
  působila jistotou, kterou tato data nemají." (*a curve fitted through a handful
  of points would project a confidence this data does not have*) — and, in her
  words, *"That is the register I want everywhere."* Any calibration work (§2.1)
  must preserve the under-data verdict **as the headline**. (`KAT-ANA-14` ×2 ·
  `LUC-ANA-S08`)
- **G2 — New disclosure rides *alongside* the sealed bytes, never replaces
  them.** `rationaleLocalized` is a parallel field so the hash is unaffected
  (`AnalyticsDecisionRecordsPanel.tsx:36-39,57-59`). Lucie: „nikdo se nesáhl na
  hašované bajty, aby mi udělal radost" (*nobody touched the hashed bytes to make
  me happy*). (`LUC-ANA-S03`)
- **G3 — Fix the grain of accountability, keep its honesty.** `operatorApprover()`
  states the posture instead of inventing a person; the approver stays
  **server-bound** so a caller cannot assert it; the human reversal seals into the
  **same** chain, attributed to the human, never the machine. (`LUC-ANA-S01`,
  `LUC-ANA-S02`)
- **G4 — The audit trail is server-paged, never windowed, and `seq` is visible in
  every ordering** — sorting is a view over the chain, never a claim about it —
  and the export button keeps naming its own scope („Exportovat stránku").
  (`LUC-ANA-S04`, `LUC-ANA-S05`)
- **G5 — Keep the access posture**: `requireOperator()` on the whole-chain read,
  the candidate's view as a separate closed allowlist projection, CSV injection
  neutralized centrally. (`LUC-ANA-S06`)
- **G6 — Attribution stays three-state and fails *away* from the machine**, and
  the `kindsQueued` swap keeps refusing to claim a delivery the relay did not
  perform. Mapping unknown kinds (§2.13) must not make `unknown` default to
  `AUTO`. (`LUC-ANA-S07`)
- **G7 — Do not touch the metric-pack contract**: per-metric
  `measured|thin|not_measurable`, sample, a mandatory `basis`, the `certifiable`
  gate, `recruiter_hours_saved` sampled in *actions* not hires, and the flat
  refusal to compute a "% improvement vs before" kp has no baseline for. Keep the
  two-currency rule — USD ledger and CZK spend side by side, never summed, reason
  printed. Kateřina on that refusal: „**To je přesně ta věta, kterou bych napsala
  sama.**" (*That is exactly the sentence I would have written myself.*)
  (`KAT-ANA-12`)
- **G8 — Never reintroduce a name-based terminal/gate check.** "A hire" is one
  role-derived, workspace-axis-aware predicate applied in seven places; rename the
  Hired column and every aggregate still counts the same people. It is the only
  reconciliation trace that came back clean. (`KAT-ANA-13`)
- **G9 — The four headline numbers stay in the header, above the switcher**, and
  every section keeps its one-line hint — the single reason the three-way split is
  survivable for an out-of-segment reader. (`TOM-ANA-S1`, `TOM-ANA-S2`)
- **G10 — Keep the em-dash rule, the "not yet" branches and the
  verdict-as-instruction register.** „Zatím nikdo nebyl přijat, takže není co
  vykázat", „Pomlčka ve sloupci Útrata znamená, že se u tohoto typu zdroje neměří,
  ne že byl zdarma", „Nechte u zamítnutí ještě člověka, dokud se to nezlepší."
  Fix what those sentences rest on, not their register — and extend the register
  to Performance and Economics. (`TOM-ANA-S3`, `TOM-ANA-S4`)

---

### 2.1 The clean arm and its disclosure reach the screen — **build** (B1)

*Rank basis: the only item that is recurrence 2 **and** convergence ×3 **and**
L1+L2. Everything else is downstream of it.*

- **Evidence:** `KAT-L1-001` (rec 2, `fixed` not verified) · `KAT-ANA-1` (blocker,
  ×3 Characters) · `KAT-ANA-6` ×2 · `LUC-ANA-2` (blocker) · `LUC-ANA-3` ·
  `TOM-ANA-10` · `KAT-L1-006` (rec 2). Confirmed and **widened** at L2
  (`L2-EVIDENCE §1`, arm A, cs).
- **Voice — Kateřina:** „Postavili poctivou verzi a nezapojili ji. […] A hlavně
  bych je varovala před tou jednou větou: ‚Automatická rozhodnutí na tomto skóre
  jsou obhajitelná.' **Na tohle se nikdo z nás nemůže podepsat.**" (*They built
  the honest version and didn't plug it in. Above all I'd warn a peer about that
  one sentence: "automated decisions on this score are defensible." None of us can
  put our name on that.*) Her adoption verdict on this section is not "improve
  it": *"The Quality section — **no, and I would ask for it to be switched off**
  before a client sees it, which is a strange thing to say about the most
  carefully-built code on the page."*
- **Voice — Lucie:** „‚obhajitelná' je právní tvrzení. Ne statistické. Tuhle větu
  bych podepisovala já, ne panel." (*"Defensible" is a legal claim, not a
  statistical one. I would be the one signing that sentence, not the panel.*)
- **What L2 added:** the reliability curve renders its **own leakage signature as
  a success** — predicted 0.35 → observed 0.00 (n=3); 0.45 → 1.00; 0.57 → 1.00
  (n=8); 0.66 → 1.00; 0.99 → 1.00: a step function at the threshold is what a
  score-caused label looks like, and the screen labels it „dobře kalibrované".
  And Lucie's arithmetic makes it worse than "optimistic": model Brier 0.1631 vs
  **base-rate Brier 0.1224 → skill score −0.332**, i.e. worse than a constant
  guess, under a headline reading „s pohodlným náskokem před hádáním".
- **What to build** (all four, they are one change):
  1. Widen the source union to include `holdout` and ship the 4-locale copy
     (`sourceHoldout` / `measuresHoldout` / `exclusionHoldout` + the `leakage`
     vocabulary) — **verified**: the union is two-valued at
     `AnalyticsCalibrationPanel.tsx:51` and `AnalyticsCalibrationHeader.tsx:17-18`,
     and `grep -rn "holdout\|leakage" app/features` returns nothing.
  2. Declare `leakage` in both `Payload` types and render `note` + `ceiling`
     under the verdict — the honest four-sentence disclosure already ships on
     every request (`calibration/route.ts:90`).
  3. **Structurally bar** a `level:"high"` source from producing a `trustworthy`
     verdict or the word „obhajitelná", and replace the coin-flip reference
     (0.25) with the **cohort base rate** — a 86 %-positive cohort makes coin-flip
     the wrong yardstick.
  4. When the recommender runs on contaminated pairs, print the caveat the route
     already wrote beside Apply (`route.ts:88-89`), or run it over the holdout
     once that arm clears the gate (`KAT-L1-006`).
- **Cost / value:** the entire data layer exists, is tested and is cited at its
  fix sites. This is copy in four locales, two type declarations, one guard and
  one reference change — days, not sessions. Value: it is the single sentence
  that cost this surface all three signatures.
- **Ceiling to ship *with* it (not a reason to delay):** the clean arm is a
  next-quarter instrument. Auto-reject is off by default and
  `DEFAULT_HOLDOUT_PERCENT = 5`, so ≈500 would-be auto-rejects are needed before
  the holdout clears `MIN_CALIBRATION_OUTCOMES = 20` — on `:3001`'s 88 entries
  that is 2 people. Kateřina names the required copy herself: **"the honest curve
  needs ≈N more decisions", not an empty chart.** **G1 binds this whole item.**

### 2.2 Ground truth: what "a good hire" is, who records it, and what calibration may claim — **concept-doc** (C1)

*Rank basis: recurrence 2 on a **blocker** (`KAT-L1-002`) plus recurrence 2 on
`KAT-L1-003`. It ranks second because it is the deepest unbuilt gap in the run —
and it ranks as a concept-doc because the design questions are real and building
it blind would be guessing.*

- **Evidence:** `KAT-L1-002` (blocker, rec 2) — real hires now reach the outcome
  store (`dev-outcomes.ts:202-227`, called from `offer-finalize.ts:7` and
  `db/pipeline.ts:10` — genuine progress), but the 1..5 on-the-job rating has no
  capture path outside `/api/devcase/outcomes`, and `calibrate()` is consumed only
  by `/control`. `KAT-L1-003` (major, rec 2) — outcome `1` is `stage ∈
  axis.slice(screeningGateIndex(axis))`, so **Interview, Offer and Hired are one
  label**; now honestly disclosed („advanced past screening"), still not separable.
- **Voice — Kateřina:** the question she opens the tab with, and her own verdict
  on it — *"Did the 90 %-match candidates get hired **and stay**?" is still
  unanswerable from my tab* — after every UI fix in §2.1 has shipped.
- **What the doc must resolve** (none of these is a coding decision):
  - What **is** the outcome signal — 90-day retention, a manager rating, ramp
    time, or the pipeline's own terminal stage? Who enters it, on what surface,
    and when (the moment a hire is 90 days in is nobody's current workflow)?
  - Does Interview / Offer / Hired become **three labels, or a second axis**?
    Calibration against "advanced past screening" and calibration against "hire
    quality" are different instruments with different sample sizes.
  - **Lucie's world constrains it:** storing employee performance data beside
    hiring decision records changes the lawful basis and the retention clock. A
    performance rating sealed into an Art. 22 chain is a different artifact from a
    screening rationale.
  - What does the surface say in the years before that data exists? (G1: the
    honest answer is a stated horizon, not an empty chart.)
- **Cost / value:** schema + a new capture surface + a policy decision. Value is
  high and permanent — it is the difference between calibrating the screener and
  calibrating the *hire* — but it is the one item here that a PR cannot answer.
  Write it in `docs/concepts/`, then promote to build with its own journey.

### 2.3 Make "show me the people" work again — **build** (B2)

*Rank basis: blocker, confirmed live with a purpose-built probe, and it is the
mechanism under a **regressed strength** (`KAT-L1-S02`, convergence ×2).*

- **Evidence:** `TOM-ANA-1` (blocker, L1+L2) + `KAT-L1-S02` (rec 2 / regression,
  Kateřina + Tomáš). L2 clicked it: „Pohovor 19 42%" → `urlAfterClick:
  "http://localhost:3001/?stage=Interview"`, `selectedNav: ["Analytika"]`,
  `looksLikeBoard: false`. **None of the five funnel hrefs carries `tab=`.**
  `buildUrl` deletes `tab` when it equals `DEFAULT_TAB` (`tabs.ts:288,328`), and
  since `2d02a388` the active tab only changes when a param **arrives**
  (`useUrlInboxState.ts:59-64`). All five `boardHref` call sites break; `tab:
  "decisions"`, `"jobs"`, `"channels"` all survive.
- **Voice — Tomáš:** „K čemu mi je graf, ze kterého se nedostanu k lidem? To si
  radši napíšu recruiterce." (*What use is a chart I can't get from to the people?
  I'd rather message the recruiter.*) And the line that prices the whole backlog:
  „Jsem od ‚ano' blíž, než jsem čekal. […] Tři z těch šesti věcí jsou jednovětné
  opravy a **jedna je odstranění jednoho `params.delete`**."
- **Voice — Tomáš, on the second, independent half:** the Economics board is
  „**Ani jeden řádek nikam nevede.** Osm sloupců, žádný `Link`, žádný `onClick`."
  (*Not one row leads anywhere. Eight columns, no link, no onClick.*) Kateřina's
  own bar is what this breaks — *"every number on the page ends in a decision"*,
  previously **met**, now broken in two places (the dead
  `variantRecommendations` and the Quality verdict).
- **What to build:** (a) keep `tab=` for cross-tab links, **or** make the inbox
  treat an *absent* param as an arrival of the default — the remedy is a
  deliberate choice, not an oversight, because `tabs.test.ts:189-193` **pins the
  deletion on purpose** and 20/20 of its tests pass. Whichever branch is taken,
  the contract test is updated deliberately, not deleted. (b) Give the Economics
  board rows an exit again (the `decisionsHref` pattern at
  `AnalyticsAutomationPanel.tsx:58-64` already works).
- **Cost / value:** the smallest cost-to-value ratio in the run. It restores a
  strength that was previously *met*, on the one affordance the product advertises
  in its own comment („every chart links to the candidates behind it",
  `AnalyticsTab.tsx:85`). Note the coupling to **§2.18** — both halves of "take
  this number to the people / to a colleague" broke from the same shift of tab
  from URL state to app state; do **not** block this fix on that concept-doc.

### 2.4 Condition the tamper-evidence claim on `key_id` — **build** (B3)

*Rank basis: blocker, L1+L2, and the run's **only stated purchase condition** —
voice escalation of the strongest kind.*

- **Evidence:** `LUC-ANA-1` (blocker, L1+L2). Rendered on arm A:
  „**Odolné proti manipulaci: 66 zapečetěných záznamů, řetězec ověřen.**" over 66
  records that all carry `key_id=''` — plain SHA-256, no secret. Lucie
  **reproduced the forgery** against the real store (rewrote the approver on a
  sealed auto-rejection, re-forged the chain with the public algorithm,
  `verifyDecisionChain` → `{ok:true}`), and the repo's own **passing** test
  asserts the property (`decision-record-store.test.ts:167`).
- **Voice — Lucie, to a peer:** „Je to jediný nástroj, který jsem viděla, co si tu
  rozhodovací stopu opravdu vede sám a živě, ne dodatečně rekonstruovanou. A je to
  taky jediný, který mi u ní napsal, že je odolná proti manipulaci, když jsem si
  za dvacet minut ověřila, že není. **Kup ho, až tu jednu větu podmíní klíčem — do
  té doby si ji přečti, ale nepodepisuj.**" (*…Buy it once they condition that one
  sentence on a key — until then, read it, but don't sign it.*)
- **What to build** (all four verified while writing this):
  1. Add `keyed` / `keylessCount` to `ChainVerdict` — today it is
     `{ok, count, brokenAtSeq}` (`decision-record-store.ts:49`), so the route
     **cannot** pass the fact even if the badge wanted it — and split the badge
     copy in 4 locales.
  2. Add `KP_DECISION_HMAC_KEY` (+ `_ID`) to `.env.example` — **absent today**,
     while the rotation contract is fully documented in the module header.
  3. Correct `docs/features/compliance/README.md:56-58`, which states *"Every
     automated or human adverse action is sealed into a per-tenant,
     **HMAC-SHA256** hash-chained record"* unconditionally.
  4. Show `key_id` (or its absence) on the row — the count in the badge (66)
     currently quantifies exactly the records it cannot vouch for.
- **Cost / value:** Lucie's own estimate — „Čtvrtá je **jeden `if`**." One
  boolean, one env line, one doc sentence, one 4-locale copy split. It converts a
  contradicted claim into a true one on the single artifact a regulator reads.
  **G3 binds it:** condition the claim, do not soften the honesty around it.
- **Ceiling to state on screen:** a key added tomorrow **cannot retro-seal
  yesterday**. The 66 existing records were hashed without a secret; the badge
  becomes truthful, those records do not become tamper-evident.

### 2.5 Restore the only write path to channel spend — and date the number it produces — **build** (B4)

*Rank basis: blocker, L1+L2, convergence ×2, and **re-shaped by L2** from
`missing-feature` to `trust` — the sharpest single discovery of the live pass.*

- **Evidence:** `KAT-ANA-2` (blocker, re-scored) + `TOM-ANA-4`. Kateřina's
  mechanism is exactly right and verified: `setChannelSpend` has one caller
  (`api/analytics/spend/route.ts:24`), whose only UI client
  (`AnalyticsChannelSpendInput`) lives inside `AnalyticsChannelEconomicsPanel`,
  which `sectionChunks.tsx:36` exports and **no section imports** (verified: the
  three sections import 7 of the 9 declared chunks; `SourcePanel` and
  `ChannelEconomicsPanel` are the two nobody imports). No seeder writes the table.
- **What L2 falsified — and it is worse:** her strong form ("cost per hire can
  never exist") is false on arm A. `833 CZK / přijetí` renders from **one**
  `channel_spend` row — `linkedin = 5,000 CZK, updated_at 2026-07-05` — written
  **six weeks earlier by the `2026-07-02-full` UAT run**, while the panel was
  still reachable. The figure is not absent; it is a **fossil from a prior test
  session rendered as a current metric that no user can now update or correct**.
- **Voice — Kateřina:** „Nákup se mě zeptá ‚kolik nás stál jeden nábor' a já mám
  na obrazovce pomlčku. To si na slide dát nemůžu." (*Procurement asks what one
  hire cost us and I have a dash on screen. I can't put that on a slide.*) Her
  declared adoption threshold; and on the note the board politely prints beneath
  the empty column — *"The board even prints a note pointing at the door that has
  been bricked up."*
- **Voice — Tomáš:** „Ekonomika slibuje náklady na nábor, které se **už nedají
  zadat**, a zdvořile mi vysvětluje, že se evidují po kanálech — kde ale nejsou
  dveře."
- **What to build:** import `ChannelEconomicsPanel` into `EconomicsBoard` (one
  line) **or** lift `AnalyticsChannelSpendInput` into the Economics section
  directly; and render every single-row-derived money figure with its own
  `updated_at`, so a six-week-old number reads as six weeks old. **G7 binds it:**
  the metric pack's contract — `status`/`sample`/`basis`, the `certifiable` gate,
  no currency summing — must not move.
- **Cost / value:** one import plus a date. Until it lands, `cost_per_hire` is
  `not_measurable` in every window, `certifiable` is permanently false, and the
  best artifact on the surface always ships stamped *not publishable*.

### 2.6 The auditor's row: make one decision record answer a subject-access request — **build** (B5)

*Rank basis: two recurrence-2 rows (`CS-L1-005`, `LUC-GEF-L1-11`) plus five
first-time majors, all on the same two tables and the same trip.*

- **Evidence:** `LUC-GEF-L1-11` (rec 2 — `GET /api/decisions/records?candidate=`
  exists; `grep -rn "?candidate=" app/` returns **one hit, the route's own
  comment**; zero UI callers a full cycle after it was first raised, and the
  table's 20-row paging removed the Ctrl-F workaround the old unbounded list
  allowed) · `CS-L1-005` (rec 2 — `policyVersion` sealed on all 66 records with
  **three distinct floors** in the fixture; `grep -rn "policyVersion"
  app/features/` → 0; it is grounding-denominator source #5) · `LUC-ANA-5`
  (Subject is the only column of six with neither sort nor filter, and the log's
  only lookup is SQLite byte order, which puts every Czech-diacritic surname after
  Z — proven: `Adam, Marek, Zuzana, Čermák, Řezníčková, Šimková, Žák`) ·
  `LUC-ANA-8` (the per-record **content-hash fingerprint** was dropped from the
  table while `AnalyticsThresholdHistoryStrip.tsx:155-156` renders the identical
  idiom twenty lines away) · `LUC-ANA-7` (both tables render UTC as if local —
  10:42 Prague reads 08:42 — while the CSV writes the true ISO, so screen and
  export disagree by two hours **on an audit artifact**) · `LUC-ANA-10` (the legal
  basis is `line-clamp-2` with no `title`, no expand, no row detail) ·
  `LUC-ANA-9` (`labelize()` is English-only: the *Druh* column and its filter menu
  read "Auto Rejected" under a Czech header, while the sibling log localizes the
  identical vocabulary — and `i18n:check` **cannot** catch it, because there is no
  key) · `LUC-ANA-11` (neither export describes itself: no workspace, timestamp,
  locale, active filter or page/total, and 174 rows at 20 per click is nine
  downloads).
- **Verified while drafting this** (so the fixer starts from fact, not report):
  `grep -rn "?candidate=" app/` → the route's own comment plus one auth test,
  **zero UI callers**; `grep -rn "contentHash" app/features/` → only
  `AnalyticsThresholdHistoryStrip.tsx:18,155-156`; `grep -rn "policyVersion"
  app/features/` → **0**; `DecisionRecordsTable.tsx:66,101` calls the English-only
  `labelize` (`format.ts:651`) for both the column and the filter menu; both tables
  render `createdAt.slice(0,16).replace("T"," ")`
  (`DecisionLogTable.tsx:185`, `DecisionRecordsTable.tsx:122`) while the CSV writes
  raw `d.createdAt` (`:116`) — screen and export disagree by the UTC offset.
- **Voice — Lucie:** „Bez per-row fingerprintu nemám jak spojit řádek na obrazovce
  s řádkem v exportu." And on the whole bundle: „Co nemůžu udělat je připojit ji k
  podání jako důkaz, protože bych musela k jejímu vlastnímu odznaku dopsat
  poznámku, že to tvrzení neplatí. A **dodavatel, ke kterému musím psát errata, se
  do banky nedostane.**" (*A vendor I have to write errata for doesn't get into the
  bank.*)
- **What to build, as one trip through two files:** subject search (the
  `ColumnFilter` primitive already ships `mode="search"`, unused here) + an
  "export this candidate's dossier" button calling the existing `?candidate=`
  route; `policyVersion` and the truncated `contentHash` back on the row;
  localized `kind` labels via the sibling log's `kindLabel`; Czech collation on
  the name sort; local time with an explicit zone (or UTC labelled as UTC, matching
  the CSV); an expandable rationale; a provenance block + whole-trail export.
  **G4 and G5 bind it:** keep `seq` visible in every ordering, keep the trail
  server-paged and unwindowed, keep `requireOperator()` and the central CSV
  neutralization.
- **Cost / value:** Lucie's own estimate for the first three — „**čtyři dny
  práce**". This is the section she would otherwise attach an erratum to.

### 2.7 Name the person on an adverse decision — **build** (B6)

*Rank basis: recurrence 2 (`CS-L1-004`) + a first-time major, with voice
escalation — Lucie ranks it #1 of her five missing items.*

- **Evidence:** `CS-L1-004` (rec 2) — `reasons.rejectDid` has **no
  `{approvedBy}` placeholder in en/cs/de/fr** (verified in all four catalogs at
  `messages/*.json:2834`), so the approver survives only inside `payloadJson`,
  while `AnalyticsThresholdHistoryStrip.tsx:152` already renders exactly the
  pattern („Approved by {who}"). `LUC-ANA-4` — `pipeline_events` has **no actor
  column** (verified in the schema at `db/core.ts:394-405`), so the log's *Kdo*
  column can only ever render a **class**; the records table renders
  `human:recruiter`; the Art. 22 approver is the constant string „operator
  (single-operator deployment)". Meanwhile `currentUserId(session)` exists
  (verified, `auth/session.ts:131`) and five identified users with roles sit in
  the same database.
- **Voice — Lucie:** „V mém světě má rozhodnutí **jméno**. Tady má třídu:
  `human:recruiter`, `AUTO`, ‚operátor'. V té samé databázi je Petra Nováková
  (owner), Jan Dvořák (admin), Markéta Svobodová (recruiter). **Pět jmen. Na
  záznamu nula.**" (*In my world a decision has a name. Here it has a class… Five
  names in that same database. Zero on the record.*)
- **What to build:** add the `{approvedBy}` placeholder (or a „Schválil" line) to
  the localized rationale in all four locales; derive `approvedBy` from
  `currentUserId` + the users row when the session carries identity, keeping
  `operatorApprover()` as the honest fallback (**G3**); add an actor column to
  `pipeline_events`. Note the stale comment at
  `app/api/decisions/screen-wave/route.ts:55-58` — *"Per-user identity doesn't
  exist yet"* — which is no longer true.
- **Cost / value:** the placeholder is a copy change; the actor column is a
  migration plus one writer. **Ceiling:** in open dev mode every caller folds to
  owner, so a name only appears where a session actually carries identity.
- **Not double-entered:** this is the UAT evidence for **G5 in the AI-Act gap
  register** already tracked in `docs/BACKLOG.md` (*"`operatorApprover()` still
  returns a role string; not threaded to the per-user identity that now exists"*).
  The backlog entry cross-references it rather than opening a second line.

### 2.8 A group-eval reject must carry a reason — **build** (B7)

*Rank basis: recurrence 2 on a major, and it corrupts the exact column §2.6
exists to make readable.*

- **Evidence:** `LUC-GEF-L1-08` (rec 2). **Verified:**
  `hiring/decisions/DecisionsModals.tsx:105` calls `void act(e, action)` with no
  third argument, while `act` is `(e, action, detail?, ttlDays?)` — so the seal
  degrades to the template `"Recruiter reject from <stage>."` with
  `inputs.detail: null`. The *analysis* path in the same file passes a reason
  (`:60-61`). There is no confirmation step either.
- **Voice — Lucie:** *"On the new table that renders as a tautology in the
  **Odůvodnění** column — the column an auditor reads for the basis."* The reason
  recorded for a rejection is that a recruiter rejected.
- **What to build:** require a reason on the group-eval reject path (pass
  `detail`), and add the confirm step the analysis path has. **G6/G3 bind it:**
  the reversal path already seals correctly attributed to the human — do not
  regress that while touching this modal.
- **Cost / value:** one argument plus a small modal. Second cycle unbuilt on a
  path that writes into the sealed chain — every reject sealed until it lands is
  permanently reasonless.

### 2.9 "Confidence" gets four different words — and the LLM's self-report stops rendering as a measurement — **build** (B8)

*Rank basis: two recurrence-2 rows (`KAT-L1-004`, `RECON-06`) on the same word.*

- **Evidence:** `KAT-L1-004` (rec 2) — **verified**: the LLM's self-reported 0–100
  confidence still renders as a tone-banded meter with an ARIA assertion
  (`DecisionsAiReviewCard.tsx:149-159`), the one number on the card with nothing
  behind it. `RECON-06` (rec 2) — "confidence" is ≥4 unrelated quantities: a
  measurement **interval** (Matrix `match.band.*`), an **LLM self-report %**, a
  **salary-read grade**, and an archetype **vote share**. Plus the `RECON-02`
  ceiling from §1: the Matrix grid still renders producer (C) bare.
- **Voice — Kateřina:** the self-reported meter is *"the one number with nothing
  behind it"* — her own words from the carry-forward table — and her carry-forward
  verdict is that two mitigations landed (excluded for scorecards and offers; no
  chrome when absent) while the meter itself did not move.
- **What to build:** label the meter *self-reported* (or replace it with the
  measured band advance rate, which the calibration surface can now produce), and
  give each of the four quantities its own word in a single 4-locale sweep. Add
  provenance to the Matrix score while in that neighbourhood.
- **Cost / value:** a vocabulary sweep plus one label — low cost, and it is the
  second cycle for both rows. Value is cumulative: every §2.1 gain is undermined
  if a *different* unvalidated confidence number sits on the decision card.

### 2.10 One basis per per-hire figure; a settable manual baseline; no silent cap — **build** (B9)

- **Evidence:** `KAT-ANA-4` (major) — `pipelineAnalytics` runs **three windowing
  bases at once** (entry-creation cohort · event time · ledger time) and divides
  them into each other. Executed on a bank-shaped month: rendered **78.4 h/hire →
  "100 %"** versus an honest **13.1 h/hire → "31 %"** — overstated by ~69 points
  and pinned at the cap — while the code comment claims the opposite (**verified**
  at `db/analytics.ts:556-559`: *"both same-window → honest"*). Plus the
  `KAT-L1-005` ceiling from §1 (`MANUAL_HOURS_PER_HIRE = 42` unreachable;
  `Math.min(100, …)`) and `KAT-ANA-7` (the same USD ledger read all-time in
  Analytics and 30-day in Billing, neither surface naming the other; the compute
  `basis` names the call count but no period).
- **Voice — Kateřina:** „**Tohle je ta věta, po které mě vyhodí**" is reserved for
  the calibration headline, but this is the number she takes upstairs: „A build
  that names its own seams this carefully everywhere else has mis-named this one,
  and it is the seam under the number I take upstairs." Her fit verdict is
  precise: *"my reporting cycle is a **quarter**, and every per-hire figure on
  this surface is all-time-only or mixed-window, so my actual reporting rhythm is
  the broken case."*
- **What to build:** count hires whose **terminal transition** falls in the window
  (so numerator and denominator share a basis), **or** label every figure with the
  basis it used; add a `manual_hours_per_hire` target key so an org can enter its
  own anchor (hers is 23 h screening / 13 h sourcing); remove the `Math.min(100,…)`
  cap — a cap that hides an implausible result is worse than no cap; and put the
  **period** into `basis`. **G7 binds it.**
- **Cost / value:** medium. It is the difference between a windowed view being
  usable and being wrong, and the windowed view is the one her cycle uses.

### 2.11 The window control tells the truth about its scope — and says why the default has no deltas — **build** (B10)

*Rank basis: two convergent pairs (`KAT-ANA-5`+`TOM-ANA-13`, `TOM-ANA-7`+
`KAT-ANA-10`) on one control, plus voice escalation — a `confusion` row whose
voice describes abandonment.*

- **Evidence:** `KAT-ANA-5` ×2 — the 30/90-day switcher lives in the
  always-rendered header, so it sits with `aria-pressed="true"` above the **entire
  Quality section**, which is window-blind (calibration, score bands, threshold
  history, both audit tables), and above `/api/benchmarks`, which takes no window
  param at all. `TOM-ANA-7` ×2 — `deltas = null` for the all-time view, all-time
  is the default, and **no copy anywhere** explains it; the only explanation is a
  `title` on a chip that is not rendered. **Verified while drafting:**
  `app/api/benchmarks/route.ts` is `GET()` with **no parameters at all**, and
  neither `/api/analytics/decisions` nor `/api/analytics/calibration` reads a
  `days` param — the three endpoints the switcher visibly sits above.
- **Voice — Tomáš (the escalation):** „Já z toho neusoudím ‚musím kliknout na
  *Posledních 30 dní*, aby se srovnání objevilo'. Já z toho usoudím **‚tenhle
  dashboard neumí srovnat s minulým měsícem'** a zavřu ho." (*I won't conclude "I
  should click 30 days" — I'll
  conclude "this dashboard can't compare to last month" and close it.*) One
  sentence of copy prevents a closed tab; that is why a clarity row ranks here.
- **Voice — Kateřina:** *"That is not a missing feature; that is **a control that
  lies about its scope**."* She also **retracted** her own momentum suspicion in
  the same finding — `db/analytics.ts:347` does honour the window.
- **What to build:** thread `?days=` into the endpoints that can honestly take it,
  **hide or grey the switcher on sections that cannot** and print the scope in
  force (the `analytics.compute.manualWindowed` pattern already exists); and add
  one line beside the window pills: „Srovnání s předchozím obdobím se zobrazí po
  volbě 30 nebo 90 dní." **See §2.23 — windowing the audit tables themselves is
  declined**, so for Quality the fix is scoping the control, not the trail.
- **Cost / value:** one copy key ×4 locales for the delta half (the cheapest item
  in the run); a routing decision per endpoint for the scope half.

### 2.12 Decide restore-or-delete for the nine orphans, and add the test that would have caught them — **build** (B11)

- **Evidence:** `KAT-ANA-3` + `TOM-ANA-2` (convergence ×2, both executed against
  the import graph). Nine orphaned modules (`AnalyticsFunnelPanel`,
  `ForecastPanel`, `ArchetypePanel`, `FunnelEmptyGuide`, `OfferLegPanel`,
  `analyticsFunnelEmptyState.ts`, `SourcePanel`, `ChannelEconomicsPanel`,
  `ChannelSpendInput`) and seven payload fields the server computes on every
  request and nobody renders (`stageDwell`, `koDeclined` total, `byArchetype`, the
  offer legs, `variantRecommendations`, `byVariantTotal`,
  `deltas.bySource|byChannel`). Git-grounded: `83a63aef` and `0a8a2c37` swapped
  baselines out without carrying the affordances across. **Verified**:
  `sectionChunks.tsx` declares 9 chunks, the three sections import 7.
- **Voice — Tomáš:** *"`stageDwell` is the one that stings. **„Čas v jednotlivých
  fázích"** is a literal, per-stage answer to „proč je moje pozice pořád otevřená".
  It is computed on every request and rendered nowhere."* (*"time in each stage"
  / "why is my role still open"*)
- **Voice — Kateřina:** on `variantRecommendations`, computed over the deliberately
  **uncapped** stat set and rendered nowhere — *"the one 'pause this creative on
  Monday' action on the surface, and it is dead."* Also: the variant list is
  silently capped at 24 with no "showing 24 of N" note, unlike `byJobTotal`, which
  *is* honoured.
- **What to build** (note: the **test is also the verification** — two walkers
  executed the import graph and converged on nine, and I re-verified the barrel
  ratio by hand; write the test first and let it produce the authoritative list,
  rather than trusting either report's enumeration): an explicit restore-or-delete
  decision per module and per payload field — `stageDwell` first, then the offer legs and
  `variantRecommendations` + the cap notice — and a test that walks the import
  graph from `AnalyticsTab` and **fails on an unreachable panel or an unimported
  `sectionChunks` export**. Not one orphan produced a test failure, a type error
  or a lint warning; `analyticsSections.test.ts` pins the section *vocabulary*,
  nothing pins the *render map*.
- **Cost / value:** the decision is an afternoon; the test is the thing that stops
  the next consolidation repeating it. Pairs with **method-commitment §2.19**.

### 2.13 The decision log stops claiming coverage it does not have — **build** (B12)

- **Evidence:** `LUC-ANA-6` (major) — four event kinds live in the seeded
  workspace are unmapped in `DECISION_META`, badge `NEZNÁMÉ`, are in neither
  filter and in no rollup. **Verified**: `offer_reminder_sent`
  (`comms-dispatch.ts:588` — an automated message to a candidate) and
  `human_round_queued` (`pipeline-entry-action.ts:267` — *the human-oversight
  handoff itself*) have live writers and no mapping; the two onboarding kinds are
  orphaned by the module removal. And the drift guard that exists to stop exactly
  this — `decision-attribution.test.ts:30-58` — is a **hand-copied literal list
  "as of W9-3"** (verified) that omits both, so it passes while the gap is live,
  even though the same file already derives `AUTOMATION_ALERT_KINDS` from the
  writers' shared source. `LUC-ANA-12` (major) — **verified** at
  `DecisionLogTable.tsx:67-68`: `if (kind) … else if (attribution)` drops the
  attribution filter while `ColumnFilter` keeps its active dot lit, so the table
  says it narrowed and did not.
- **Voice — Lucie:** „Filtr, který o sobě tvrdí, že filtruje, a nefiltruje, je na
  auditní obrazovce **horší než žádný filtr**." (*A filter that claims to filter
  and doesn't is worse than no filter on an audit screen.*)
- **What to build:** map the live kinds; **derive** the guard list from the
  writers instead of hand-copying it; intersect the two filters server-side (or
  clear the other filter's active state). **G6 binds it:** mapping the unknown
  kinds must not make `unknown` default to `AUTO`.
- **Cost / value:** four map entries, one derived list and one query branch —
  hours. Value: the two claims this table makes about itself ("every machine
  decision" and "filtered") both become true, and one of the unmapped kinds is the
  **human-oversight handoff**, which is the row an AI-Act reviewer looks for
  first.

### 2.14 No verdict colour without an org goal — **build** (B13)

- **Evidence:** `TOM-ANA-9` (major, trust). **Verified**:
  `PerformanceBriefing.tsx:71,140` uses `data.targets.conversion[f.stage] ?? 50`,
  so the "weakest link" headline and every coral row are judged against a
  **vendor-invented 50 %** disclosed nowhere. The pre-consolidation panel at least
  showed a goal chip, and only when a goal was **set**.
- **Voice — Tomáš:** „Padesát procent, které u nás nikdo nenastavil, a přesto
  podle nich něco svítí červeně." (*Fifty percent nobody here set, and something is
  glowing red because of it.*) The shared denominator says it for him: *a number
  without the org's target is a reading, not a verdict.*
- **What to build:** render no verdict colour (and no "weakest link" claim)
  without an org goal, or disclose the default explicitly with a one-click path to
  set the real one — `GoalsEditor` already exists two bands away. **G10 binds the
  register.**
- **Cost / value:** one conditional plus a copy line. It is cheap, and it is the
  difference between a dashboard that reports and a dashboard that accuses — on
  the band an out-of-segment reader reads first.

### 2.15 Put the zero-transition guard back on the render path — and seed the third fixture state — **build** (B14)

- **Evidence:** `TOM-ANA-3` (major, `resolution: uncertain` — **not reproducible
  on either host**, and that is itself the finding). L1 is solid: Tomáš executed
  `briefWeakestClaim(Screened, 0)` against `conversionPct` built exactly as
  `analytics.ts:243-248`, and showed the guard written to prevent it —
  `hasNoStageTransitions()` + `AnalyticsFunnelEmptyGuide` + fully translated
  `analytics.funnelGuide.*` — is orphaned, its 6-branch `stageQuestionKey` map
  dead in all six branches, covered by **no test**. Live: arm A has movement, arm B
  has zero entries, so neither host can produce "entries with zero transitions".
  `TOM-ANA-5` — `?funnelEmpty=1` is threaded through three files and destructured
  by nobody (**verified**: `PerformanceBriefing.tsx:59` takes six of seven props).
- **Voice — Tomáš:** „…největším písmem na obrazovce, v display typu, stojí
  **‚Nejslabším článkem je Screening s konverzí 0 %.'** […] Pravdivé čtení je:
  *‚nikdo se toho ještě nedotkl.'*" And: „**A ta správná věta je napsaná,
  přeložená, a nedosažitelná. To není chybějící feature, to je hotová práce,
  která leží pod stolem.**" (*The
  right sentence is written, translated, and unreachable. That's not a missing
  feature, that's finished work lying under the desk.*) — „Nábor je připravený a
  čeká" is the copy that already exists.
- **What to build:** put `hasNoStageTransitions` back on the live render path with
  its guide; honour `?funnelEmpty=1` **or** delete it and its journey references;
  and seed the third fixture state (≥1 entry, 0 stage transitions) so this can
  ever be certified at L2. **G10 binds it.**
- **Cost / value:** small, and it converts an `uncertain` verdict into a testable
  one — a first-week workspace is the state where a hiring manager forms their
  first opinion.

### 2.16 A filter and a search on the by-role table — **build** (B15)

- **Evidence:** `TOM-ANA-6`, the half that is a defect **regardless of
  segmentation**: `BY_JOB_CAP = 12` sorted by volume descending, with no filter and
  no search (**verified**: `db/analytics.ts:309,321`; the sibling
  `BY_VARIANT_CAP = 24` at `:543-544` is the silent one — §2.12). The title honestly says „Top 12 z {total} podle objemu" and there is
  no way to reach row 13.
- **Voice — Tomáš:** „Moje pozice je **jedno místo a hrstka uchazečů** — tedy
  přesně ten řádek, který ze seznamu vypadne první." (*My role is one seat and a
  handful of applicants — exactly the row that drops off the list first.*)
- **Cost / value:** one select or search box over data already in the payload. The
  *account-wide* half of his finding is a segmentation question and goes to
  **§2.17**; this half does not wait for it.

### 2.17 Who is Analytics for? The per-role consumer view — **concept-doc** (C2)

*Rank basis: the run's **opposing-verdict item**. It is routed to a concept-doc
because the evidence does not settle it — it is a segmentation decision.*

- **The conflict, stated without flattening it:** Tomáš judged the three-section
  split as **passing navigation** — „Jako navigace: **obstálo**." — and faulted
  what the redesign *dropped*, not the boundary: „To **není** cena za tu hranici —
  hranice je nevinná. Zaplatilo se to při volbě ‚vítězné' varianty." (*That is not
  the price of the boundary — the boundary is innocent. It was paid when the
  winning variant was chosen.*) Meanwhile his job question has no dimension on the
  surface at all: `pipelineAnalytics(windowDays?, opts?, workspaceId)` has **no
  job parameter**, so a select in the UI cannot manufacture one. He files the
  account-wide half himself as a `scope_note`, not a defect: „Tahle plocha je
  postavená na `workspace`… To je **segmentační rozhodnutí, ne bug**, a je
  legitimní."
- **Voice — Tomáš (the line to keep on the wall):** „Řekněte mi na jedné
  obrazovce, kde ta moje pozice stojí a u koho — a jsem váš. Zatím mi říkáte, jak
  je na tom nábor v celé bance, **a to se mě neptal nikdo**." (*Tell me on one
  screen where my role stands and with whom, and I'm yours. Right now you're
  telling me how hiring is going across the whole bank, and nobody asked me
  that.*)
- **What the doc must resolve:** is the hiring-manager answer (a) a `?job=` scope
  on Analytics, (b) a role-scoped block on the **job page** (where he already
  goes), or (c) a personal "my roles" surface? What is the payload change — per-job
  funnel, dwell, bottleneck and TTH is a `pipelineAnalytics` signature change, not
  a UI filter. Does a role-scoped view keep the four header numbers (G9), and does
  it inherit the same window semantics (§2.11)? What is the cardinality cost of
  computing per-job funnels for 105 open roles?
- **Cost / value:** a payload change plus a surface decision — the largest
  unbuilt item in the run, and the one with the clearest adoption payoff: „**Kdyby
  k tomu přišel filtr na pozici, doporučil bych to sám.**" Note his own volume
  honesty: ~1.5 h of his time per year. **The value is not the minutes — it is the
  latency**, an answer during the meeting instead of in two days.

### 2.18 What is a shareable view? The URL-inbox contract vs "send me that number" — **concept-doc** (C3)

- **Evidence:** `TOM-ANA-8` + `KAT-ANA-9` (convergence ×2). **Verified**:
  `useUrlInboxState.ts:66-76` actively **erases** the param after adoption, for
  `?sec=` and `?tab=` alike, while `?win=` *is* written back — so the only thing
  copyable out of an argument is `/?win=30`. The trade-off is **documented and
  deliberate** (`useUrlInboxState.ts:22-27`), which is why this is not a bug
  report.
- **Voice — Kateřina:** *"**I cannot send a colleague the number I am arguing
  about, and I cannot even reliably send the section.** My sharing unit is a
  screenshot, which is precisely what the decision-audit half of this surface
  exists to replace."* She is
  explicit that the inbox is the **right** call for `?tab=` and the wrong one for
  the one tab whose job is to be quoted.
- **Voice — Tomáš:** „VP se zeptá, já otevřu Kvalitu a audit, uvidím to číslo, dám
  Ctrl+L, Ctrl+C — a pošlu `/?win=30`."
- **What the doc must resolve:** does the shell get an explicit "copy link to this
  view" affordance that builds a URL the inbox will honour (the cheap interim), or
  does Analytics opt out of the inbox pattern? What belongs in a shareable view —
  tab, section, window, active filters, a specific row? How does it interact with
  **§2.3**, whose remedy changes `tab=` semantics on the same contract? Does a
  shared link survive a section rename?
- **Why not build now:** the contract is shell-wide and used by every tab; a
  revert-shaped fix would fight a documented decision made for good reasons.
  §2.3 must not be blocked on this.
- **Cost / value:** the doc is an afternoon; the likely outcome (an explicit
  copy-link affordance) is small. Value is asymmetric — two Characters name it,
  and for the analytics tab specifically the alternative sharing unit is the
  screenshot this surface exists to replace.

### 2.19 A consolidation carries an affordance inventory — **method-commitment** (M1)

- **Evidence + voice — Kateřina:** *"Postavili poctivou verzi a nezapojili ji.*
  […] *Meanwhile the eight orphaned panels took the channel-spend input with them,
  and **nothing failed — no test, no type error, no lint**."* Tomáš supplies
  the ledger: eight numbers that existed before the redesign and are now „**nikde**"
  (stage dwell · KO-declined total · offer leg · archetype · channel-spend input ·
  the pause-this-creative recommendation · source/channel deltas · the link to
  Channels), and names the commits that did it (`83a63aef`, `0a8a2c37`).
- **The commitment (this is a change in how we work, not in the code):** when a PR
  swaps a "winning variant" for a baseline, or stops rendering a panel, it lists in
  the PR body **every affordance and payload field the old surface rendered**, with
  an explicit *restore* or *delete* verdict per line. A payload field with no
  renderer is deleted from the payload or given one — never left computed.
- **Trigger:** any change that removes an import from a section barrel, deletes a
  section/panel, or introduces a `sectionChunks`-style dynamic barrel. The CI half
  ships in **§2.12**; this is the review half that catches what a test cannot (the
  *decision* about whether the number mattered).

### 2.20 A headline may not outrun its own payload's qualifier — **method-commitment** (M2)

- **Evidence:** three separate display-type sentences in one run, each contradicted
  by a qualifier the same payload already carries — „Automatická rozhodnutí na
  tomto skóre jsou obhajitelná" over `leakage.level:"high"`; „Odolné proti
  manipulaci … řetězec ověřen" over 66 rows with `key_id=''`; „Nejslabším článkem
  je Screening s konverzí 0 %" over a pipeline nobody has moved. And the fourth
  case is a **doc**: `docs/features/compliance/README.md:56-58` asserts HMAC
  unconditionally.
- **Voice — Lucie:** „To není mezera v znalostech. **To je věta, která byla
  napsaná a pak vypnutá.**" (*That is not a gap in knowledge. That is a sentence
  that was written and then switched off.*)
- **The commitment:** any sentence set in display type that renders a **verdict**
  must name the payload field that licenses it, and where the payload ships a
  qualifier (`leakage`, `certifiable`, `status:"thin"`, `basis`, `keyId`), the
  headline may not assert a conclusion that qualifier contradicts — in the UI **and
  in the doc that describes it**. The structural version of this ships as one guard
  in §2.1; the commitment is that a reviewer asks the question every time.
- **Trigger:** adding or altering a display-type verdict string, or a
  security/compliance property claim in `docs/`.

### 2.21 Drift guards are derived from the writers, never hand-copied — **method-commitment** (M3)

- **Evidence:** `LUC-ANA-6` — `decision-attribution.test.ts:30-58` is the guard
  whose own docstring says it exists to stop exactly this drift, and it is a
  literal list "as of W9-3" that passes while two live writers are unmapped. The
  correct pattern is **already in the same file**: `AUTOMATION_ALERT_KINDS` is
  spread from the shared source the writer itself consumes, with a comment saying
  why.
- **Voice — Lucie:** the guard is *"a **hand-maintained literal list "as of
  W9-3"** that contains neither `offer_reminder_sent` nor `human_round_queued`.
  **It passes while the gap is live.**"*
- **The commitment:** a test that asserts "every X is mapped" derives its X list
  from the source the producer consumes. A hand-maintained literal list dated in a
  comment is not a guard; it is a snapshot. Applies to `DECISION_META`,
  `sectionChunks`, tab ids, and any future closed vocabulary.
- **Trigger:** any new `*_META` map, allowlist, badge map or section resolver, and
  any review of a test containing the phrase "as of".

### 2.22 Per-decision compute-cost attribution — **decline-with-reason** (D1)

- **Evidence:** `KAT-ANA-11` (minor) — no cost column on either decision table and
  no link from Economics to Billing; Kateřina records it as a **named addition
  outside** the shared denominator, and lists it 6th of her 7 missing items.
- **Reason to decline:** `llm_usage.request_id` is never joined to pipeline events,
  so "what did this decision cost" requires threading a request id through every
  LLM call site into the event writer — and the compute ledger is **account-wide**
  while decisions are workspace-scoped, so the ratio would be dishonest in a
  multi-workspace account by construction. The SUMMARY names it as a permanent
  ceiling; the cheap half (a link from Economics to Billing, and the ledger's
  period in `basis`) is already inside **§2.10**.
- **Revisit when:** per-tenant `llm_usage` attribution lands (already tracked in
  `docs/BACKLOG.md` under Platform), which makes the join cheap and the number
  honest.

### 2.23 Windowing the audit tables to the 30/90 switcher — **decline-with-reason** (D2)

- **Evidence:** the obvious reading of `KAT-ANA-5` ("thread `?days=` into
  everything") would apply the window to `/api/analytics/decisions` and
  `/api/decisions/records` too.
- **Reason to decline:** Lucie's guardrail is explicit and the code already states
  it — *"a bounded window would silently drop older decisions, which is the one
  thing an audit surface may not do"* (`DecisionLogTable.tsx:14-19`, **G4**). She
  notes it herself while corroborating the window finding: „pro auditní stopu je
  ‚vždycky celá stopa' ta bezpečná strana." The defect is the **control claiming a
  scope it does not have**, not the trail's completeness. §2.11 therefore scopes
  the control; the trail stays unwindowed.
- **Revisit when:** never on this reasoning. A future "filter by date range"
  *inside* the audit table is a different feature with its own explicit control and
  does not resurrect this.

### 2.24 Seeding or backfilling `channel_spend` so the column shows a number — **decline-with-reason** (D3)

- **Evidence:** `KAT-ANA-2` as **re-shaped by L2** — the column is not blank; it
  renders 833 CZK from a fossil row, and that is precisely why the finding moved
  from `missing-feature` to `trust`: *"a blank column is a gap; this is a gap
  wearing a plausible figure."*
- **Reason to decline:** seeding a demo spend value would manufacture exactly the
  defect the run found, at scale and in every install. Kateřina's ask is not a
  number — it is, first on her list of what is missing: *"**An input for channel
  spend. Anywhere. One number field.**"* §2.5 gives her the field and dates the
  value; a seeder gives her a fiction.
- **Revisit when:** never as a seeder. If a demo corpus needs a spend figure, it is
  written through the same input with a visible `updated_at`, like any other user
  entry.

### 2.25 Reverting the three-section consolidation — **decline-with-reason** (D4)

- **Evidence:** the out-of-segment consumer — the Character most likely to be lost
  by a re-layout — **passed** the navigation: „Jako navigace: obstálo… Podtitulky
  mi řeknou, kde hledat, a **nemusím znát jejich taxonomii**. To je přesně ta
  klauzule z definition-of-done a je splněná." Two of the run's strengths
  (`TOM-ANA-S1` section hints, `TOM-ANA-S2` header numbers above the switcher) are
  properties **of the new shape**, and G9 protects them.
- **Reason to decline:** the cost was paid at *variant selection*
  (`83a63aef`, `0a8a2c37`), not at the section boundary — „hranice je nevinná."
  Restoring affordances (§2.12) and repairing the drill path (§2.3) recovers what
  was lost; reverting the layout would also revert the two things the
  out-of-segment reader named as the reason the split is survivable.
- **Recorded because** "the three-way split was a mistake" is the shape this run's
  headline could be misread into next quarter. It was not the split.

**Tally: 15 build · 3 concept-doc · 3 method-commitment · 4 declines.**

---

## 3. Methodology lessons — what this run taught about `/uat` itself

1. **The surface model has a blind spot, and L2 exposed it: the three walkers
   counted panels three different ways.** Kateřina counted **files**
   (33 `Analytics*.tsx`, 25 reachable / 8 orphaned), the brief guessed 35, and
   Tomáš counted **modules** across the whole import graph (49 accounted, 40 clean,
   9 orphaned in three shapes). All three were right about different denominators
   and none of them answers the question that matters. The only ratio that does is
   **`sectionChunks` declarations vs section imports** — 9 declared, 7 imported
   (verified in this drain) — because a `dynamic()` that no section imports is dead
   *even though the file has an importer*, which is exactly what made the two dead
   chunks look alive to a reader. **Fix for the overlay:** L1's panel-inventory
   instruction states the unit of measure (barrel declarations vs section imports),
   and the CI version of the same ratio ships as §2.12.
2. **The shared grounding denominator landed this run and fixed the axis, not the
   scale.** `env.md §Grounding denominators` stopped each Character inventing their
   own list — a real improvement over the previous runs — but the three scores
   still diverged (Performance 4 vs 5, Economics 3.5 vs 4, Quality 4 vs 5.5 vs 7)
   because the *classification rule* (`lands` / `fetched-but-unrendered` /
   `absent`) admits half-credit judgement. L2 had to arbitrate, and **refuted
   Tomáš's 7/7 on Quality**: source #3, the clean-arm partition, has zero rendered
   matches across 250 lines and no selector, so it cannot be a "land". **Fix for
   the overlay:** publish a worked half-credit example beside the denominators, and
   make the *section owner's* score the authoritative column (already applied in
   this run's roll-up: 11.5→12/20 after the L2 adjustment).
3. **The preflight and the retraction discipline prevented six false findings, and
   that is a quality signal about the run, not a footnote.** (a) `GET
   /api/analytics/spend` → 405 is **correct** — the route is POST-only, a
   recruiter-entered write; a GET probe read as a broken read would have fabricated
   a blocker underneath the run's most-cited finding. (b) `feedback.railLabel`
   rendered raw on arm B was a **stale-server artifact**, not a missing
   translation — the catalog on disk holds „Zpětná vazba" and arm A renders it;
   arm B's server started 15:54, the catalog was written 18:41. Second consecutive
   run in which that rule saved a phantom i18n regression. (c) DB 9 `Hired` vs API
   6 is **correct tenancy scoping**. (d) funnel `current` 17/22 vs raw stage counts
   19/26 **reconciles** — rejected/rematched entries retain their stage. (e) The
   orchestrator retracted a bad lead **before dispatch**, keeping three walkers off
   it. (f) Kateřina retracted her own momentum-window suspicion inside the very
   finding that indicts every other panel for ignoring the window. **Keep the
   preflight's "measured by the orchestrator, never fed to the walkers" rule** —
   it is what keeps convergence independent evidence.
4. **The third fixture state does not exist, and an L2 verdict stayed `uncertain`
   because of it.** `TOM-ANA-3` needs a tenant with ≥1 pipeline entry and **zero**
   stage transitions; arm A has movement, arm B has nothing, and the in-app flag
   that used to reach that state (`?funnelEmpty=1`) is itself dead — threaded
   through three files, destructured by nobody. It cost this run a planned
   cross-check and the journey doc had to be corrected in place. **Fix for the
   overlay:** `env.md` declares the **fixture states** a journey needs (not just
   the hosts), and a review-only flag that is the sole path to a state is either
   covered by a test or deleted — a dead review hatch is worse than none, because
   the brief plans around it.
5. **An undrained run costs a second run.** `2026-07-20-cases-scoring` was never
   drained; its blockers still read `resolution: open` in its own `findings.json`
   while several were demonstrably fixed in code with their ids cited at the fix
   sites. The consequence, paid in this run's budget: **eleven rows carry
   `recurrence: 2`**, seven of them Kateřina's, and the brief had to fold a
   re-certification into a fresh run („Closing that gap honestly is half this run's
   value"). The structural cause was that `uat/README.md` had **no `## Drain
   homes` section** — nothing told a finishing session where a drain writes. Fixed
   in this same change: the section now names the analysis-doc home, the backlog
   file, the concept-doc home, the method-commitment home, and states that a drain
   follows every `run`/`recertify` and that a run without one is half-billed value.
6. **The previous drain's own method fixes were exercised, and they worked.**
   `recurrence` (added after the 2026-08-10 drain) did the ranking work it was
   introduced for — it is why five carry-forward rows sit above first-time
   blockers. And the `impact_l1` / `severity_l1` / `type_l1` convention was used
   for real: `KAT-ANA-2` moved `missing-feature` → **`trust`** at L2 while
   preserving its L1 scores, making the widening machine-visible instead of prose
   only. Both fixes are now load-bearing; keep them.
7. **A UAT run's own writes become another run's evidence — and can outlive their
   session.** The `833 CZK / přijetí` on the seeded host is one `channel_spend` row
   written on 2026-07-05 by the `2026-07-02-full` run, six weeks later
   indistinguishable from customer data and now the subject of a blocker. This cut
   both ways: it *created* a defect-shaped artifact, and it *revealed* a real one
   (a metric with no writer and no recency). **Fix for the overlay:** a run that
   POSTs to a shared host records what it wrote in the run folder, and the drain
   treats prior-run residue as a first-class confounder to check before scoring a
   number as live.
