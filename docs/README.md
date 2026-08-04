# kp Documentation

Source of truth for what kp does today, the contracts behind it, and the work that is
still proposed.

## Where to start

| Need | Start here |
| --- | --- |
| What the product does today | [features/](features/README.md) |
| Cross-cutting implementation contracts | [architecture/](architecture/) |
| Design system, tokens, both themes | [design/README.md](design/README.md) |
| How to build, test, evaluate, calibrate | [development/](development/) |
| Market position, roadmap, enterprise track | [product/](product/) |
| Proposals not yet implemented | [concepts/](concepts/) |
| Dated review/scan evidence | [harness/](harness/) |
| Superseded material, kept for context | [_archive/](_archive/) |
| Known doc gaps and follow-ups | [BACKLOG.md](BACKLOG.md) |
| Component/sequence diagrams | [diagrams/](diagrams/README.md) |
| Localization glossary + style guides | [i18n/](i18n/) |

## Documentation rules

- **`docs/features`** describes what is implemented in the current app, one folder per
  feature area. Every claim should be checkable against a real file path.
- **`docs/architecture`** documents cross-cutting contracts — the LLM provider layer, the
  persistence backend, the self-hosting story, the app's folder structure, and
  [localization](architecture/localization.md) (the four-locale contract: where English is
  allowed, how API errors resolve, number/date formatting, and what the lint cannot see).
- **`docs/design`** is the dual-theme design system (Studio Light + Spark Dark). Read it
  before building UI.
- **`docs/development`** documents the evaluation and calibration harnesses: how to run
  them, what they measure, what their baselines are.
- **`docs/product`** holds market/roadmap framing (competitor teardown, coverage waves,
  enterprise readiness track). Aspirational by nature — don't mistake it for feature docs.
- **`docs/concepts`** is only for not-yet-implemented proposals. When a concept ships,
  move or rewrite it under `features/` or `architecture/` and leave only the remaining
  follow-up work behind.
- **`docs/harness`** keeps dated product-review, scan, and context-map runs. That is
  evidence with a timestamp, not a source of truth.
- **`docs/_archive`** keeps superseded docs so old context survives. Each carries a note
  saying what replaced it. Prefer archiving over deleting.

One deliberate exception: [`TAXONOMY_COVERAGE.md`](TAXONOMY_COVERAGE.md) stays at the root
of `docs/` because `pipeline/jobfit/taxonomy_check.py` hardcodes that path as its report
output and a test gate fails when it drifts. It is generated, not written.

## Keeping docs in sync with code

A Stop hook — [`scripts/docs/check-doc-sync.mjs`](../scripts/docs/check-doc-sync.mjs),
registered in `.claude/settings.json` — watches for the drift that made this
reorganization necessary. When a turn edits source mapped in
[`scripts/docs/feature-doc-map.json`](../scripts/docs/feature-doc-map.json) without
touching any doc under `features/`, `architecture/`, or `design/`, it names the doc that
probably went stale.

Update the doc in the same change, or dismiss it in one sentence when the change really
was internal-only. Full contract in [`.claude/CLAUDE.md`](../.claude/CLAUDE.md)
("Documentation Sync"). Fixtures: `node scripts/docs/__tests__/check-doc-sync.test.mjs`.
