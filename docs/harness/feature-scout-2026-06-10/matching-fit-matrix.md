# Feature Scout — Candidate-Job Matching & Fit Matrix (2026-06-10, re-scan of mined context)

> Total: 4 (1H/2M/1L)
> Prior scan 2026-06-08: 6 findings, all shipped. This re-scan reports only net-new gaps.

## 1. Generate per-match "Explain fit" reasoning in the recruiter's locale
- **Value**: High
- **Category**: user_benefit
- **Effort**: S
- **Where**: `pipeline/jobfit/reasoning_cli.py:30-43` (no `--lang` flag; `generate(...)` called without `lang`) + `app/_lib/reasoning-run.ts:31` (args never carry `--lang`), `app/_lib/reasoning-cache-key.ts:45-54` (no lang axis), `app/api/match/reasoning/route.ts`, `app/_lib/tasks.ts:85`. Ready-made server seam: `pipeline/jobfit/match_reasoning.py:254-276` (`generate(..., lang="en")` + `language_directive` already implemented). Precedent: `app/api/analyze/route.ts:80-96` (`getServerLocale()` → task params → `--lang`) and `app/_lib/cache-key.ts:22-26` (`v5-2026-06-09-lang-cachekey`).
- **Gap**: Opened by i18n (7922fbe). The match chrome is fully bilingual and the *analysis* LLM narrative is locale-threaded end-to-end, but the per-match reasoning block (verdict / strengths / gaps / interview probes) is locked to English: `match_reasoning.generate` already accepts `lang` and appends `language_directive`, yet `reasoning_cli` exposes no `--lang` and the TS chain (route, background task, cache key) never reads the locale. The reasoning cache also lacks a lang axis, so naive wiring would serve a cached English verdict to a Czech session.
- **Proposal**: Capture `getServerLocale()` at request scope in `/api/match/reasoning` and in the `startTask("reasoning")` param build (exactly the analyze pattern — the detached task can't read the cookie itself), thread it through `ReasoningInput` → `reasoning_cli --lang` (normalize via `i18n.normalize_lang`) → `generate(lang=...)`. Add `lang` as a fourth axis in `reasoningCacheKey` and bump `REASONING_PROMPT_VERSION` (keeping `test_prompt_version_sync.py` green) so pre-i18n entries retire.
- **Why users need it**: A Czech recruiter now reads a Czech surface with an English rationale embedded in its most-read panel — the exact text they quote to hiring managers and candidates. Same seam exists in group-eval narrative (`group_compare.generate(lang=)` also never receives lang) — noted for the Decisions context, out of scope here.

## 2. Name the KO blocker on blocked Fit-Matrix cells
- **Value**: Medium
- **Category**: functionality
- **Effort**: S
- **Where**: `pipeline/jobfit/matrix_cli.py:92-94` (`passed, _reasons = ko_filter(cand, job)` — reasons computed then discarded) + `app/api/matrix/route.ts:10` (`Cell = { score, blocked }`), `app/features/sub_matrix/MatrixTab.tsx:537,554` (tooltip/cell say only "Blocked (KO)" / "–"), `pipeline/jobfit/matching.py:209-234` (`KoReason` carries a stable category `key` minted at birth for exactly this rollup use).
- **Gap**: Every blocked cell already has its categorized KO reasons computed in the same loop that scores the grid, and they are thrown away. The recruiter sees "–", and the only way to learn *why* (location? language? seniority? salary floor?) is to leave the grid and run a full match for that pair. The Match tab surfaces aggregated KO reasons (`meta.koReasons`, `KoReasonsNote`); the matrix — where blocked cells dominate a real pool — says nothing.
- **Proposal**: Emit the reason keys on the cell (`{ score, blocked, koKeys: [...] }`) from `matrix_cli`, and render them in the cell `title`/`aria-label` (and the select-mode "blocked" tooltip). Localize by the stable `KoReason.key` through the messages catalog rather than shipping the server's English label, keeping the grid bilingual. The in-process matrix cache holds whole `MatrixOut` objects, so the shape change is self-invalidating on restart.
- **Why users need it**: "Blocked: salary band" and "blocked: must-have language" demand opposite recruiter actions (renegotiate vs. skip); today both read as the same dash.

## 3. Honor the job half of the matrix→match deep-link (highlight the clicked role)
- **Value**: Low
- **Category**: user_benefit
- **Effort**: S
- **Where**: `app/features/sub_matrix/MatrixTab.tsx:182` (`open()` navigates with BOTH `profile` and `job`) + `app/features/sub_match/MatchTab.tsx:26` (only `search.get("profile")` is consumed), `app/features/tabs.ts:143-162` (`job` is a documented tab-scoped deep-link param: "a job (`job`)").
- **Gap**: Clicking a matrix cell promises the candidate×role pair, but the Match tab only honors the candidate half: it auto-runs the full ranking and drops the role on the floor — the clicked position can sit below the fold at #14 of 25. The `job` param already rides the URL; nothing in `sub_match` reads it (grep-verified).
- **Proposal**: When `?job=` accompanies the auto-run, scroll to and ring-highlight that role's `MatchCard` (with its rank visible), mirroring the evidence→turn anchoring pattern from W7. If the role didn't survive the KO filter for this candidate, show a one-line "this role was filtered out" note instead of silently ignoring the param — that absence is itself the answer the recruiter clicked for.
- **Why users need it**: Cell→detail is the grid's primary verb; every click currently costs a manual scan to re-find the role the user just pointed at.

## 4. Persist recruiter weight overrides; give the Matrix weight parity
- **Value**: Medium
- **Category**: feature
- **Effort**: M
- **Where**: `app/features/sub_match/WeightsPanel.tsx:42` (draft is component state only), `app/features/sub_match/MatchTab.tsx:51-77` (`runMatch` always omits `weights` → every fresh run resets to baseline), `app/api/matrix/route.ts:36-94` (GET, no weights input; cache key hashes only profiles/jobs), `pipeline/jobfit/matrix_cli.py:96` (`score_job(cand, job)` — no weights), `pipeline/jobfit/matching.py:460` (`resolve_weights` clamps any proposal server-side).
- **Gap**: New seam exposed by MAT1 shipping. The bounded re-rank sliders work, but the override is per-run ephemera — it evaporates on the next run, navigation, or reload (no localStorage/db anywhere in `sub_match`, grep-verified) — and the Fit Matrix (including the Pipeline "Rank candidates" `?job=` scoped view) always scores at the archetype baseline, so the grid silently disagrees with the ranking the recruiter just tuned. The matrix half is a documented unshipped remainder of MAT1 (harness-learnings W13: "Matrix-tab MAT1 (weighting, W6) is separate"); the persistence half was never proposed anywhere.
- **Proposal**: Persist the applied vector client-side keyed by archetype (bounds are archetype-keyed; follow the `kp.pipelineViews`/`kp.pipelineStageSla` localStorage precedent — no schema), seed `WeightsPanel` from it and auto-apply on fresh runs with a visible "custom weighting" pill + one-click reset. Optionally thread the same override into `/api/matrix` → `matrix_cli --weights` (resolved per-candidate via the existing `resolve_weights`, server still the fairness enforcer) and fold it into the matrix cache key.
- **Why users need it**: Re-dragging three sliders on every run reduces MAT1 to a demo; and a tuned Match ranking that contradicts the matrix column for the same role quietly erodes trust in both surfaces.

---
## Cross-checks performed
- **Dedup reads**: prior report `feature-scout-2026-06-08/matching-fit-matrix.md` (all 6 MAT findings), `feature-scout-2026-06-08/INDEX.md`, `harness-learnings.md` W1/W3/W6/W7/W11/W12/W13 close-out entries, and the UI-bug scan's `ui-bug-scan-2026-06-08/candidate-job-matching-fit-matrix.md` (4 findings: re-weight blanking, table a11y, bulk-add dup-id lookup, median rounding) — no overlap with the 4 above.
- **MAT1–MAT6 verified shipped in code**: WeightsPanel + `/api/match` weights forwarding (MAT1), `ColumnStats` + `rowStrong` pills (MAT2), Results bulk shortlist + matrix selectMode/`addSelected` (MAT3), `exportCsv` on both surfaces via export-utils (MAT4), `JobCompare` (MAT5), `minFit` + `sortCol` (MAT6). None re-proposed.
- **Weights persistence seam**: grep `localStorage` in `sub_match` → none; grep `weights` across `app/` → no store/db writer; `runMatch` omits weights on fresh runs; `/api/matrix` + `matrix_cli` + matrix cache key are weight-blind. → Finding 4.
- **match_reasoning outputs fully rendered?** Yes — `ReasoningPanel`/`ResolvedReasoning` (MatchShared.tsx:48-82) renders verdict, strengths, gaps, interviewProbes, source badge, cached suffix. No dark output. But the `lang` parameter of `generate()` is dead code in this path (reasoning_cli has no `--lang`; reasoning-run.ts never passes it; cache key has no lang axis) → Finding 1.
- **Matrix staleness**: NOT a gap — `/api/matrix` cache is content-addressed (sha1 of exact profiles+jobIds+jobs JSON), so profile/job edits self-invalidate; placements are re-read on every response, cached or not.
- **Reverse matching parity**: covered — job→candidates exists as the `?job=`-scoped matrix ("Rank candidates" from Pipeline) plus the Decisions group-eval; no net-new gap worth a finding.
- **KO reasons**: `matrix_cli.py:92` discards `_reasons` from `ko_filter`; `Cell` carries only `{score, blocked}`; MatrixTab tooltip says "Blocked (KO)" with no cause, while the Match tab surfaces `meta.koReasons` → Finding 2.
- **`?job=` deep-link**: grep `get("job")` across `app/` → consumed by JobsTab, DecisionsTab, MatrixTab, interview/compare — never by `sub_match`, though MatrixTab `open()` sets it and `tabs.ts` documents it as the job deep-link param → Finding 3.
- **Adjacent-scout collisions avoided**: auto-score inbound applicants (automation scout — not touched), profile-list UI (profile scout — not touched), soft_signals/sanityChecks surfacing (scoring-engine scout — distinct from hard-gate KO reasons in Finding 2; verified `ko_filter` is matching.py's KO path, not the analysis scorer's soft signals).
- **i18n catalogs**: `messages/en.json` + `messages/cs.json` exist; match/matrix UI fully keyed (next-intl `useTranslations` throughout both tabs). Server-supplied English KO labels interpolated into localized sentences noted inside Finding 2's localize-by-key proposal.
