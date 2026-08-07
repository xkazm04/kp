# L1 theoretical — Eva Marešová (eng hiring lead) × cv-analysis-jobfit

- **Run:** 2026-07-02-full · main @ `3395b4c` · cert_level **L1** (code-derived surface model, no browser)
- **Verdict:** **L1-conditional** — structurally sound and unusually honest about its own
  limits, but one major carries to L2: the GitHub evidence she supplies never reaches the
  headline verdict she has to defend.
- **Journey grounding score:** **6/9** main analyze surface · **4/6** GitHub deep-dive
  (shared audit with Petra's report §3; Eva-specific deltas below)
- **Estimated time saved (if it all worked):** **~40 min per engineer CV** (manual CV+JD
  deep read plus a by-hand skim of the candidate's public repos ≈ 45–60 min → ~10 min run
  + read both tabs) · confidence **medium** — discounted because she must still mentally
  merge the CV verdict and the GitHub tab herself (the major below).
- **Ship bar:** "public product path" — same evidence as Petra's report §7 (workspace
  stamping OK; content-keyed cache seam PET-CVJF-07; no comms, no landing).

---

## 1. Reachability (resolved before judging)

Eva = internal user; her binding is primarily the **Dev** tab plus **Analyze** and
**Matrix** for engineer CVs. This journey lives entirely on Analyze/History —
inside her set (`app/features/tabs.ts:19-23,122-127`, no role gating). Fixtures: 105
seeded analyses, Gemini live (run checkpoint). The GitHub deep-dive route
(`/api/github-analysis`) is reachable from her Analyze form (`AnalyzeForm.tsx:141-168`).
**No `unreachable` tags needed.** Note: her dev-case scored criteria (case authoring,
live work) are **out of this journey's scope** — only her transferable criteria
(evidence-backed verdict, director-defensibility, AI-awareness, time-saved, language) are
applied below.

## 2. Surface model — Eva-specific deltas

Shared chain (intake → `/api/analyze` → background task → `pipeline.jobfit.cli` → Gemini
prompt → result panels) is documented with file:line in Petra's report §2. What matters
extra to Eva:

- **GitHub input → deep-dive.** The handle field (`AnalyzeForm.tsx:141-168`) triggers a
  *parallel, client-fired* run at submit (`useAnalyzeForm.ts:343-372,405`) →
  `executeGithubAnalysis` (`runAnalysis.ts:115-160`, JD read from the same source as the
  main analysis, file-extracted first `:128-141`) → `/api/github-analysis`
  (`app/api/github-analysis/route.ts:140-292`): REST harvest (user, repos, languages,
  top-3 README/commits/file names `:477-502`), deterministic job-fit signals over a fixed
  27-skill alias taxonomy (`:111-138,404-455`), then a **conservative Gemini repo-signal
  review** (`:620-633` — "You are NOT reading the source code…"), with an explicit
  evidence basis + limitations (`:252-256,540`) and a fail-loud path when all repo signals
  came back empty (`:590-604` — refuses to let the model fabricate from nothing).
- **Result integration.** The deep-dive renders as a tab in the same `ResultPanel`
  (`ResultPanel.tsx:61-70,170-178`), persists onto the saved analysis row (GH1 PATCH,
  `useAnalyzeForm.ts:289-302`) and is restored after refresh (`:308-332`); a done
  deep-dive rides "Add to pipeline" as evidence (`ResultPanel.tsx:127-135`). **But it
  never enters the analysis itself** — `analyze_profile_with_gemini` has no GitHub
  parameter (`gemini.py:439-448`), so the headline job-fit score/summary/risk-flags
  cannot cite repo evidence.
- **Verification layer she'd audit.** Matched-skill trust gate `verify_skills_in_cv`
  (`pipeline.py:200-210`, `ats.py:105-141`); score-contract reconciliation (dial pinned
  to component sum, divergence flagged into the trust ledger — `format.ts:457-468`,
  `pipeline.py:998-1030`); evidence tooltips on matched chips (`SkillChips.tsx:28-43`).

## 3. Grounding audit — Eva's read

Main surface **6/9** (table in Petra's report §3). The Eva-weighted misses:

- **#7 GitHub evidence absent from the main prompt** — for engineer hires this is the
  single strongest hard evidence she holds, and it is structurally excluded from the
  verdict (`gemini.py:439-448`; the deep-dive is fired separately at
  `useAnalyzeForm.ts:350`). → EVA-CVJF-01, major.
- **#8 structured JD comp band unjoined** (`analyze-run.ts:130,184` vs the group-eval
  path that does join it, `group-eval-run.ts:393,475`) — matters when she debates comp
  with a director; the JD *text* band still reaches the prompt when it's written in.
