# Documentation & gap backlog

Open items surfaced by the 2026-07-30 documentation restructure. Every entry below was
found by reading a doc **against the code it claims to describe** — these are the gaps
that survived that check, not a wish list.

Product/engineering gaps are listed here because the docs are where they were discovered;
they are not owned by the docs. Move an item into the relevant tracker when it gets picked
up, and delete it here when it closes.

## Doc gaps

| # | Gap | Where |
| --- | --- | --- |
| D1 | Three shipped features have **no feature doc**: analytics stage-dwell, pool-fit, and the NL command bar. (The onboarding hand-off was on this list too; the module has since been removed.) They were documented only inside the now-archived GDPR extensions doc, which was never the right home for them. | `docs/features/` — needs `analytics/` and `talent-pool/` areas |
| D2 | No `docs/development/README.md` — the three harness docs (automation eval, case calibration, voice-interview testing) have no shared index explaining when to reach for which. | `docs/development/` |
| D3 | `docs/architecture/llm-model-matrix.md` is a dated benchmark snapshot. It now carries a "re-run before trusting" banner, but nothing re-runs it. | `docs/architecture/` |
| D4 | `docs/product/coverage-plan.md` W0.5 acceptance criteria say `/trust` is public and landing-linked; `app/trust/page.tsx` is deliberately `noindex`, internal-only (2026-07-30 product decision). Criteria and reality disagree — one of them should move. | `docs/product/coverage-plan.md` |
| D5 | The visual-uplift plan's remaining phases cite pre-refactor file paths (`JobsTab.tsx:78` style). Anyone picking Phase 2 up must re-locate them first. | `docs/concepts/visual-uplift-plan.md` |

## Compliance — AI Act gap register (G1–G14)

Closed since the pack was written: **G3** (name-neutrality perturbation test now exists),
**G11** (AI disclosure now renders on `/status`), **G9 partially**
(redacted candidate-facing decision view; the full sealed dossier stays operator-gated by
design). Still open:

| # | Gap | Note |
| --- | --- | --- |
| G2 | **No Annex IV technical documentation / instructions-for-use doc.** | Highest priority — AI Act applicability date is **2026-08-02** |
| G1 | No risk-management doc, DPIA, or residual-risk analysis | Art. 9 |
| G4 | No `audit_events` table — grepped `app/` and `pipeline/`, zero hits | Art. 12 logging |
| ~~G5~~ | **CLOSED (item 6).** `operatorApprover()` is now the honest *fallback*, not the answer: `approverIdentity()` / `resolveApprover()` / `humanActor()` (`app/_lib/auth/operator-approver.ts`) derive the named person from `currentUserId()` + `app/_lib/db/users.ts`, `pipeline_events` carries an `actor` column, and the sealed adverse rationale renders „Approved by {who}" — or „Approver not identified" where a deployment genuinely has no named user (never a defaulted person) | Art. 14; UAT evidence `CS-L1-004` rec 2 · `LUC-ANA-4`. Still role-only on two callers not in that change: `app/api/analytics/calibration/apply-threshold/route.ts` and the reinstate/scorecard/schedule seals in `app/api/pipeline/[id]`, `app/api/schedule` — one-line swaps to `resolveApprover()`/`humanActor()` |
| G12 | `app/api/workspace/{export,import}` are whole-DB dumps. Decision chains are already per-tenant; export/import is the remaining non-tenant-scoped path | Narrowed from the original scope |
| G6, G7, G8, G10, G13, G14 | Spot-checked, still absent | — |
| — | DPO sign-off on score retention is still a live pre-production gate | Carried from the archived GDPR doc |

## Product gaps found while verifying docs

**Matching & scoring**
- CV salary anchoring uses the *matched job's* band rather than a candidate-seniority band when the two diverge.
- `potential_score`'s 35/25/25/15 weighting is unvalidated against outcomes — telemetry is captured, no validation run has happened.
- `maxMatchToReject` / fit-tier thresholds were never re-tuned after the 2026-07-20 provenance-default change.
- **Multi-market lock is at the compensation layer**, not the taxonomy: the taxonomy covers 16 families (incl. healthcare, legal, trades, education), but comp is CZK-denominated by default (`market_config.py`) and no second market has been seeded or exercised.

**Pipeline & comms**
- No ground-truth loop validates the `confidence ≥ 80` auto-advance band against real outcomes.
- **Outreach has no draft/preview/approve gate before the first send** (UAT M4). `outreach-halt.ts` only stops *re*-sending. Mail goes out under the customer's name.
- No durable retry queue; soft bounce-callback outcomes are accepted but never surfaced.
- "Publish to external job boards" is still unimplemented.
- E6 candidate-language expansion beyond en/cs is blocked on a product decision about the supported language list.

