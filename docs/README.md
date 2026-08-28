# kp Documentation

Source of truth for what kp does today, the contracts behind it, and the work that is
still proposed.

## Where to start

| Need | Start here |
| --- | --- |
| What the product does today | [features/](features/README.md) |
| Cross-cutting implementation contracts | [architecture/README.md](architecture/README.md) — runtime shape, source tree, engines, pipeline stages, and the per-concern docs |
| **Why it is this way** — the settled decisions | [architecture/decisions/](architecture/decisions/README.md) — ADRs for the choices that look surprising on purpose |
| Design system, tokens, both themes | [design/README.md](design/README.md) |
| How to build, test, evaluate, calibrate | [development/README.md](development/README.md) — verification commands, eval harness, model benchmarks, CLI reference, DevInspector, logging |
| Market position, roadmap, enterprise track | [product/](product/) — including the [salary data sources](product/salary-data-sources.md) the anchor bands were calibrated against |
| Proposals not yet implemented | [concepts/](concepts/) |
| **Patterns worth porting to another repo** | [marketing/the-bar.md](marketing/the-bar.md) — the five things that keep a public marketing surface from drifting into lies |
| Superseded material, kept for context | [_archive/](_archive/) |
| Known doc gaps and follow-ups | [BACKLOG.md](BACKLOG.md) |
| Component/sequence diagrams | [diagrams/](diagrams/README.md) |
| Localization glossary + style guides | [i18n/](i18n/) |

## Documentation rules

- **`docs/features`** describes what is implemented in the current app, one folder per
  feature area. Every claim should be checkable against a real file path.
- **`docs/architecture`** documents cross-cutting contracts — the LLM provider layer, the
  persistence backend and [workspace data](architecture/workspace-data.md) (seeding,
  dump & restore), [result caching](architecture/result-caching.md), the self-hosting
  story, [engine setup](architecture/engine-setup.md), the app's folder structure, and
  [localization](architecture/localization.md) (the four-locale contract: where English is
  allowed, how API errors resolve, number/date formatting, and what the lint cannot see).
- **`docs/design`** is the dual-theme design system (Studio Light + Spark Dark). Read it
  before building UI.
- **`docs/development`** documents the evaluation and calibration harnesses: how to run
  them, what they measure, what their baselines are.
- **`docs/product`** holds market/roadmap framing (competitor teardown, coverage waves,
  enterprise readiness track). Aspirational by nature — don't mistake it for feature docs.
- **`docs/marketing`** is the EXPORT lane: patterns proven here, written for someone
  porting them into a different repository. Not a description of kp's own marketing
  pages — that lives in [`features/marketing/`](features/marketing/README.md).
- **`docs/concepts`** is only for not-yet-implemented proposals. When a concept ships,
  move or rewrite it under `features/` or `architecture/` and leave only the remaining
  follow-up work behind.
- **`docs/harness`** used to keep dated product-review, scan and context-map runs.
  It is untracked since the repository went public (see `.gitignore`): timestamped
  evidence is working material, not product documentation. The durable outcome of a
  run belongs in `features/`, `architecture/` or `BACKLOG.md`.
- **`docs/_archive`** keeps superseded docs so old context survives. Each carries a note
  saying what replaced it. Prefer archiving over deleting.

One deliberate exception: [`TAXONOMY_COVERAGE.md`](TAXONOMY_COVERAGE.md) stays at the root
of `docs/` because `pipeline/jobfit/taxonomy_check.py` hardcodes that path as its report
output and a test gate fails when it drifts. It is generated, not written.

## Decisions vs. descriptions

`features/` and `architecture/` say **what the code does**.
[`architecture/decisions/`](architecture/decisions/README.md) says **why it is
allowed to be this way** — one record per settled choice, each ending in the
observation that would reopen it.

The split matters because an agent scoping a change reads files, not `git log`.
Before this directory existed, "SQLite, not Postgres" and "spawn Python, don't
run a service" were justified only in commit bodies, which is the same as not
being justified at all for anyone who arrives later. When a change would reverse
a record, argue with the record — add a superseding ADR — rather than editing
around it.

## Keeping docs in sync with code

Three mechanisms, deliberately layered from cheapest to strictest:

1. **The Stop hook** — [`scripts/docs/check-doc-sync.mjs`](../scripts/docs/check-doc-sync.mjs),
   registered in `.claude/settings.json`. When an agent turn edits source mapped in
   [`scripts/docs/feature-doc-map.json`](../scripts/docs/feature-doc-map.json) without
   touching any doc under `features/`, `architecture/`, or `design/`, it names the doc
   that probably went stale. A nudge, in conversation, immediately.
2. **The CI gate** — [`scripts/docs/check-doc-sync-diff.mjs`](../scripts/docs/check-doc-sync-diff.mjs)
   (`npm run docs:check:diff`) applies the *same* rule to the git range, so the
   obligation survives a human commit, a bot PR, or a dismissed reminder. Its escape
   hatch is a commit trailer — `Doc-sync: internal-only — <why>` — which a reviewer can
   read and disagree with.
3. **The ADR gate** — [`scripts/docs/check-adrs.mjs`](../scripts/docs/check-adrs.mjs)
   (`npm run docs:check`) fails when a decision record names a `sources:` path that no
   longer exists, or when the index and the records disagree.

Full contract in [`.claude/CLAUDE.md`](../.claude/CLAUDE.md) ("Documentation Sync").
Fixtures for all three: `npm run test:docs`.
