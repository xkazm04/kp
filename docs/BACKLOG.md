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
| D1 | Four shipped features have **no feature doc**: analytics stage-dwell, pool-fit, onboarding hand-off, and the NL command bar. They were documented only inside the now-archived GDPR extensions doc, which was never the right home for them. | `docs/features/` — needs `analytics/` and `talent-pool/` areas |
| D2 | No `docs/development/README.md` — the three harness docs (automation eval, case calibration, voice-interview testing) have no shared index explaining when to reach for which. | `docs/development/` |
| D3 | `docs/architecture/llm-model-matrix.md` is a dated benchmark snapshot. It now carries a "re-run before trusting" banner, but nothing re-runs it. | `docs/architecture/` |
| D4 | `docs/product/coverage-plan.md` W0.5 acceptance criteria say `/trust` is public and landing-linked; `app/trust/page.tsx` is deliberately `noindex`, internal-only (2026-07-30 product decision). Criteria and reality disagree — one of them should move. | `docs/product/coverage-plan.md` |
| D5 | The visual-uplift plan's remaining phases cite pre-refactor file paths (`JobsTab.tsx:78` style). Anyone picking Phase 2 up must re-locate them first. | `docs/concepts/visual-uplift-plan.md` |

## Compliance — AI Act gap register (G1–G14)

Closed since the pack was written: **G3** (name-neutrality perturbation test now exists),
**G11** (AI disclosure now renders on `/status` and `/onboarding`), **G9 partially**
(redacted candidate-facing decision view; the full sealed dossier stays operator-gated by
design). Still open:

| # | Gap | Note |
| --- | --- | --- |
| G2 | **No Annex IV technical documentation / instructions-for-use doc.** | Highest priority — AI Act applicability date is **2026-08-02** |
| G1 | No risk-management doc, DPIA, or residual-risk analysis | Art. 9 |
| G4 | No `audit_events` table — grepped `app/` and `pipeline/`, zero hits | Art. 12 logging |
| G5 | `operatorApprover()` still returns a role string; not threaded to the per-user identity that now exists in `app/_lib/db/users.ts` | Art. 14; regressed in usefulness *because* E0 shipped |
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
