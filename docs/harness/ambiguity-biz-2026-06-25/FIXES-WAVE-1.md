# Ambiguity+Business Fix Wave 1 — Hiring correctness

> 6 commits, 6 findings closed (5 Critical + 1 High).
> Baseline preserved: tsc 0 → 0 · JS unit 1018 → 1020 · Python green (686 → 694) · en/cs parity OK. 0 regressions.

The theme: silent, *wrong or unfair* hiring outcomes — the product's core promise. Each fix removes a way the engine could quietly mis-decide on a candidate, and adds a test pinning the corrected behavior.

## Commits

| # | Commit | Finding | Sev | Files |
|---|---|---|---|---|
| 1 | `71e2cfc` | Group-eval "Fairness check" mislabel | C | FairnessPanel.tsx, en/cs.json |
| 2 | `5dcf1fa` | archetype-`bau` default strips fairness shield | C | match-candidate.ts, matching.py, test_matching.py |
| 3 | `7af3152` | `handledWell:False` halves in-product judgment | C | process_events.py, evaluate.py, DevTypes.ts, devcase-cohort.ts, +2 tests |
| 4 | `7b3c964` | paste-blind authenticity moat | C | LiveWorkSurface.tsx, devcase-authenticity.ts, devcase-run.ts, DevTypes.ts, +test |
| 5 | `48d4c86` | LLM-only credential/licence gate | C | credentials.py (new), pipeline.py, test_credentials.py (new) |
| 6 | `9266d0a` | positional "deal-breaker" missing-skill tiers | H | MissingSkillsTiers.tsx, en/cs.json |

## What was fixed

1. **"Fairness check" mislabel (C).** The Group-eval panel measured weight-scheme *robustness*, not demographic/adverse-impact fairness, yet a green "Fairness check passed" reads as bias clearance (EEOC/LL144/EU-AI-Act false assurance). Renamed to "Weighting robustness" + a scope disclaimer ("does not assess protected-class bias") shown in both branches.

2. **archetype-`bau` strips the fairness shield (C).** A saved analysis with no v2 profile defaulted to `bau`, which fired the seniority KO and dropped `fairnessProtected` — silently auto-filtering a student/switcher out of senior roles. Now passes an explicit `"unknown"` sentinel; `ko_filter` fails closed (no seniority auto-KO for an unclassified archetype, mirroring TS `isFairnessProtected`). Scoring unchanged (neutral BAU weights).

3. **Observed judgment halved (C).** `tooling_from_events` hardcoded `handledWell:False`, so the in-product (Live Work Surface) path scored every candidate's fairness-critical judgment at `0.5*verif + 0.5*0` while reporting 0.8 confidence. `handledWell` is now tri-state (`None` = detected-not-graded); `evaluate` treats `None` as no-signal → judgment rests on verification alone, with honest "worked the probe areas" credit.

4. **Paste-blind authenticity (C).** The watched editor recorded one debounced edit regardless of paste size, and the observed-session waiver let a pasted LLM solution score 100/100 "authentic". Now records paste magnitude (count only) and docks a bulk paste (≥600 chars, no build-up) 65 points → "suspect", held for the ownership-verifying interview.

5. **Credential gate (C).** The schema captured `credentials[].expiry` and the prompt's CREDENTIAL GATE, but evaluation was 100% LLM free-text — one missed flag = an expired/missing RN/Series-7/PE licence slipping a regulated hire. New deterministic `credential_checks` flags JD-required-but-missing and past-dated *regulated* licences into the trust ledger.

6. **Positional deal-breaker tiers (H).** `missingSkills` (a flat model-emitted array, no ordering contract) was sliced by position and the first 3 branded "Must have / likely a deal-breaker". Relabelled position-neutral ("Top gaps / Other gaps / Minor gaps"), de-"deal-breaker"ed, and documented the model-emitted ordering.

## Verification

| Gate | Before | After |
|---|---|---|
| tsc --noEmit | 0 | 0 |
| JS unit (`node --test`) | 1018 | 1020 |
| Python (`unittest discover`) | 686 OK / 4 skip | 694 OK / 4 skip |
| i18n en/cs parity | OK | OK |

## Patterns established (catalogue items 1–4)

1. **Honest-label over false-assurance.** A feature named for a guarantee it doesn't provide (`Fairness check` measuring only weight robustness) is a correctness/legal risk, not cosmetics — rename + scope-disclaimer, cheapest via i18n.
2. **Fail closed on unclassifiable inputs.** A defaulted sentinel (`"unknown"` archetype, `None` handledWell) must route to the safe branch (no auto-KO, no graded-failure), never collapse to a class that triggers a hard gate. The TS `isFairnessProtected` philosophy generalized into Python `ko_filter` and `evaluate`.
3. **Tri-state a "couldn't assess" signal.** A hardcoded `False` for an unmeasured boolean reads downstream as a graded negative; emit `None` and have consumers treat it as no-signal (drop from the mean), reserving `False` for an actual assessment.
4. **Deterministic safety net beside an LLM gate.** When a hard, consequential gate (credentials, fairness) is delegated to a single LLM generation, add a cheap pure check that folds into the same trust ledger — independent of whether the model remembered to flag it. Mirror the existing `authenticity_checks` shape.

## What remains

16 of 17 criticals + 100 Highs open (INDEX themes). Next-highest-value waves: **W2 cross-tenant isolation** (the keystone — `KP_MULTI_WORKSPACE` honor-system flag + unauth PII reads), **W3 revenue leak/billing**, **W4 GDPR/audit**, **W5 comms/candidate-experience reliability**.
