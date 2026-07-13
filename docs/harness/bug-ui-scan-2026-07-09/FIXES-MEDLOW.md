# Medium/Low remediation — running log

> The Med/Low tail (125 Medium + 30 Low = 155) worked in **domain-topic waves**, one agent per
> context fixing that context's whole cluster on disjoint files. Same discipline as the
> Critical/High waves: fix at the root, skip a genuine non-issue with a reason (never pad),
> extract a pure `.ts` helper where the logic lives in a `.tsx` (the bare `node --test` can't
> load a `.tsx`), prove each behavioral test fails against pre-fix code, keep every gate green.
>
> All 9 Criticals + all 66 Highs were closed first (waves 1–11; see the FIXES-WAVE-*.md docs).

## Wave 12 — Platform, Shell & Shared UI (22 findings, 6 contexts)

7 commits (`ecc6362` i18n + 6 fixes). tsc 0 · node unit 1560 → **1610** · i18n 3249 → **3252** × 4 · `next build` ✓.

- **app-shell** (`4770f1a`): drawer closes on every nav (not just `selectTab`); palette
  loading state + active-option scroll; rail label 10.5→11px. Pure `drawer-nav-close.ts` /
  `palette-results.ts`.
- **branding** (`6e9040a`): clearing the accent reverts live; external-logo `onError` fallback
  + `no-referrer`; Reset restores last-saved + unsaved guard; 3-digit-hex badge fix.
- **shared-ui** (`1a9f921`): `htmlToMarkdown` escapes metacharacters (was corrupting JD text);
  `[text](url)` links round-trip with a scheme-validated `safeLinkHref`; RichTextEditor
  disabled/readonly + a11y name; form-control API convergence (safe subset).
- **tasks** (`d5b0d8d`): watchdog+reaper for hung slots; retention prune; memoized poll;
  honest indeterminate progress bar. Constants `TASK_MAX_RUNTIME_MS`/`TASK_RETENTION_DAYS`.
- **market** (`1e040f3`): the "every JD card is coral" bug — `familyColor(orgType)` fed a
  non-family key; `familyColor` is now TYPED so it's a compile error, plus a proper `orgColor`;
  map landmark + legend a11y.
- **shared-utils** (`bcada7e`): `publicBaseUrl` validates an absolute, deployment-owned origin
  (rejects Host-poisoning); durable retryable intake ack; `getAdapter` throws on an unknown
  channel. **Necessary consequence:** rewired `comms-dispatch.ts`'s now-unreachable
  "dead-relative-link" warning to fire via a new `publicOriginIsFallback` predicate — kept the
  loud misconfiguration signal, fixed the test that encoded the old empty-return contract.

**Flake note:** the billing-webhook test flaked once (the known pid-keyed temp-DB issue,
data-store #4); 3 clean full runs confirmed it, not a regression.

## Wave 13 — Pipeline, Decisions & Channels (21 findings, 6 contexts)

7 commits (`558707e` i18n + 6 fixes). tsc 0 · node unit 1610 → **1658** · i18n 3252 → **3269** × 4 · python 878 OK · `next build` ✓.

- **communications-inbound-channels** (`3a3d307`, 5 findings): receiver-revoke `Modal`
  confirm (+ red live-receiver warning); pure `pickBounceTarget` binds a bounce to the single
  newest send at-or-before it (was fanning out over every same-`(ref,kind)` send); bounced rows
  get a `BouncedResend` control and the resend route stops treating a bounced receipt as
  "already recovered"; pure `callback-auth.ts` — `secretsMatch` (SHA-256 → `timingSafeEqual`,
  constant-time), timestamp freshness, replay guard; route reads secret header-only (dropped
  `?secret=`); `resolveCommsLocale` threads an optional `workspaceId`.
- **application-intake-apply-flows** (`f051144`): pure `classifyStatusError` (not-found /
  expired / transient) so the status page shows the right copy; `ConversationalApply` polish.
- **pipeline-board-candidate-drawer** (`97eac70`): pure `pipeline-move-targets.ts`
  (`moveStageSelectValues` / `resolveRejectTargets`) so move/reject menus only offer legal
  destinations; `pipeline-command` parsing hardened; drawer/board/command-bar fixes.
- **screening-decisions-records** (`825ea03`): SD-5 two-step confirm before the irreversible
  screen-wave commit + accessible preview button; SD-3 posture block no longer asserts a
  framing the candidate-facing `/api/compliance` disclosure never received.
- **group-evaluation-fairness** (`6d075e2`): **min-cohort floor** — `computeDifferentiators`
  returns `[]` with no rivals (an empty field trivially crowns every requirement skill
  "unique"), `GROUP_EVAL_MIN_COHORT=2` gates cohort stats; pure group-eval dedupe;
  `parseGroupCounts` hardened; `task-dedupe` keyed by role + governance-mode + candidate-set;
  FairnessPanel typing. **Two pre-existing differentiator tests** that used `[]` rivals as a
  shortcut were updated to pass a present non-matching rival (new contract, not a regression).
- **ats-integration-egress** (`cf966a1`): pure `ats-candidate-audit.ts` records what candidate
  fields egress on an ATS push; `resolveClientIp` honours **`KP_TRUSTED_PROXY`** (trust XFF only
  behind a declared proxy, else socket IP — spoof-resistant limiting). New optional env var
  documented in `docs/SELF_HOSTING.md`.

**New deploy env var:** `KP_TRUSTED_PROXY` (optional) — comma-separated trusted proxy CIDRs/IPs;
unset ⇒ XFF is ignored and the socket IP is used for rate limiting. All Wave-13 pure helpers
proven non-vacuous (each behavioral test fails against pre-fix code).

## Status
Med/Low: **43 of 155 closed**, 112 open (82 M + 30 L). Remaining topic waves: Insights/Analytics/Sim,
AI Matching engine, Candidate Analysis, Dev Hiring, Interviews/Scheduling, Offers/Automation +
Identity/Data/Privacy, Jobs/JD/Sourcing + LLM + Billing.
