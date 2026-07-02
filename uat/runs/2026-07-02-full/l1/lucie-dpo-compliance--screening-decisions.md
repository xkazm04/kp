# L1 — Lucie Procházková (DPO / Fairness & Compliance) × screening-decisions

- **Run:** 2026-07-02-full · main @ 3395b4c · cert level: **L1 (theoretical, code-derived)**
- **Verdict:** **L1-conditional** — the Art. 22 human-in-the-loop gate and the tamper-evident decision chain are structurally real (no blocker), but three majors stand: unscored candidates auto-rejectable on a fabricated "match 0", no automated-decision disclosure/contest channel in the rejection sent to the subject, and sealed records of human decisions that omit the AI recommendation they ratified.
- **Grounding score:** wave engine **4/6** · AI screening card **3/6**
- **Time saved (designed):** decision-trail audit collapses from days of reconstruction per system to reading/exporting a built-in verified chain — est. **~4–6 h saved per audit cycle** on this slice · confidence **medium-low** (conditioned on SD-L1-004: for human-ratified AI decisions I would *still* reconstruct what the AI told the human — the exact threshold my motivation names)

## Reachability (resolved before judging)

Internal user, dev gate on; my binding is **Decisions (records/audit) + Analytics (decision logs)** plus consent/disclosure surfaces wherever AI touches a candidate. Decisions tab: `tabs.ts:103`; Analytics tab: `tabs.ts:137` → `AnalyticsTab.tsx:327` renders `DecisionRecordsPanel`. No per-role gating — everything below is in-set. Fixture dependency: a run with committed auto-rejections to audit (L2 preflight). No out-of-set findings.

## The compliance surface model (what I audited, affordance → code)

**1. Human-in-the-loop on the adverse path (GDPR Art. 22 / AI Act oversight) — structurally sound.**
- The wave *always* previews: dry-run on open + every change (`ScreenWaveModal.tsx:61-96`), server-honored with zero mutation/comms/audit-writes (`screen-wave.ts:237-241`, `route.ts:31`).
- A commit **must** carry the `approvalToken` — a SHA-256 signature of the *exact* reject set under the *exact* policy (`screen-wave-approval.ts:16-23`), recomputed server-side from the live cohort; missing → 409 "approval required", stale → 409 "set changed, re-preview" (`screen-wave.ts:174-185`, `route.ts:38-48,54-56`). The commit loop reads from the same `wouldReject` set that was signed, so the committed set cannot diverge from the reviewed one (`screen-wave.ts:211-213`).
- The human can reverse the AI: reconsider queue → reinstate, guarded + audited (`pipeline.ts:428-456`), **and the reversal itself is sealed into the chain** (`api/pipeline/[id]/route.ts:179-187`) — an overturned rejection is not an audit hole.
- Fairness shielding is server-side and **fails closed**: early-career and any unknown/renamed archetype are never auto-rejected (`screen-wave.ts:169,198` → `archetypes.ts:58-68`); an unknown archetype writes a drift marker on commit (`screen-wave.ts:202-204`). Tie-break refuses to split equal scores across the cutoff, resolved in the candidate's favour (`decision-config-schema.ts:249-258`).

