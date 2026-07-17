# Screening Decisions & Records — ambiguity-guardian + ui-perfectionist scan

> Total: 6 findings (0 critical, 3 high, 2 medium, 1 low)

## 1. Screen wave reads the screening config from the DEFAULT workspace, not the caller's team
- **Severity**: High
- **Lens**: ambiguity
- **Category**: tenant-unscoped-config-read
- **File**: `app/_lib/screen-wave.ts:184`
- **Scenario**: A non-default team saves a team-scoped screening rule (or per-family floors) via `setDecisionConfig(..., ws, "team")`, then runs a screening wave. The wave silently uses the default workspace's config cascade instead of theirs.
- **Root cause**: `runScreenWave` painstakingly threads `workspaceId` into `listPipeline`, `withCanonicalScores`, `jdLastEditedAt`, `recordAutomationEvent`, and the seals — but the very first read, `getDecisionConfig<ScreeningRule>("screening")`, omits it, so it falls back to `DEFAULT_WORKSPACE_ID`. The modal's override masks this for the three global fields (it always sends all three), but `familyFloors` are never in the override, so a team's family floors come from the wrong tenant — and any non-modal caller (automation, scripts) gets the wrong whole rule.
- **Impact**: Wrong auto-reject floors applied per candidate for non-default teams; the sealed record's `policyVersion` then attests to a floor the team never configured. Cross-tenant policy leakage in the one place the file's own P1 comment says was fully scoped.
- **Fix sketch**: Pass the parameter through: `getDecisionConfig<ScreeningRule>("screening", workspaceId)`. Add a regression test that saves a team-scoped `familyFloors` override and asserts a dry run for that workspace reports the family floor in `reasonParams.threshold`.

## 2. The wave modal seeds its sliders from code defaults, ignoring the saved decision rules
- **Severity**: High
- **Lens**: ambiguity
- **Category**: config-not-hydrated
- **File**: `app/features/sub_decisions/ScreenWaveModal.tsx:86-87`
- **Scenario**: A recruiter sets "reject bottom 10%, only below 30" in the Decision Rules modal (whose rule sentence promises these rules govern screening). Later they open "Screening wave" on a role: the sliders show 20% / 45 (the `SCREENING_DEFAULT` constants), and because `override()` always sends all three fields, the saved rule is entirely ignored by the run they commit.
- **Root cause**: `useState(SCREENING_DEFAULT.rejectBottomPercent)` / `useState(SCREENING_DEFAULT.maxMatchToReject)` initialize from the code default rather than fetching `/api/decisions/config` the way `DecisionRulesModal` does. Only `enabled: true` is documented as a deliberate per-run default; the numeric seeds carry no such rationale.
- **Impact**: Silent divergence between the configured policy and the executed wave — the recruiter reviews a preview built on numbers they never chose, and a stricter saved floor is quietly loosened back to 45. The rules modal's plain-English "this is what will happen" sentence is false for the primary way waves are actually run.
- **Fix sketch**: On mount, fetch the effective screening config (same GET the rules modal uses) and seed `bottomPercent` / `maxMatch` from it, falling back to `SCREENING_DEFAULT` on error; keep `enabled: true` as the documented per-run intent. Alternatively omit untouched fields from `override()` so the server-side saved rule applies — either way, add a note in the modal when the run deviates from the saved rule.

## 3. Single-card Reject fires the irreversible, emailed rejection on one unconfirmed click — batch reject is confirm-gated
- **Severity**: High
- **Lens**: ui
- **Category**: inconsistent-destructive-confirm
- **File**: `app/features/sub_decisions/AiReviewCard.tsx:298-304`
- **Scenario**: A recruiter aiming for "View analysis" or the adjacent Accept button clips the per-card Reject. The candidate is instantly rejected and the rejection email dispatches — no confirm, no undo. Yet rejecting the same cards via batch select requires an explicit "reject N? yes/cancel" step, which `DecisionsTab` justifies with "reject is confirm-gated because it emails candidates".
- **Root cause**: The confirm ceremony was added to the bulk path (`confirmingBulkReject`) and to the wave modal (two-step commit, SD-5), but the per-card `onReject={() => act(e, "reject")}` path — the highest-traffic one — kept the original single-click behavior. The stated rationale (emails candidates) applies identically to one candidate.
- **Impact**: One misclick sends an adverse-action email to a real candidate with no recovery path (only screening auto-rejects reach the reconsider queue; a manual reject does not). The protection level is inversely proportional to how easy the action is to hit.
- **Fix sketch**: Give the per-card Reject the same lightweight inline confirm the batch bar uses (button flips to "Reject <name>? / Cancel" on first click), or an equivalent two-click pattern. Keep Accept single-click — it is forward-moving and recoverable.

