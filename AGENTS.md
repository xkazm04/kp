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

### What those three need on a machine that has never built this repo

`git clone && npm ci` is not enough for the first of them, and the reason is not
visible in its name: `typecheck` runs `schemas:gen` before `tsc`, `schemas:gen`
runs the Python codegen, and the codegen imports the pipeline package. So:

```bash
# Python 3.12 — the version .github/workflows/ci.yml pins
pip install -r requirements.txt
npm ci
```

`npm run build` needs the same. Nothing else on the list does — `test:unit` and
`lint` are Node-only.

If the interpreter is somewhere unusual, `KP_PYTHON=/path/to/python` picks it;
otherwise `scripts/schemas-gen.mjs` tries `python`, `python3` and `py -3` in that
order and, when none of them works, says which prerequisite is missing instead of
failing as a generic error inside a command called "typecheck".

**This is checked, not asserted.** `.github/workflows/cold-clone.yml` runs the
three commands nightly from an empty checkout with no caches, in the order this
section names, and opens an issue when they do not succeed. It is deliberately
not a required check — it re-runs the documented path against a moving world
(runner images, point releases), so it can go red for reasons unrelated to any
one commit. If it fails, either the tree broke or this section is wrong, and
deciding which is the whole point.

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
| `npm run i18n:check` | a key is missing from one of the 4 catalogs, repeats inside one catalog object, or a literal leaked into a shared primitive |
| `npm run docs:check` | an ADR's `sources:` path is gone, or the decision index drifted from the records |
| `npm run guidance:check` | the guidance files, `.ai/manifest.yaml` and this table stopped agreeing |
| `npm run api:check` | `docs/architecture/api-reference.md` and `app/api/**/route.ts` disagree — a route with no row, a row with no route, a method added, or a route that changed side of the fail-closed auth gate. Fix with `npm run api:docs` |
| `npm run deploy:check` | the Helm chart regressed a deployment invariant (`docs/architecture/self-hosting.md`) |
| `npm run release:check` | package.json, the chart's `appVersion` and the CHANGELOG name different versions |
| `npm run test:release` | fixtures for the release scripts — prepare, commit-msg, sbom, provenance |
| `npm run sbom` | the bill of materials cannot be built from the lockfile + the pip environment |
| `npm run test:docs` | fixtures for the doc-sync hook, the ADR gate, the guidance check, the schemas-gen wrapper and the API-reference generator — including a comparison of the committed reference against the routes that exist |
| `npm run test:skills` | fixtures for the project-owned motionize skill tools (glyph core, contact sheet, fetch budget) |
| `npm run test:review` | fixtures for the review lenses (constitution, gate-check, the shared workflow reader, the agent lens's pure half) — including that an untrusted value reaches a shell only as a quoted `env:` binding |
| `npm run test:agent` | fixtures for the dispatch guard — who may dispatch, what may never be written (the protected set is DERIVED from the gates CI runs), that an OBEDIENT model is refused everything a hostile issue asks it for, and the spend meter that stops a lane at its declared token ceiling |
| `npm run test:lint-ratchet` | fixtures for the shared ratchet protocol and for the ruff and ts ignore ratchets built on it |
| `npm run test:perf` | fixtures for the CI wall-clock budget ("every job in ci.yml AND review.yml has a ceiling, under its own timeout"), plus the static import-graph budget measured against this tree — `perf-budget.json` is enforced here rather than by a CI step of its own |
| `npm run test:deploy` | fixtures for the chart policy |
| `npm run review:gate` | a required check in `.github/rulesets/main.json` no longer matches a job name |
| `npm run security:actions` | a workflow does not scope `GITHUB_TOKEN`, or a NEW action rides a mutable tag |
| `npm run security:secrets` | a file git tracks carries a credential — the whole tree, not just the diff, and NOT waivable by a commit trailer |
| `npm run test:security` | fixtures for the credential table and the workflow gate: every pattern and every rule class fires, and the real tracked tree + `.github/workflows` are clean |
| `npm run hooks:check` | `.githooks/*` points at an npm script or a file that no longer exists |
| `npm run test:bench-driver` | fixtures for the App-master bench driver and its committed baseline |
| `npm run test:flake` | fixtures for the flake policy — a FLAKE still blocks, a quarantine does not, and `test-quarantine.json` has a dead/unexplained/expired entry or is over its ceiling |
| `npm run test:unit` | the node:test suite over `app/**/*.test.ts`, `packages/**/*.test.ts`, `edge/**/*.test.ts` and `i18n/**/*.test.ts` — a failing run re-runs the failing files once and labels each BROKEN / FLAKE / QUARANTINE |
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
