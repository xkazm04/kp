# L1 (theoretical, code-grounded) — Eva Marešová, Engineering Hiring Lead

Run: l1-2026-06-19 · Character: eva-eng-hiring-lead · Mode: L1 (no browser) · Language: cs (internal)

Journeys walked: **cv-analysis-jobfit**, **dev-case-hire**.

Surface model built by following the import chain from each affordance to the
Python pipeline prompt that backs it; cited `file:line` throughout. Reachability
resolved against the seeded local DB (`data/kp.sqlite`).

---

## Per-journey verdicts

| Journey | Verdict | Blockers | Majors | Minors | Polish | Strengths |
|---|---|---|---|---|---|---|
| cv-analysis-jobfit | **L1-pass** | 0 | 0 | 2 | 0 | 3 |
| dev-case-hire | **L1-conditional** | 0 | 1 | 2 | 0 | 4 |

dev-case-hire is L1-conditional, not L1-pass: it is structurally complete and
the machinery is excellent, but one **major** carries forward — the
candidate-facing skill-match honesty gap is shared with the analyze journey, and
the eval-reading half is currently **unpopulated** in the seed (no published case
+ submission), so its job-impact verdict must be confirmed live at L2.

---

## Reachability resolution (resolved BEFORE judging)

Eva is an internal user; the dev gate (`kp_dev_authed=1`) opens the authed
workspace and there is **no per-role nav gating** — so her reachable set is
"is the tab seeded with data". Against `data/kp.sqlite` on 2026-06-19:

- **Analyze + History + Matrix** (cv-analysis-jobfit): `analyses` = 100,
  `jobs` = 100, `jds` = 1. History is non-empty, Matrix has candidates+positions.
  **Fully reachable + populated.**
- **Dev tab** (dev-case-hire authoring): reachable. But authoring is anchored to a
  **saved JD** (`NeedForm.tsx:53-90`, `DevTab.tsx:167-185`) and only **1 JD** is
  seeded — Eva can author exactly one role without first writing more JDs.
- **Dev eval-reading half** (CaseDetail / EvalPanel / shortlist): `dev_cases` = 0,
  `dev_postings` = 0, `dev_submissions` = 0, `dev_lifecycle` = 0. The surfaces
  exist and are correct in code, but there is **no fixture** (env.md fixture #4/#5
  not run: `devcase/seed_materializer.py` + a published case + a submission). The
  eval surface is **reachable-but-empty** — Eva can author + publish live, but to
  *read an evaluation she can defend* she must first collect a submission. Tagged
  `unreachable` for the eval-reading sub-step; its senior-quality verdict on a real
  eval defers to L2.
- The candidate live-work surface `/devcase/apply/[token]` is **Sam's, not hers** —
  excluded from Eva's set per her Surface binding.

---

## Journey 1 — cv-analysis-jobfit (Czech)

### Surface model + grounding audit

Intake (`AnalyzeForm.tsx`) → `runAnalysis.ts` → POST `/api/analyze`
(`route.ts:32-125`) → background `analyze` task (`route.ts:124`,
`startTask("analyze")`) → `analyze-run.ts:85` `runAnalyze` → `spawnPython`
`pipeline.jobfit.cli` (`analyze-run.ts:50-60`, `cliArgs`). The real JD rides in
three ways — `jobDescriptionText` / `jobDescriptionFile` / `jdSlug`
(`route.ts:34-38`) plus a company overview and a `grounding` flag
(`route.ts:33`). Result panels render from `ResultPanel.tsx` (extraction / salary
/ job-fit / interview / compare).

**Grounding — strong.** The real JD reaches the Python pipeline end-to-end and is
a HARD GATE for job-fit:

- `cli.py:27-28` (`--job-description-path` / `--job-description-text`) →
  `service.py:29-31` (file→text extract) → `pipeline.py:142` →
  `gemini.py:442` injects the real JD into the prompt; `gemini.py:389-393`:
  job_fit is populated only when a JD is supplied, else returned null. So
  job-fit is against *this* role, never a generic rubric.
- **Salary is benchmark-anchored, not a free-floating guess.** `taxonomy.py:11-13,40`
  loads committed `data/salary_benchmarks.json` (CZK monthly gross, role×seniority
  bands, real sources: Platy.cz 2026 / Kitalent / expats.cz / Glassdoor+Levels). The
  deterministic `role_band(family, seniority)` is fed to Gemini as the PRIMARY
  anchor (`gemini.py:434` — adjust only ~±20% on stronger evidence, and CITE the
  anchor in `salary.rationale`). The band itself is sanitized + plausibility-capped
  in `salary_band.py:45-66,33` (350k/mo ceiling flags garbage for review). The UI
  surfaces a salary gauge + confidence badge + rationale bullets + a `salaryEvidence`
  trace + a grounded `marketEvidence` panel with vetted source links
  (`SalaryTab.tsx:43,63,66-74,76-103`). **This clears Eva's "salary cites a basis" bar.**