**Assessments**
- Third-party distribution channels (email/ATS/job-board) exist only as the `DistributionAdapter` interface; only `LocalDistributionAdapter` is built.
- Case generation drifts across sub-specialties (Frontend↔backend, iOS↔Android).
- Voice: V3 Playwright Tier B and CI wiring of `--no-llm` reliability against a committed baseline are open. The ElevenLabs agent-level `asr.keywords` + refreshed dashboard prompt still need a deploy (requires recreating the agent).
- P7 hostile-candidate tone softening is a **deliberate** non-fix — every wording attempt caused language drift.

**Platform**
- `KP_TRUSTED_PROXY` is real, tested (`app/_lib/rate-limit.test.ts`), and required by the self-hosting production checklist — but **missing from `.env.example`**.
- `cv_analysis` is Gemini-only; no per-tenant `llm_usage` attribution.
- Tenancy last mile: per-session revocation. (Entry-id workspace component, tasks dedup index and per-tenant export/import have shipped — see `docs/features/organization/README.md`.)
- Enterprise track still open: E-SSO-2/3/5, E-AUD-2/3/4, E-SH-1 (license decision), E-SH-3 (Postgres build), E-SH-6, E5 (SOC 2), E-GDPR-1/3/4/5, E6 (org-level billing/seats). BYOM tier enforcement unbuilt.

**Design & structure**
- Visual uplift Phase 2 (tab composition, `PANEL_SUNKEN` migration, `FIELD` height standardization, a `TABLE` recipe that does not yet exist), Phase 3 (contrast/a11y), Phase 4 (delight) are open.
- Five `.tsx` files have crept past the 200-line invariant since the structure refactor landed — listed in `docs/architecture/app-structure.md` under "Drift since landing".

## Intake — UAT drain 2026-08-07 (see docs/product/uat-insights/2026-08-07-intake.md)

Build-recommended items from the first `/uat drain` pass over run
`2026-08-07-intake`; each cites its Character evidence in the insights doc.
Guardrail: any edit affordance must preserve provenance-chip honesty (a human
edit is `stated`; an accepted agent suggestion is `stated` only on explicit
confirm).

- ~~**Editable brief + re-openable session**~~ — SHIPPED + RECERTIFIED
  2026-08-07 (edit mode in the brief panel + `PATCH /api/intake/[id]/brief` +
  reopen with an appended system turn; promoted briefs stay frozen). Live
  evidence in `uat/runs/2026-08-07-intake-recertify/report.md`. (§2.1)
- ~~**Defensibility layer**~~ — SHIPPED + RECERTIFIED 2026-08-07
  (`source_turn` with click-to-turn flash, weight/rationale/confidence detail
  rows, markdown export with provenance + numbered transcript — download
  captured live). (§2.2)
- ~~**Non-tech grade capture**~~ — SHIPPED + RECERTIFIED 2026-08-07 ("Band 5,
  roughly" stored verbatim as a stated `grade_label` facet; seniority stays
  visibly assumed). (Priya; §2.3)
- ~~**Latency honesty**~~ — SHIPPED + RECERTIFIED 2026-08-07 (staged
  "Stále přemýšlím…" second line verified at 10 s; not streaming per §2.7).
  (§2.4)
- **Composer squeeze regression (R-1)** — the keyless voice note renders
  inline in the composer row and collapses the textarea to a sliver
  (`JdsIntakeVoice.tsx:241` ↔ `JdsIntakeChat.tsx:131-155`); found by the
  recertify pass, every keyless deploy hits it. Small CSS fix (wrap the note
  under the row or icon-collapse it). Also minor: the LLM close leaks
  `<<END>>` into the last bubble (R-2).
- **`llm_era_confused` persona clause** — one `_PERSONA_TECHNIQUE` sentence
  anchoring role-existence doubt in 90-day outcomes. (§2.6)
- **Workspace-context grounding of the dialog** — concept-doc first (which
  org context, prompt budget, a possible `grounded` provenance value);
  promote to build after the voice plane settles prompt economics. (§2.5)

Declined with reasons (do not resurface without new evidence): streaming
replies; keyless laddering imitation; smarter deterministic parsing —
see insights doc §2.7. Dev-case seam is owned by the Direction-2 workstream;
multi-market comp is already tracked above under Matching & scoring.

## Intake — 2026-08-10-intake-triptych drain (see docs/product/uat-insights/2026-08-10-intake-triptych.md)

Build-recommended items from the `/uat drain` pass over run
`2026-08-10-intake-triptych` (L1 ×3 Characters → L2 live, all three reached L2).
Each cites its Character evidence in the insights doc; the section number in
brackets points at the opportunity that justifies it.

