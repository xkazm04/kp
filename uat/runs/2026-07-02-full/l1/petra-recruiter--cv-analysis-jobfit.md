# L1 theoretical — Petra Nováková (recruiter) × cv-analysis-jobfit

- **Run:** 2026-07-02-full · main @ `3395b4c` · cert_level **L1** (code-derived surface model, no browser)
- **Verdict:** **L1-conditional** — the journey completes structurally and the trust core is strong, but one major (silent save / no path from the fresh result to the recorded verdict) carries to L2.
- **Journey grounding score:** **6/9** (main analyze surface; GitHub deep-dive 4/6 — see audit)
- **Estimated time saved (if it all worked):** **~23 min per analyzed CV** (manual ~30 min JD-deep read + salary research + written reasoning → ~7 min upload/wait/read) · confidence **medium** (L1, designed experience; L2 must confirm output quality + latency)
- **Ship bar:** "public product path" — see §7.

---

## 1. Reachability (resolved before judging)

Petra = internal user, dev gate on → workspace at `/`. `analyze` and `history` are both
valid workspace tabs (`app/features/tabs.ts:19-23`), Analyze sits in the "Tools" nav group
(`app/features/tabs.ts:122-127`) — **no role gating**, so both surfaces are inside her
binding (Jobs, Match, Analyze, Pipeline, Schedule, Interview, Onboarding). Fixtures per
run checkpoint: analyses 105, jobs 100 → History non-empty, saved-JD picker populated.
Gemini key live (checkpoint) → quality findings are in scope, not `scope_note`.
Everything judged below is reachable for her; **no `unreachable` tags needed**.

## 2. Surface model (affordance → handler → API → pipeline → prompt)

**Intake (Analyze tab, mode "new").** `AnalyzeWorkspace` segments New/History
(`app/features/sub_analyze/AnalyzeWorkspace.tsx:23-64`). The form
(`app/features/sub_analyze/AnalyzeForm.tsx`):
- CV drop/upload, up to `MAX_CV_VARIANTS` (`AnalyzeForm.tsx:64-70`), content-hash deduped
  client- and server-side (`useAnalyzeForm.ts:120-142`, `/api/analyze/route.ts:148-169`).
- JD: file drop, paste row, **saved-JD picker** (`AnalyzeForm.tsx:80-114`) → the picker
  fetches the full body by slug and detaches the slug on any fetch failure so a JD-blind
  run can never be tagged role-specific (`useAnalyzeJdLibrary.ts:44-84`); submit re-guards
  it (`useAnalyzeForm.ts:388-391`).
- Company overview (file/paste, `AnalyzeForm.tsx:117-139`), GitHub handle (`:141-168`),
  **report-language select** (`:212-223`), **blind-screening checkbox** (`:227-235`).
  *Surface-model correction vs the journey doc:* there is **no grounding toggle** — the
  client hardcodes `grounding=true` (`AnalyzeApi.ts:20`); only blind is a toggle.
- Gemini preflight warning when the engine is missing (`AnalyzeForm.tsx:172-176`) — warns,
  does not block submit.

**Run lifecycle.** Submit → `executeAnalysis` (`runAnalysis.ts:64-80`) →
`submitAnalysis` POST `/api/analyze` (`AnalyzeApi.ts:9-37`). The route rate-limits
(`route.ts:34-36`), billing-gates (`:43-44`), persists files to a workdir (`:77-84`),
spills an oversized pasted JD to a file (`:91-103`), captures locale + report-lang
override (`:114-115`) and workspace (`:121`), then **starts a background task**
(`startTask("analyze")`, `route.ts:138`) → `runAnalyze` (`app/_lib/tasks.ts:97`,
`app/_lib/analyze-run.ts:85-212`): per-variant cache lookup (`:97-108`), Python spawn
`-m pipeline.jobfit.cli` (`:121`, args `:50-59` — `--lang`, `--blind`,
`--job-description-*`, `--company-*`), zod-validated payload (`:145-149`), meter debited
only on delivered non-cached work (`:174-180`), auto-persist via `saveAnalysis` with the
reconciled score (`:184`, `:214-234`). Client polls `/api/tasks/[id]`
(`AnalyzeApi.ts:41-117`) with error-bail after ~15 s of solid failure (`:64-74`);
refresh re-attaches via sessionStorage (`useAnalyzeForm.ts:260-281`); Cancel DELETEs the
task, which SIGKILLs the Python child (`useAnalyzeForm.ts:197-207`,
`analyze-run.ts:117-121`).

