# L1 theoretical — Eva Marešová (Engineering Hiring Lead) × dev-case-hire

- **Run:** 2026-07-02-full · main @ 3395b4c · cert level: **L1** (code-derived surface model, no browser)
- **Verdict:** **L1-conditional** — the job completes end-to-end structurally (JD → need → analyze → design → human gate → publish → collect → evaluate → promote), but four majors sit exactly on her adoption line (evidence-backed, defensible evaluation).
- **Grounding score:** case authoring **5/6** · submission evaluation **3/7 (live-work path)** / 4/7 (repo-link path)
- **Estimated time saved (if it all worked):** **~5–6 h per role** (hand-design 3–4 h + ~1 h manual grading × ~3 submissions → ~1 h of active app time) · **confidence: medium** — the eval-grounding majors are exactly the "I'd redo it by hand" risk she names as her adoption line.

---

## 1. Surface model (followed import chains, file:line)

### Authoring (Eva's leg)
- **Dev tab** is registered for all internal users — nav group "Dev extension" → `dev` (`app/features/tabs.ts:28,128-131`); nav labels are Czech-translated (`messages/cs.json:868,878`). The studio has three views: Cases / Define need / Outbox (`app/features/sub_dev/DevTab.tsx:18-41`).
- **JD-first intake:** a saved JD is REQUIRED (picker + `aria-invalid`, buttons disabled until the body loads — `NeedForm.tsx:50,146,153`); the need carries `jdText` as the primary statement, plus up to 3 GitHub repos (`devcase-constraints.ts:8`) and a seniority target (`DevTab.tsx:178-196`).
- **Two paths:** "Run automated lifecycle" → `POST /api/devcase/lifecycle` (`DevTab.tsx:222-237`, `app/api/devcase/lifecycle/route.ts:19-42`, billing-metered at :29-31) drives `runLifecycle` (`app/_lib/devcase-orchestrator.ts:101-347`); or manual "Analyze need only" → `need_analysis` task → `design_artifacts` task → approve → `POST /api/devcase` (`DevTab.tsx:311-340`, `app/_lib/tasks.ts:103-110`).
- **Case generation chain:** `runNeedAnalysis`/`runDesignArtifacts` (`app/_lib/devcase-run.ts:87-151`) shell out to `python -m pipeline.jobfit.devcase.devcase_cli` → `analyze.py` (need + full JD[:6000] + real repo snapshots — `analyze.py:52-83`) → `design.py` `design_role` (JD[:4000] + real stack + comparable seed-corpus roles — `design.py:110-145`) and `design_case` (the heart: assumes 100% LLM-generated code, bakes 2–4 covert probes with mandatory `reveals` + `decisionSpace`, forces a DECISIONS log, hard-caps the timebox at 2 h — `design.py:189-296,31-34,396`).
- **Human gate:** auto-approve fails CLOSED — a non-LLM (template) design, low confidence, or an absent reality-reflection array routes to `awaiting_approval` with a stated reason (`devcase-orchestrator.ts:45-70,132-141`); redesign honors reviewer feedback (`devcase-run.ts:123-151`).
- **Publish:** `POST /api/devcase/publish` → `LocalDistributionAdapter.publish` mints a posting with a **CSPRNG 128-bit bearer token** (`app/_lib/distribution.ts:18-41`); the studio renders it as a copyable apply-URL pill (`ApplyTokenPill.tsx:30-41`). Publish also (best-effort, provenance-audited) generates the interview scenario + **materialized seed** file tree with planted seams incl. `DECISIONS.md` (`devcase-orchestrator.ts:169-223`, `seed_materializer.py:1-44,60-74`) and pro-actively sources the candidate DB (`devcase-orchestrator.ts:228-260`).