**Guardrails on every item below** (strengths named by all three Characters,
phrased as constraints — insights doc §2 "Guardrails"): G1 any newly visible
value carries the stated/inferred/default provenance chip · G2 attachment
fencing stays audit-grade (server-resolved bodies, caps, inferred-until-confirmed,
keyless-never-mined, frozen after promote) · G3 the live JD draft stays
deterministic and zero-LLM · G4 fixes work inside the Triptych's safety rails
(min-one-open, persisted folds, reduced motion, keyboard spines) · G5 keyless
disclosure is extended earlier, never softened · G6 keep citing the UAT finding
id at the fix site.

1. **Market-research opt-out in the promote sheet** — the fix exists at the API
   and is unreachable from the UI (two-arm live proof: browser promote →
   `marketResearch:true` + a Czech salary band; `POST …/promote
   {"marketResearch":false}` → no salary line). Add the checkbox beside
   case-design, wire it through `jdsIntakeLogic.ts:150-161`, and make the draft
   pane's working-note copy conditional. (`L1-HRBP-11`, major; Priya, 2nd
   consecutive run; §2.1)
2. **Title provenance chip + inline title edit** — `spineProvenance.title` is
   written engine-side and rendered nowhere; live control arm proved an attached
   JD drives the title, and *both* arms stamped it `inferred`. Extend the
   seniority chip pattern (`JdsIntakeBriefPanel.tsx:134-141`) to the title at
   `:131-133`; a typed title is `stated`. (`L1-TOM-2`, major, widened at L2; §2.2)
3. **Both spine badges must tell the truth** — `countFor` maps the draft leaf to
   `counts.attachments` while `counts.draftReady` has no consumer, *and* the brief
   leaf counts `requirements`, empty in every live session: two of three spines
   badge `0` over a full workspace. Repair both branches (draft = filled-state
   marker, not a count) and audit the third. (`L1-EVA-10` · `L1-HRBP-15` ·
   `L1-TOM-5` convergent ×3 + `L2-CONV-1`; ranked 3rd on voice escalation; §2.3)
4. **"Podklady" must survive a fold** — folded, the attachments pane is absent
   from the accessibility tree entirely; a persisted fold hides the attach
   affordance forever. Surface it independently of the draft leaf's fold state
   plus a cue in the opener/composer. (`L1-TOM-5`, confirmed live; §2.4)
5. **roleFamily visible, editable, honestly labelled** — classified, threaded
   into the build, shown to nobody; no control in `JdsIntakeBriefEdit`. Render it
   with its provenance chip, add a select (a chosen family is `stated`), stamp the
   zero-signal fallback `default` not `inferred` (`L1-HRBP-13`), and stop
   initialising a fresh brief to `software_engineering`. (`L1-HRBP-12`, major,
   confirmed in half; Priya, 2nd consecutive run; §2.5)
6. **Confirmed dealbreakers must reach `requirements[]`** — "Java and Kafka in
   production", stated and confirmed, left `requirements[]` empty in all three
   live sessions; the edit sheet's Nezbytné/Výhodou block sits empty while
   `needText` carries them into a correct JD. Representational gap that starves
   the shipped defensibility layer. (`L2-NEW-2`, new at L2; §2.6)
7. **Supersede: write the link, badge the ledger** — after promote the attached
   JD is still `archived_at = NULL` and Saved JDs shows two rows with the
   byte-identical title. Persist the attached `jdSlug` as a `supersedes` pointer
   (attachments already carry it) and badge both rows. Do **not** block on the
   lineage concept-doc. (`L1-EVA-9` · `L1-TOM-6` convergent ×2, worse live; §2.7)
8. **Voice extraction thread receives its attachments** — `--attachments-json` is
   shipped and loaded, then dropped at `intake_cli.py:85`; `extract_transcript`
   has no attachments parameter. One-line fix plus a prompt block. **Cannot be
   `resolved-verified` until a keyed (OpenAI) host runs the recertify.**
   (`L1-EVA-8` · `L1-HRBP-14` convergent ×2; §2.8)
9. **Keyless materials copy discloses before the ack** — the empty state promises
   mining unconditionally; offline the truth arrives only after attach+send.
   Keyless-conditional copy (G5: earlier, not softer). (`L1-HRBP-16`; §2.9)
10. **Escape fence markers in attachment text** — `_attachments_block`
    interpolates raw text between `<<<ATTACHED_MATERIAL>>>` markers, unlike
    `fenced_untrusted` which json-escapes. Strip/escape + unit test.
    (`L1-TOM-4`; §2.10)
