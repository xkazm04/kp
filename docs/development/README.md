# Development — build, test, evaluate, calibrate

Developer-facing material: how to verify a change, what the eval harnesses measure,
the tooling that only exists in dev builds, and the command-line entry points.

| Doc | Covers |
| --- | --- |
| [testing-and-evaluation.md](testing-and-evaluation.md) | The verification commands, what each suite covers, the 14-fixture golden-set eval and its thresholds |
| [change-review.md](change-review.md) | The two lenses that read a change back — a deterministic gate-integrity pass and an LLM review against this repo's own rules |
| [benchmarks.md](benchmarks.md) | Dated model benchmark (2026-08-05): judged quality, reliability and economics across commercial and open models |
| [cli-reference.md](cli-reference.md) | `scripts/*.py` analysis CLIs and the `python -m pipeline.jobfit.*` operational CLIs |
| [dev-inspector.md](dev-inspector.md) | DevInspector — click a component, copy its `File.tsx:line` |
| [logging.md](logging.md) | Per-request JSONL logs in `tmp/` and the prompt-capture switch |
| [automation-eval.md](automation-eval.md) | Automation quality gating |
| [case-calibration.md](case-calibration.md) | Case-generation calibration framework |
| [voice-interview-testing.md](voice-interview-testing.md) | Testing the voice interview plane |
| [role-intake-research.md](role-intake-research.md) | Conversation-design research behind the role-intake dialog |

Contributor conventions (staging rules, locale parity, the design-token gate) are in
[`CONTRIBUTING.md`](../../CONTRIBUTING.md) and, in full, [`.claude/CLAUDE.md`](../../.claude/CLAUDE.md).
