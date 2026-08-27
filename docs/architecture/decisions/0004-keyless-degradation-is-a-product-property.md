---
id: "0004"
title: Keyless degradation is a product property, not a fallback
status: accepted
date: 2026-08-26
supersedes: []
superseded-by: null
tags: [llm, product, testing]
sources:
  - app/_lib/llm-config.ts
  - pipeline/jobfit/llm/capabilities.py
  - app/_lib/offline.ts
  - pipeline/jobfit/eval/matching_eval.py
  - .github/workflows/ci.yml
---

# Keyless degradation is a product property, not a fallback

## Context

Every AI feature here routes to **the operator's** provider keys. There is no
kp-hosted inference. So the honest default state of a fresh install is: no keys
configured.

An app that answers that state with a 500, or with a modal saying "configure a
provider to continue", is an app nobody evaluates. The first five minutes decide
whether a self-hoster keeps going.

## Decision

Every LLM-backed path has a **deterministic** result for the keyless case, and
that result is a real answer — not an error, not an empty state, not a spinner
that never resolves. Claude CLI is the local default (no key needed at all);
absent even that, the deterministic path runs.

This is load-bearing in three places, which is what makes it a property rather
than a courtesy:

1. **CI certifies it.** The deterministic e2e job in
   `.github/workflows/ci.yml` sets **no** provider env and runs against a real
   production build. If keyless degradation broke, that job goes red.
2. **Evals run on it.** `matching_eval` needs no API key by construction, and
   `automation_eval --no-llm` / `intake_eval --no-llm` are the CI-safe modes.
   The deterministic path is therefore continuously scored, not merely present.
3. **`KP_OFFLINE=1` depends on it.** The hard no-egress mode (`app/_lib/
   offline.ts`, mirrored in Python) is only usable because every feature has a
   local answer. Air-gapped and data-residency deployments ride on this.

## Consequences

**Good.** `git clone && npm run dev` is a working product. Tests are cheap and
deterministic. Air-gapped deployment is a config flag, not a fork.

**Bad, and accepted.** Two implementations per feature, and the deterministic
one has to stay genuinely good — a fallback that is obviously worse teaches
users the feature is broken. Delivery claims must stay truthful across both
paths (`sent` / `queued` / `failed`, never a green lie).

**Do not** delete a deterministic fallback because "everyone has a key", and do
not make a new feature hard-require a provider. If a feature genuinely cannot
degrade, it must fail *visibly and specifically*, and say what to configure.

## What would change our mind

Nothing about hosting. If kp ever ships a hosted tier with inference included,
that tier is an *addition* — the self-hosted keyless path is the licence
promise ([ADR 0006](0006-agpl-with-cla.md)) and stays.
