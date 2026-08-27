---
id: "0003"
title: The jobfit pipeline is a spawned process, not a service
status: accepted
date: 2026-08-26
supersedes: []
superseded-by: null
tags: [architecture, python, self-hosting]
sources:
  - app/_lib/python-runner.ts
  - pipeline/jobfit/codegen.py
  - pipeline/jobfit/llm/capabilities.py
  - app/_lib/llm-config.ts
  - Dockerfile
---

# The jobfit pipeline is a spawned process, not a service

## Context

CV extraction, scoring, the taxonomy, the archetype router and the LLM registry
are Python. That is where the ecosystem is (pypdf, pydantic, the provider SDKs)
and where the evaluation harnesses live. The web app is TypeScript.

The textbook answer is a second service: FastAPI, an HTTP contract, its own
container, a queue between them. That answer costs the self-host story
([ADR 0002](0002-sqlite-single-file-persistence.md)) an entire moving part.

## Decision

The app **spawns** `python -m pipeline.jobfit.*` per request via
`app/_lib/python-runner.ts`. One container holds both halves; the Dockerfile
copies `pipeline/` next to `server.js`. There is no long-lived Python process,
no port, no queue, no service discovery.

Two contracts keep the seam honest:

- **Schemas are generated, not hand-mirrored.** `npm run schemas:gen`
  (`python -m pipeline.jobfit.codegen`) runs *before* `tsc` in `npm run
  typecheck` and before `next build`. A drifted schema is a compile error, not
  a runtime surprise. This is also why CI must install Python in the *Node*
  job.
- **The LLM catalog has one authority.** `pipeline/jobfit/llm/capabilities.py`
  is authoritative; `app/_lib/llm-config.ts` mirrors it only to validate what
  the admin API will accept, and hands the resolved config to the spawn as
  `KP_LLM_CONFIG`.

## Consequences

**Good.** One artifact to run. Python's dependency tree never reaches the
browser bundle. Each request is isolated: a crash in extraction kills one child,
not the server. The Python side is directly runnable from a terminal, which is
what makes the eval harnesses cheap.

**Bad, and accepted.** Per-request interpreter startup — real, and the reason
hot paths cache (`docs/architecture/result-caching.md`). Timeouts are the
route's job: `maxDuration` is serverless-only and self-hosted `next start` will
not kill a long handler, so the child-process timeout is the actual bound.
Anything the pipeline needs must be passed as argv, a temp file, or env — there
is no shared memory.

**Do not** convert this to a service to "clean it up". The coupling it would
remove is not the coupling that hurts; the second deployable is.

## What would change our mind

Interpreter startup dominating p95 on a hot path that cannot be cached, or a
model runtime that genuinely needs a warm resident process (a local embedding
server, say). Even then the answer is a sidecar for that one workload, not a
rewrite of the seam.