11. **Eval bank asserts `role_family`** (and `requirements[]` non-emptiness for
    confirmed dealbreakers) — `grep role_family intake_eval.py` → zero matches
    while the bank is organised by family. One assertion per scenario turns two
    findings into standing regression coverage. (`L1-HRBP-17`; §2.11)
12. **Delete the dead duplicate `submit` handler** in `JdsIntakeChat.tsx:86-91`
    (duplicates `submitDraft` at `:198-203`, no callers). (`L1-EVA-12` ·
    `L1-TOM-9`; §2.12)

Concept-doc first (do not code yet):
- **JD lineage / versioning model** — successor vs version-chain vs replacement;
  what happens to live applications, share tokens, comms threads and matching on
  a superseded posting; three-deep chains; an intake attaching two JDs. Item 7
  buys the pointer and badge without answering these. (§2.13)
- **Workspace-context grounding of the dialog** — carried from the 2026-08-07
  drain §2.5 and re-confirmed: org context / prior sessions / market band scored
  ✗ in all three Characters' grounding audits. Attachments delivered the
  user-curated half inside the provenance law; the automatic half still needs its
  design (which context, prompt budget against 22–52 s exchanges, a possible
  `grounded` provenance value, privacy scope). (§2.14)

Declined with reasons (do not resurface without new evidence):
- **Attachments passed through to the promoted JD build** (`L1-TOM-3`) — L2
  softened it; `needText` carries the distillate and the built JD opened with
  „Java — produkční zkušenost (potvrzená tvrdá podmínka requestora)". Raw
  passthrough would bypass the provenance-tracked-distillate boundary that G2
  protects. Revisit only if a live JD is shown to miss content only the raw
  attachment held.
- **Auto-archiving the attached JD on promote** — destructive, and it presumes
  the "replacement" answer to the lineage question before that question is
  answered; a wrongly archived posting can hold live applications and share
  links. Item 7's non-destructive pointer is the honest interim.
- **Re-affirmed from the 2026-08-07 drain** (no new evidence to overturn):
  streaming replies (live latency 22.4/52.3/33.3 s behind an honest staged hint
  drew zero complaints from any of the three Characters); keyless laddering
  imitation; smarter deterministic answer-parsing.

Covered elsewhere, not double-entered: multi-market compensation stays the
workspace ceiling tracked above under Matching & scoring (item 1 makes the Czech
read *skippable*, not right for GBP); the dev-case seam shipped and was
recertified 2026-08-07.

Loop rule: each shipped item re-enters via `/uat recertify` against the
originating Character's scored criteria — fresh live evidence,
`resolved-verified`, and its own ceiling. Item 8 is explicitly blocked on a keyed
host.

### Recertify delta (added 2026-08-10 after `b54c451b` · `dd67bc46` · `41cd5cc3`)

The `/uat recertify` pass closed items 1, 2 and 3 above as `resolved-verified`
(five findings) and left three rows that §2 did not cover. All three triaged
**build** — see insights doc §4.

13. **A normally-conducted dialog must yield a promotable brief** —
    `L2-NEW-2` escalated **minor → major**, `recurrence: 2`. Not just
    representational any more: both English sessions ended `requirements: []`
    **and** `successCriteria: []` over nine stated facets, so `Create JD` stayed
    disabled and the recertify had to `PATCH …/brief` to test promote at all.
    Root cause: the extraction contract offers two homes for the same fact and
    ranks neither — `dealbreaker_context` is in the suggested facet vocabulary
    while `requirements` is described only as a grading rule, so every live
    session filed its hard conditions as facet prose. Fix both ends: route
    named hard conditions into `requirements[]` (contract), and let the promote
    gate count the substance in either home (deterministic, keyless-testable).
    Supersedes item 6. (§4.1)
14. **The draft-ready marker must agree with the promote gate** — `L2-RC-1`
    (minor, new): the repaired spine badges ✓ „Návrh připraven" over a
    **disabled** `Vytvořit inzerát`, with no visible reason. `draftReady` reads
    `briefDraftHasContent`, the gate reads `briefReadyToPromote`. Three spine
    states (empty · drafting · ready) plus a disabled button that names what it
    is missing. Was flagged as item 3's ceiling before it was a finding. (§4.3)
- **Item 4 ("Podklady" must survive a fold) stays open** — `41cd5cc3` fixed only
  its compounding clause (the badge no longer counts attachments). Folded, the
  materials pane is still absent from the page entirely; the recertify names the
  remainder exactly: *a discoverability cue near the conversation, or a materials
  affordance that survives folding the draft leaf*. (§4.2)

## Analytics — UAT drain 2026-08-17-analytics-sections (see docs/product/uat-insights/2026-08-17-analytics-sections.md)