## 4. Decision Rules modal reads the team-effective config but writes the org baseline
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: read-write-scope-asymmetry
- **File**: `app/api/decisions/config/route.ts:38`
- **Scenario**: A team with its own screening override opens Decision Rules: the GET returns the team-cascaded effective values (`getAllDecisionConfigs(ws)`). The recruiter tweaks one number and saves. The POST carries no `scope`, so the route defaults to `scope: "org"` — the team's values are silently promoted into the company baseline that every other team inherits.
- **Root cause**: `DecisionRulesModal.tsx:40-44` never sends `scope`; the route's default is `"org"` ("the historical behavior"), while the read path is the team cascade. Nothing in the modal names which tier is being edited, and the route's own comment defers the problem ("gate it on a manage capability once RBAC is enforced").
- **Impact**: A read-modify-write through the modal copies one team's override into the org default — cross-team policy contamination the moment more than one workspace exists (and workspaces already exist: the wave, seals, and reconsider queue are all P1 tenant-scoped). Also inconsistent with `ComplianceSection`, which writes through the same default and so also edits the org tier.
- **Fix sketch**: Decide the intended tier and make it explicit: have the modal send `scope: "team"` (matching what its read shows), or flip the route default to `"team"` and require an explicit `scope: "org"` for baseline edits. Surface the tier in the modal subtitle ("applies to your team" / "company default") so the blast radius is visible.

## 5. Reinstate failure is completely silent
- **Severity**: Medium
- **Lens**: ui
- **Category**: missing-error-state
- **File**: `app/features/sub_decisions/DecisionsTab.tsx:196-211`
- **Scenario**: A recruiter clicks "Reinstate" on an auto-rejected candidate. The POST returns non-ok (409 stage drift, 500, expired session). The button spinner stops, the row stays, and nothing tells the recruiter anything happened — most will assume the click didn't register and either retry blindly or walk away believing the candidate was reinstated.
- **Root cause**: `reinstate()` only handles `r.ok` (`if (r.ok) { ... }`); there is no `else` branch and no `catch`-side surfacing — a network throw isn't even caught (only `finally` clears the busy flag), so a rejection propagates as an unhandled promise.
- **Impact**: The safety valve over irreversible auto-rejection — the flow the tab's own comments call an audit-critical second look — can fail invisibly, leaving a candidate out of the funnel while the recruiter believes otherwise. Every sibling flow here (bulk bar, wave modal, rules modal) surfaces its failures.
- **Fix sketch**: Add an error path: on `!r.ok` (and in a `catch`), show `toast.error(t("reinstateFailed"))` (the toast store is already imported) and re-run `loadReconsider()` to reconcile. Two lines of state, consistent with the rest of the tab.

## 6. Offer card fabricates "0" for a missing amount and computes a NaN-width salary bar
- **Severity**: Low
- **Lens**: ui
- **Category**: degenerate-payload-rendering
- **File**: `app/features/sub_decisions/AiReviewCard.tsx:152-155`
- **Scenario**: An offer_review card whose payload is missing `recommended` / `salaryMin` / `salaryMax` (older draft, partial generation) renders a headline salary of "0" — in a codebase that repeatedly insists an absent number must never render as a fabricated 0 (SD-L1-002, the unscored-dash rule two files away) — and the band meter at line 189-196 computes `width: NaN%`, an invalid style that silently collapses the bar.
- **Root cause**: `Number(parsed?.recommended ?? 0).toLocaleString()` defaults the absent amount to 0, and the meter math divides `Number(undefined)` values with no presence check (the `Math.max(1, …)` guard only protects against a zero denominator, not NaN).
- **Impact**: The recruiter approving "Send offer" sees a confident-looking 0-money offer instead of an honest "amount unavailable", and the band context disappears without explanation — the exact bare-fallback dishonesty the rest of the decisions surface was reworked to avoid.
- **Fix sketch**: Gate the headline and the meter on `typeof parsed?.recommended === "number"` (and both band bounds being finite); render a dash plus a short "draft incomplete — re-draft the offer" note otherwise. Mirrors the unscored-dash convention already used in the wave modal and reconsider rows.
