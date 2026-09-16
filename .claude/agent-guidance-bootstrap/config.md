# agent-guidance-bootstrap — kp overlay

Project-specific configuration for the shared `agent-guidance-bootstrap` skill.

- Canonical guidance: `.claude/CLAUDE.md` (`.ai/manifest.yaml` `guidance.canonical`);
  `AGENTS.md` and `CLAUDE.md` are declared projections, and `AGENTS.md` carries the CI
  gate table. Refresh the canonical file; do not collapse the projections to one-line
  pointers — `npm run guidance:check` holds this structure deliberately.
- Checks to run after a refresh: `npm run guidance:check`, `npm run docs:check`
  (AGENTS.md is an ADR `sources:` path), `npm run test:docs` (pins the keyless e2e line).
- The `personas:context-map` block in `CLAUDE.md` is generated; refresh it by rescanning,
  not by hand.

## Skill improvement log

### 2026-09-16 — refresh run (skill 0.6.0, pinned install, no registry receipt)

- Observation: on a repo that already machine-checks its guidance (`guidance:check`),
  the drift that survived was in *numbers and version labels* inside prose — a fixture
  count (19 → 25), a test-glob list, a "canary" label on an exact stable pin, an
  unreproducible site count — none of which any gate reads. Auditing every literal
  number/version claim was the productive step.
- PROPOSAL (method, not applied — pinned install): the "Keeping it true" audit could add
  "re-derive every count and version stated in prose; drop a count you cannot reproduce".
- PROPOSAL (method, not applied): the "aim for under 200 lines" and "one file, one root /
  one-line pointer" rules conflict with a repo that declares a canonical file plus checked
  projections; the skill could say to respect an existing machine-declared structure.