### Evaluation (Eva's leg)
- Submissions arrive per posting; `Evaluate` → `evaluate_submission` task → `runEvaluateSubmission` (`devcase-run.ts:395-516`): session submissions (`repoRef = "session:<id>"`) load **observed events** (`:409-417`), repo submissions fetch commit metadata. Chain: `reflect_commits` → `assess_tooling` (observed path = deterministic `tooling_from_events`, confidence 0.8 — `reflect.py:198-206`, `process_events.py:73-123`) → `evaluate_submission` (5-dim rubric — `evaluate.py:110-202`) → `score_transfer` (`:208-259`) → `mint_followups` (candidate-specific authorship-verification questions — `:277-389`).
- **EvalPanel** shows rubric-weighted score bars, per-step provenance + propagated min-confidence, an authenticity band, probe outcomes, DECISIONS-kept chip, seed-engagement, interview follow-ups, an explicit "code assumed LLM-generated — AI never penalised" note, and a degraded-run warning (`EvalPanel.tsx:53-237`). Promote → Decisions review card; suspect authenticity forces "hold" (`devcase-run.ts:597-656`).

## 2. Reachability (resolved before judging)

Internal user, dev gate on → `/` workspace → Dev tab: **reachable** (no per-role gating, `tabs.ts:128-131`). Her fixtures: a saved JD (library) + optionally a Gemini/Claude-CLI key (keyless → deterministic templates, honestly badged and blocked from auto-publish — `scope_note`, not a defect). The candidate page `/devcase/apply/[token]` is Sam's surface, not hers — findings there are not scored against her.

## 3. Grounding audit (the crux)

**Case authoring — 5/6.** Reaches the prompt: (1) full real JD body (`analyze.py:62`, `design.py:120`), (2) real multi-repo snapshots (`devcase-run.ts:88-104` → `analyze.py:64`), (3) seniority target incl. timebox calibration (`design.py:207-208,243-248`), (4) comparable market roles from the real seed corpus (`design.py:48-68,128`), (5) human reviewer feedback on redesign (`design.py:271-277`). Missing: (6) CV soft-signal `focus_probes` exist in `design_case`'s signature (`design.py:189-204`) but are **not wired** through this journey's authoring path (`devcase-run.ts:130-150` never passes them). Genuinely well-grounded machinery.

**Submission evaluation — 3/7 on the live-work path** (4/7 repo path). Reaches the prompt: (1) case + rubric + probes, (2) role spec, (3) observed process events → tooling. Does NOT reach it: (4) **the candidate's actual edited file contents** — the session saves the full tree (`db/devcase.ts:539-547`) but `runEvaluateSubmission` never loads it; no studio surface renders it either (no consumer of session files outside the flush route), (5) **the DECISIONS.md text** — the case's own centerpiece artifact is checked only for *existence* (`devcase-run.ts:471-477`), never read, (6) the paste-magnitude authenticity tell (dead pipeline — see dch-l1-001), (7) seed-diff engagement (null for sessions — `devcase-run.ts:497-501`). Plus: `reflect_commits` runs over an **empty commit list** for sessions (`devcase_cli.py:329-330`, `reflect.py:96-121`), so the "reflection" the evaluator and the authenticity scorer consume (`devcase-run.ts:479-489`) is inferred from nothing. **"Good machinery fed thin context" — the classic defect, on her headline output.**

## 4. Cognitive walkthrough — scored acceptance criteria (identical every run)

