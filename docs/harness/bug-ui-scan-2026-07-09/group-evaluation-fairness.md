# Group Evaluation & Fairness — bug-hunter + ui-perfectionist scan

> Context: Side-by-side group evaluation of shortlisted candidates with per-candidate tabs, comparison tables, differentiators, risks and a weighting-robustness ("fairness") panel.
> Files reviewed: 14 of 21
> Total: 5

## 1. Governance mode is unpersisted per-mount client state — a committee/eligibility role silently re-seals an AI-picked lead

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: validation-gap / silent-failure
- **File**: `app/features/sub_decisions/DecisionsTab.tsx:73` (default) and `:261` (send); `app/_lib/group-eval-run.ts:262,441`; `app/_lib/group-eval-governance.ts:23`
- **Scenario**: A role is a statutory civil-service hire (should be `eligibility_list`) or a faculty committee search (`committee`). A recruiter runs the group eval once in the correct mode. Later they (or another user, or the same user after the tab re-mounts) click **Rerun** — or open a fresh Decisions tab and run it — without re-touching the segmented control.
- **Root cause**: `evalMode` is `useState<…>("recommendation")` — local component state that resets to `"recommendation"` on every mount, is shared across all roles, and is **never bound to the role or synced from the stored eval's `governanceMode`** (`openGroupEval` loads `evalData` but never calls `setEvalMode`). `runGroupEval` reads `governanceMode` from the request params each run, and `normalizeGovernanceMode` coerces any absent/invalid value back to `"recommendation"`. `sealsLead("recommendation") === true`, so the run calls `sealDecisionSafe({ kind: "group_eval_lead", actor: "auto:group-eval" })` — a solely-automated significant hiring decision — on a role whose governance requires the AI to stay advisory.
- **Impact**: The governance module's core guarantee ("the AI never seals a winner for collective/statutory processes") is bypassable by simply reopening/rerunning. The wrong governance seal is persisted to the decision record with no warning. Regulated-hiring compliance breach on a common path.
- **Fix sketch**: Persist `governanceMode` per role (store it in the role/job config, or read it back from the saved eval payload) and resolve it server-side in `runGroupEval` instead of trusting a per-request param; on rerun, initialise `evalMode` from the stored eval so a governed role can never silently downgrade to `recommendation`.

## 2. The weighting-robustness "gate" cannot fail: it asserts "robust" from a no-op and vanishes silently on ranker failure

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent-failure / success-theater
- **File**: `app/features/sub_decisions/group-eval/FairnessPanel.tsx:16,20-28`; `app/_lib/group-eval-run.ts:302-308,441`; `messages/en.json:1802` (`fairnessUniform`)
- **Scenario**: (a) A pool where no candidate has high-trust evidence, so Python proposes no weight adjustments (`weightNotes` empty). (b) The recruiter ranker throws (best-effort) or the role has no job, so `fairness` is `null`.
- **Root cause**: In case (a) `adjusted` is false and the panel affirmatively renders *"Weighting is robust — re-scoring every candidate under each other's weighting leaves the order unchanged, so the ranking is robust, not weighting-dependent."* But with uniform weights every scheme is identical, so "order unchanged" is guaranteed a priori — the cross-scheme test never actually ran; a no-op is reported as a PASS. In case (b) the ranker error is swallowed (`catch { console.warn }` at `:305`), `fairness` stays `null`, and `FairnessPanel` returns `null` (`:16`) — the section simply disappears with no "robustness check unavailable" notice. In **both** cases `runGroupEval` still crowns and `sealDecisionSafe`s a lead (`:441`).
- **Impact**: On the two most common paths the panel provides zero real signal, yet in case (a) it actively reassures the recruiter the ranking is robust, and in case (b) the check silently vanishes — while the automated lead is sealed regardless. This is exactly the "gate that cannot fail" shape on a hiring-decision surface.
- **Fix sketch**: When weights are uniform, say "not tested — no evidence-driven weighting to vary" rather than "robust". When `fairness` is `null` in an enriched eval, render an explicit "robustness check unavailable (ranker did not run)" state and reflect that the sealed lead was not robustness-checked.

