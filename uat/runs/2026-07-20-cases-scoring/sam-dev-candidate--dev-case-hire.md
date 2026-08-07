---
run: 2026-07-20-cases-scoring
character: sam-dev-candidate
journey: dev-case-hire
cert_level: L1
verdict: L1-conditional
reachability: unreachable (no dev-case fixture in the local DB — design judged, live impact deferred to L2)
grounding: 6/9 (submission-evaluation surface)
time_saved_min: 120
time_saved_confidence: medium
language: en
branch: vibeman/ambiguity-ui-wave1 (read-only; no source touched)
---

# Sam Okafor × dev-case-hire — L1 (theoretical, code-grounded)

## Surface model

Sam's ONLY reachable surface is `/devcase/apply/[token]`. Import chain followed
affordance → handler → API → Python.

**Entry / page shell**
- `app/devcase/apply/[token]/page.tsx:26-28` — token resolved via `getPostingByToken`; `notFound()` otherwise.
- `page.tsx:34-42` — closed posting renders an honest closure card, no collection.
- `page.tsx:44-47` — case + role loaded; brief rendered through `caseToMarkdown`.
- `app/features/sub_dev/DevHelpers.ts:42-58` — `caseToMarkdown` emits ONLY title / role+seniority+timebox / Brief / What you're handed / Tasks. **`coverProbes` are excluded by construction** — probe-safety holds; the answer key cannot leak. Note it also excludes the rubric, so Sam never sees the five dimensions he is scored on.
- `page.tsx:81` — `<AiDisclosure showDataConsent />`; component at `app/_components/AiDisclosure.tsx:57-73`, copy at `messages/en.json` `aiDisclosure.*` (human review of every adverse decision, jurisdiction-aware framework + data-law line, retention window fetched from `/api/compliance`).
- `page.tsx:96-104` — **either/or submit path**: seed files present → `LiveWorkSurface`; else → `DevApplyForm` (repo link). Never both.

**Live-work surface** (`app/devcase/apply/[token]/LiveWorkSurface.tsx`)
- `:325-340` file-tree buttons → `selectFile` → `record("open", path)` (`:207-211`).
- `:341-354` the editor: a **plain `<textarea>`** (no highlighting, no runner, no test execution). `onChange` → `onEdit` (`:213-220`) debounced 600 ms → `record("edit"|"decision_log")`.
- `:344-350` `onPaste` → `record("paste", path, charCount)` — **paste magnitude captured**.
- `:102-137` `ensureSession` — lazy mint on first interaction via `POST /api/devcase/session`; stamps the returned watermark into `DECISIONS.md`.
- `:148-197` `flush` — every 8 s (`FLUSH_MS`, `:16`); dirty-gated file tree; 404/409 self-heal; offline re-buffer.
- `:57-90` localStorage draft persistence + resume-on-mount, keyed per token.
- `:317-322` mid-flight requirement-change banner, server-revealed.
- `:357-414` **captured chat**: `assistant` + `stakeholder` tabs → `POST /api/devcase/session/[id]/chat`.
- `:416-443` identity (name + email, both required) → `submit()` (`:222-257`) → flush(submit) → `POST /api/devcase/session/[id]/submit`.
- `:297-304` submitted state: a static thank-you card. No status link, no next step, no reference.

**APIs**
- `app/api/devcase/session/route.ts:16-42` — validates open posting, 50-sessions/token/day throttle, returns `sessionId` + watermark.
- `app/api/devcase/session/[id]/route.ts:44-102` — event allow-list `open|edit|decision_log|submit|paste`, caps (500 events / 50 files / 256 KB), `size` coerced through; server-side `perturbation` event + reveal.
- `app/api/devcase/session/[id]/chat/route.ts:25-77` — persists both sides, appends a **server-recorded** `prompt` event (`:57`), calls `runSessionChat`.
- `app/api/devcase/session/[id]/submit/route.ts:8-40` — 410 on closed posting; `submitDevSession(...)` with identity.

