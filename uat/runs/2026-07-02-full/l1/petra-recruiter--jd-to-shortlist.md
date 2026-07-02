# L1 theoretical — Petra Nováková (Corporate Recruiter) × jd-to-shortlist

- **Run:** 2026-07-02-full · main @ 3395b4c · cert level: **L1** (no browser)
- **Verdict: L1-conditional** — the job structurally completes (ranked, KO-filtered,
  provenance-honest shortlist per role; ingested jobs rank; reasoning exists and is
  cache-correct) but the reasoning narrative is NOT on the shortlist surface, and the
  analysis-sourced reasoning path feeds the prompt no CV narrative to cite.
- **Journey grounding score:** ranking **4.5/6** · reasoning **6/8 (profile-sourced) / 4/8 (analysis-sourced)**
- **Estimated time-saved-if-it-all-worked:** ≈ **2.5–3 h per role-shortlist** (manual ≈ 3–4 h
  screening+write-up per role → ≈ 25–40 min incl. the reasoning detour) · confidence **medium**.
  Without finding JTS-L1-01 (reasoning on the shortlist itself) this rises to <20 min per role.

## 1 Surface model (code-derived, import-chain-followed)

**Path A — JD → ranked candidates (the journey's core):**
- Jobs tab (`app/features/sub_jobs/JobsTab.tsx:26`) → job list → row click / ingest auto-open
  (`JobsTab.tsx:51-75,105-115`) → `JobPostingModal` → **candidates** tab
  (`app/features/sub_jobs/JobPostingModal.tsx:301,356-357`) → `RecruiterCandidates` autoLoad
  (`app/features/sub_jobs/RecruiterCandidates.tsx:53-84`) → `GET /api/jobs/[id]/candidates`
  (`app/api/jobs/[id]/candidates/route.ts:9`) → `buildCandidatePool()` (v2 profiles + saved
  analyses, `app/_lib/candidate-pool.ts:46-66`) → `rankPoolForJob` (`app/_lib/recruiter-run.ts:21`)
  → `pipeline/jobfit/recruiter_cli.py:27` → `rank_candidates_for_job`
  (`pipeline/jobfit/recruiter.py:50-90`: ko_filter + score_job per candidate) + cross-scheme
  fairness matrix (`recruiter.py:28-47`).
- Row affordances: ScoreBadge + confidence band w/ drivers + fit tier + skills chips with
  provenance (`RecruiterCandidates.tsx:446-545`), "Reach out" / "+ pipeline"
  (`useReachOut` / `useAddToPipeline`, persisted server-side `route.ts:37-54`), Fair Rank +
  Pool Fit toggles + fairness audit CSV (`RecruiterCandidates.tsx:171-207,281-345`),
  not-eligible cohort with per-candidate KO reasons + near-miss flag (`RecruiterCandidates.tsx:252-278`).
- **Ingested jobs rank:** the route passes the DB job record directly (`route.ts:27-35`,
  `recruiter_cli.py --job-json` at `recruiter_cli.py:35,46`). DoD item satisfied structurally.

**Path B — Match tab (candidate → jobs; the inverse direction):**
- `app/features/sub_match/MatchTab.tsx:64-90` `runMatchFor` → `POST /api/match`
  (`app/api/match/route.ts:30`) → `writeMatchInput` (`app/_lib/match-input.ts:32` — profile
  payload written IN FULL, `match-input.ts:40-44`) → `match_cli` with the **live DB corpus**
  as `--jobs-json` (`route.ts:44-52`). Recruiter weight re-rank (`route.ts:57-63`, WeightsPanel).
- Per-job card: weight-aware ScoreBreakdown (server-computed, `MatchShared.tsx:160-198`;
  `pipeline/jobfit/matching.py:623-640`), bulk shortlist top-N → pipeline (`Results.tsx:135-146,208-254`).

**Path C — "Explain fit" reasoning (the defensible narrative):**
- ONLY two affordances app-wide (grep-verified): `MatchCard.tsx:128-137` (Match tab, via
  background task `MatchCard.tsx:58-67`) and the Matrix cell popover (`MatrixTab.tsx:237-270`).
- Chain: `/api/match/reasoning/route.ts:10` → `runReasoning` (`app/_lib/reasoning-run.ts:32`)
  → `reasoning_cli` with `--lang` (cs/en, `reasoning-run.ts:34,40-48`) + live corpus
  (`reasoning-run.ts:49-57`) → prompt `pipeline/jobfit/match_reasoning.py:99-135`, persona
  `match_reasoning.py:24-41`. Cache: 5-axis content-addressed key
  (`app/_lib/reasoning-cache-key.ts:45-67`; prompt-version drift CI-pinned, `reasoning-run.ts:12-15`).
- **Degrade seam:** past the `ai_candidates` allowance → `--no-llm` (`reasoning-run.ts:58-63`),
  same path as a missing key/provider failure (`match_reasoning.py:292-299`). Disclosed in UI
  as a source chip "LLM" vs "pravidlové" + "z mezipaměti" (`MatchShared.tsx:72-77`,
  `messages/cs.json` keys verified). Deterministic fallbacks stay UNCACHED so they upgrade
  when the provider returns (`reasoning-run.ts:95-100`).

## 2 Grounding audit (AI surfaces)

**Surface A — job→candidates ranking (deterministic engine): 4.5/6**
| Source | Reaches the scorer? |
|---|---|
| Full v2 profiles | ✓ full payload (`candidate-pool.ts:53-55`, `recruiter_cli.py:61`) |
| Saved CV analyses | ~ v2Profile yes; legacy fallback is a 6-field stub with **archetype hardcoded "bau"** (`candidate-pool.ts:31-43`) |
| Real job record (incl. ingested) | ✓ (`route.ts:30-35`) |
| Job hard gates (lang/edu/seniority/work-mode) | ✓ (`matching.py:241-288`) |
| Pipeline/outreach state | ✓ decorated server-side (`route.ts:43-54`) |
| Prior decisions/outcomes | ✗ never reach the ranking |

**Surface B — "Explain fit" LLM reasoning: 6/8 profile-sourced, 4/8 analysis-sourced**
| Source | Reaches the prompt? |
|---|---|
| Candidate tags (skills/seniority/langs/years/traits) | ✓ (`match_reasoning.py:52-64`) |
| Real CV narrative (summary/highlights/workLinks) | ✓ profile path (`transform.py:192-193`); **✗ analysis path** — `CandidateInput` has no such fields (`match-candidate.ts:4-24,41-59`), so `candidate.summary`/`experienceHighlights` arrive empty while the prompt DEMANDS citing them (`match_reasoning.py:132-134`) |
| Job must/nice requirements | ✓ (`match_reasoning.py:79-88`) |
| Full JD description text | ✗ only title/seniority/family/requirements |
| Deterministic scores + matched/missing | ✓ (`match_reasoning.py:89-96`) |
| Industry/market lens | ✓ role family + location persona (`match_reasoning.py:24-41`) |
| Recruiter locale (cs) | ✓ MAT1 (`MatchCard.tsx:61`, `reasoning/route.ts:15`, `i18n.py:47-62`) |
| Pipeline history / soft signals | ✗ |

## 3 Reachability (resolved before judging)

Petra binds to the authed workspace: **Jobs, Match, Analyze, Pipeline, Schedule, Interview,
Onboarding** (`uat/characters/petra-recruiter.md` Surface binding; no per-role nav gating,
`app/features/tabs.ts:98-153`). Jobs tab + modal + Match tab: **reachable**. The Matrix tab —
the only job-side reasoning affordance — is **outside her declared binding** (Insights group,
`tabs.ts:134-141`); the Pipeline's "Rank candidates" deep-link does route there
(`MatrixTab.tsx:90-92`), so it is not `unreachable`, but it is not where she works.
Fixture gates: pool must be non-empty (seeded profiles/analyses per `env.md`), else the scan
returns the empty note (`route.ts:21-23`) — see JTS-L1-07. Gemini/provider key gates LLM
reasoning quality; keyless → deterministic template (scope_note per journey).

## 4 Cognitive walkthrough (in character, over the model)

1. *Will I try the right action?* Open role → modal → "Kandidáti" tab is visible and labeled
   (`JobPostingModal.tsx:296-320`); autoLoad even scores without a click. ✓
2. *Will I notice the control?* "Ohodnotit uložené kandidáty pro tuto roli" is the only button
   in the empty panel (`RecruiterCandidates.tsx:96-110`). ✓
3. *Label→effect match?* ✓ — and the two-column early-career/experienced split is explained
   inline (`RecruiterCandidates.tsx:205,381-386`).
4. *Feedback after acting?* Loading state, per-candidate add/reach state persisted across
   sessions (`route.ts:37-54`), aria-live announces (`RecruiterCandidates.tsx:168-170`). ✓ —
   though the announce strings are hardcoded English (`useAddToPipeline.ts:128,131`).
5. *Does the result advance my job at my bar?* **Half.** I get a ranked, KO-explained,
   provenance-marked list — but the "reason next to each candidate I can hand a manager"
   (verdict/strengths/gaps/probes) is not on this surface; I must detour per candidate to
   Match (inverse direction: run the candidate, find this job in their list, `MatchCard.tsx:128`)
   or the Matrix popover outside my usual tabs. That is a per-candidate re-entry loop —
   my acceptance criterion "without a dead-end or a re-entry loop" fails as designed.
6. *Do I trust it enough to put my name on it?* The scoring layer earns trust: partial-match
   `~` chips (`MatchCard.tsx:183-197`), confidence drivers in plain sight (`MatchCard.tsx:167-171`),
   KO reasons per person, skipped candidates surfaced (`recruiter_cli.py:66-71`). The reasoning
   layer: for profile-sourced candidates the prompt gets real CV highlights; for
   analysis-sourced candidates it's told to cite CV facts it never receives — that's where a
   hallucinated skill would come from, and one of those ends my adoption.

## 5 Scored acceptance criteria

| Criterion | L1 result |
|---|---|
| completion — JD → ranked shortlist, no dead-end/re-entry | **✗ conditional** — ranked list ✓; reasoning requires per-candidate re-entry via Match/Matrix (JTS-L1-01) |
| senior-quality/trust — reasoning cites ≥1 concrete CV fact, no interchangeable boilerplate | **~** — structurally demanded by prompt (`match_reasoning.py:132-134`) for profile path; **impossible by construction** on analysis path (JTS-L1-03); live check = L2 |
| trust — zero hallucinated skills | **~** — matched/missing computed deterministically ✓; narrative risk concentrated on the ungrounded analysis path; L2 |
| senior-quality — score carries drivers | **✓** — ScoreBreakdown w/ weights+contributions (Match tab), confidence drivers everywhere; jobs-side card lacks the per-dimension bar (data present, UI omits — JTS-L1-06) |
| trust — salary shows basis | **✓ (scoped)** — the band shown is the job record's own band (`MatchCard.tsx:140-150`), not an AI estimate |
| clarity — explicit confirmation of what/who | **✓** — per-candidate persisted state; minor: no aggregate band after bulk add on Match tab (JTS-L1-10) |
| time-saved — faster than manual | **✓ conditional** — minutes for the ranking; the reasoning detour costs ~2–4 min/candidate (JTS-L1-01) |
| language — cs UI + cs reasoning | **~** — UI fully cs (verified in `messages/cs.json`); LLM narrative cs ✓ (MAT1); engine fragments (KO reasons, drivers, assumptions) and the deterministic fallback are English-only (JTS-L1-05) |

## 6 Findings (this character; full schema in jd-to-shortlist.findings.json)

- **JTS-L1-01 · major · missing-feature/effort** — no "Explain fit" on the job→candidates
  shortlist; reasoning only on Match tab + Matrix popover. `RecruiterCandidates.tsx` (whole
  card, no reasoning call — grep: only `MatchCard.tsx:61`, `MatrixTab.tsx:244`).
- **JTS-L1-03 · major · quality-gap (senior-quality)** — analysis-sourced reasoning has no CV
  narrative to cite. `match-candidate.ts:41-59` vs `match_reasoning.py:132-134`. Note: the
  Match tab **defaults to the analysis source when no profiles exist** (`MatchTab.tsx:44`).
- **JTS-L1-05 · minor · confusion (language)** — English engine fragments in the cs UI
  (`matching.py:256-286,563-585,679+`; deterministic fallback en-only `match_reasoning.py:288-289`).
- **JTS-L1-09 · minor · clarity** — degrade chip says "pravidlové" but never WHY (allowance vs
  key vs provider error), `reasoning-run.ts:58-63` + `MatchShared.tsx:72-77`.
- **JTS-L1-10 · minor · clarity** — Match-tab bulk shortlist lacks the aggregate completion
  band Matrix has (`Results.tsx:135-146` vs `MatrixTab.tsx:110-113,326-331`).
- Shared ship-bar finding JTS-L1-04 (tenancy) and strengths JTS-S1..S3 — see findings.json.

**What passed (protect these):** live-corpus hand-off on all three routes (ingested job ranks
end-to-end); 5-axis reasoning cache with honest non-caching of fallbacks; provenance/partial-
match/confidence-driver honesty; KO reasons + near-miss + skipped-candidate disclosure;
persisted sourcing state on the ranking (`route.ts:37-54`).

## 7 l2_priority (what live must confirm for me)

1. Profile-sourced "Explain fit" on a real ČS role: cites this candidate's CV facts, zero
   hallucinated skills, Czech narrative, no boilerplate shared across two candidates.
2. Analysis-sourced reasoning: does it hallucinate specifics it was never given?
3. Wall-clock to assemble top-5 WITH reasoning via the detour (adoption threshold).
4. Ingested (non-seed) job ranks + reasons end-to-end; cold 30–130 s tolerated, cached fast.

## 8 Character feedback — Petra, first person (cs)

> Tohle je poprvé, co mi „AI matching" ukázal, PROČ je někdo nevhodný — u každého vyřazeného
> vidím důvod, u částečné shody vlnovku, u jistoty rozptyl s vysvětlením. To je poctivé a
> chci to pochválit: tohle bych podepsala. Ingestnu inzerát a role se hned skóruje proti
> reálné databázi, ne proti nějakému starému seedu — dobře.
>
> Ale ten hlavní slib — „seznam, který pošlu manažerovi a obhájím" — mi nástroj dává jen
> napůl. U role vidím pořadí a skóre, jenže zdůvodnění (verdikt, silné stránky, mezery,
> otázky na pohovor) si musím naklikat OBRÁCENĚ: přes kandidáta v záložce Match, pro každého
> zvlášť, a tu roli si v jeho seznamu znovu najít. Pět kandidátů = pět koleček. *A stalo se
> vůbec něco?* — tady naopak vím, co se stalo, jen se to děje na špatné obrazovce.
>
> A jedna věc mě fakt znervózňuje: když kandidát přijde z uložené analýzy (což je můj běžný
> případ), model dostane jen štítky — žádné shrnutí, žádné highlights z CV — a přitom má
> příkazem „cituj konkrétní detail z CV". Z čeho asi bude citovat? Jestli si něco vymyslí,
> končím. Tohle chci vidět naživo, než tomu dám jméno. Čeština funguje u hlavního textu,
> ale důvody vyřazení a „assumptions" na mě vyskakují anglicky — manažerovi to takhle
> přeposlat nemůžu. Verdikt: použitelné, slibné, ještě ne obhajitelné bez práce navíc.