### Walk in-character (cognitive walkthrough + scored criteria)

- *Will I try / notice / connect the controls?* Yes — drop/paste CV + JD, a
  saved-JD picker, a report-language select, grounding/blind toggles are all
  present in the intake.
- *After acting, do I see progress + know it worked?* Yes — background task with a
  Tasks indicator survives navigation (`route.ts:124`), each panel has explicit
  empty/degraded states.
- *Did it advance my job + clear my bar?* **Mostly yes.** Extraction, a
  basis-stated salary gauge, job-fit coverage, soft signals, a verdict — all
  defensible. The salary basis especially is exactly what I'd put in front of a
  director.
- *Do I trust it enough to put my name on it?* **Mostly.** The salary and
  keyword-coverage layers are auditable. BUT the **matched / missing skill chips
  are LLM-narrated**, not from a deterministic CV↔JD matcher (`pipeline.py:617-634`).
  The UI cross-checks each "matched" chip against the CV `evidenceTrace.skills`
  for a tooltip (`SkillChips.tsx:28-43`) — a soft signal — but nothing HARD-BLOCKS
  the model from listing a "matched" skill not present in the CV. The journey's DoD
  says "No skill appears that isn't in the CV"; in code that is only *softly*
  guarded. → minor (L2 must adversarially confirm a real run never invents a match).

**Time-saved:** clearly positive vs Eva's manual baseline (read CV, eyeball
against JD, guess a band) — the benchmark-anchored salary alone saves the part she
can't do reliably by hand. **Senior-quality:** meets her bar on salary + JD-real
job-fit; the soft skill-honesty gap is the one reservation.

### Findings (journey 1)

See findings table below (ids EVA-CVJF-*). No blockers, no majors.

---

## Journey 2 — dev-case-hire (cs authoring; eval defense)

### Surface model + grounding audit (the crux)

Authoring: `DevTab.tsx` (define-need view) → `NeedForm.tsx` picks a **saved JD**
(required, `NeedForm.tsx:53-90`) + GitHub codebases + seniority → `buildNeed()`
(`DevTab.tsx:167-185`, `jdText = jd.body`) → POST `/api/devcase/lifecycle`
(auto) or the manual analyze→design→approve path. The lifecycle
(`devcase-orchestrator.ts:92-345`) drives intake→analyzed→designed→
awaiting_approval→approved→published→collecting→ranked→promoted, with a human
approval gate (`gateApproval`, `:45-61`, fail-closed on missing reality reflection).

**Case GENERATION — receives the REAL role need, not a sample.** `design.py:102-135`
(`design_role`) and `design.py:181-274` (`design_case`) both take the actual
`need` + `NeedAnalysis`: the role is anchored to the real JD body
(`design.py:111` `need.jd_text[:4000]`, "the authoritative statement of the need"),
the case is calibrated to the real stack, seniority-scaled timebox
(`_TIMEBOX` `:26`, junior 3h…lead 8h), and explicitly told to use the role's own
vocabulary and NOT produce a generic puzzle (`design.py:216-248`). This is the
opposite of a fizzbuzz template — it is Eva's exact "case generated from the
actual role" requirement.

**The case is AI-era by construction — this is the headline strength.** The system
prompt (`design.py:62-66`) and case prompt assume the candidate's code is 100%
LLM-generated, so the instrument is AMBIGUITY, not typing: 2-4 covert probes
(ambiguity / legacy_trap / verification_trap / underspecified), each with a
`decisionSpace` of 2-3 defensible options and an internal `reveals` note
(`design.py:239-273`), plus a MANDATED visible DECISIONS log
(`design.py:246-248`). This is precisely "probes human-AI collaboration and real
judgment, not a leetcode puzzle a bot one-shots." A strong senior would NOT
eye-roll this; the timebox keeps it short (no 3-hour marathon).

**EVALUATION — scores the ACTUAL observed work, evidence-backed, defensible.**
`submission_eval.py` runs reflect→assess_tooling→evaluate→score_transfer over the
real submission. `evaluate.py:110-190` grades the five durable capabilities
(framing/tooling/judgment/architecture/transfer), explicitly NOT correctness, and
NEVER penalises AI use (`evaluate.py:24-28`). Confidence is PROPAGATED as the MIN
of upstream signals (`evaluate.py:61-75`) so a deterministic-fallback eval can
never look authoritative. The killer feature for Eva's defense:
`mint_followups` (`evaluate.py:265-377`) turns the eval into candidate-specific
interview questions anchored to each observed decision — "the scores are
HYPOTHESES; the interview verifies them." The fairness gate (`submission_eval.py:268-310`)
is a real, thresholded, sampled invariant (verifiers must lead non-verifiers by
≥5 judgment pts; AI use must not be penalised; strong must beat weak by ≥5) — not
a vibe.