- **Vocabulary split:** the GitHub tab's skill space is a hand-rolled 27-bucket alias map
  (`github-analysis/route.ts:111-138`), the CV tab's is `data/taxonomy.json` (176 terms)
  — two adjacent tabs can name the same skill differently or disagree on coverage.
  Folded into EVA-CVJF-01; the reconciliation sweep should also see this.

GitHub deep-dive surface itself: **4/6** — and the two misses are *disclosed in-product*
(`limitations`, `evidenceBasis`), which is exactly the honesty she trusts.

## 4. Cognitive walkthrough (rubric questions, in character)

1. **Will I try it?** Yes — Analyze is where engineer CVs go; the GitHub column invites
   the handle I always have (`AnalyzeForm.tsx:141-168`), and a handle alone is a valid
   run (GH3, `useAnalyzeForm.ts:374-409`).
2. **Notice the controls?** Yes. Statuses per column; the Gemini-missing preflight
   (`AnalyzeForm.tsx:172-176`) tells me *before* submit that a doomed run is doomed.
3. **Control ↔ effect?** The Analyze button fans out CV pipeline + GitHub deep-dive; the
   GitHub tab appearing only when I supplied a handle matches intent
   (`ResultPanel.tsx:61-70`). Same soft-timeline caveat as Petra's §4.3.
4. **Feedback?** Run tracked, cancellable, refresh-safe; a JD that couldn't be read for
   the deep-dive is *told to me* as a warning instead of silently running JD-blind
   (`runAnalysis.ts:132-146`) — good. GitHub errors are retryable alone without re-paying
   the whole pipeline (GH5, `useAnalyzeForm.ts:343-372`).
5. **Does the result clear my bar?** *"Obhájím to před ředitelem? Čím?"* — mostly:
   matched chips are verified against the CV and carry evidence tooltips; the score dial
   cannot contradict its factor bars; withheld skills are disclosed; the repo review
   cites what it looked at and refuses to overreach. What does NOT clear the bar: the
   **headline verdict ignores the repo evidence entirely** — if the CV says "Kubernetes"
   and the repos show zero infra work, job_fit still scores on the CV narration; the
   contradiction only exists if I open both tabs and reconcile them myself. Also
   `job_fit.score` is a bare clamped LLM scalar (`pipeline.py:696`) with no deterministic
   counterpart — nothing reconciles it against the keyword-coverage percent computed two
   panels down (`ats.py:66`).
6. **Trust enough to sign it?** The verification *architecture* (gate + reconciliation +
   disclosure) is precisely my taste — grounded-but-modest beats fluent-but-fabricated.
   Residual: the skill gate verifies against Gemini's **own** extraction (`raw_text`,
   `pipeline.py:160-166,200-202`), not the independent pypdf text — circular if the model
   hallucinates at extraction. Low likelihood, but it's my kind of seam to name.

## 5. Eva's scored acceptance criteria (this journey's applicable subset)

| Criterion | L1 result | Evidence |
|---|---|---|
| completion — CV+JD(+GitHub) → evaluation, no dead-end | **pass (structural)** | §2 chain; GitHub-only run also valid (`useAnalyzeForm.ts:374-409`) |
| trust — verdict backed by rubric + concrete evidence | **partial** | chips evidenced + gated (`ats.py:105-141`, `SkillChips.tsx:28-43`); but the headline verdict can't cite the repo evidence (EVA-CVJF-01) and jobFit.score has no deterministic cross-check (EVA-CVJF-03) |
| trust — defensible to an eng director | **partial** | provenance dossier + trust ledger exist (`ReportActions`, `QualityStrip`); defense requires manually merging two tabs |
| trust — AI use acknowledged, not pretended away | **pass** | model + engine named (`AnalysisMetadata`, `pipeline.py:288-295`); repo review discloses its basis and limits (`github-analysis/route.ts:252-256,620-633`) |
| senior-quality — evidence over vibes | **pass-designed** | no-invention rule (`gemini.py:537`), withheld-skill disclosure, fail-loud empty-signal path (`route.ts:590-604`); live prose quality is L2's |
| time-saved — faster AND better signal | **pass-designed, discounted** | ~40 min/CV promised; the manual merge of CV verdict × repo evidence claws some back |
| language — Czech authoring/eval UI | **partial** | chrome + narrative cs; deterministic probe/ledger text English (shared finding PET-CVJF-02) |
| (dev-case criteria: case authoring, brevity of live work) | **n/a** | out of this journey's scope — judged in the dev-case journeys |

