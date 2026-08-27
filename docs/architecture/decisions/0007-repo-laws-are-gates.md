---
id: "0007"
title: A repo law that isn't a gate isn't a law
status: accepted
date: 2026-08-26
supersedes: []
superseded-by: null
tags: [process, agentic, quality]
sources:
  - scripts/design/check-design-tokens.mjs
  - scripts/i18n-check.mjs
  - app/_lib/tenancy.ts
  - app/api/rate-limit-contract.test.ts
  - scripts/docs/check-doc-sync.mjs
  - .github/workflows/ci.yml
  - .githooks/pre-push
---

# A repo law that isn't a gate isn't a law

## Context

Around 90% of changes here are written by an AI agent. Agents read the
instruction files and mostly comply — but "mostly" compounds badly at agent
throughput, and a rule that lives only in prose decays in a specific, observed
way: the dual-theme design law was stated in **two** documents and enforced
**nowhere**, and the `brand.ts` ↔ `globals.css` lockstep it demanded had
silently broken. Nothing in CI or in the pre-push hook had ever read
`app/globals.css`.

The lesson generalises. A constraint that only a careful reader enforces is a
constraint that survives exactly as long as everyone is careful.

## Decision

Every non-negotiable stated in `.claude/CLAUDE.md` must have an executable
enforcer, and the enforcer is the authority — the prose describes it.

Currently in force:

| Law | Enforcer | Runs |
| --- | --- | --- |
| No raw hex / inline colour outside `app/landing/`; `brand.ts` ↔ `globals.css` lockstep | `npm run design:check` + an eslint rule | CI, pre-push |
| Four-locale message parity (`en` is source of truth) | `npm run i18n:check`, and typed next-intl keys via `tsc` | CI, pre-push |
| Every persistent table is workspace-scoped or explicitly exempt | `app/_lib/tenancy.ts` manifest + colocated `*-tenancy.test.ts` | `npm run test:unit` in CI |
| Named open/paid routes call `rateLimit()` | `app/api/rate-limit-contract.test.ts` | `npm run test:unit` in CI |
| TS ↔ Python schema parity | `npm run schemas:gen` before `tsc` | CI, pre-push |
| No new silently-skipped Python test | `KP_SKIP_BASELINE` in the gated suite | CI |
| Feature docs move with feature source | `scripts/docs/check-doc-sync.mjs` | Stop hook, and `--diff` in CI |
| ADR `sources:` still exist; the index is complete | `scripts/docs/check-adrs.mjs` | CI |

Two rules about the gates themselves:

- **Repair by fixing, never by deleting.** Weakening a gate to make a change
  pass is the failure this ADR exists to prevent. The App-master programme
  names the same set as forbidden change classes: test deletion or skip,
  suppression directives, gate configuration, dependency bumps *to satisfy a
  check*.
- **Changing a gate is a deliberate, reviewed edit**, and
  `scripts/review/constitution-check.mjs` flags a diff that touches gate
  configuration so the reviewer sees it as a category rather than a line.

## Consequences

**Good.** An agent gets a mechanical answer instead of a judgement call, and the
answer arrives in seconds. Onboarding a new contributor — human or model — is
"run the gates" rather than "read three documents carefully".

**Bad, and accepted.** Gates cost CI minutes and occasionally block a correct
change on a technicality. That is the trade: a false positive costs one
conversation, a missing gate costs weeks of undetected drift. Every gate here
was written *after* the drift it now prevents, which is honest but means the
set is reactive; each new law should arrive with its enforcer in the same
change.

## What would change our mind

A gate that produces more false positives than real catches should be
**re-scoped** rather than deleted — the drift it was written for is still real.
Deleting one requires demonstrating that the underlying constraint no longer
exists.
