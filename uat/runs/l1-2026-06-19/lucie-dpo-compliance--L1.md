# L1 (theoretical, code-grounded) — Lucie Procházková, DPO / Fairness & Compliance Officer

Run: l1-2026-06-19 · Character: `lucie-dpo-compliance` · Mode: L1 (no browser) · Language she reads in: cs
Surface binding: authed workspace, compliance lens — **Decisions** (records/audit), **Analytics** (decision log, calibration), and the **consent / AI-disclosure / provenance** surfaces. She reviews, never authors.

Reachability resolved first (rubric §reachability): `decisions` and `analytics` are both in `NAV_GROUPS` with **no per-role gating** (`app/features/tabs.ts:103,137`), so once the dev gate is on every surface she audits is reachable. The candidate-facing disclosure she inspects lives on the tokenized apply pages (`/apply/[id]`, `/apply/[id]/quick`) — reachable in code; live confirmation deferred to L2 (token-mint fixture, `env.md` open-Q #3).

---

## Per-journey verdicts

| Journey | Verdict | Blockers | Majors | Minors | Strengths |
|---|---|---|---|---|---|
| screening-decisions | **L1-conditional** | 0 | 2 | 1 | 4 |
| group-eval-fairness | **L1-pass** | 0 | 0 | 1 | 3 |
| analytics-calibration | **L1-pass** | 0 | 1 | 0 | 3 |

No journey is L1-fail: on the surfaces Lucie reads, a human-in-the-loop gate, an AI disclosure, a provenance trail and an auditable decision record all **exist in code**. The conditional/major findings are about *coverage and consistency* of those controls, not their absence — which is exactly the kind of gap she would catch in a readiness review and exactly why she doesn't sign on the demo.

---

## Journey 1 — Screening decisions & defensible record (`screening-decisions`)

### Compliance / grounding audit
- **Human-in-the-loop — interactive wave (PASS).** The `ScreenWaveModal` dry-runs on open and on every slider change (`app/features/sub_decisions/ScreenWaveModal.tsx:57-92`), shows exactly who *would* be rejected with per-row rationales, and only an explicit **"Reject and notify"** commit (`:94-112`, `dryRun:false`) mutates anything. The route honors `dryRun` with full math / zero mutation (`app/api/decisions/screen-wave/route.ts:21-25`). A named human authorizes the batch. Good.
- **Scheduled automation pass — human-in-the-loop default (PASS, with a caveat below).** The unattended policy pass defaults `rejectMode` to **`"approve"`** (`app/_lib/scheduler-store.ts:97` — anything ≠ `"auto"` → approve), which **queues** each reject onto the human Decisions gate (`setApproval(...,"rejection_review")`, `app/_lib/automation-pass.ts:288-306`) instead of applying + emailing. The reject only goes out through the human route. This is the Art. 22 safeguard I want as the default.
- **Fairness shielding fails CLOSED (STRENGTH).** Early-career *and* any unknown/renamed archetype are shielded from auto-reject (`app/_lib/screen-wave.ts:152-162`, `isFairnessProtected`); an unrecognized archetype is recorded as `fairness_gate_unknown_archetype` rather than silently rejected. The automation pass re-asserts the same invariant as defense-in-depth before applying (`automation-pass.ts:279-287`). A protected candidate cannot be auto-rejected by drift.
- **Tamper-evident decision record (STRENGTH).** A committed screen-wave reject seals a hash-chained record — actor (`auto:screen-wave`), `policyVersion`, the decisive inputs, rationale, timestamp — into a System of Record (`screen-wave.ts:215-223` → `app/_lib/decision-record-store.ts:111-144`), and `verifyDecisionChain()` recomputes the chain to prove no after-the-fact edit (`:173-191`). `DecisionRecordsPanel` leads with that verify badge and exports the dossier in one click (`app/features/sub_analytics/DecisionRecordsPanel.tsx:62-72,27-30`). This is genuinely the regulator-handable artifact I ask for — protect it.
- **Reconsider path (PASS).** `/api/decisions/reconsider/route.ts:9` projects the auto-rejected cohort back for a fresh look — no silently-terminal rejection.

### Findings
- **MAJOR (trust, `quality-gap`) — the most autonomous reject path does NOT seal a decision record.** In `rejectMode:"auto"` (explicit opt-in) the pass applies + emails a reject fully unattended (`automation-pass.ts:307-326`) via `actOnPipelineEntry(...,"reject",...,{actor:"system"})`. That writes the `auto_rejected` *audit event* (visible in the DecisionLog) but **never calls `sealDecisionSafe`** — confirmed: no seal in `actOnPipelineEntry`/`db.ts`/`pipeline.ts`. Only the screen-wave path seals (`screen-wave.ts:215`). So the tamper-evident System of Record — the artifact I'd hand a regulator — is *incomplete precisely for the path with the least human oversight*. A solely-automated significant decision with only a mutable event row and no sealed record is the weakest possible audit posture. `l2_priority`: confirm a live `auto`-mode reject is absent from `/api/decisions/records`.
- **MAJOR (trust, `confusion`) — disclosure copy promises per-decision human review the `auto` path doesn't honor.** The candidate disclosure states *"Každé rozhodnutí o postupu, nabídce či zamítnutí přezkoumává a činí člověk; nic nepříznivého se nerozhoduje automaticky"* (`messages/cs.json:461`). That is true under the `approve` default and the interactive wave, but **false** under `rejectMode:"auto"` (an applied + emailed reject with no human in the loop). A disclosure that can be contradicted by a config toggle is a representation risk, not just copy. Either gate the `auto` mode off for production tenants or qualify the sentence. `l2_priority`: verify which mode ships as default at the tenant level.
- **MINOR (clarity) — the screen-wave audit `rationale` is persisted English-only** (`screen-wave.ts:22-23,174`); the Czech rendering is UI-side via `reasonCode` (`ScreenWaveModal.tsx:122-132`). Defensible (the byte-stable audit string is deliberate), but a cs regulator reading the raw `decision-records.json` export sees English rationales. Worth a note, not a blocker.

### Verdict: **L1-conditional** — completes structurally with a real human gate and a real sealed record, but the two majors (seal-coverage asymmetry + a disclosure the `auto` mode can falsify) carry to L2.

---

## Journey 2 — Group evaluation & fairness (`group-eval-fairness`)

### Compliance / grounding audit
- **Source disclosure on every AI output (STRENGTH).** The AI compare verdict carries an explicit `aiBacked ? "AI-backed" : "rule-based"` pill (`app/features/sub_decisions/group-eval/AiVerdict.tsx:34`), and the fairness matrix discloses `llm`-tuned vs rule-based weights (`FairnessPanel.tsx:35-37`). A non-disclosed AI verdict acting on a candidate is my classic peeve; here the provenance of the reasoning is on the face of the panel.
- **Reasoned, not black-box (STRENGTH).** The fairness panel renders a real cross-scheme matrix — each candidate re-scored under every candidate's bounded weighting, a mean, a robust order, and per-candidate weight-adjustment notes (`FairnessPanel.tsx:43-101`); when no weighting actually diverged it says so plainly (`:20-27`) instead of theater. It even flags when the robust order *diverges* from the headline (`:89-91`). This answers "why did one outrank another."
- **Knockout integrity (STRENGTH, code-grounded via journey pointer).** The ko-aware sort means a must-have-failing candidate can't be crowned lead, and the lead is sealed to the decision record only when ko passes (`group-eval-run.ts:351,402` per the journey's grounding map). A fair lead, recorded.
- **Grounding (PASS).** Per-candidate the eval is fed the full deterministic recruiter breakdown + the candidate's own salary expectation + the role band (`group-eval-run.ts:135,156,191`), not labels alone — so the "compare all" narrative is the senior-quality input I'd expect.

