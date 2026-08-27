# Changelog

What changed, per version, for someone deciding whether to upgrade a running
install. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html) — see
[`docs/architecture/releases.md`](docs/architecture/releases.md) for what a
major/minor/patch means *here* (schema migrations and env-var contracts, not
just the TypeScript API).

New sections are inserted directly below this marker by
`node scripts/release/prepare.mjs --version x.y.z`. Do not remove it.

<!-- next-release -->

## [0.1.0] - unreleased

The first tagged release line. Until now there was no release boundary at all:
CI was green, the `Dockerfile` and Helm chart existed, and an operator's only
option was to pin a git SHA and read `git log` to find out what it contained.

`v0.1.0` is the tag that cuts this. Pushing it runs
[`.github/workflows/release.yml`](.github/workflows/release.yml), which
re-runs the gates, publishes `ghcr.io/xkazm04/kp:0.1.0` with a build-provenance
attestation, packages the Helm chart, and creates the GitHub Release from this
section.

### Added

- **A release process.** `scripts/release/prepare.mjs` cuts a version across
  `package.json`, the chart's `appVersion` and this file in one step;
  `--check` runs in CI so the three cannot drift apart.
- **Signed, versioned container images** published to GHCR on tag, with
  provenance attestation and an immutable `sha-<commit>` tag beside the semver
  one.
- **A rollback runbook** — [`docs/architecture/releases.md`](docs/architecture/releases.md)
  — covering the image roll-back, the SQLite backup/restore path
  (`npm run db:dump` / `db:load`) and what is and is not reversible.
- **Automated change review.** Two lenses read every change back: a
  deterministic gate-integrity pass over the diff, and an LLM review against
  this repository's own written rules. See
  [`docs/development/change-review.md`](docs/development/change-review.md).
- **Architecture decision records** under
  [`docs/architecture/decisions/`](docs/architecture/decisions/README.md), with
  a CI gate that fails when a record names a file that no longer exists.
- **Supply-chain automation** — CodeQL over TypeScript and the Python pipeline,
  `npm audit` / `pip-audit` gates, and Dependabot across npm, pip and Actions.
  See [`SECURITY.md`](SECURITY.md).

### Security

- `next` 16.3.3 — two critical unauthenticated RCE advisories.
- Intake: the `CODEBASE_DOSSIER` fence now survives its own payload.
- Every CI workflow declares least-privilege `permissions:` for `GITHUB_TOKEN`.

### Changed

- The deterministic, keyless AI-behaviour evals (`matching_eval --strict`,
  `automation_eval --no-llm --strict`) and the App-master bench driver's own
  tests are now CI gates rather than on-demand runs.

### What "0.1.0" means about stability

Young project, single release line, no maintained back-branches. The self-host
contract that this version pins:

- one SQLite file at `data/kp.sqlite` (`KP_DB_PATH` to relocate);
- a production build **fails closed** without `KP_OPERATOR_PASSWORD` unless
  `KP_ALLOW_OPEN=1`;
- every AI feature degrades to a deterministic answer with no provider key.

Migrations run forward automatically on boot and are **not** automatically
reversible — take a dump before upgrading. `docs/architecture/releases.md` says
what that costs.