**2. The decision record (my regulator-handable artifact) — real, with named gaps.**
- Every committed auto-reject seals a hash-chained record: kind, actor `auto:screen-wave`, `policyVersion` = `screen-wave/bottom{pct}/maxMatch{n}`, candidateRef, byte-stable English rationale, reasonCode, decisive inputs incl. `approvedBy` (`screen-wave.ts:263-272`). Human accept/reject and offer terms are sealed too (`api/pipeline/[id]/route.ts:249-260,57-66`).
- Chain integrity is recomputable: `verifyDecisionChain()` re-hashes every link (`decision-record-store.ts:173-191`); the panel headlines the verdict badge and exports the whole chain + localized rationale in one click (`DecisionRecordsPanel.tsx:94-104,52-62`). The sealed English string is never touched — localization renders from the structured mirror (`:34-50`). Correct instinct: the hash stays stable, the reader stays Czech.
- **Gap (SD-L1-004, major):** when a recruiter ratifies an *AI screening recommendation* (AiReviewCard accept/reject), the sealed record's inputs are only `{ fromStage, detail }` with rationale defaulting to "Recruiter accept from Screened" (`api/pipeline/[id]/route.ts:249-259`). The AI's verdict/confidence/model that the human acted on lives in mutable `approval_detail` (`automation-run.ts:224`) and is *cleared* after the decision — the dossier can't show what the AI told the human. My provenance criterion (model/version + inputs) fails here.
- **Gap (SD-L1-005, minor, honest seam):** `approvedBy` defaults to the constant "operator (single-operator deployment)" unless `KP_OPERATOR_NAME` is set, and the request may supply any unauthenticated string (`route.ts:43-48`, `operator-approver.ts:11-13` — the code names this seam itself). Deployment precondition for me: set the name, and don't accept it from the client.
- **Gap (SD-L1-008, minor):** the per-subject dossier exists server-side (`/api/decisions/records?candidate=` — `records/route.ts:17`) but **no UI passes the param** (`DecisionRecordsPanel.tsx:26` fetches unscoped; grep confirms no consumer). A DSAR/right-to-explanation response is export-everything-and-filter today.

