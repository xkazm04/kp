# Marketing truth recheck, pass 2 — 2026-10-09

Base: `8338f2dca`. Branch `autopilot/accepted-idea-delivery-ff64df76`. Follows pass 1 (`46b76d709` + `72687c155`, `.ai/tasks/2026-10-09-marketing-truth-recheck.md`).

## Pins added (3 of the 8 allowed)
| Test | Claim it locks | Commit |
| --- | --- | --- |
| `chapters.test.ts` "the JD-sources detail card says what the design prompt really sends: the first 4 000 characters" | `about.jd.sources.jdDetail` names the cap in `design.py` `need.jd_text[:4000]`, in en/cs/de/fr | `2e43b3ef3` test(about): pin the 4 000-character JD window and the two-of-three fairness-protected archetypes |
| `chapters.test.ts` "the archetypes lede says two of three archetypes are fairness-protected, and the registry agrees" | `archetypes.json`: 3 archetypes, 2 `fairnessProtected`; `about.chapters.archetypes.lede` says "two of the three" in all four locales | `2e43b3ef3` (same commit) |
| `MarketingClaims.test.ts` "the offer figure is computed from the role band and the fit total before any model call" | in `draft_offer` (`pipeline/jobfit/automation.py`), `recommended = max(lo, min(hi, _round_k(lo + (hi-lo)*f)))` with `f` from `m.total`, computed before `_generate(`; no `provider`/`_generate`/`.complete` on that path; the result's `recommended`/`salaryMin`/`salaryMax` are those computed values | `677aa839d` test(landing): pin the offer figure as band x fit with no model call |
| `MarketingClaims.test.ts` "every locale's offer copy still says the figure is deterministic" | `landing.features.offer.body`, `aboutPage.steps.offer.body` (the second string; it sits under `aboutPage`, not `landing`) and `siteFeatures.items.offer.pin1` say "deterministic" in all four locales | `677aa839d` |

What the offer pin proves: the structured figure is computed from band and fit with no model on that path. It does **not** prove the letter text repeats it unchanged — the prompt tells the model to state the figure, and the model writes the body. The copy says "no model in the number"; the number is true, the sentence in the letter is the model's.