### Findings
- **MINOR (clarity) — fairness matrix degrades to "uniform / adds nothing" when weights weren't adjusted** (`FairnessPanel.tsx:20-27`). Honest and correct, but for an auditor it can read as "no fairness check ran." A one-line "we tested cross-scheme; weights converged, so order is robust" framing would read as a *passed* check rather than an absent one. Polish-adjacent; doesn't threaten the job.

### Verdict: **L1-pass** — structurally sound for my lens. The reasoning is legible, the AI/deterministic source is disclosed, the lead passes the must-haves. `l2_priority`: confirm the live matrix renders with real per-candidate divergence (not identical cells) and the disclosure pill reflects the actual generation path.

---

## Journey 3 — Analytics & calibration (`analytics-calibration`)

### Compliance / grounding audit
- **Calibration is MEASURED, not asserted (STRENGTH — the crux).** `computeCalibration` bins real `(score, advance/pass-outcome)` pairs into a reliability curve + Brier score (`app/_lib/calibration.ts:62-99`); the route reads **every** saved-analysis row tenant-scoped (`app/api/analytics/calibration/route.ts:18`, `currentWorkspace()`), not a sample. No hardcoded confidence anywhere in the path.
- **Honest "not yet calibrated" gate (STRENGTH).** Below `MIN_CALIBRATION_OUTCOMES = 20` (`calibration.ts:15`) the panel refuses to draw a curve and says exactly how many more outcomes are needed (`CalibrationPanel.tsx:94-102`). A vendor that admits "I can't prove this yet" earns more trust from me than one that draws a confident line on five points. This is the opposite of the precision-theater I'm trained to reject.
- **Decision log attribution is three-state on purpose (STRENGTH).** An unmapped event kind renders `UNKNOWN`, never defaults to `auto` — because in an auditable log defaulting accountability to the machine is the most damaging error (`app/_lib/decision-attribution.ts:84-87,82` and `DecisionLog.tsx:46-53`). The log is filterable by auto/human and CSV-exportable (`DecisionLog.tsx:122-135`). Auto vs human is never silently misattributed.
- **Decision records export (PASS).** `/api/decisions/records` returns the records + a global chain verdict; the panel exports the whole chain for a right-to-explanation request (`DecisionRecordsPanel.tsx:25-30`).