**Evaluation chain**
- `app/_lib/db/devcase.ts:937-969` — `submitDevSession` → `createSubmission` (`repoRef = "session:<id>"`), one transaction, idempotent.
- `app/_lib/devcase-run.ts:498-654` — `runEvaluateSubmission`: session branch loads events + integrity + files + chat (`:523-529`), passes `--events-json --chat-json --files-json --seed-json --baseline-json` (`:575-581`).
- `app/_lib/devcase-authenticity.ts:59-129` — `scoreAuthenticity`; observed sessions waive commit penalties (`:70`), `observedBulkPaste` −65 (`:86-89`), `integrityCompromised` −70 (`:95-98`), missing DECISIONS −25.
- `devcase-run.ts:610` — `observedBulkPaste = paste event with size >= PASTE_BULK_CHARS (600)`.
- `pipeline/jobfit/devcase/devcase_cli.py:434-456` — assembles `extras` = promptSignals / canaryOutcomes / baselineSimilarity → `evaluate_submission` + `mint_followups`.
- `pipeline/jobfit/devcase/process_events.py:46-167` — observed signals; `overRelianceFlags: []` "never inferred from process — fairness contract" (`:161`).
- `pipeline/jobfit/devcase/prompt_signals.py:58-109` — verification asks, iteration depth, clarifying questions, `briefPasteRatio` (explicitly "never a score penalty", `:11-15`, `:108`).
- `pipeline/jobfit/devcase/artifact_checks.py:58-176` — canary verdicts (addressed/flagged/propagated/unverifiable) + baseline similarity.
- `pipeline/jobfit/devcase/evaluate.py:129-255` — the scoring prompt; `:330-451` `mint_followups` — the authorship interview.
- `pipeline/jobfit/devcase/submission_eval.py:268-350` — fairness gate: `ai_not_penalised` non-inferiority (±2 pts), `verify_rewarded` ≥5 pts, discrimination ≥5 pts incl. the `ai_no_verify` gamer cohort.
- `pipeline/jobfit/devcase/design.py:28-38` — `_MAX_TIMEBOX_HOURS = 2.0`; senior → **2.0 h**.

## Grounding audit — submission evaluation: **6/9**

Sources the evaluation output *should* use, and whether they reach the prompt
(`evaluate.py:136-158`):

| # | Real context | Reaches prompt? | Evidence |
|---|---|---|---|
| 1 | Role spec | **partial** — only `title` + `seniority` | `evaluate.py:138` (mustHaves/responsibilities reach only `score_transfer`, `:263-268`) |
| 2 | Case rubric dimensions | yes | `evaluate.py:137` |
| 3 | Observed process events | yes | `devcase_cli.py:415` → `process_events.tooling_from_events` |
| 4 | Captured prompt/chat transcript | yes | `devcase_cli.py:437,441-443` |
| 5 | Planted canaries vs submitted tree | yes (when seeded + LLM up) | `devcase_cli.py:438,444-445` |
| 6 | One-shot naive-LLM baseline | yes (when frozen) | `devcase_cli.py:439,446-447` |
| 7 | **The submitted code itself** | **NO** | `evaluate.py:136-141` — `ctx` carries no file bodies or diff |
| 8 | **Authenticity / integrity verdict** | **NO** | computed in TS at `devcase-run.ts:617-630`, merged into the bundle *after* the Python call at `:639-650` |
| 9 | Candidate history / CV / prior pipeline | **NO** | absent from the whole chain |

**6/9.** Item 7 is deliberate and defensible (the design's thesis is that code is
assumed LLM-generated), but it means the artifact is never read; item 8 is a real
seam — the strongest anti-ghostwriting signal the product computes never informs
the score it sits beside.

## Reachability

**`unreachable` today.** Read-only query of `data/kp.sqlite`: `dev_postings = 0`,
`dev_cases = 0`, `dev_sessions = 0`, `dev_submissions = 0`. The only mint path is
Eva's authoring → `/api/devcase/publish` → `app/_lib/distribution.ts:21,37`, which
needs an LLM key. `uat/env.md` open question #3 (candidate-token mint) is still
open, and `env.md` names it "the single biggest L2 blocker".

Consequence: every finding below is scored `reachability: low` and its live impact
is deferred to L2. The **fixture/mint gap itself** is recorded as finding SAM-L1-06.
Per `uat/accepted-gaps.md` the bare-URL 404 is suppressed; the *absence of any way
to mint a token locally* is not.

## Findings

