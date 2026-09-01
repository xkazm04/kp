<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# kp (CandiDate / KP studio)

Self-hostable AI recruiting studio (Next.js + Python jobfit pipeline).

Full agent guide: **[`.claude/CLAUDE.md`](./.claude/CLAUDE.md)** — read it
before changing anything.

Verify a change:

```bash
npm run typecheck    # runs Python schemas:gen before tsc
npm run test:unit
npm run lint
```

Everything else — commit rules for this shared checkout (pathspec-only
staging), the design-token and locale-parity gates, keyless e2e setup,
doc-sync obligations — is stated once in `.claude/CLAUDE.md`; follow it as
written there.

## Every gate CI will run on your push

Those three commands are what you run *while working*. They are not what decides
whether the change lands: `.github/workflows/ci.yml` runs the table below, and
until this table existed an agent that followed the guidance to the letter still
met `design:check`, `docs:check`, `release:check` and twenty more for the first
time in a red build. Documented commands and gating commands were two different
sets and nothing compared them.

None of these needs a key or a network. All are seconds-fast except `build`,
`test:unit` and `test:python:gate`.

`.ai/manifest.yaml` `guidance.gates` is the machine-readable copy of this table
and `guidance.gates_doc` points at this file. `npm run guidance:check` fails when
the two drift **in either direction** — a step added to `ci.yml` that this table
never names (`gate-unlisted`), a row here that CI no longer runs (`gate-stale`),
or one package.json has dropped. **Add a CI step and you add its row in the same
change.** That is the whole rule, and it is what makes this table trustworthy
rather than a snapshot.

| Gate | Fails when |
| --- | --- |
| `npm run typecheck` | tsc — after `schemas:gen`, so Python and `requirements.txt` must be installed |
| `npm run lint` | eslint, including the `no-restricted-syntax` ban on `await` inside `db.transaction()` |
| `npm run lint:ts-ratchet` | an `eslint-disable`/`@ts-` suppression has no ceiling in `ts-debt.json`, or grew past it |
| `npm run design:check` | `brand.ts` ↔ `app/globals.css` fell out of lockstep, or a shade utility has no dark value |
| `npm run i18n:check` | a key is missing from one of the 4 catalogs, or a literal leaked into a shared primitive |
| `npm run docs:check` | an ADR's `sources:` path is gone, or the decision index drifted from the records |
| `npm run guidance:check` | the guidance files, `.ai/manifest.yaml` and this table stopped agreeing |
| `npm run deploy:check` | the Helm chart regressed a deployment invariant (`docs/architecture/self-hosting.md`) |
| `npm run release:check` | package.json, the chart's `appVersion` and the CHANGELOG name different versions |
| `npm run test:release` | fixtures for the release scripts — prepare, commit-msg, sbom, provenance |
| `npm run sbom` | the bill of materials cannot be built from the lockfile + the pip environment |
| `npm run test:docs` | fixtures for the doc-sync hook, the ADR gate and the guidance check |
| `npm run test:review` | fixtures for the review lenses (constitution, gate-check) |
| `npm run test:agent` | fixtures for the dispatch guard — who may dispatch, what may never be written |
| `npm run test:lint-ratchet` | fixtures for the ruff and ts ignore ratchets |
| `npm run test:perf` | fixtures for the CI wall-clock budget, including "every job has a ceiling" |
| `npm run test:deploy` | fixtures for the chart policy |
| `npm run review:gate` | a required check in `.github/rulesets/main.json` no longer matches a job name |
| `npm run security:actions` | a workflow does not scope `GITHUB_TOKEN`, or a NEW action rides a mutable tag |
| `npm run security:secrets` | a file git tracks carries a credential — the whole tree, not just the diff, and NOT waivable by a commit trailer |
| `npm run test:security` | fixtures for the credential table: every pattern fires, and the real tracked tree is clean |
| `npm run hooks:check` | `.githooks/*` points at an npm script or a file that no longer exists |
| `npm run test:bench-driver` | fixtures for the App-master bench driver and its committed baseline |
| `npm run test:unit` | the node:test suite over `app/**/*.test.ts` and `packages/**/*.test.ts` |
| `npm run build` | `next build`, after `schemas:gen` |
| `npm run lint:ruff-ratchet` | a `ruff.toml` ignore has no ceiling, is over it, or now suppresses nothing |
| `npm run test:python:gate` | the gated Python suite, or its skip count exceeded `KP_SKIP_BASELINE` |
| `npm run test:eval:ci` | a keyless deterministic AI-behaviour eval regressed (matching, automation, fault) |

Two further CI jobs read the **commit range** rather than the tree, so no local
command stands in for them:

- **doc-sync** — changed source vs the doc `scripts/docs/feature-doc-map.json`
  couples it to. Waive on the record with a `Doc-sync: internal-only — <why>`
  trailer in the commit body.
- **commit-convention** — `scripts/release/commit-msg.mjs`. The subject is ONE
  CLAUSE ABOUT THE CHANGE; the session narrative belongs in the body. Waive with
  `Commit-convention-exemption: <why>`.

Before a push to `main`, `.githooks/pre-push` runs the fast core of the table
(both review lenses, then `typecheck`, `lint`, `lint:ts-ratchet`, `design:check`,
`build`). Everything else is CI's, and CI is the teeth.

## Before you reverse something surprising

Several choices here look wrong until you know why they were made: a pinned
canary Next line, one SQLite file instead of a database server, a Python
pipeline **spawned per request** rather than run as a service, deterministic
fallbacks that exist even though "everyone has an API key".

Each of those is a written decision with its own record in
**[`docs/architecture/decisions/`](./docs/architecture/decisions/README.md)** —
read the relevant one before proposing to undo it. Every record ends with the
concrete observation that *would* reopen it, so disagreeing is a supported move;
doing it silently is not.

Records are machine-checked: `npm run docs:check` fails when an ADR's
`sources:` paths no longer exist or the index drifts from the records.