### Findings
- **MAJOR (trust, `quality-gap`) — the audit trail Lucie reads here is split across two stores with different integrity guarantees, and the autonomous-reject gap (Finding from Journey 1) lands *here*.** Lucie's audit surface is two siblings: the **DecisionLog** (mutable `automation_events` rows, every kind, including `auto`-mode `auto_rejected`) and the **DecisionRecordsPanel** (the tamper-evident hash chain — today only screen-wave seals). An auditor reading the *tamper-evident* panel sees an incomplete picture of autonomous rejections; the *complete* picture is in the *mutable* log. For a "hand it to a regulator" claim, the strong-integrity store should cover every solely-automated significant decision, not a subset. Same root cause as Journey 1's major; recorded here because this is the surface where she'd notice the asymmetry. `l2_priority`: with seeded `auto`-mode rejects, confirm whether they appear in `/api/decisions/records` or only in the DecisionLog.

### Verdict: **L1-pass** — every headline number ties to a source, calibration is real and honestly gated, and the decision log is reachable + exportable. The one major is a consistency gap in audit-store coverage, not a missing control. `l2_priority`: seed outcomes → confirm the reliability curve renders from real pairs and the "calibrated since N" gate is honest; cs-only labels in the dashboard.

---

## First-person feedback — Lucie's voice

I came in expecting the usual: a beautiful funnel and no answer to "who made the final call on this rejection, and where is it written down?" I was wrong about the second half, and I want to say so plainly, because a real audit trail is worth protecting.

The good is genuinely good. The screening wave *previews before it mutates* — I can watch the count change, see a rationale per candidate, and nothing happens until a person clicks "reject and notify." The fairness shield **fails closed**: an unknown archetype isn't quietly rejected, it's recorded as a desync. The scheduled pass defaults to *queuing* rejects for a human, not firing them. The decision record is hash-chained and the panel leads with a tamper-evidence badge — that is the artifact I'd put in front of a supervisor. And the calibration panel does the one thing almost no vendor does: it *refuses to draw a confidence curve* until it has twenty real outcomes and tells me how many more it needs. That honesty buys more of my trust than any precision claim would.

Now the part that stops me signing today. There is an `auto` reject mode where a candidate is rejected *and emailed* with no human in the loop — and that path, the one with the least oversight, is the one that **does not seal a tamper-evident record**. It writes a mutable event, yes, but the strong-integrity System of Record I'd hand a regulator covers the *supervised* wave and skips the *unsupervised* pass. That is backwards. Worse, my candidate disclosure promises in plain Czech that "nothing adverse is decided automatically" — true under the default, *false* the moment someone flips that toggle. A disclosure a config switch can contradict is a representation I can't defend.

So: not a fail. The machinery is here, the defaults are sane, the honesty is real. But before 2 August 2026 I need two things — seal *every* solely-automated reject into the tamper-evident chain (not just the supervised one), and either disable `auto` mode for our tenant or make the disclosure tell the truth about it. Fix those and I can certify this. Leave them and I'm one config toggle away from a headline.

Would I tell a peer? Yes — as the rare AI-hiring tool that *built* the audit trail instead of promising to reconstruct it later. With the two caveats above, in writing.