```json
[
  {
    "id": "SAM-L1-01",
    "journey": "dev-case-hire",
    "character": "sam-dev-candidate",
    "cert_level": "L1",
    "type": "broken-flow",
    "severity": "major",
    "dimension": "completion",
    "title": "The live-surface submit is a dead end: no acknowledgement comm and no lifecycle resume — the third intake path skipped the shared trigger",
    "expected": "Submitting the case acknowledges me and moves the process — the same as every other intake path.",
    "got": "submitDevSession calls createSubmission directly; nothing calls intakeSubmission (no ack email) and nothing calls resumeCollectingLifecycle (no auto-evaluate → rank → promote). The submission sits inert until a human opens the workspace.",
    "impact": { "frequency": "high", "reachability": "low", "trust_erosion": "high" },
    "evidence": [
      "app/_lib/db/devcase.ts:950-968 — createSubmission inside the tx, no intakeSubmission",
      "app/api/devcase/session/[id]/submit/route.ts:31-36 — no resumeCollectingLifecycle call",
      "app/api/devcase/inbound/route.ts:44-52 — the webhook path DOES both",
      "app/api/devcase/submit/route.ts:33 — the authed path DOES both",
      "app/_lib/tasks.ts:305-309 — the comment claims 'shared by the authenticated /submit route and the public /inbound webhook … so the resume condition can't drift between the two intake paths'; there are now THREE intake paths",
      "app/devcase/apply/[token]/page.tsx:93-97 — the live surface is the SOLE submit path for workspace cases",
      "app/devcase/apply/[token]/page.tsx:12-20 — the page header claims 'submit through the same inbound webhook external channels use (ack comms + lifecycle resume come free)', which is true only of the DevApplyForm branch"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Submit a live session end-to-end; assert an outbox 'acknowledgement' row is created and the lifecycle advances from 'collecting' without manual intervention."
  },
  {
    "id": "SAM-L1-02",
    "journey": "dev-case-hire",
    "character": "sam-dev-candidate",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "dimension": "time-saved",
    "title": "A senior case is scoped to a 2-hour timebox — 4× my abandonment threshold and 4× the journey's own <30-min anchor",
    "expected": "≈<30 min of real work (jobsbyculture/fullscale research: long take-homes lose 40–60% of strong seniors).",
    "got": "_TIMEBOX['senior'] = 2.0 h, capped at _MAX_TIMEBOX_HOURS = 2.0, and the candidate is shown '~2h timebox' at the top of the brief. The design comment even cites the 40–60% drop-off, then sets the cap at 2 h.",
    "impact": { "frequency": "high", "reachability": "low", "trust_erosion": "med" },
    "evidence": [
      "pipeline/jobfit/devcase/design.py:28-34",
      "pipeline/jobfit/devcase/design.py:251 — '~{timebox}h is a HARD cap'",
      "app/features/sub_dev/DevHelpers.ts:47 — renders '~2h timebox' to the candidate",
      "uat/journeys/dev-case-hire.md:19 — DoD anchor '<30 min'"
    ],
    "code_check": "by-design",
    "verdict": "confirmed",
    "resolution": "open",
    "ceiling": "The cap is a deliberate product decision, and 2 h is far better than the industry's half-day norm — but it does not meet this Character's declared adoption threshold, so the 40–60% senior drop-off the comment cites is only partially mitigated.",
    "l2_priority": "Generate a real senior case and time the actual task list — is the rendered scope genuinely 2 h, or does a 2 h label hide 4 h of work?"
  },
  {
    "id": "SAM-L1-03",
    "journey": "dev-case-hire",
    "character": "sam-dev-candidate",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "dimension": "trust",
    "title": "Paste magnitude is measured and decisively penalised, but the disclosure invites tool use and never mentions it — and a chunked paste evades it",
    "expected": "If a mechanical signal can move me from 'authentic' to 'suspect', tell me it exists.",
    "got": "onPaste records char count; a single paste ≥600 chars sets observedBulkPaste, which costs −65 and drops a clean submission into the 'suspect' band that GATES auto-promotion. The candidate-facing copy says 'You may use any tools, including AI. We never record keystrokes or your screen' — true, but silent about paste measurement. Two consequences: an honest senior who drafts in his own editor and pastes once is flagged; anyone who pastes in three chunks is not.",
    "impact": { "frequency": "med", "reachability": "low", "trust_erosion": "high" },
    "evidence": [
      "app/devcase/apply/[token]/LiveWorkSurface.tsx:344-350",
      "app/_lib/devcase-authenticity.ts:57 (PASTE_BULK_CHARS = 600), :86-89 (−65), :49,:127 (SUSPECT_THRESHOLD gate)",
      "app/_lib/devcase-run.ts:610 — the predicate is 'some single event ≥ threshold'",
      "messages/en.json devApply.workSurface.intro",
      "messages/en.json aiDisclosure.body — human-review promise, no process-measurement line"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Confirm the live copy shown to a candidate; then paste 1×1200 chars vs 3×400 chars into the watched editor and compare the resulting authenticity bands."
  },
  {
    "id": "SAM-L1-04",
    "journey": "dev-case-hire",
    "character": "sam-dev-candidate",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "dimension": "clarity",
    "title": "The page subtitle and the submit-error message both point me at a repository-link form that is not rendered on this branch",
    "expected": "Copy that describes the surface I'm actually on.",
    "got": "The page-level subtitle says 'grab the starter files, and submit a link to your solution repository when you're done', and the live-surface error says 'try again, or use the repository-link option below' — but page.tsx renders LiveWorkSurface XOR DevApplyForm, so when the live surface is up there is no repo option below it. On a failed submit I'd be told to use a control that doesn't exist.",
    "impact": { "frequency": "med", "reachability": "low", "trust_erosion": "med" },
    "evidence": [
      "app/devcase/apply/[token]/page.tsx:96-104 — strict either/or",
      "messages/en.json devApply.subtitle",
      "messages/en.json devApply.workSurface.error"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Render a live token with a seeded case and read the subtitle + force a submit failure to see the error text."
  },
  {
    "id": "SAM-L1-05",
    "journey": "dev-case-hire",
    "character": "sam-dev-candidate",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "dimension": "senior-quality",
    "title": "The 'live-work surface' is a bare textarea — no syntax highlighting, no runner, no way to execute a test I'm being scored for writing",
    "expected": "An editor/runner that doesn't fight me.",
    "got": "A single <textarea> with spellCheck off and a monospace font. Meanwhile the evaluator rewards 'editedTest' (0.5 of the observed verification score) and fluency weights editedTest at 0.3 — I am graded on verification I cannot actually run. My only execution option is to work outside the surface and paste back in, which trips SAM-L1-03.",
    "impact": { "frequency": "high", "reachability": "low", "trust_erosion": "med" },
    "evidence": [
      "app/devcase/apply/[token]/LiveWorkSurface.tsx:341-354",
      "pipeline/jobfit/devcase/process_events.py:108-112 — fluency weights editedTest 0.3",
      "pipeline/jobfit/devcase/evaluate.py:175-179 — obs_verif gives 0.5 for editedTest"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Type a realistic 100-line edit in the live textarea and judge lag, indentation, and whether any execution affordance exists."
  },
  {
    "id": "SAM-L1-06",
    "journey": "dev-case-hire",
    "character": "sam-dev-candidate",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "dimension": "completion",
    "title": "No dev-case fixture or local token-mint path exists — my entire journey is untestable, not passing",
    "expected": "A documented way to mint a candidate apply token locally (env.md open question #3).",
    "got": "dev_postings/dev_cases/dev_sessions/dev_submissions all 0 rows in data/kp.sqlite. The only mint path is publish, which needs Eva's authoring plus an LLM key.",
    "impact": { "frequency": "high", "reachability": "low", "trust_erosion": "low" },
    "evidence": [
      "data/kp.sqlite (read-only): SELECT COUNT(*) FROM dev_postings → 0; dev_cases → 0",
      "app/_lib/distribution.ts:21,37 — token minted only at publish",
      "uat/env.md:127,131-133 — 'the candidate-token fixture is the single biggest L2 blocker'"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Blocks L2 entirely. Resolve the mint path (seed script or dev-only listing) before scheduling Sam's live run."
  },
  {
    "id": "SAM-L1-07",
    "journey": "dev-case-hire",
    "character": "sam-dev-candidate",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "dimension": "trust",
    "title": "The authenticity/integrity verdict never reaches the evaluation prompt it sits beside",
    "expected": "If the system computes tamper-evidence and a paste tell, the scorer should know.",
    "got": "scoreAuthenticity runs in TypeScript AFTER the Python chain returns and is merged into the persisted bundle; evaluate_submission's ctx contains no authenticity or integrity field. The score and the authorship verdict are computed independently and only co-displayed.",
    "impact": { "frequency": "med", "reachability": "low", "trust_erosion": "med" },
    "evidence": [
      "app/_lib/devcase-run.ts:617-630 then :639-650 (merge is post-hoc)",
      "pipeline/jobfit/devcase/evaluate.py:136-144 — ctx = role/rubric/reflection/tooling(+extras) only"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Check Eva's panel: is the authenticity band visibly bound to the score, or are they two unrelated numbers a reviewer must reconcile?"
  },
  {
    "id": "SAM-L1-08",
    "journey": "dev-case-hire",
    "character": "sam-dev-candidate",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "dimension": "clarity",
    "title": "The submitted state is a dead-end card: no reference, no status link, no expected timeline",
    "expected": "Evidence my effort entered a real queue I can check.",
    "got": "A static thank-you: 'The team will review it.' No submission id, no /status/[token] link, no SLA. Combined with SAM-L1-01 (no ack comm), the loop closes on nothing.",
    "impact": { "frequency": "high", "reachability": "low", "trust_erosion": "med" },
    "evidence": [
      "app/devcase/apply/[token]/LiveWorkSurface.tsx:297-304",
      "messages/en.json devApply.workSurface.submitted",
      "uat/env.md:110-112 — /status/[token] exists and is not linked from here"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "After a live submit, look for any reachable status surface from the confirmation."
  },
  {
    "id": "SAM-L1-S1",
    "journey": "dev-case-hire",
    "character": "sam-dev-candidate",
    "cert_level": "L1",
    "type": "strength",
    "severity": "polish",
    "dimension": "trust",
    "title": "The fairness contract against penalising AI use is encoded in code and gated by a test harness, not asserted in copy",
    "impact": { "frequency": "high", "reachability": "low", "trust_erosion": "low" },
    "evidence": [
      "pipeline/jobfit/devcase/process_events.py:161 — overRelianceFlags never inferred from tool use",
      "pipeline/jobfit/devcase/prompt_signals.py:11-15 — briefPasteRatio aims the interview, never scores down",
      "pipeline/jobfit/devcase/evaluate.py:25-28 — 'using AI is not a negative' in the system prompt",
      "pipeline/jobfit/devcase/submission_eval.py:283-291 — ai_not_penalised non-inferiority gate, MIN_VERIFY_MARGIN 5.0",
      "pipeline/jobfit/devcase/submission_eval.py:319,327-328 — an explicit ai_no_verify 'gamer' cohort must score below strong"
    ],
    "code_check": "n-a",
    "verdict": "confirmed",
    "resolution": "by-design",
    "ceiling": "The gate certifies a SYNTHETIC scenario landscape (submission_scenarios.py), not real candidates; keyless it runs the deterministic path, and a not_evaluable gate exits zero."
  },
  {
    "id": "SAM-L1-S2",
    "journey": "dev-case-hire",
    "character": "sam-dev-candidate",
    "cert_level": "L1",
    "type": "strength",
    "severity": "polish",
    "dimension": "senior-quality",
    "title": "Probe-safety, honest closure, draft durability, and the server-recorded event kinds are all done right",
    "impact": { "frequency": "high", "reachability": "low", "trust_erosion": "low" },
    "evidence": [
      "app/features/sub_dev/DevHelpers.ts:42-58 — probes structurally cannot render to the candidate",
      "app/devcase/apply/[token]/page.tsx:34-42 — closed posting refuses honestly instead of ghosting",
      "app/devcase/apply/[token]/LiveWorkSurface.tsx:57-90,188-194 — localStorage draft + offline re-buffer",
      "app/api/devcase/session/[id]/route.ts:44,89-99 — 'prompt' and 'perturbation' are server-recorded and absent from the client allow-list, so the timeline can't be forged",
      "app/api/devcase/session/[id]/submit/route.ts:21-26 — closed-posting 410 parity with the webhook"
    ],
    "code_check": "n-a",
    "verdict": "confirmed",
    "resolution": "by-design",
    "ceiling": "Draft durability is per-device (localStorage); switching machines mid-case falls back to the ≤8 s server flush."
  }
]
```

