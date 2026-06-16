# Code Refactor — Fix Wave 7: UI component/markup extraction

> 9 atomic commits, 10 findings closed, 2 skipped-on-inspection (Theme G).
> Baseline preserved: tsc 0 → 0 · unit 849 → 849. Markup behavior preserved throughout (dedup, not redesign).

## Commits

| # | Commit | Finding | What |
|---|---|---|---|
| 1 | `1d17e9c` | dev-studio #1 + #2 | `ProbeRow` + `RubricChip` into `DevShared.tsx` (shared file → one commit) |
| 2 | `4b7114a` | dev-studio #3 | `FollowupQuestionItem` shared between EvalPanel + InterviewKit |
| 3 | `c87e31f` | dev-studio #4 | `LIVE_STAGES` moved beside `STAGE_LABEL`/`LIFECYCLE_STEPS` in `DevTypes.ts` |
| 4 | `54df493` | interview-prep #1 | `ScorecardRatingRow` with optional evidence slot; AI jump-to-turn preserved |
| 5 | `1401a72` | analytics #1 | `InlineNumberSave` (resync + validation preserved; callers own fetch) — replaced `SpendInput`/`TargetInput` |
| 6 | `9033897` | voice #1 (compliance) | extracted only the 2 byte-identical persona lines (`PERSONA_GENDER_GRAMMAR`/`PERSONA_LANGUAGE_DETECT`) |
| 7 | `f89649e` | matching #1 | `ConfidenceRange` (JobCompare + 3 span sites) |
| 8 | `f961964` | scheduling #1 | routed 2 raw slot-formatters through `useSlotLabel()` (also fixes an unguarded "Invalid Date") |
| 9 | `124a20c` | workspace-shell #3 | class-string-only dedupe of ThemeToggle/LanguageSwitcher (`TOGGLE_GROUP`/`toggleBtn`); semantics untouched |

## Verify-before-fix outcomes (this is where the certainty bias earned its keep)

- **voice #1 (compliance copy)**: the report called it "verbatim across 3 builders," but byte-comparison showed only 2 of ~5 lines actually matched. The AI-disclosure line, role intro, and closing verb **legitimately differ per builder**. Reusing `NON_NEGOTIABLES`/`CLOSING` wholesale would have *changed* compliance prose — so only the 2 truly-identical lines were extracted. Exactly the right call for legally-relevant text.
- **matching #3 (ReasoningBody) — SKIPPED**: the two reasoning renderers genuinely diverged (grid vs stacked, custom dots vs `list-disc`, 4/4/3 slice caps, `matrix` vs `match.shared` i18n namespace). Unifying would redesign the matrix popover — a behavior change, not a dedup.
- **workspace-shell #4 (TabLinkButton) — SKIPPED**: too thin (only a className + arrow shared; the two nav contracts differ — `buildTabSwitchUrl` vs `buildUrl`+cleared params). Report had flagged it Low/watch.
- **matching #1**: `MatchCard`'s range is a block layout, not adjacent to its badge → kept as-is to avoid altering layout; applied `ConfidenceRange` to the safe sites.

## Verification

| Gate | Before | After |
|---|---|---|
| tsc --noEmit | 0 | 0 |
| unit (node --test) | 849 | 849 / 0 fail |

## Patterns established (catalogue item 9)

9. **"Duplicated markup" must be byte-verified before extraction — especially compliance/legal copy.** Two of this wave's "verbatim" findings were only partially identical; merging the divergent parts would have silently changed rendered behavior or legal wording. Extract only the truly-identical core; leave legitimate per-site variation alone.

## What remains

Waves 8–9+ per INDEX.md: fetch/persist wiring dedup, then the cleanup/stale tail.