| Criterion | Verdict | Evidence |
|---|---|---|
| **completion** — need → case → live work → evaluation, no dead-end | **PASS** | full chain wired both manual + auto (`DevTab.tsx:222-340`, orchestrator stages `devcase-orchestrator.ts:74`); *caveat:* a live-surface submission does not wake her auto-lifecycle (dch-l1-005) — completion survives via the manual Evaluate button |
| **senior-quality** — role-specific case probing human–AI collaboration | **PASS (structural)** | grounded prompts + covert probes + decisionSpace + forced DECISIONS log (`design.py:249-259`); template fallback cannot silently auto-publish (`devcase-orchestrator.ts:50-54`); actual output quality → L2 |
| **senior-quality / effort** — brief and realistic | **PARTIAL** | hard 2 h cap + clamp of the LLM's own estimate (`design.py:31-34,396`) kills the half-day take-home; but 1.5–2 h is still 3–4× the <30 min research anchor she carries (dch-l1-006, scored major on Sam's leg) |
| **trust** — rubric + concrete evidence, not a vibe | **PARTIAL → major** | rubric bars, probe outcomes, follow-ups: yes. But the evidence is process *shape* only — the eval never cites a line the candidate wrote or a decision they logged, and she can't even open the work product from the studio (dch-l1-002) |
| **trust** — defensible to an eng director | **PARTIAL** | provenance strip + propagated min-confidence + authenticity band are exactly the honesty a director probes (`EvalPanel.tsx:61-96`); but "ukažte mi, CO napsal" has no answer on the live path (dch-l1-002); the paste tell she'd rely on is dead (dch-l1-001) |
| **trust** — AI use acknowledged/observed | **PASS** | fairness contract engineered + eval-gated: over-reliance never inferred from tool use (`reflect.py:224-227`, `process_events.py:120`, `submission_eval.py:71-74`); disclosed to the candidate |
| **time-saved** — minutes vs hours, better signal | **PASS (structural)** | authoring is a JD pick + one click; grading is automatic; ~5–6 h/role saved — *if* she doesn't have to re-grade by hand (her stated adoption line, at risk from dch-l1-002) |
| **language** — internal UI in Czech | **FAIL → major** | the entire dev studio is hardcoded English — zero `useTranslations` in `app/features/sub_dev/*` (grep), vs the rest of the workspace which is translated; the Czech sidebar item "Vývojové případy" (`cs.json:868`) opens an all-English surface (dch-l1-003) |

## 5. Findings (see `dev-case-hire.findings.json`)

Majors: **dch-l1-001** (paste-from-LLM tell never persists — broken pipeline), **dch-l1-002** (eval never reads the actual work / DECISIONS content; no work-product viewer), **dch-l1-003** (dev studio English-only), **dch-l1-004** (no candidate-language control, shared with Sam), **dch-l1-005** (live submit skips ack + lifecycle resume, shared with Sam). Minor: **dch-l1-008** (seed-diff evidence null for sessions). Strengths: **dch-l1-009** (probe safety by construction), **dch-l1-010** (defensible-eval surface + fail-closed gates), **dch-l1-012** (authoring grounding 5/6), **dch-l1-013** (fairness contract).

## 6. Character feedback — Eva, first person (voice: precise, evidence-driven)

> Konečně někdo pochopil zadání. The case designer starts from my real JD and the real codebase, it refuses to auto-publish a template pretending to be bespoke, and the probes come with a decision space — that's the first take-home generator I've seen that assumes the code is AI-written and tests judgment anyway. Authoring that used to cost me an afternoon is a JD pick and one click. Dobře.
>
> But my test is *"obhájím to před ředitelem? čím?"* — and here it wobbles. The eval panel looks defensible: rubric bars, provenance, confidence, even an authenticity badge. Then the director asks "ukažte mi, co ten člověk napsal" — and I have nothing. The live surface watched every edit, saved every file, forced a DECISIONS log… and the evaluation reads none of it. Not the code, not the decisions text. It grades the *shape* of the process and calls it evidence. That's a vibe with charts. And the one tell I'd bank on — someone pasting a whole LLM solution into the watched editor — is recorded by the browser and then thrown away by the server. The authenticity badge would say "genuine" to exactly the person it was built to catch.
>
> Also: my whole workspace speaks Czech, and then the Dev tab — *my* tab, the one I champion — switches to English mid-sentence. My directors will notice before they notice anything else.
>
> Would I adopt it? Yes — for authoring, today. For the verdicts, not until the evaluation can quote the candidate's own work back to me. That's the line between "saved me five hours" and "I re-graded everything myself anyway."

## 7. L2 handoff (l2_priority)

1. **dch-l1-002:** submit a live session with a rich DECISIONS.md → does the eval summary/follow-ups quote ANY of its content? (expect: no)
2. **dch-l1-001:** paste >600 chars into the live editor, submit → does authenticity dock to "suspect"? (expect: no — the event never persists)
3. **dch-l1-005:** auto-lifecycle in `collecting` + live-surface submit → is it ever evaluated without a manual click? does an ack appear in the outbox?
4. **dch-l1-003/004:** cs locale → dev studio language; and the generated brief's language on Sam's token page.
5. Real output quality of a generated case from a ČS JD (role-specific? names real files/symbols? short?) — 15–130 s LLM calls, budget for it.
