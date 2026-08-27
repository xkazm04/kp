---
id: "0001"
title: Next.js on the instant-navigations line, pinned exactly
status: accepted
date: 2026-08-26
supersedes: []
superseded-by: null
tags: [runtime, framework, performance]
sources:
  - next.config.ts
  - package.json
  - AGENTS.md
---

# Next.js on the instant-navigations line, pinned exactly

## Context

kp is a single-page workspace driven by `?tab=` (`app/features/shell/tabs.ts`).
Every tab switch is a navigation, so navigation latency *is* the product's
perceived speed. On the stable Next line each of those was a server round trip
with a visible pause.

Next 16.3 ships **Instant Navigations**: `cacheComponents` plus
`partialPrefetching` let the router serve the shell from cache and stream the
dynamic hole. That line moves fast and its APIs are not what a model trained on
Next 14/15 expects — hence the loud warning at the top of `AGENTS.md`, which
`next dev` itself re-writes into the repo.

## Decision

Run on the instant-navigations line and pin `next` to an **exact** version in
`package.json`, in lockstep with `eslint-config-next`. Keep `cacheComponents:
true` and `partialPrefetching: true` on.

Consequences of that pairing, enforced in the tree:

- Route-level `runtime` / `dynamic` configs are **banned** — `cacheComponents`
  rejects them.
- A route that cannot be cached opts out explicitly with
  `export const instant = false`, or it becomes a dev error. Roughly 21 dynamic
  routes are opted out this way today.
- `output: "standalone"` is required for the self-host container, which means
  `next start` does not work — CI and the Dockerfile assemble
  `.next/standalone/server.js` by hand.

## Consequences

**Good.** Tab switches are instant. The self-host image is small because
standalone traces only the server files it needs.

**Bad, and accepted.** Upgrades are not routine: a Next bump can change router
semantics, so it gets a full gate run and a read of
`node_modules/next/dist/docs/` before it lands. Training-data answers about
Next are actively wrong here, which is why `AGENTS.md` leads with that sentence.
Client pages that need instant navigation require a server-wrapper split, and
several are still opted out rather than split.

**Do not** "fix" a `cacheComponents` error by deleting the flag, and do not
un-pin `next` to a range to make an upgrade PR smaller.

## What would change our mind

The instant-navigations flags graduating to stable defaults (the pin can then
relax to a caret), or a measured finding that prefetching costs more server
work than the latency it buys on a self-hosted single-container deployment.