**Pipeline → prompt.** `cli.py:56-66` → `service.py:12-47` (extracts JD/company files to
text) → `pipeline.analyze_cv` (`pipeline.py:92-347`): deterministic pre-pass (pypdf text
+ taxonomy skills/seniority/role-family + **CZK anchor band** from
`data/salary_benchmarks.json`, `pipeline.py:878-976`, `taxonomy.py:286-304`) → single
Gemini call `analyze_profile_with_gemini` (`gemini.py:439-578`): CV file bytes attached
(`:557`), JD + company text inline (`:544-545`), deterministic evidence JSON (`:524-525`),
anchor-band cite rule (`:532`), no-invention rule (`:537`), credential gate (`:539`),
Google-Search grounding when `grounding=true` (`:323-324`, sources `:581-592`),
output-language rule (`:529`). Post-Gemini: **matched-skill trust gate**
`verify_skills_in_cv` (`pipeline.py:200-210`, `ats.py:105-141`), keyword coverage
(`pipeline.py:251-264`, `ats.py:35-78`), salary repair + company factor
(`pipeline.py:652-689`, `insights.py:67-78`), sanity checks / trust ledger
(`pipeline.py:990-1092`), interview kit (`interview.py:23-52`), soft signals
(`soft_signals.py`), archetype routing (`pipeline.py:303-324`).

**Result panels.** `ResultPanel` (`app/_components/results/ResultPanel.tsx:42-181`):
ArchetypeBanner → **QualityStrip** trust ledger (`:137`, `QualityStrip.tsx:17-67`) → tabs
Extraction (`ExtractionTab.tsx` — dial pinned to component sum `:36`, factor chart,
strengths/gaps, evidence trace, LLM explanation), Job fit (`JobFitTab.tsx` — score dial,
summary, `SkillChips.tsx` matched chips with evidence tooltips + `MissingSkillsTiers.tsx`
position-neutral gap tiers, keyword coverage with honest "+N more" caps `:111-134`),
Salary (`SalaryTab.tsx` — gauge with confidence opacity `SalaryGauge.tsx:21-43`, range,
structure note, rationale, evidence trace, company context, grounded market evidence with
vetted links `:83-109`), Interview, GitHub (when run). History: `HistoryTab.tsx` list with
search/filters + review-flag pill (`:238-247`) → `/history/[slug]`
(`app/history/[slug]/page.tsx`) with **DispositionEditor** (advance/hold/pass, `:133-137`)
and ReportActions.

## 3. Grounding audit (L1's sweet spot)

**Main analyze surface — the context this output SHOULD use → does it reach the prompt?**

| # | Source | Reaches the prompt/pipeline? | Evidence |
|---|---|---|---|
| 1 | Full CV (file bytes; redacted text in blind mode) | **yes** | `gemini.py:555-557`, blind fail-closed `:495-503` |
| 2 | The real JD (file/paste/saved slug body) | **yes** | `route.ts:48-52` → `service.py:29-31` → `gemini.py:544`; job_fit nulled without it `:479-483` |
| 3 | Company overview | **yes** (prompt + deterministic factor) | `gemini.py:545`; `insights.py:28-78` |
| 4 | Deterministic taxonomy evidence + **salary anchor band** (`data/salary_benchmarks.json`) | **yes** | `pipeline.py:117,143-152`, `taxonomy.py:286-304`, prompt rule `gemini.py:532` |
| 5 | Live market signals (Google-Search grounding + cited sources) | **yes** | `gemini.py:323-324,581-592`; UI `SalaryTab.tsx:83-109` |
| 6 | Recruiter's report language | **yes** | `route.ts:114-115` → `--lang` → `gemini.py:529`; cache lang-keyed `analyze-run.ts:104` |
| 7 | GitHub evidence (when a handle is supplied) | **no** — separate call, never joins the main prompt | `useAnalyzeForm.ts:343-372`; `gemini.py:439-448` has no GitHub param |
| 8 | The saved JD's **structured** comp band (`jobs.salary_min/max`) | **no** — `jdSlug` rides for persistence/logging only | `analyze-run.ts:130,184,199`; contrast group-eval which DOES join it (`app/_lib/group-eval-run.ts:393,475`) |
| 9 | Prior history for this candidate (earlier analyses / pipeline state) | **no** — cache only dedupes identical bytes | `analyze-run.ts:97-108` |

