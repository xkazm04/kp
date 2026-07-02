# L1 theoretical — Tomáš Dvořák (hiring manager) × group-eval-fairness

- **Run:** 2026-07-02-full · main @ 3395b4c · cert level: **L1** (no browser)
- **Journey:** `uat/journeys/group-eval-fairness.md` · language: cs
- **Verdict: L1-conditional** — the job completes structurally and beats his 15-minute
  bar on paper, but two majors carry forward (English AI narrative in a Czech
  workspace; cross-track "apples-to-apples" presentation).
- **Grounding score (journey): 15/22 ≈ 7/10** (compare narrative 6/10 · per-candidate
  reasoning 4/6 · fairness weight proposer 5/6 — details below)
- **Time saved (designed): ~40 min per shortlist decision · medium confidence**
  (~60 min reading CVs + email ping-pong → ~12–15 min in the modal incl. one
  30–130 s cold generation; cached re-open is seconds. L2 must confirm latency.)

---

## 1 · Surface model (code-derived, import chain followed)

**Entry:** Decisions tab is a first-class workspace tab (`app/features/tabs.ts:13,103`),
no per-role gating. `DecisionsTab` groups pending `approvalKind === "decision"` entries
per role (`app/features/sub_decisions/DecisionsTab.tsx:119-150`) and renders one
`RoleDecisionRow` per role with candidate chips + the **Group evaluation** button
(`app/features/sub_decisions/RoleDecisionRow.tsx:48-61`; label cs: "Skupinové
hodnocení", `messages/cs.json:1392`).

**Generate chain:** button → `openGroupEval` (`DecisionsTab.tsx:216-241`) →
`startTask("group_eval", { roleKey, roleTitle, jobId, candidates, governanceMode })`
(`DecisionsTab.tsx:239`) → task registry (`app/_lib/tasks.ts:119-122`) →
`runGroupEval` (`app/_lib/group-eval-run.ts:240-488`), which:

- dedupes by identity + sorts by fit **before** the cap of 6 (`group-eval-run.ts:21,251-270`),
- pulls each candidate's stored profile + CV analysis once (`resolveCandidates`, :112-121),
- runs the **deterministic recruiter ranking** in one Python process with
  `--weights-llm --embeddings` (`rankCandidates`, :157-178 → `app/_lib/recruiter-run.ts:21-51`
  → `pipeline/jobfit/recruiter_cli.py` → `recruiter.py:50-90` `rank_candidates_for_job` +
  `recruiter.py:28-47` `fairness_check`),
- runs per-candidate **AI reasoning concurrently** (`group-eval-run.ts:301-311` →
  `app/_lib/reasoning-run.ts:32-105` → `pipeline/jobfit/match_reasoning.py:99-135` prompt),
- lifts each candidate's **own salary expectation** from their CV analysis
  (`salaryExpectationFrom`, `group-eval-run.ts:136-148`),
- sorts **ko-aware** so a must-have-failing candidate never outranks a passer
  (:351-361), crowns a lead only if ko passes (:366), computes **differentiators**
  restricted to role requirements the lead matched and every rival missed
  (:372-380 → `app/_lib/group-eval-differentiators.ts:28-52`),
- runs the AI **"compare all" narrative** (`runGroupCompare`, :183-238 →
  `pipeline/jobfit/group_compare_cli.py:31-61` → `group_compare.py:41-57` prompt,
  deterministic fallback :71-129),
- **seals** the recommendation into the decision chain (:417-441 →
  `app/_lib/decision-record-store.ts:111-157`), and persists the payload
  (`saveGroupEval` → `app/_lib/group-eval.ts:36-52`).

**Read chain:** re-open reads the saved eval via `GET /api/decisions/group-eval?role=`
(`app/api/decisions/group-eval/route.ts:11-23`) — the route never regenerates.

**Modal (`GroupEvalModal.tsx:63-147`):** drift + "top N of M" notices
(`Notices.tsx:7-26`), governance banner (:104-109), `AiVerdict` headline/keyPoints/
recommendation with AI-vs-rule pill (`AiVerdict.tsx:26-67`), `ComparisonTable`
(fit, confidence band, profile, must-have coverage, per-dimension bars, skills matrix
must/nice, salary-vs-band on one shared scale — `ComparisonTable.tsx:112-249`),
`FairnessPanel` (cross-scheme matrix, `FairnessPanel.tsx:14-107`), `PerCandidateTabs`
with verdict/strengths/gaps/interview probes + **inline Advance/Reject**
(`PerCandidateTabs.tsx:74-98`), `Risks` strip (`Risks.tsx:5-23`), re-run footer
(`GroupEvalModal.tsx:76-84`). Inline decide resolves identity → live entry by id and
reuses the queue's CAS path (`DecisionsTab.tsx:476-492`), only flipping the pill if
the action landed (`useGroupEval.ts:27-38`); human advance/reject is sealed as
`human:recruiter` (`app/api/pipeline/[id]/route.ts:249-260`).

## 2 · Grounding audit (AI surfaces)

**A. "Compare all" narrative** (`group-eval-run.ts:192-219` context → `group_compare.py:41-57`) — **6/10**.
Reaches the prompt: real per-dimension percents (:196-203), matched/missing skills
(:204-205), per-candidate verdicts (:206), potential score (:207), candidate salary
midpoint currency-gated against the band (:208-218), role salary band (:195).
Missing: KO status/reasons (a KO-failed rival can be praised without the flag),
confidence band, matched-skill provenance/strength, must-have-vs-nice kinds
(only implicitly via missingSkills), **recruiter locale** (no `--lang` —
`group_compare_cli.py:50` calls `generate(context, provider=…)` though
`group_compare.py:147-149` accepts `lang`).

**B. Per-candidate reasoning** (`group-eval-run.ts:301-311` → `match_reasoning.py:99-135`) — **4/6**.
Reaches: full CV/profile via `writeMatchInput`, the real job incl. recruiter-ingested
corpus (`reasoning-run.ts:50-57`), the deterministic match result, an archetype-aware
lens with anti-boilerplate directive (:102-134). Missing: locale (`group-eval-run.ts:305`
passes no `lang`; default "en" at `reasoning-run.ts:34`), prior pipeline history.

**C. Fairness weight proposer** (`recruiter.py:28-47` → `weight_proposal.py:37-76`) — **5/6**.
Reaches: per-dim scores, must-have provenance, archetype baselines + hard bounds,
potential. Bounded downstream and fails open to the deterministic proposer with the
source disclosed (`FairnessPanel.tsx:36-38`). Missing: locale for rationale notes.

**Verdict: this is NOT "good machinery fed thin context"** — the deterministic feed is
genuinely rich (full breakdown, provenance, salary, requirements). The real grounding
gap is the **language axis** and the narrative's blindness to KO/confidence.

## 3 · Reachability (before judging)

Tomáš binds to Decisions (group eval) among his few tabs — in-set. Dev gate + seeded
pipeline fixture cover him (`uat/env.md:123-124`). The whole journey happens on one
tab → one modal; nothing judged below is outside his set. No `unreachable` tags.

## 4 · Cognitive walkthrough (in character)

1. **Will he try it?** Yes — Decisions is the tab TA points him to; the role row shows
   his candidates as chips and one coral button. His question "kdo z nich je nejlepší?"
   maps 1:1 to "Skupinové hodnocení" (`RoleDecisionRow.tsx:48-61`). ✓
2. **Notice the control?** Yes — one accented button per role; after a run it flips
   to a green "Zobrazit hodnocení" state (`RoleDecisionRow.tsx:52-60`). ✓
3. **Label→effect match?** Good. The governance dropdown next to it
   ("Doporučení AI / Komise / Pořadník", `DecisionsTab.tsx:305-315`,
   `messages/cs.json:1355-1358`) is the one control he'd never touch and doesn't
   need to — safe default. ✓ (minor: it silently applies only to the *next* run)
4. **Feedback while working?** Spinner + "Generuji skupinové hodnocení…" text
   (`GroupEvalModal.tsx:86-89`), honest unavailable/error states (:90-99),
   busy-disabled button. ✓ — but a cold run is 30–130 s with no progress bar; L2 must
   confirm he doesn't bail.
5. **Does the result advance the job?** Strongly, on paper: a bold one-line headline
   naming who leads and why, 3–5 keyPoints, a concrete recommendation
   (`AiVerdict.tsx:36-60`), a ranked table where the leader cell is tinted per row
   (`ComparisonTable.tsx:92-107`), differentiator chips scoped to actual role
   requirements (`group-eval-differentiators.ts:28-52`), and **Advance/Reject right
   in the modal** at the moment of maximum context (`PerCandidateTabs.tsx:74-98`).
   He never reads a raw CV. ✓
6. **Would he stake the pick on it?** Mostly — same dimensions per column, KO pill,
   confidence band, risks named. Two things erode it: the reasoning prose arrives in
   **English** (finding 01) and the career column can silently compare two different
   things (finding 02).

## 5 · Scored acceptance criteria (his fixed lens)

| Criterion | Verdict | Evidence |
|---|---|---|
| completion — review/compare/decide in a few clicks | **pass** | tab → row → button → modal → inline decide (`DecisionsTab.tsx:216-241,476-492`) |
| effort — no recruiter work forced on him | **pass** | zero tagging/scoring inputs anywhere in the chain; everything precomputed (`group-eval-run.ts:240-488`) |
| senior-quality/trust — clear, defensible recommendation | **pass (L2 to confirm prose)** | topPick + headline + recommendation + differentiators (`group-eval-run.ts:462`, `AiVerdict.tsx:53-60`) |
| trust — same dimensions, apples-to-apples, override allowed | **CONDITIONAL** | one table, same rows for all (`ComparisonTable.tsx:188-244`) — but the career dimension mixes potential vs work-history semantics under one label (finding 02); override = inline decide ✓ |
| senior-quality — interview questions he'd ask | **pass (design)** | per-candidate `interviewProbes` grounded in real gaps (`PerCandidateTabs.tsx:126`, `match_reasoning.py:131`) |
| clarity — one clear decide action + confirmation | **pass** | Advance/Reject buttons → outcome pill, no fake success on stale entries (`useGroupEval.ts:27-38`) |
| time-saved — inside ~15 min, beats reading 3 CVs | **pass (design) — L2 confirms latency** | cached re-open instant; cold run 30–130 s budget (journey note; `group-eval-run.ts:293-311` concurrency) |
| language — plain Czech, no jargon | **FAIL → major** | modal chrome fully Czech (`messages/cs.json:1535-1622`) but verdicts, headline, keyPoints, risks, summary, governance note are English (finding 01) |

## 6 · Findings raised through his lens

- **GEF-L1-01 (major)** — AI narrative + risks + summary arrive in English inside a
  Czech UI; the lang plumbing exists and is simply never passed on this path.
- **GEF-L1-02 (major, shared with Lucie)** — flat cross-track ranking presented as
  apples-to-apples; the career row label comes from whichever candidate is first.
- **GEF-L1-07 (minor)** — "Unique strengths (lead)" chips keyed by display label,
  not entryId; duplicate names mis-attribute them (`PerCandidateTabs.tsx:110`).
- Strengths S1–S5 (see findings.json): inline decide with CAS, fit-sorted cap +
  "top N of M" honesty, drift warning, currency-honest salary row, requirement-scoped
  differentiators.

## 7 · Character feedback (first person)

> Tak jo. Otevřu Rozhodnutí, u role vidím svých pět lidí, jedno tlačítko — "Skupinové
> hodnocení". Kliknu, počkám (prý až dvě minuty — to je na hraně, ale přežiju to
> jednou, ne pokaždé), a dostanu přesně to, co chci: kdo vede, proč, čím se liší od
> dvojky, a rovnou tam mám tlačítko Postoupit. Nemusím číst jediné CV, nemusím nic
> tagovat. Tohle je poprvé, co mi HR nástroj šetří čas místo aby mi ho bral —
> odhadem 40 minut na jedno obsazení.
>
> Ale dvě věci. Za prvé: proč na mě ta hlavní věta — ta jediná, kterou fakt čtu —
> mluví anglicky, když celý zbytek obrazovky je česky? "Klára leads 5 candidates on
> overall fit" — půlka mých vedoucích poboček si to bude překládat mobilem. To je
> trapné a zbytečné, čeština tam evidentně jde všude jinde. Za druhé: když mi do
> jednoho sloupce dáte studenta s "potenciálem 72" a vedle seniora s "kariérou 72",
> vypadá to jako stejné číslo, ale není. Já to nepoznám — a právě proto tomu nástroji
> mám věřit já, ne on mně.
>
> Verdikt: beru, budu to používat — jakmile to na mě přestane mluvit anglicky.
> Kolegovi bych to ukázal už teď, ale s omluvou u té první věty.

**L1-conditional.** Majors GEF-L1-01, GEF-L1-02 carry to L2; top L2 questions: real
narrative quality + language in a cs session, cold-run latency vs his 15 minutes,
career-row legibility on a mixed pool.