## Headline question — can this case discover *my mentality* when I use LLM tools?

**Answer, from the seat of the person being judged: mostly yes — and this is the
first assessment I've seen that earns that answer in code rather than in marketing
copy. But it grades my mentality with one hand and my artifact with the other, and
two of its sharpest instruments are dormant or evadable.**

**Could I ace it by pasting the brief into Claude and submitting the output?**
No — not cleanly, and I can show you where it breaks:

1. The work happens *inside* the watched editor, so there is no artifact-only path.
   A single ≥600-char paste sets `observedBulkPaste` (`devcase-run.ts:610`), costs
   −65 (`devcase-authenticity.ts:86-89`), lands me in `suspect`, and **holds me for
   an ownership-verifying interview instead of auto-advancing** (`:10`, `:49`).
2. The seed carries **planted flaws with known ground truth** I was never told
   about (`seed_materializer.py:34-36,157-160`). A one-shot generation propagates
   them; `canary_outcomes` marks each `addressed | flagged | propagated`
   (`artifact_checks.py:98-108`), and `_descends_from_seed` (`:41-47`) closes the
   obvious dodge — rewriting the file from scratch scores `unverifiable`, not a
   free pass.
3. The case was **already solved once by a bare model at freeze time**
   (`baseline.py:1-15`), and my delta is diffed against that frozen naive solve
   (`baseline_similarity`, `:135-176`). If what I submit is what a bare model
   produces unattended, that is visible as a number.