**EvalPanel surface (`EvalPanel.tsx`)** gives Eva exactly the defensible read:
capability score bars with weights, a confidence badge tinted coral when low
(`:67-74`), process-authenticity band (`:78-95`), DECISIONS-log present/missing
(`:145-166`), seed-engagement (which planted seam files were touched, `:172-186`),
per-probe handled/detected/missed (`:189-208`), and the interview follow-ups
(`:213-226`). **CaseDetail (`CaseDetail.tsx`)** cleanly separates the
candidate-facing markdown (`caseToMarkdown`, probe-safe by construction) from a
`Lock`-marked internal section (probes + decision spaces + rubric, `:142-179`),
and badges degraded generations (template-only scenario / skeleton-only seed,
`:94-115`).

**Probe-safety — confirmed.** `page.tsx:13-21,44` renders only `caseToMarkdown`,
which excludes probes by construction; the page explicitly never renders the raw
case object. No probe/answer-key leak to the candidate.

### Walk in-character (cognitive walkthrough + scored criteria)

- *Author a case from a role need — minutes not hours?* Yes (one automated
  lifecycle button, `NeedForm.tsx:143-152`) — BUT gated on a **saved JD existing**;
  with only 1 JD seeded, Eva can author one role before she must go write JDs in the
  library. Reasonable design (the JD *is* the need) but a flow dependency to note.
- *Is the case role-specific + AI-era, not a generic puzzle?* **Yes — strongly.**
- *Is the candidate task brief + realistic?* **Yes** — seniority-scaled timebox,
  short scope, AI allowed-and-observed.
- *Is the eval rubric + evidence-backed, defensible to a director?* **Yes in code —
  but I can't read a real one yet** because no submission is seeded. The machinery
  is exactly what I want; I need a live submission to confirm the prose quality.
- *Is AI use acknowledged/observed, not pretended away?* **Yes** — the entire design
  assumes LLM-generated code and grades collaboration; the panel says so explicitly
  (`EvalPanel.tsx:228-231`).
- *Honest about degraded output?* **Yes** — a strength: scenario/seed fallbacks get
  their OWN audit action and an amber badge so Eva is never handed template probes
  silently (`devcase-orchestrator.ts:164-207`, `CaseDetail.tsx:94-115`).

