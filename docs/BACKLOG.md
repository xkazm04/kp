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
- Tenancy last mile: pipeline entry-id workspace component, tasks dedup index, per-session revocation, per-workspace export/import.
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

- ~~**Editable brief + re-openable session**~~ — SHIPPED 2026-08-07 (edit
  mode in the brief panel + `PATCH /api/intake/[id]/brief` + reopen with an
  appended system turn; promoted briefs stay frozen). Pending `/uat recertify`
  against Tomáš/Priya. (§2.1)
- ~~**Defensibility layer**~~ — SHIPPED 2026-08-07 (`source_turn` written on
  both paths with click-to-turn in the panel; weight/rationale/confidence
  detail rows; markdown export of brief + numbered transcript + provenance).
  Pending `/uat recertify` against Eva. (§2.2)
- **Non-tech grade capture** — seniority answers matching no enum token land
  verbatim as a `grade_label` facet (`stated`) instead of vanishing ("Band 5"
  ≠ silence). (Priya; §2.3)
- **Latency honesty** — elapsed hint + staged copy on the thinking bubble
  (31–40 s measured live); explicitly not streaming (declined, §2.7). (§2.4)
- **`llm_era_confused` persona clause** — one `_PERSONA_TECHNIQUE` sentence
  anchoring role-existence doubt in 90-day outcomes. (§2.6)
- **Workspace-context grounding of the dialog** — concept-doc first (which
  org context, prompt budget, a possible `grounded` provenance value);
  promote to build after the voice plane settles prompt economics. (§2.5)

Declined with reasons (do not resurface without new evidence): streaming
replies; keyless laddering imitation; smarter deterministic parsing —
see insights doc §2.7. Dev-case seam is owned by the Direction-2 workstream;
multi-market comp is already tracked above under Matching & scoring.