4. A **mid-flight requirement change** fires server-side after ~a third of the
   timebox (`session/[id]/route.ts:86-99`, `design.py:377`), and my edits *after*
   the reveal are counted (`process_events.py:78-84`). One-shot delegation
   submits against the stale brief and the evidence line says so verbatim
   (`process_events.py:156`).
5. The eval's real output isn't the score — it's `mint_followups`
   (`evaluate.py:330-378`), which states outright that the submission "may be
   ENTIRELY LLM-produced" and treats every score as "a hypothesis to VERIFY LIVE",
   then anchors each question to one observed decision and asks for the rejected
   alternative and the counterfactual. That is the right instrument. You cannot
   reconstruct a trade-off you never made.

**What does the system actually see of me?** Which files I opened before I edited
them (`readBeforeWrite`, `process_events.py:63-69`), whether I kept the decision
log warm, whether I touched a test, my full **assistant and stakeholder
transcripts** — persisted verbatim and scored for iteration depth, verification
asks, and clarifying questions (`prompt_signals.py:58-93`) — how I adapted to the
mid-flight change, and a tamper-evident hash chain over the whole log
(`devcase-run.ts:617-619`). That is process, not artifact. It is the right thing
to look at.

**Is AI use disclosed, penalised, or measured as a skill?** Measured as a skill,
and unusually honestly. The assistant is *supplied in-product* and the copy says
"good questions and good prompts count in your favor"
(`devApply.workSurface.chatIntro`). The fairness contract is load-bearing code:
over-reliance is never inferred from tool use (`process_events.py:161`), a
verbatim brief paste "only AIMS the authorship interview — it never scores the
candidate down" (`prompt_signals.py:11-15`), and a gated harness asserts
AI-verifiers are not scored below non-verifiers while an `ai_no_verify` gamer must
score materially lower (`submission_eval.py:283-291,319,327-328`). Nobody else is
doing this.

