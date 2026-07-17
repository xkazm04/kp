# Fix Wave 5 — Fairness / semantics

> 6 findings closed in 6 atomic commits (all High). Theme: silent bias, fabricated signals, and false fairness/compliance claims.
> Baseline preserved: tsc 0 → 0 errors; node suite 2364 → 2366 pass; Python suite 1151 → 1157 pass; **matching-eval --strict PASS (fairness 4/4)**. 0 regressions.
> Branch: `vibeman/ambiguity-ui-wave1` (continues Waves 1–4). All targets in clean files (match_reasoning.py and the devcase WIP left untouched).

## Commits

| # | Commit | Finding closed | Files |
|---|---|---|---|
| 1 | `7ba99fd` | a built-in's fairness shield is one PUT away | `archetype-registry.ts` (+2 tests) |
| 2 | `282f130` | blank profile defaults roleFamily to software_engineering | `sub_profile/ProfileForm.ts` (+test) |
| 3 | `a894dc5` | capability matrix advertises file_input for text-only adapters | `llm/capabilities.py` (+test) |
| 4 | `f4b8aa6` | blind screening claims "identity redacted" when no name found | `redact.py`, `pipeline.py` (+tests) |
| 5 | `d146f3e` | live-case "observed" credit from naive substring matching | `live_case.py` (+2 tests) |
| 6 | `11f384b` | align script re-skins every non-tech candidate into a Java dev | `align_candidates_csas.py` (+2 tests) |

## What was fixed

1. **Editable fairness shield** — `setArchetypeArchived` refuses to retire a built-in (that would strip the shield), but `updateArchetype` had no guard and `EDITABLE_FIELDS` includes `fairnessProtected`/`scoringModel`. Unticking the fairness checkbox on the built-in "Student" (or a raw PUT) silently disabled the "early-career candidates are never auto-rejected" guarantee. Now rejected with `edit_builtin_shield` for built-ins; label/weight edits still go through.
2. **Default-family bias** — the blank profile form seeded `roleFamily: "software_engineering"` with a comment falsely claiming it "is not scored". The matcher DOES score family (1.0 on match else 0.35/0.3), so every hand-built non-tech profile was biased toward SWE. Now seeds `DEFAULT_ROLE_FAMILY` ("general_professional"), matching the analysis path's "Never assume software" policy.
3. **Capability-matrix drift** — `PROVIDER_CAPABILITIES` advertised `file_input` for anthropic/openai/azure/gemini, but every adapter in this layer is text-only, so routing `cv_analysis` there silently dropped the CV and analyzed an empty prompt. Dropped the cap so those routes fail loud until an adapter truly attaches files.
4. **Blind-screening fail-open** — when `_guess_name_line` missed the name, the real name flowed to the model verbatim while the pipeline still recorded "identity redacted before scoring" (false compliance claim) and returned `name: None`. `RedactResult` now carries `name_detected`; the note is honest ("Blind screening PARTIAL — no candidate name detected… Verify") when no name was redacted.
5. **Fabricated "observed" credit** — `_credited_skills` minted the engine's highest-trust `observed` provenance via bidirectional substring matching, so a short must-have like "R" matched "Strong framing" ("r" ⊂ "strong"). Now uses whole-token overlap (`taxonomy.contains_whole_token`), the discipline the taxonomy module enforces everywhere.
6. **Seed corpus drift** — `align_candidates_csas` fell back to `software_engineering` for any family not in its 3-tech-family `TRACKS`, re-skinning every non-tech candidate (finance/sales/ops) with a Java stack while leaving `roleFamily` unchanged — internally-inconsistent records the non-tech jobs couldn't match. Now leaves non-tech candidates untouched and reports them.

## Verification

| Gate | Before | After |
|---|---|---|
| tsc --noEmit | 0 errors | 0 errors |
| node unit suite | 2364 pass / 0 fail | 2366 pass / 0 fail |
| python suite | 1151 pass / 0 fail | 1157 pass / 0 fail |
| matching-eval --strict | PASS | **PASS (fairness 4/4)** |

Every fix carries a test that fails pre-fix (verified for the live-case substring credit and the archetype shield); the two scoring-adjacent Python changes (live-case whole-token, default-family) were validated against the strict matching-eval golden with **zero delta**.

## Patterns established (catalogue items 18–21)

18. **Asymmetric protection on parallel mutators** — one path (archive) guards an invariant while a sibling path (edit) that can violate the SAME invariant has no guard. Enumerate every mutator that can reach a protected field; guard them all.
19. **"Not scored" comment that's false** — a default value documented as inert that a downstream stage actually consumes. Verify the claim against the consumer before trusting a default is safe; a biased default is worse than a required field.
20. **Fail-open on a detection miss** — a redaction/guard that reports success on the happy path but has no signal for "I couldn't do the thing", so a detection miss silently ships as a completed guarantee. Add an explicit detected/undetected signal and make the success claim depend on it.
21. **Substring where the module uses whole-token** — a raw `in`/substring test for skill/term matching in a codebase whose taxonomy enforces whole-token discipline everywhere else. Short/generic tokens ("R", "Go", "hr") substring-match unrelated words; always match on normalized whole tokens.

## What remains (deferred, with cause)

- **Archetype UI disable** (fairness checkbox / scoring-model select disabled for built-ins in EditPanel) — the server guard fully closes the hole; the UI reflection is a small follow-up flagged in commit `7ba99fd`.
- **Blind-screening name recovery** — when no name is detected the recruiter-facing name stays `None` (the model was instructed to null it); the honest PARTIAL note now explains it, but recovering a name would need a change to the blind LLM instruction — deferred.
- Remaining theme-G tail (early-career motivation substring bug, fairness_matrix cross-track ranking, education ordinal) — future-wave candidates.
