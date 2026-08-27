# Architecture decision records

The unusual choices in this codebase are deliberate, and until this directory
existed their justifications lived in commit bodies and code comments. An agent
scoping a change reads **files**, not `git log` — so a settled decision could be
quietly re-litigated by someone who never saw that it was a decision.

Each record here answers one question: *why is it this way, and what would have
to be true for it to change?*

## Read this before you

- swap the framework, the runtime target, or a Next flag in `next.config.ts` → [0001](0001-next-canary-instant-navigations.md)
- replace, wrap, or "just add an ORM in front of" the database → [0002](0002-sqlite-single-file-persistence.md)
- turn the Python pipeline into a service, a queue worker, or a rewrite in TS → [0003](0003-spawned-python-pipeline.md)
- make a feature require an API key, or delete a "silly" deterministic fallback → [0004](0004-keyless-degradation-is-a-product-property.md)
- touch auth, add a candidate-facing route, or put an id on the public wire → [0005](0005-hmac-sessions-and-capability-tokens.md)
- change the licence, add a proprietary component, or gate a feature on hosting → [0006](0006-agpl-with-cla.md)
- weaken, skip or reconfigure a repo gate (design tokens, locale parity, tenancy, rate limits) → [0007](0007-repo-laws-are-gates.md)

## Index

| ADR | Title | Status | Date |
| --- | --- | --- | --- |
| [0001](0001-next-canary-instant-navigations.md) | Next.js on the instant-navigations line, pinned exactly | accepted | 2026-08-26 |
| [0002](0002-sqlite-single-file-persistence.md) | A single SQLite file is the default persistence | accepted | 2026-08-26 |
| [0003](0003-spawned-python-pipeline.md) | The jobfit pipeline is a spawned process, not a service | accepted | 2026-08-26 |
| [0004](0004-keyless-degradation-is-a-product-property.md) | Keyless degradation is a product property, not a fallback | accepted | 2026-08-26 |
| [0005](0005-hmac-sessions-and-capability-tokens.md) | HMAC operator sessions; capability tokens for candidates | accepted | 2026-08-26 |
| [0006](0006-agpl-with-cla.md) | AGPL-3.0-only plus a CLA; hosting is the commercial boundary | accepted | 2026-08-26 |
| [0007](0007-repo-laws-are-gates.md) | A repo law that isn't a gate isn't a law | accepted | 2026-08-26 |

## Writing a new one

Copy the shape of an existing record. Every ADR carries YAML front matter:

```yaml
---
id: "0008"
title: One line, in the imperative or as a claim
status: accepted        # proposed | accepted | superseded | deprecated
date: 2026-08-26
supersedes: []          # ADR ids this replaces
superseded-by: null     # ADR id that replaced this one
tags: [runtime]
sources:                # real paths that ENACT the decision
  - path/to/file.ts
---
```

Then the body: **Context** (the forces, not the narrative) · **Decision** ·
**Consequences** — including the ones you dislike · **What would change our
mind** — the concrete observation that would reopen this.

`sources:` is the part that keeps the record honest. It lists the files that
*enact* the decision, and
[`scripts/docs/check-adrs.mjs`](../../../scripts/docs/check-adrs.mjs) fails CI
when one of them no longer exists — the same drift class that made
`docs/` get reorganised. It also checks that the table above lists every record
exactly once with the right title and status, that ids match filenames, and
that `supersedes` / `superseded-by` are reciprocal.

Run it locally with `npm run docs:check`. Fixtures:
`node scripts/docs/__tests__/check-adrs.test.mjs`.

## Status vocabulary

- **proposed** — written down, not yet the way things are. Rare; prefer
  `docs/concepts/` for genuinely speculative work.
- **accepted** — this is how the code behaves today.
- **superseded** — replaced by a later ADR, named in `superseded-by`. Kept, not
  deleted: the reasoning that was overturned is part of why the replacement is
  right.
- **deprecated** — no longer true, and nothing replaced it (the thing went
  away).