**Where it does not see me, and where the honest candidate can still lose:**

- **It never reads my code** (grounding item 7 — `evaluate.py:136-141` carries no
  file bodies). Defensible given the thesis, but it means every judgment about
  *what I built* is mediated through derived signals.
- **Two of the three anti-delegation instruments are LLM-dependent and fail
  silent.** Keyless, canaries are `[]` (`seed_materializer.py:118-120`) and the
  baseline is `{"solutions": []}` (`baseline.py:13-15`, orchestrator
  `:262` "baseline_unavailable — submissions will not be baseline-diffed"). The
  degradation is honest — and it reduces the whole apparatus to process events,
  prompt signals, and paste magnitude.
- **The paste control is trivially evadable and asymmetrically unfair.** The
  predicate is *one* event ≥600 chars. Three 400-char pastes: clean. My own
  carefully-written 700-char function, drafted in my editor because the surface
  has no runner (SAM-L1-05): suspect. That is precisely the failure mode you asked
  about — the honest candidate loses to the quieter one. Not because a better
  model wins, but because the control keys on paste *shape*, not authorship, and
  is undisclosed (SAM-L1-03).
- **The authenticity verdict never informs the score** (SAM-L1-07). The system's
  best authorship evidence sits beside the number instead of inside it.

**Would I feel fairly seen?** Yes, in kind — this design looks at the thing that
actually matters in 2026, and it says so in code I can read. But I'd feel *only
partly* seen: the loop it opens (an authorship interview minted from my real
decisions) is the whole payoff, and on this branch nothing automatically carries me
there — no acknowledgement, no lifecycle resume, no status surface (SAM-L1-01,
SAM-L1-08). **It discovers mentality by design and grades output by default: the
process apparatus is genuinely first-class, but it is gated behind an LLM key, an
undisclosed and evadable paste heuristic, and a submit that currently ends in
silence.**

