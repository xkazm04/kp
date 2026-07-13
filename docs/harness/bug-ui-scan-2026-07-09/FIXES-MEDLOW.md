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

## Status
Med/Low: **22 of 155 closed**, 133 open (103 M + 30 L). Remaining topic waves: Pipeline/Decisions/
Channels, Insights/Analytics/Sim, AI Matching engine, Candidate Analysis, Dev Hiring, Interviews/
Scheduling, Offers/Automation + Identity/Data/Privacy, Jobs/JD/Sourcing + LLM + Billing.
