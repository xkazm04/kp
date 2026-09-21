## Skill improvement log

- 2026-09-15: Refreshes must inspect local hooks as well as package scripts and
  CI. This run found that `.githooks/pre-push` had gained a local-only English
  copy gate after `AGENTS.md` was last updated. The repository's declared
  canonical/projection layout and machine-checked CI gate table take precedence
  over collapsing every guidance file to a one-line pointer.