Build-recommended items from the `/uat drain` pass over run
`2026-08-17-analytics-sections` (journey `analytics-calibration`; Kateřina — TA
ops/analytics · Lucie — DPO/compliance · Tomáš — hiring manager, out-of-segment
consumer lens; **all three returned `L1-fail`**, with a targeted live
confirmation pass on the three blockers). Each cites its Character evidence in the
insights doc; the section number in brackets points at the opportunity.

The theme, and the reason most of these are small: **a correct, honest,
well-built mechanism that reaches no surface** — the leakage disclosure, the
holdout clean arm, the channel-spend input, the zero-transition empty-state
guard, nine orphaned modules. Several items are one wire, not a feature.
Doc-sync: analytics items update `docs/features/analytics/README.md`; item 3
also corrects `docs/features/compliance/README.md:56-58`.

**Guardrails on every item below** (strength rows, phrased as constraints —
insights doc §2 "Guardrails"): G1 the calibration honesty gate stays the
headline, never a caveat · G2 new disclosure rides alongside the sealed bytes,
never replaces them · G3 fix the grain of accountability, keep its honesty
(`operatorApprover()` posture, server-bound approver, human reversal sealed to
the human) · G4 the audit trail stays server-paged and unwindowed, `seq` visible
in every ordering, exports naming their own scope · G5 keep the access posture
(`requireOperator()`, separate candidate projection, central CSV neutralization)
· G6 attribution stays three-state and fails away from the machine · G7 the
metric-pack contract is untouchable (status/sample/basis, `certifiable`, actions
not hires, no "% vs before", no currency summing) · G8 never reintroduce a
name-based terminal check — "a hire" is one role-derived predicate in seven
places · G9 the four headline numbers stay above the section switcher and every
section keeps its one-line hint · G10 keep the em-dash / "not yet" empty-state
register and the verdict-as-instruction voice.

1. **The clean arm and its disclosure reach the screen** — the holdout arm is
   real, tested and cited at its fix sites, and no UI reaches it: the selector
   union is `"pipeline" | "analysis"` (`AnalyticsCalibrationPanel.tsx:51`),
   `grep -rn "holdout\|leakage" app/features` → 0, no `sourceHoldout`/`leakage`
   key in any locale, and `QualityInstrument.tsx:44` hardcodes the contaminated
   arm under „Automatická rozhodnutí na tomto skóre jsou obhajitelná". Widen the
   union + 4-locale copy, declare `leakage` in both `Payload` types and render
   `note` + `ceiling`, structurally bar `level:"high"` from producing a
   trustworthy verdict, replace the coin-flip reference with the cohort base rate
   (skill score is **−0.332** today), and print the accrual horizon ("≈N more
   decisions") rather than an empty curve. Also print the recommender's own
   contamination caveat beside Apply (`KAT-L1-006`). (`KAT-L1-001` rec 2 ·
   `KAT-ANA-1` convergent ×3 · `KAT-ANA-6` ×2 · `LUC-ANA-2` · `TOM-ANA-10`;
   L1+L2; G1; §2.1)
2. **"Show me the people" must work again** — all five `boardHref` call sites emit
   a URL with **no `tab=`** (`buildUrl` deletes it when it equals `DEFAULT_TAB`,
   `tabs.ts:288,328`) and the URL-inbox only adopts a param on arrival, so the
   click rewrites the address bar and moves nothing (clicked live). Keep `tab=`
   for cross-tab links **or** make the inbox treat an absent param as an arrival
   of the default — either way update `tabs.test.ts:189-193`, which pins the
   deletion **deliberately**, rather than deleting the assertion. Give the
   Economics board rows an exit again. (`TOM-ANA-1` blocker L1+L2 · `KAT-L1-S02`
   regressed strength ×2; §2.3)
3. **Condition the tamper-evidence badge on `key_id`** — „Odolné proti
   manipulaci: 66 zapečetěných záznamů, řetězec ověřen" renders over 66 rows with
   `key_id=''`; the forgery was reproduced against the real store and the repo's
   own **passing** test asserts a keyless chain accepts an insider re-hash.
   `ChainVerdict` has no keyed flag (`decision-record-store.ts:49`) so the route
   cannot pass one. Add `keyed`/`keylessCount`, split the badge copy in 4 locales,
   add `KP_DECISION_HMAC_KEY[_ID]` to `.env.example` (absent today), and correct
   the unconditional HMAC claim in `docs/features/compliance/README.md:56-58`.
   State the ceiling on screen: a key added tomorrow cannot retro-seal yesterday.
   (`LUC-ANA-1` blocker L1+L2; Lucie's stated purchase condition; G3; §2.4)
4. **Restore the only write path to channel spend, and date the number** —
   `AnalyticsChannelSpendInput` lives in `AnalyticsChannelEconomicsPanel`, which
   `sectionChunks.tsx:36` exports and **no section imports**; live, the column is
   not blank but shows `833 CZK / přijetí` derived from **one `channel_spend` row
   written 2026-07-05 by a prior UAT run** — a fossil rendered as a current
   metric. One import (or lift the input into the section) plus an `updated_at` on
   every single-row-derived money figure. Until it lands, `cost_per_hire` is
   `not_measurable` in every window and the metric pack is permanently
   `notPublishable`. (`KAT-ANA-2` blocker, re-scored `missing-feature`→`trust` at
   L2 · `TOM-ANA-4`; G7; §2.5)
5. **The auditor's row** — one trip through both audit tables: subject search
   (`ColumnFilter` already ships `mode="search"`) + "export this candidate's
   dossier" calling the existing `?candidate=` route (zero UI callers for a full
   cycle); `policyVersion` and the truncated `contentHash` back on the row (the
   sibling strip renders the identical idiom 20 lines away); localized `kind`
   labels via the log's `kindLabel`; Czech collation on the name sort (today
   SQLite byte order puts every diacritic surname after Z); local time with an
   explicit zone (screen and CSV currently disagree by two hours); expandable
   rationale; a provenance block + a whole-trail export. (`LUC-GEF-L1-11` rec 2 ·
   `CS-L1-005` rec 2 · `LUC-ANA-5` · `LUC-ANA-7` · `LUC-ANA-8` · `LUC-ANA-9` ·
   `LUC-ANA-10` · `LUC-ANA-11`; G4, G5; §2.6)