## 6. Findings (detail in `cv-analysis-jobfit.findings.json`)

| id | sev | type | title |
|---|---|---|---|
| EVA-CVJF-01 | **major** | quality-gap | GitHub evidence never reaches the headline verdict — a parallel panel, not an input; plus two disjoint skill vocabularies across adjacent tabs |
| EVA-CVJF-02 | minor | trust | Matched-skill verification is circular: it checks the LLM's claims against the LLM's own extracted text, not the independent pypdf text |
| EVA-CVJF-03 | minor | quality-gap | `job_fit.score` is a bare clamped LLM scalar — no deterministic reconciliation against keyword coverage (unlike the main score's component-sum contract) |
| EVA-CVJF-S1 | strength | trust | The GitHub deep-dive is honest by construction: named evidence basis, disclosed limits, conservative prompt, and a fail-loud refusal to fabricate from empty signals |
| EVA-CVJF-S2 | strength | trust | Score contract: the dial is pinned to the component sum and any divergence is written into the trust ledger — a director-proof property |
| EVA-CVJF-S3 | strength | trust | JD-degradation is disclosed, never silent: a deep-dive that lost its JD says so as a warning beside the result |

Shared findings judged in Petra's file and not duplicated here: PET-CVJF-01 (silent
save), PET-CVJF-02 (English decision-layer strings — hits Eva when defending in Czech),
PET-CVJF-05 (simulated progress), PET-CVJF-06/07 (polish). Suppressed per
`accepted-gaps.md`: none applicable. Keyless run = `scope_note` (keys live this run).

## 7. Verdict

**L1-conditional.** The verification architecture is the best-grounded AI surface in the
app and materially improved since l1-2026-06-19 (the LLM-narrated-chips seam is now gated
at the source). The major that carries: for exactly her population — engineers — the
strongest evidence source is collected, rendered, persisted… and excluded from the
verdict. Fix is an integration, not a rebuild (the deep-dive result already exists
server-side at PATCH time).

**L2 priorities:** (1) run a real engineer CV + ČS JD + real GitHub handle; check whether
the CV tab and GitHub tab visibly disagree on skills/coverage (vocabulary split) and
whether the headline summary ever references repos (it structurally can't — confirm);
(2) adversarial matched-chip check incl. the raw_text circularity (plant a skill in a CV
the model might over-extract); (3) jobFit.score vs keyword-coverage% divergence on a weak
candidate; (4) deep-dive latency + the GH retry path under GitHub rate-limiting;
(5) Czech report readability for a director (how much English decision-layer text
surfaces on one screen).

## 8. Character feedback — Eva, first person (cs)

> Nahraju CV inženýra, přihodím jeho GitHub, vyberu JD. Jedním tlačítkem to rozjede
> pipeline i hloubkový pohled na repa — a když GitHub spadne na rate-limit, můžu ho
> zopakovat samostatně, bez placení celé analýzy znova. To je dospělé chování.
>
> Co mě potěšilo, a to říkám málokdy: ten nástroj **přiznává, co nevidí**. U code review
> stojí "nečtu zdrojový kód, jen README, commity a názvy souborů" a když z GitHubu nic
> nepřijde, radši selže nahlas, než aby model fabuloval sebevědomé hodnocení z ničeho.
> Skóre nemůže lhát vlastnímu rozpadu — ciferník je přibitý k součtu složek a nesoulad se
> propíše do ledgeru. Vymyšlené dovednosti se zadrží a vypíšou. Tohle je přesně "obhájím
> to před ředitelem — čím? — tímhle."
>
> A teď to hlavní: dám vám GitHub — nejtvrdší důkaz, který o kandidátovi mám — a verdikt
> ho **nepoužije**. Vhodnost se spočítá z CV narativy, repa visí vedle jako druhá záložka,
> a když CV tvrdí Kubernetes a repa ukazují nula infra, tak si ten rozpor musím najít a
> složit já. To je práce, kterou jste mi slíbili vzít. Navíc každá záložka mluví jiným
> slovníkem dovedností — jedna má taxonomii, druhá ručně psaných 27 kbelíků. Řediteli
> nemůžu ukázat dvě tabulky, které se neshodnou na tom, co je "match".
>
> Adopce? Pro screening inženýrských CV ano, podmíněně — architektura důvěry je tu
> nejlepší, jakou jsem v těchhle nástrojích viděla, a ušetří mi to reálně přes půl hodiny
> na kandidáta. Ale dokud verdikt neintegruje důkazy z kódu, budu ho brát jako dobrý
> první názor, ne jako hodnocení, pod které se podepíšu.
