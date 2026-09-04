# Toolchain — the machine contract

What a checkout of this repository requires of the machine it sits on, and where
each requirement is stated so it cannot drift. Everything here used to be true by
coincidence — the right Node happened to be installed, everyone's git happened to
agree about line endings, the lint config happened to cover the files people
happened to edit. Each item below names the file that now says it and the gate
that reads that file back.

## Node and npm

| Fact | Stated in | Read back by |
| --- | --- | --- |
| Node 24.x | `package.json` `engines.node` (`>=24.0.0 <25.0.0`) | `scripts/docs/__tests__/toolchain-pin.test.mjs`, via `npm run test:docs` |
| The same 24 in CI | `node-version: 24` in twelve steps across seven workflows | the same fixture — it requires every workflow pin to agree on one major, and `engines.node` to be the range admitting exactly that major |
| One npm build | `package.json` `packageManager` (`npm@11.6.2`, exact) | the same fixture — a range is rejected |
| Peer resolution | `.npmrc` `legacy-peer-deps=true`, mirrored by the Dockerfile | its own comment; the two install modes are meant to move together |

Node 24 is not a preference. The unit-test runner is
`node --experimental-transform-types` over `.ts` files (see
`scripts/run-unit-tests.mjs`), and on an older major the whole suite fails to
parse rather than failing a test. Before the pin existed, `package.json`
declared no `engines` at all, so a contributor on Node 20 got a syntax error with
nothing anywhere naming the expected version.

Bumping the line is one change in two places — the `node-version:` steps and
`engines.node` — and the fixture fails if only one moves, in either direction.

## Line endings

This is a Windows-primary checkout with `core.autocrlf=true`: the working tree is
CRLF, the index is LF. That was true for 3628 of 3631 tracked files by everyone's
local git config agreeing, not by anything the repository said.

- `.gitattributes` — `* text=auto` makes LF-in-the-index the repository's rule,
  with explicit `eol=lf` for the files that are executed or parsed by LF-happier
  tools (`.mjs`, `.py`, `.json`, `.yml`, `.sh`, and the `sh` hooks in
  `.githooks/`), plus `binary` for the asset extensions.
- `.editorconfig` — the other half: what an editor **writes**, so an editor and
  git agree before a file reaches the index. 2-space indent, 4 for Python,
  trailing-whitespace trimming off for Markdown (two trailing spaces are a hard
  line break there).

The practical cost of not having this: a multi-line patch written against `\n`
silently matches nothing in a CRLF working tree, which no-op'd two patches in one
month. When you patch by exact text here, either use a tool that matches the real
bytes or normalize first, and verify the patch landed.

**The tree is not renormalized.** A probe against a throwaway index
(`GIT_INDEX_FILE=… git add --renormalize .`) puts the whole normalize diff at
five files: `app/_lib/db-path.ts`, the two `*.generated.ts`, `next-env.d.ts`
(CRLF in the index today) and `samples/profile-fixtures/synthetic-letterspaced.pdf`,
whose stored blob is already CRLF-stripped — `pypdf` recovers from it with
"incorrect startxref pointer" every time `test_pdf_parsing_quality` runs. Landing
that renormalization, and re-recording the PDF fixture from a pristine source, is
an owner decision that has not been taken.

## Which lint laws reach which files

`eslint.config.mjs` expresses every syntax law as a `no-restricted-syntax`
selector, and flat config **replaces** a rule's options rather than merging them
— so each block is built by `restrict()` from declared selector sets. The layers
and what each owes:

| Layer | Transaction law | Module-graph laws | Design (colour) law | Portable-lane wall |
| --- | --- | --- | --- | --- |
| `app/**` lib + api | yes | yes | yes (bar the stated exemptions) | — |
| `app/features/**`, `app/_components/**` | yes | yes + no db value-import | yes (bar the exemptions) | — |
| `packages/**` | yes | yes | — (renders nothing) | yes |
| `edge/**` | yes | yes | — | yes |
| `i18n/**`, root `*.ts` (`proxy.ts`, `next.config.ts`, `instrumentation*.ts`) | yes | yes | — | — |
| `scripts/**` (`.mjs` and `.ts`) | yes | — | — | — |
| `e2e/**` | yes | route-handler wall only | — (specs assert about rendered colour) | — |

`app/lint-selector-coverage.test.ts` is the guard. It asks the real ESLint what
it **resolves** for a file (not what the config source says) and, since this
change, derives the whole tracked TypeScript surface from `git ls-files` and
fails naming any file that matches no block at all. That is what caught the gap
it now prevents: 38 tracked files — every e2e spec, all of `i18n/`, the edge
Worker, the root modules, the `.d.mts` ambient files and the two TypeScript
scripts — matched nothing, so lint was green over them by omission.

## The keyless end-to-end subset

The specs that certify "degrades gracefully keyless" are declared **once**, as
`KEYLESS_SPECS` in `playwright.config.ts`. `ci.yml`'s `e2e-keyless` job passes the
same names as playwright file filters, and `.claude/CLAUDE.md` restates them;
`scripts/docs/__tests__/keyless-e2e-pin.test.mjs` fails when any of the three
diverges, in either direction.

Adding a spec to the release gate is a decision, so the list is named one entry
at a time rather than by a shared prefix — a filter that widens as files are
added is how a slow or key-needing spec ends up in the keyless gate without
anyone choosing to put it there.

`playwright.config.ts` also pins the two run-shape decisions CI was leaving to
defaults: `retries: CI ? 1 : 0` (a browser run has a flake floor a unit test does
not; locally you want the flake visible the first time) and `workers: CI ? 2`,
which is what a 4-core runner resolves to today — so nothing changes now, but a
larger runner cannot silently raise concurrency against the one production server
and one SQLite file these specs share.

## Known gaps

- The tree is not renormalized (above); the five-file diff and the damaged PDF
  fixture are recorded, not fixed.
- `tsconfig.json` runs `strict` but not `noUncheckedIndexedAccess` /
  `exactOptionalPropertyTypes`. Turning either on is repo-wide churn and belongs
  in an owner programme, not in a toolchain change.
- The `.npmrc` `legacy-peer-deps` flag is no longer load-bearing for `next` and
  should be dropped together with the Dockerfile's copy, once a strict
  `npm ci` is verified clean. Nothing gates that today.