**Time-saved:** authoring collapses hours→minutes and grading becomes a
rubric-scored, follow-up-ready read — exactly Eva's adoption case, *and* the signal
is genuinely better (AI-era probes she couldn't easily hand-design). **Senior-quality:**
the design + eval clear her bar on paper; the one reservation is the same
LLM-narration honesty concern, here in the eval's `strengths`/`concerns` prose
(the *scores* are grounded in observed probe outcomes + seed-diff, but the prose is
the LLM's). The DECISIONS-log + seed-engagement + probe-outcome evidence anchor it.

### Findings (journey 2)

See findings table (ids EVA-DCH-*). One major (skill/eval narration honesty,
shared with journey 1, carried forward), two minors.

---

## Findings table

| id | journey | type | sev | dim | title | code_check |
|---|---|---|---|---|---|---|
| EVA-CVJF-1 | cv-analysis-jobfit | quality-gap | minor | trust | Matched-skill chips are LLM-narrated, not from a deterministic CV↔JD matcher — a "matched" skill not in the CV is only softly guarded | confirmed-absent |
| EVA-CVJF-2 | cv-analysis-jobfit | quality-gap | minor | trust | Keyless run halts the core analyze (no deterministic fallback, not labelled) — scope_note for L2 | by-design |
| EVA-CVJF-S1 | cv-analysis-jobfit | strength | — | trust | Salary is benchmark-anchored (data/salary_benchmarks.json → role_band → Gemini anchor, ±20%, cited) — clears the "cites a basis" bar | n-a |
| EVA-CVJF-S2 | cv-analysis-jobfit | strength | — | senior-quality | Real JD is a hard gate for job-fit; independent ATS keyword layer surfaces what the LLM missed | n-a |
| EVA-CVJF-S3 | cv-analysis-jobfit | strength | — | trust | Analysis runs as a background task that survives navigation; meter charges only delivered non-cached work | n-a |
| EVA-DCH-1 | dev-case-hire | quality-gap | major | senior-quality | Eval narration prose (strengths/concerns) and the analyze matched-skills are LLM-authored; scores ARE grounded in observed probes/seed-diff but the prose is not independently traceable — carry to L2 to confirm a real eval reads as evidence, not vibe | present-but-missed |
| EVA-DCH-2 | dev-case-hire | broken-flow | minor | effort | Authoring requires a pre-saved JD; only 1 JD seeded, so Eva must detour to the JD library to author a second role | by-design |
| EVA-DCH-3 | dev-case-hire | missing-feature | minor | completion | Eval-reading half is reachable-but-empty (no seeded published case + submission); the defensible-eval verdict can't be earned at L1 — needs seed_materializer fixture | confirmed-absent |
| EVA-DCH-S1 | dev-case-hire | strength | — | senior-quality | Case generation is anchored to the real JD + real stack, seniority-scaled timebox, role-vocabulary — not a generic template | n-a |
| EVA-DCH-S2 | dev-case-hire | strength | — | senior-quality | The case's instrument is ambiguity + a mandated DECISIONS log assuming 100% LLM-generated code — probes AI-collaboration, not algorithm recall | n-a |
| EVA-DCH-S3 | dev-case-hire | strength | — | trust | Eval mints candidate-specific interview follow-ups anchored to observed decisions; scores are hypotheses the interview verifies — exactly Eva's "defend it to the director, with what?" | n-a |
| EVA-DCH-S4 | dev-case-hire | strength | — | trust | Degraded generations (template scenario / skeleton seed) get a distinct audit action + amber badge — Eva is never handed template probes silently; probes never leak to the candidate (caseToMarkdown) | n-a |

---

## First-person feedback — Eva's voice

> **cv-analysis-jobfit.** Tohle bych používala. Konečně mzda, kterou *obhájím* —
> není to číslo z klobouku, vidím pásmo z benchmarku a rationale to cituje. Job-fit
> jede proti té *konkrétní* JD, ne proti obecné šabloně, a coverage panel mi ukáže
> i klíčové slovo, které model přehlédl. Co mě drží zpátky: ty zelené "matched"
> chipy píše model. Tooltip sice kontroluje, jestli skill je v CV, ale nic tvrdě
> nezakáže, aby tam model napsal dovednost, kterou kandidát nemá. Před ředitelem
> bych si to musela přečíst sama. Drobnost, ale přesně ten typ, který mě v
> minulosti spálil.
>
> **dev-case-hire.** Tady mě to nadchlo — a to se mi nestává. Case se generuje z
> *reálné* role a reálného stacku, je krátký podle seniority, a hlavně: měří, jak
> kandidát *pracuje s AI*, ne jestli si pamatuje algoritmus. Ty covert probes s
> decision space a povinný DECISIONS log — to je přesně ten signál, který se mi po
> nástupu LLM rozbil. A evaluace mi nedá jen číslo: dá mi konkrétní interview
> otázky navázané na *jeho* rozhodnutí, kde skóre je hypotéza, kterou si v
> rozhovoru ověřím. To je odpověď na moje "čím to obhájím?". Dvě výhrady: musím
> nejdřív mít JD v knihovně (mám jednu), a hlavně — ještě jsem nečetla *žádnou
> opravdovou* evaluaci, protože není naseedovaný žádný odevzdaný case. Stroj je
> skvělý; potřebuju vidět, že próza, kterou napíše na reálném odevzdání, drží
> stejnou laťku jako ta mechanika. To si ověřím až naživo (L2).
>
> Řekla bych o tom kolegovi? U dev-case ano, hned. U analýzy CV taky — jen bych
> dodala "skill chipy ber jako návrh, mzdu a coverage ber jako důkaz".

## What L2 must confirm (handoff)

- **EVA-DCH-1 / EVA-DCH-3 (l2_priority):** seed a published case + a real
  submission (`devcase/seed_materializer.py` + publish + submit via the token), then
  read the EvalPanel — assert the eval cites HIS observed events (files touched,
  DECISIONS.md, probe outcomes) and the prose is evidence-backed, not a generic
  grade. Confirm the follow-ups are specific to the submission.
- **EVA-CVJF-1 (l2_priority):** run a real engineer CV + the seeded ČS JD;
  adversarially check every "matched" chip is findable in the CV text — any invented
  match is a senior-quality gap (blocker if Eva would be embarrassed).
- **Bilingual:** Eva authors in cs; confirm the brief/eval prose renders Czech with
  no leaked English strings; salary/skill CODE values stay verbatim.
- **Latency:** case generation + eval are 15-130s Python/Gemini calls — confirm no
  early client timeout; the Tasks indicator tracks them.