**3. Disclosure to the data subject — the weak leg.**
- **SD-L1-003 (major):** the rejection e-mail an auto-rejected candidate receives says "After careful review, we won't be moving forward" (`messages/en.json comms.rejection.opening`, dispatched by `comms-dispatch.ts:194-205`) — no disclosure that automated processing was involved, no route to request human intervention or contest (Art. 22(3)), and "careful review" arguably *misrepresents* a threshold rule with batch human approval. The GDPR data-access footer (`comms-dispatch.ts:93-98`) is good but is erasure, not contestation. The reconsider path exists — recruiter-initiated only; the subject is never told it exists.
- Pre-processing AI disclosure/consent lives on the apply surfaces (out of this journey's walk; the jurisdiction picker that frames it is here — `ComplianceSection.tsx:87-109`). I judged only the rejection-time disclosure here.

**4. Input integrity — the number the whole wave stands on.**
- **SD-L1-002 (major):** `matchScore ?? 0` (`screen-wave.ts:141,168`) makes a **never-scored** candidate the worst-ranked and below any threshold — auto-rejectable with a sealed rationale asserting "match 0 < 45", a fabricated figure for a missing measurement. The cohort filter (`:140`) has no null-score exclusion; the preview shows them as "match 0", indistinguishable from a genuine zero, so the human gate can't meaningfully catch it. An adverse automated decision computed on absent data is exactly what I cannot defend.
- Otherwise input handling is disciplined: overrides validated + clamped at the route *and* re-validated at the destructive operation (`route.ts:26-27`, `screen-wave.ts:137-138`) — a malformed override is a 400, never a silent mis-reject.

**5. Honest posture (strength).** The compliance section states covered items vs named ceilings — explicitly *not* claiming protected-class monitoring it can't do (no demographic data), with the four-fifths check running purely in-browser on pasted counts (`ComplianceSection.tsx:14-20,119-147,149-208`). I trust a build more when it names its own seams; this one does, repeatedly (`operator-approver.ts:6-10`, `pipeline.ts:425-427`).

## Scored acceptance criteria (applied identically every run)

| Criterion | Verdict |
|---|---|
| trust/blocker — scored+rejected with NO disclosure, NO HITL, NO record | **not triggered** — HITL (token gate) + sealed record + apply-time disclosure are structurally present → no blocker |
| trust — AI-use disclosure + consent before processing, plain-language | apply-surface (other journey); **rejection-time disclosure absent → SD-L1-003 major** |
| trust — provenance on every headline AI output (model, inputs, timestamp, human) | wave: pass (policy numbers + approver + timestamp sealed); **human-ratified AI decisions: fail → SD-L1-004 major**; approver identity generic/unauthenticated → SD-L1-005 minor |
| completion — HITL override on the reject path, recorded, reversible | **pass** — preview/token gate + reconsider/reinstate, reversal sealed |
| senior-quality — record regulator-handable as-is | **conditional** — auto-reject records yes (with SD-L1-002/005 caveats); human-decision records too thin |
| clarity — group/fairness evaluation explains ranking | out of scope here → `group-eval-fairness.md` |
| missing — exportable/inspectable audit trail | **pass** — verified chain + one-click JSON dossier (`DecisionRecordsPanel.tsx:52-62`) |

## Ship-bar evidence (public product path)

- **SD-L1-010:** `/api/decisions/screen-wave|records|reconsider` have **no in-route auth or tenant scoping** (`screen-wave/route.ts:12`, `records/route.ts:14`, `reconsider/route.ts:9`), and `decision_records` has no workspace column (`decision-record-store.ts:56-71`) — one global chain. On the multi-workspace path (`uat/env.md` notes real cookie auth + tenancy) the sealed chain and reconsider queue would cross tenants. Low reachability today (single-operator deployment), must-fix before public. L2: probe unauthenticated access.
- Comms delivery is a durable local outbox by default, real relay only when `COMMS_WEBHOOK_URL` is set (`comms-dispatch.ts:11-16`) — honest, but "the candidate was notified" in an audit sense is relay-dependent. Ceiling, not defect.

## Findings (mine — full schema in `screening-decisions.findings.json`)

SD-L1-002 (major), SD-L1-003 (major), SD-L1-004 (major), SD-L1-005 (minor), SD-L1-008 (minor), SD-L1-010 (major, low-reachability ship-bar). Strengths SD-L1-S1..S4, S6.

## Character feedback (first person, Lucie)

„Přišla jsem připravená škrtat a musím uznat: brána podle článku 22 tady není marketingová věta, je to podmínka v kódu. Commit bez tokenu z náhledu server odmítne; token je podpis přesně té množiny, kterou člověk viděl; když se kohorta mezi náhledem a potvrzením změní, systém odmítne razítkovat a vynutí nový náhled. Zvrácení rozhodnutí se pečetí do stejného řetězu jako rozhodnutí samo — auditní stopa se zaceluje, ne přepisuje. A ochrana ‚fail-closed' pro neznámý archetyp je přesně ten reflex, který u dodavatelů nevídám. Řetěz s ověřitelným hashem a exportem na jedno kliknutí — to bych regulátorovi na stůl položila.

Tři věci ale podepsat nemůžu. Za prvé: kandidát bez skóre je v matematice vlny nula — a nula je pod každým prahem. Zapečetěný záznam pak tvrdí ‚match 0', číslo, které nikdy nebylo naměřeno. Automatizované zamítnutí spočítané nad chybějícími daty neobhájím. Za druhé: e-mail, který automaticky zamítnutý kandidát dostane, říká ‚po pečlivém posouzení' — ani slovo o automatizovaném zpracování, žádná cesta, jak si vyžádat lidský přezkum. Interní ‚reconsider' fronta je hezká, ale subjekt údajů o ní neví. Za třetí: když člověk potvrdí doporučení AI z karty, do řetězu se zapíše ‚Recruiter accept' — a to, co mu AI řekla, se smaže. U dossier ‚práva na vysvětlení' bych tedy zase rekonstruovala, co viděl člověk, když rozhodoval — a přesně od toho mě tenhle nástroj měl osvobodit. Opravte tyhle tři věci a dám tomu před 2. srpnem podpis; do té doby je to ‚slibné, s výhradami' — což je, přiznávám, víc, než u AI náboru říkám obvykle."