**Grounding 6/9.** The 3 misses are integration gaps, not thin-context theater — the
machinery for #8 exists one surface over.

**GitHub deep-dive surface (`/api/github-analysis`): 4/6** — repos+languages (yes,
`route.ts:175-193`), README/commits/file names for top-3 (yes, `:477-502`), JD (yes,
`:620-633`), honest evidence basis + limitations (yes, `:252-256,540`); the main CV
analysis / candidate claims (**no** — `unverified_claims` is JD-vs-repos, the CV never
arrives); private/contribution-graph data (**no**, disclosed `:252-256`).

**Salary specifically (her "number with a basis" bar):** anchored (source #4), model told
to cite the anchor (`gemini.py:532`), company factor appends its own rationale
(`insights.py:76-78`), midpoint repaired if out-of-band (`pipeline.py:677-679`),
CZK/month plausibility ceiling flagged to the trust ledger (`pipeline.py:1081-1092`,
`salary_band.py:33`). This is the strongest-grounded number on the surface.

## 4. Cognitive walkthrough (rubric questions, in character)

1. **Will I even try this?** Yes — "Analyze" sits under Tools; the form says CV required,
   JD/company/GitHub optional with per-column status chips (`AnalyzeColumn`,
   `useAnalyzeForm.ts:81-100`). The saved-JD picker means I don't re-paste the ČS JD.
2. **Will I notice the controls?** Yes — required/optional tones, a disabled Analyze
   button until a CV (or GitHub handle) exists (`AnalyzeForm.tsx:199`). The blind
   checkbox and report-language select are labeled (`:212-235`).
3. **Control ↔ effect?** Mostly. "Analyzovat" → progress strip → result. One mismatch:
   the stage strip *looks* like live pipeline telemetry but is a timer animation
   (`AnalyzeApi.ts:41-57` — "soft timeline"); the Python CLI can emit real stages
   (`cli.py:53` `--stream`) but the task path never passes it (`analyze-run.ts:50-59`).
4. **Feedback after acting?** During the run: yes (strip + Cancel + Tasks indicator;
   survives refresh, `useAnalyzeForm.ts:260-281`). After the run: **partial** — the result
   renders, but the auto-save to History is silent: `analysis.persistence.slug` is
   consumed only by the GitHub PATCH (`useAnalyzeForm.ts:291`) and the Tasks tab
   (`TasksTab.tsx:510-512`); the panel shows no "uloženo jako …" and no link to
   `/history/[slug]`. *"A stalo se vůbec něco?"* — my pet peeve, on my headline surface.
5. **Did it advance my job, at my bar?** The designed output: extraction + reconciled
   score with drivers (FactorChart), job-fit summary + verified matched chips + missing
   tiers + risk flags, salary with basis, soft signals with probes, trust ledger. That is
   the advance/hold/pass package. But **recording** the verdict (DispositionEditor) lives
   only on `/history/[slug]` (`page.tsx:133-137`) — which the fresh result doesn't link.
6. **Do I trust it enough to put my name on it?** Structurally, yes-with-notes: the
   hallucination gate (`pipeline.py:200-210`) is exactly my hard line, and withheld skills
   are disclosed rather than hidden. Notes: the trust-ledger sentences, soft-signal probes
   and interview-kit text are engine English inside my Czech report; the coverage panel's
   keyword universe is tech-taxonomy-bounded, thin for my branch-advisor reqs.

## 5. Petra's scored acceptance criteria (applied identically every run)

| Criterion | L1 result | Evidence |
|---|---|---|
| completion — JD → decision without dead-end | **pass (structural)** | intake → run → panels → History; no dead-end; disposition path is friction, not a dead-end (`AnalyzeWorkspace.tsx:62`, `history/[slug]/page.tsx:133`) |
| senior-quality/trust — reasoning cites the CV | **pass-designed** | matched chips carry evidence tooltips from the trace (`SkillChips.tsx:28-43`, `insights.py:81-91`); prose quality itself is L2's to confirm |
| trust — zero hallucinated skills | **pass (gate landed)** | `verify_skills_in_cv` (`ats.py:105-141`) strips unverifiable matches + discloses withheld (`pipeline.py:200-210`) — the prior run's major, now code-landed; **L2 must verify live** |
| senior-quality — score with drivers | **pass** | total pinned to component sum + FactorChart (`format.ts:457-468`, `ExtractionTab.tsx:36,137`); jobFit score has narrative drivers (`JobFitTab.tsx:35-49,74-80`) |
| trust — salary shows a basis | **pass** | anchor band + cite rule + rationale + evidence trace + confidence (`gemini.py:532`, `SalaryTab.tsx:44-81`) |
| clarity — no silent success | **FAIL (major)** | auto-save has no receipt/link on the fresh result (grep: `persistence.slug` unused in the result UI) |
| time-saved — faster than manual | **pass-designed** | one upload + 30–130 s vs ~30 min manual; L2 confirms latency |
| language — Czech UI + Czech reasoning | **partial** | chrome + LLM narrative cs (`messages/cs.json`, `gemini.py:529`); deterministic ledger/probes/kit English (`QualityStrip.tsx:13-16`, `SoftSignalsSection.tsx:15`, `interview.py:55-80`) |

## 6. Findings (detail in `cv-analysis-jobfit.findings.json`)

| id | sev | type | title |
|---|---|---|---|
| PET-CVJF-01 | **major** | missing-feature | Fresh result never says it was saved and never links `/history/[slug]` — the verdict-recording surface (disposition) is a hidden hop away |
| PET-CVJF-02 | minor | quality-gap | Decision-layer strings (trust ledger, soft-signal probes, interview kit, evidence trace) are engine-English inside the Czech report |
| PET-CVJF-03 | minor | quality-gap | "Independent" keyword coverage is bounded by a tech-dominant taxonomy — structurally thin for her non-tech ČS requisitions |
| PET-CVJF-04 | minor | confusion | Candidate-coaching POV leaks into the recruiter report ("address it in *your* CV…", CV-rewrite panel, STAR prep scaffolds) |
| PET-CVJF-05 | minor | confusion | Progress strip is a timer animation dressed as pipeline stages; real `--stream` stages exist but are unwired |
| PET-CVJF-06 | polish | trust | Growth-target line hardcodes +30% and "Kč / měsíc" regardless of the estimate's currency/period |
| PET-CVJF-07 | polish | trust | Analyze cache is content-keyed, not tenant-keyed — identical cross-tenant submits share a result and skip the meter |
| PET-CVJF-S1 | strength | trust | The hallucinated-skill seam from run l1-2026-06-19 is closed **at the source**, with disclosure of withheld skills |
| PET-CVJF-S2 | strength | trust | Salary is a basis-carrying number end to end (anchor → cite rule → repair → ledger → gauge) |
| PET-CVJF-S3 | strength | trust | JD integrity is guarded on every path (pick-detach, submit gate, jd-null rule) — a JD-blind run can't masquerade as role-specific |
| PET-CVJF-S4 | strength | completion | Run is a refresh-surviving background task with real cancel (SIGKILL) and delivered-work-only metering |

Suppressed per `accepted-gaps.md`: none applicable (only the tokenized-404 entry exists;
this journey touches no tokenized page). Keyless degradation = `scope_note` per the
journey file; keys are live this run.

## 7. Ship-bar evidence (public product path)

- **Multi-tenancy isolation:** the workspace is captured at request scope and stamped on
  the saved analysis (`route.ts:119-121`, `analyze-run.ts:37,184`); `/history/[slug]`
  loads workspace-scoped (`history/[slug]/page.tsx:37-40`) and the board chip lookup is
  scoped to the same ws (`:80`). **Seam:** the analyze result cache key has no workspace
  component (`analyze-run.ts:97-106`) — identical CV+JD bytes submitted from another
  tenant hit the same cache entry. No data leaks beyond what the submitter already holds
  (identical inputs required), but the second tenant's run is unmetered
  (`analyze-run.ts:172-180`). Recorded as PET-CVJF-07 (polish).
- **Real comms delivery:** not touched by this journey (no email/SMS sent from Analyze).
- **Unlaunched landing:** not touched (authed workspace only).

## 8. Verdict

**L1-conditional.** Structurally sound, trust core genuinely strong (the one thing that
would make Petra drop the tool — an invented skill — is now gated at the source). One
major (PET-CVJF-01) is a designed-in silent success on her headline surface; carry it +
the l2_priority list to L2. Time-saved promise ~23 min/CV at medium confidence.

**L2 priorities:** (1) adversarial matched-chip vs CV text live (confirm the gate holds
end-to-end, incl. the circularity note EVA-CVJF-02); (2) salary number cites a basis in
the rendered Czech report; (3) cs↔en report-language re-run is cache-correct; (4) latency
30–130 s + Tasks indicator; (5) run a **non-tech ČS JD** (branch advisor) and check the
keyword-coverage panel isn't empty/misleading; (6) confirm the silent-save friction live
(how does a real user find `/history/[slug]` after a run?).

## 9. Character feedback — Petra, first person (cs)

> Tak jo. Nahraju CV, vyberu uložený inzerát z knihovny — nemusím nic přepisovat, dobře.
> Zmáčknu Analyzovat, běží to na pozadí, můžu si mezitím otevřít Pipeline a ono to
> nespadne. Tohle oceňuju, protože přesně tohle Teamio neumělo.
>
> Výsledek: skóre má rozpad, ne jen číslo. Mzda má pásmo, důvody a odkud to je — "okay,
> to číslo má základ." A hlavně: když si model vymyslí dovednost, systém ji **zadrží a
> napíše mi to** — "Withheld 2 AI-suggested matching skills not found in the CV". To je
> přesně ta věta, kterou potřebuju, abych tomu začala věřit. Minule jsem psala, že chipy
> jsou čistá LLM narace — tohle někdo opravil pořádně, u zdroje.
>
> Co mě štve: doběhne analýza a — *a stalo se vůbec něco?* Ono se to uloží do Historie,
> ale nikde to neřekne. Žádné "uloženo jako cv-…", žádný odkaz. A když chci zapsat
> advance/hold/pass, musím přepnout na Historii, najít řádek, prokliknout se. To je
> přesně to tiché "hotovo" bez záznamu, kvůli kterému nevěřím nástrojům.
>
> Druhá věc: půlka důvěryhodnostních vět je anglicky. Report je česky, manažer čte česky,
> a pak tam svítí "Salary range needs manual review" a "RED FLAG: overclaim risk".
> Přežiju to, manažer ne. A ty rady "upravte si shrnutí životopisu" — komu to mluví? Já
> ten životopis nepsala.
>
> Adoptovala bych to? Pro IT pozice ano, hned — ušetří mi to reálně dvacet minut na CV a
> zdůvodnění je předepsané. Pro moje pobočkové pozice si počkám, co ukáže živý test —
> ta taxonomie klíčových slov je celá o Dockeru a Reactu, ne o hypotékách. Kolegyni bych
> řekla: věř tomu chipu, kontroluj Historii, a verdikt si zapiš hned, než zapomeneš, kde
> to je.