## Character feedback — Sam Okafor, first person

I'll say the thing I never get to say: someone here actually thought about this.

I opened the link expecting the usual — a brief, a repo, three hours of my evening,
and silence. Instead the brief is short, the starter files are right there, and the
intro tells me straight that my process is what's being watched and that I can use
any tools including AI. Then it *hands me the AI*. And a stakeholder I can ask
questions of. That's not a test dressed up as real work; that's closer to a Tuesday.
The paragraph that got me was "good questions and good prompts count in your favor."
Fine. Now we're talking about the actual job.

And it isn't naive. I went looking for the seams and found planted flaws in the
seed with known answers, a frozen one-shot model solve of my own case to diff me
against, a requirement change that fires mid-flow, and a follow-up interview minted
from decisions I actually made — with the internal note that the whole submission
might be LLM-written and every score is a hypothesis to check live. That's the
correct posture. Anyone selling you an AI-proof take-home is lying; this one instead
says "we'll verify authorship in a conversation anchored to your specific calls."
I'd show up to that conversation. I'd probably enjoy it.

Now the parts that would annoy me.

The editor is a textarea. Not a metaphor — a `<textarea>`. No highlighting, no
indent handling, and nothing to run. Meanwhile you're scoring me on whether I
edited a test. I can't *run* the test. So I'll do what every engineer does: write
it properly in my own editor and paste it back — and that paste is silently
measured, and one chunk over 600 characters drops me into "suspect." You told me to
use any tools and then instrumented the one gesture that using tools requires,
without saying so. I'd find that out afterwards and I'd resent it. Worse, it doesn't
even work: anyone who guesses just pastes in thirds. It catches me and misses them.

Two hours for a senior. Your own source comment cites the 40–60% drop-off and then
sets the cap at two hours. Better than the industry — but for me on a Tuesday
evening, unpaid, on spec? That's still a maybe, not a yes. Thirty focused minutes
and I'd be in without thinking.

And then I hit submit and it ends. A thank-you card. No reference number, no status
link, no "you'll hear from us by Friday." I dug into the code — there's no
acknowledgement email and the pipeline that would evaluate my work isn't even woken
up by my submitting; the other two submit paths do both, mine does neither. So the
one thing I told you I care about most — *evidence my effort produced a signal a
human acted on* — is exactly the thing that's missing. That's the ghosting shape,
just with better instrumentation upstream. The page copy also tells me to submit a
repo link and, if submitting fails, to use the repo option "below," which isn't
there. Small, but it's the tell that nobody walked this path as me.

Would I adopt it? I'd finish this case — genuinely, because the case is interesting
and the mid-flight change is a nice touch. Would I tell a peer? Yes, with a caveat:
"the assessment is the best-designed one I've seen, the editor is a text box, and
you'll hear nothing back." Fix the runner, tell me you measure pastes, and make
submit actually kick something off with an email and a status link — and I'd stop
caveating.

One last thing, and I mean it as praise: the fairness rules aren't a marketing page,
they're in the scoring code with a test gate that fails if AI users get penalised.
I checked. That bought you more trust than any copy on the page.