6. **Name the person on an adverse decision** — `reasons.rejectDid` has no
   `{approvedBy}` placeholder in **en/cs/de/fr** (`messages/*.json:2834`), so the
   approver survives only in `payloadJson`; `pipeline_events` has no actor column
   (`db/core.ts:394-405`) so the log's *Kdo* can only render a class. Add the
   placeholder (the pattern exists at `AnalyticsThresholdHistoryStrip.tsx:152`),
   derive `approvedBy` from `currentUserId` + the users row when the session
   carries identity, keep `operatorApprover()` as the honest fallback, add an
   actor column. **This is the UAT evidence for the AI-Act gap register's own
   `G5` row above** (*"`operatorApprover()` still returns a role string; not
   threaded to the per-user identity that now exists"*) and closes it — not a
   second line for the same gap. (`CS-L1-004` rec 2 · `LUC-ANA-4`; guardrail G3;
   §2.7)
7. **A group-eval reject must carry a reason** —
   `hiring/decisions/DecisionsModals.tsx:105` calls `act(e, action)` with no
   `detail`, so the seal degrades to „Recruiter reject from Screened." — a
   tautology in the *Odůvodnění* column an auditor reads first. Pass the reason
   (the analysis path already does, `:60-61`) and add a confirm step.
   (`LUC-GEF-L1-08` rec 2; §2.8)
8. **"Confidence" gets four different words, and the LLM's self-report stops
   rendering as a measurement** — the model's own 0–100 still renders as a
   tone-banded meter with an ARIA assertion (`DecisionsAiReviewCard.tsx:149-159`);
   "confidence" is simultaneously a measurement interval (Matrix), an LLM
   self-report, a salary-read grade and an archetype vote share. Label it
   self-reported (or replace it with the measured band advance rate) and give each
   quantity its own word in one 4-locale sweep; add provenance to the bare Matrix
   score while there (`RECON-02` ceiling). (`KAT-L1-004` rec 2 · `RECON-06` rec 2;
   §2.9)
9. **One basis per per-hire figure** — `pipelineAnalytics` runs three windowing
   bases at once and divides them into each other: reproduced at **78.4 h/hire →
   "100 %"** versus an honest **13.1 h/hire → "31 %"**, while the comment at
   `db/analytics.ts:556-559` claims both are the same window. Count hires whose
   *terminal transition* falls in the window (or label each figure's basis), add a
   `manual_hours_per_hire` target key (`MANUAL_HOURS_PER_HIRE = 42` is a 4th
   parameter no call site passes), remove the `Math.min(100,…)` cap that renders
   437 % as a clean 100 %, and put the **period** into the compute `basis`.
   (`KAT-ANA-4` · `KAT-L1-005` ceiling · `KAT-ANA-7`; G7; §2.10)
10. **The window control tells the truth about its scope** — the pressed 30/90
    switcher sits in the always-rendered header above the entire window-blind
    Quality section and above `/api/benchmarks`, which takes no window param at
    all. Thread `?days=` where it can be honoured, hide/grey the switcher where it
    cannot and print the scope in force (`analytics.compute.manualWindowed` is the
    pattern). Same change, one copy line beside the pills: „Srovnání s předchozím
    obdobím se zobrazí po volbě 30 nebo 90 dní" — today the default view has no
    delta chips and the only explanation is a `title` on a chip that is not
    rendered. **Do not window the audit tables** (declined below).
    (`KAT-ANA-5` ×2 · `TOM-ANA-7` ×2; §2.11)
11. **Decide restore-or-delete for the nine orphans, and add the test that would
    have caught them** — nine orphaned modules and seven payload fields the server
    computes on every request and nobody renders (`stageDwell` first — the literal
    answer to "why is my role still open" — then the offer legs,
    `variantRecommendations` and the `byVariantTotal` cap notice). `sectionChunks`
    declares 9 chunks, the sections import 7. Add a test that walks the import
    graph from `AnalyticsTab` and fails on an unreachable panel or an unimported
    barrel export; `analyticsSections.test.ts` pins the section vocabulary and
    nothing pins the render map. (`KAT-ANA-3` · `TOM-ANA-2` convergent ×2; §2.12)
12. **The decision log stops claiming coverage it does not have** — four live
    event kinds are unmapped in `DECISION_META`, badge `NEZNÁMÉ`, sit in neither
    filter and in no rollup; two have live writers (`offer_reminder_sent`,
    `comms-dispatch.ts:588`; `human_round_queued`, `pipeline-entry-action.ts:267`
    — the human-oversight handoff itself). The guard meant to stop this
    (`decision-attribution.test.ts:30-58`) is a hand-copied list "as of W9-3" that
    passes while the gap is live. Map them, **derive** the guard list (the same
    file already does it right for `AUTOMATION_ALERT_KINDS`), and intersect the
    Rozhodnutí/Kdo filters server-side — today `if (kind) … else if (attribution)`
    drops the attribution filter while its active dot stays lit.
    (`LUC-ANA-6` · `LUC-ANA-12`; G6; §2.13)
13. **No verdict colour without an org goal** — `data.targets.conversion[stage] ??
    50` (`PerformanceBriefing.tsx:71,140`) is the benchmark behind the "weakest
    link" headline and every coral row, disclosed nowhere; the pre-consolidation
    panel showed a goal chip only when a goal was actually set. Render no verdict
    colour without an org goal, or disclose the default with a one-click path to
    `GoalsEditor`. (`TOM-ANA-9`; G10; §2.14)
14. **Put the zero-transition guard back on the render path, and seed the third
    fixture state** — on a pipeline nobody has moved, the display-type headline
    reads „Nejslabším článkem je Screening s konverzí 0 %" while the guard written
    to prevent exactly that (`hasNoStageTransitions` + `AnalyticsFunnelEmptyGuide`
    + fully translated „Nábor je připravený a čeká") is orphaned and covered by no
    test. Honour `?funnelEmpty=1` or delete it and its journey references (it is
    threaded through three files and destructured by nobody). Seed a tenant with
    ≥1 entry and **zero** stage transitions — neither `:3001` nor `:3002` provides
    it, which is why the finding is `uncertain` rather than confirmed.
    (`TOM-ANA-3` L1+L2 uncertain · `TOM-ANA-5`; G10; §2.15)
15. **A filter/search on the by-role table** — `BY_JOB_CAP = 12` sorted by volume
    with no filter, so a single open seat is the first row to fall off. This is the
    half of `TOM-ANA-6` that is a defect regardless of segmentation; the
    account-wide half is the concept-doc below. (§2.16)

Standing method commitments (how we work, not code — each with its trigger):
- **A consolidation carries an affordance inventory.** A PR that swaps a "winning
  variant" for a baseline, or stops rendering a panel, lists every affordance and
  payload field the old surface rendered with an explicit restore/delete verdict
  per line; a payload field with no renderer is deleted or given one, never left
  computed. *Trigger:* removing an import from a section barrel, deleting a
  panel/section, or introducing a `sectionChunks`-style dynamic barrel. (The CI
  half is item 11.) (`KAT-ANA-3` · `TOM-ANA-2`; §2.19)
- **A headline may not outrun its own payload's qualifier.** A display-type
  verdict names the payload field that licenses it, and where the payload ships a
  qualifier (`leakage`, `certifiable`, `status:"thin"`, `basis`, `keyId`) the
  headline may not assert a conclusion that qualifier contradicts — in the UI
  **and** in the doc that describes it. *Trigger:* adding/altering a display-type
  verdict string, or a security/compliance property claim in `docs/`. (Three such
  sentences in one run; §2.20)
- **Drift guards are derived from the writers, never hand-copied.** A test
  asserting "every X is mapped" derives its list from the source the producer
  consumes; a literal list dated in a comment is a snapshot, not a guard.
  *Trigger:* any new `*_META` map, allowlist, badge map or section resolver, and
  any review of a test containing the phrase "as of". (`LUC-ANA-6`; §2.21)

Concept-doc first (do not code yet):
- **Ground truth: what "a good hire" is, who records it, and what calibration may
  claim** — real hires now reach the outcome store, but on-the-job performance has
  no capture path outside `/api/devcase/outcomes`, `calibrate()` is read only by
  `/control`, and Interview/Offer/Hired remain **one** success label. The doc must
  resolve: what the outcome signal is, who enters it and when; whether hire
  quality is a third label or a second axis; the lawful basis and retention clock
  for performance data sealed beside hiring decisions; and what the surface says
  in the years before that data exists. (`KAT-L1-002` blocker rec 2 ·
  `KAT-L1-003` rec 2; §2.2)
- **Who is Analytics for? The per-role consumer view** — the out-of-segment
  Character **passed** the three-section navigation and still could not answer
  "why is my role still open": `pipelineAnalytics` has **no job parameter**, so a
  UI select cannot manufacture one. The doc must resolve: `?job=` scope vs a
  role-scoped block on the job page vs a personal "my roles" surface; the payload
  signature change; whether a scoped view keeps the four header numbers (G9) and
  the window semantics; the cardinality cost across ~105 open roles. Item 15 does
  not wait for it. (`TOM-ANA-6`, filed by the Character himself as a
  `scope_note`; §2.17)
- **What is a shareable view?** — `useUrlInboxState.ts:66-76` actively erases
  `?sec=` and `?tab=` after adoption while `?win=` is written back, so the only
  copyable artifact is `/?win=30`; the trade-off is documented and deliberate,
  which is why this is a model question, not a bug. The doc must resolve: an
  explicit "copy link to this view" affordance vs Analytics opting out of the
  inbox; what belongs in a shareable view; and the interaction with item 2, which
  changes `tab=` semantics on the same contract. Item 2 is **not** blocked on it.
  (`TOM-ANA-8` · `KAT-ANA-9` convergent ×2; §2.18)

Declined with reasons (do not resurface without new evidence):
- **Per-decision compute-cost attribution** (`KAT-ANA-11`) — `llm_usage.request_id`
  is never joined to pipeline events, and the compute ledger is account-wide while
  decisions are workspace-scoped, so the per-decision ratio is dishonest by
  construction on a shared ledger. The cheap half (Economics→Billing link, the
  period in `basis`) is inside item 9. Revisit when per-tenant `llm_usage`
  attribution lands (tracked above under Platform).
- **Windowing the audit tables to the 30/90 switcher** — the code already states
  why: *"a bounded window would silently drop older decisions, which is the one
  thing an audit surface may not do"* (`DecisionLogTable.tsx:14-19`, G4). The
  defect is the control claiming a scope it does not have, so item 10 scopes the
  **control**, not the trail. A future explicit date-range filter inside the table
  is a different feature and does not resurrect this.
- **Seeding or backfilling `channel_spend` so the column shows a number** — that
  manufactures exactly the defect L2 found (a stale figure that looks plausible),
  in every install. The ask is an input field, not a value; item 4 gives the field
  and dates the number.
- **Reverting the three-section consolidation** — the out-of-segment consumer
  passed the navigation („Jako navigace: obstálo"), and two run strengths (section
  hints, header numbers above the switcher — G9) are properties of the new shape.
  The cost was paid at variant selection (`83a63aef`, `0a8a2c37`), not at the
  section boundary; items 2 and 11 recover what was lost.

Covered elsewhere, not double-entered: the approver-identity gap is **G5 in the
AI-Act gap register** above (item 6 supplies its UAT evidence and closes it); the
Matrix score's missing provenance is the `RECON-02` ceiling, folded into item 8.

Loop rule: each shipped item re-enters via `/uat recertify` against the
originating Character's scored criteria — fresh live evidence,
`resolved-verified`, and its own ceiling. Two are gated on data rather than code:
item 14 cannot be certified until the zero-transition fixture exists, and item 1's
clean arm stays empty until ≈500 would-be auto-rejects accrue
(`DEFAULT_HOLDOUT_PERCENT = 5`, `MIN_CALIBRATION_OUTCOMES = 20`, auto-reject off
by default) — so its recertify verifies the *handle and the disclosure*, and the
accrual horizon copy, not a populated curve.