## 3. group_eval dedupe key ignores governanceMode and the candidate set — a re-trigger silently returns the earlier run

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: race-condition / state-corruption
- **File**: `app/_lib/task-dedupe.ts:63`
- **Scenario**: A `group_eval` task for a role is in flight (started in `recommendation` mode over pool P). Before it finishes, a user changes the governance mode to `committee` — or the pool changes to P′ — and re-triggers the eval for the same role.
- **Root cause**: The dedupe key is `stableKey("group_eval", p.roleKey)` — it hashes **only the role key**, deliberately ("one run per role; re-trigger reuses an in-flight run"). It excludes `governanceMode` and `candidates`, so a concurrent re-trigger with materially different params is collapsed into the earlier run and returns its result.
- **Impact**: The recruiter selects `committee` (or edits the pool), sees a completed eval, and is served the earlier `recommendation`-mode / stale-pool result — including its auto-sealed lead. Compounds finding #1: even an explicit mode change can be dropped.
- **Fix sketch**: Fold `governanceMode` and a stable hash of the candidate identity set into the dedupe key so a genuinely different request starts its own run; or reject a re-trigger whose params differ from the in-flight run instead of silently aliasing it.

## 4. No minimum-field floor: a single-candidate group crowns a lead and reports ALL its skills as "unique strengths"

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case
- **File**: `app/_lib/group-eval-differentiators.ts:38-46`; `app/_lib/group-eval-run.ts:399-401,441`
- **Scenario**: A role reaches group eval with a single pending candidate (or one candidate plus others that all fail knockout, leaving one rival-less lead).
- **Root cause**: `computeDifferentiators` builds `rivalMatched = new Set(rivals.flatMap(...))`; with no rivals that set is empty, so **every** requirement skill the lead matched passes the `!rivalMatched.has(skill)` test and is emitted as a "unique strength (lead)". Nothing anywhere enforces a minimum group size before crowning/sealing — `lead` is set, `sealDecisionSafe({kind:"group_eval_lead"})` fires, and the robust-order check trivially "agrees" (`ranking.length === headlineOrder.length && some(diff)` is false for length 1). This is the same defect class as adverse-impact's missing minimum-sample floor, here in the differentiator/lead path.
- **Impact**: The summary asserts "Unique strengths: X, Y, Z" and a "recommended lead" for a field of one, where "unique" is meaningless — misleading decision framing sealed into the record.
- **Fix sketch**: Require ≥2 compared candidates for differentiators (return `[]` when `rivals.length === 0`) and gate the "unique strengths" / "recommended lead over the field" language on a real comparison; surface a single-candidate eval as "only one candidate — nothing to compare against".

## 5. Weighting-robustness matrix is inaccessible: no header scope, color-only diagonal, index keys

- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: a11y
- **File**: `app/features/sub_decisions/group-eval/FairnessPanel.tsx:49-77`
- **Scenario**: A screen-reader user reaches the N×N robustness matrix; a low-vision user scans the diagonal.
- **Root cause**: Column `<th>` cells carry no `scope="col"`, and each row's header is a plain `<td>` (`:62`), not `<th scope="row">` — so assistive tech cannot associate a cell's number with its row/column candidate, rendering the grid an unlabelled number soup. The "own weighting" diagonal is distinguished **only by color** (`i === j ? "bg-coral/10 text-coral ring-1..."`) with the meaning buried in a `title` (`:69`), failing "don't convey by color alone". Rows/columns/cells are keyed by index (`key={i}`/`key={j}`, `:51,61,64`), so a re-run reorders in place and drops in-cell hover/`title` state (prior report finding #7, still open).
- **Impact**: The robustness matrix — a decision-support surface — is second-class for AT users and unreadable for color-only perception.
- **Fix sketch**: Use `<th scope="col">`/`<th scope="row">` for header cells, add a visually-hidden `<caption>`, encode the diagonal with a text/visible marker in addition to color, and key rows/cols by `candidateIds[i]`/`labels[j]`.