Not pinned, with reason:
- `about.gates.noteHired` (manual move to Hired = 422): already proven by `app/api/pipeline/pipeline-routes.test.ts:134` ("set_stage guardrails: manual Hired is 422…", asserts `hired.status === 422` through the route's `actionPost`) and `entry-route.test.ts:55`. Nothing added.
- `about.archetypes.declaration` (0.65): **FALSE as worded**, see report-only #1.
- `landing.features.inbox` (five doors): no single list, see report-only #2.

## Inventory (claims held in app/ code)
| Constant / key | Claim | Source | Pin | Verdict |
| --- | --- | --- | --- | --- |
| about-jsonld.ts `PRODUCT_NAME` | "KandiDate" | brand | about-jsonld.test.ts (name asserted) | TRUE |
| about-jsonld.ts SoftwareApplication `offers` price "0" CZK | a free hosted tier exists | `app/landing/site/land/Pricing.tsx` `id: "free"` | "the free-tier Offer is claimed only while the pricing band still sells free" | TRUE |
| about-jsonld.ts `applicationCategory`/`operatingSystem` | BusinessApplication / Web | n/a (schema label) | about-jsonld.test.ts | TRUE |
| about-jsonld.ts no `FAQPage`, no `aggregateRating`/`review` | none emitted | file itself | pinned (`doesNotMatch FAQPage`; `aggregateRating === undefined`) | TRUE |
| about-jsonld.ts HowTo steps | one per `ABOUT_STEP_KEYS` | shared.ts | pinned (two tests) | TRUE |
| scenes/archetypes `TARGETS`, `SIGNALS`, `SCORES`, `WINNER`, `SIGNAL_AGREEMENT` | real rule weights; 4.5/6.0 = 0.75 | `archetypes.json` `detection.signals`; `registry.py:330` `round(scores[best]/total, 2)` | pinned "the archetype scene's tally board is drawn from the real registry" | TRUE |
| scenes/archetypes (copy via messages) | self-declared 0.9, fallback 0.4, floor 0.55 | `archetypes.json` detection | pinned "quoted detection constants" | TRUE |
| scenes/scoring `THRESHOLD` 0.5, `SIBLING_MATCH_LABEL` | `_MATCH_THRESHOLD`, `_SIBLING_MATCH` | `matching.py`, `taxonomy.py` | pinned "chapter 2's two thresholds" | TRUE |
| scenes/scoring `Why` union | adjacency / provenance / both | `matching.py:613` `UnprovenReason` | unpinned (same literal set, read by eye) | TRUE |
| scenes/scoring `REQS` (7 skills, scores) | sample candidate | none | n/a | example |
| scenes/screening `KO_REASONS` keys | language, seniority, education, workMode | `matching.py` `KoReasonKey` | pinned (subset check) | TRUE |
| scenes/screening `COHORT` 120, `SURVIVORS` 74, `TOP_N` 8, `n` per reason | worked example | none; data.ts says so; `figuresNote` says so | pinned (copy names the three) | example |
| scenes/assignments `AIM` 0.85 | baseline-similarity prompt threshold | `artifact_checks.py` `sim >= 0.85` | pinned "chapter 5's baseline-similarity threshold" | TRUE |
| scenes/assignments `OVERLAP` 0.31 | sample submission | none | pinned below AIM | example |
| scenes/gates `ACTIONS` | rejection_review, offer_review park; advance/hold do not | `approval-kinds.ts` | pinned "parked kinds are a true subset" | TRUE |
| scenes/gates `GATE_LABEL` | `needsHumanDecision(kind)` | `approval-kinds.ts` | pinned | TRUE |
| scenes/jd `REQS` (TypeScript, React 19, Kafka orphan…) | sample JD | none | n/a | example |
| scenes/*/data.ts `CYCLE`, `STILL`, `STATUS_BEATS` | animation timing | none | `scenes/beats.test.ts` | not a product claim |
| market/data.ts `FamilyKey` (16 keys) | the 16 role families | `data/taxonomy.json` `role_families` (same 16, same order) | unpinned | TRUE |
| market/data.ts `FAMILY_ORDER` doc comment "The 16 role families in taxonomy order" | list of 16 | derived from `snapshot.reference_salaries`, which holds **15** (no `product_project`) | unpinned | FALSE as a comment (see report-only #3); not shown to users |
| market/data.ts `snapshot.meta.currency` "CZK" | currency of all figures | `data/market_pulse.json` | `data.test.ts` money tests | TRUE |
| market/data.ts `STALE_AFTER_DAYS = 60` | page states staleness after 60 days | self | `data.test.ts` snapshotAgeDays | TRUE (own constant) |
| market/data.ts "`cs` output byte-identical to the hand-rolled formatters" | formatter equivalence | self | `data.test.ts` "Czech output is byte-identical…" | TRUE |
| jobMarket copy "all 14 regions" (messages, via this page) | 14 regions | `market_pulse.json` `meta.regions` 14, `regions.length` 14 | unpinned | TRUE |

## Fixes (step 3)
None. No value in an allowed data file contradicts a constant in code. The one false claim found (#1) lives in `messages/*.json`, which is report-only, and the one false comment (#3) is a comment in `market/data.ts` that no user reads.

## Report-only
1. **`about.archetypes.declaration` is FALSE as worded for one archetype.** The copy says a contradicting signal "lowers the confidence to 0.65" (same figure in cs/de/fr). `pipeline/jobfit/archetypes.json:80` (student) and `:83` (bau) are 0.65, but `:86` (career_switcher, "note: 'switcher' usually implies prior professional experience") is **0.7**, applied by `registry.py:311` `confidence = contradiction["confidence"]`. Not pinned, since pinning the sentence would lock a wrong statement. Proposed English: "A contradicting signal never overrides it. It lowers the confidence — to 0.65 for a student or BAU declaration, 0.7 for a switcher — and appends a reason, which the soft-signal panel then republishes for a human to look at." Pass 1 had this row as TRUE; it was checked against two of the three rules only.
2. **`landing.features.inbox` / `aboutPage.steps.intake` / `siteFeatures.items.inbox` ("five doors") cannot be pinned.** There is no intake-source enum. `source_channel` (`app/_lib/db/core.ts:1851`, read as `sourceChannel` in `app/_lib/db/pipeline.ts:503`) is a free string, and writers set at least `"apply"` (`app/api/apply/[id]/route.ts:392`), `"quick-apply"` (`.../quick/route.ts:140`), `"devcase"` (`app/_lib/devcase-run.ts:907`), `"agent-bridge"` (`app/_lib/agent-hire/lifecycle.ts:93`) and `"agent-fit"` (`transform-run.ts:112`); email, job boards and sourcing campaigns are not names in code. "Five" is a description, not a count the code keeps. Proposed English: drop the count from the title — "One inbox, every door" — and keep the list in the body.
3. `app/landing/spark/market/data.ts` comment above `FAMILY_ORDER` says "The 16 role families in taxonomy order"; the array holds the 15 families the snapshot has salary rows for (`product_project` is in `FamilyKey` and `taxonomy.json` but not in `market_pulse.json`). Proposed comment: "The role families the snapshot has reference salaries for (15 of the 16 in `FamilyKey`), in taxonomy order." Not changed: it is not mechanically a copy value, and a pin would need `data.test.ts`, outside this task's files.
4. `about.jd.status.s12` "hard cap 8", `landing.proof.cards.defend.body` "Czech or English" (pass 1 #1, #2) are unchanged and with the operator.
5. Trust, compliance, security and pricing rows from pass 1 (sealed chain, kill switch, GDPR Art. 22, EU AI Act, enterprise ROI stats) were not touched.
6. Offer copy: "the letter drafts itself" is fine, but "no model in the number" is true of the structured figure only; the letter body is model-written around it (see the pin note above). No reword proposed.

## Gates (in the worktree)
- `npm run i18n:check`: OK (13891 strings per locale, 4 locales in parity).
- `npm run typecheck`: pass (exit 0).
- `npm run lint`: 0 errors, 49 warnings (same count as pass 1).
- `npm run test:unit`: 13019 tests, 13019 pass, 0 fail.
- `node scripts/run-unit-tests.mjs "scripts/kpi/**/*.test.mjs"`: 85 pass, 0 fail.
- `npm run test:docs`: exit 0.
- `typecheck` rewrote `app/_lib/{contract-constants,schemas,taxonomy}.generated.ts`; they were restored with `git checkout --`.

## Notes
CHANGELOG.md was not updated because it is dirty in the shared checkout.
