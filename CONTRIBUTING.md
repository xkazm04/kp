# Contributing to KandiDate

Thanks for looking. This is a real product that happens to be open source, so the
bar is "would I want to maintain this in three years", not "does it work on my
machine". That cuts both ways: the conventions below exist so your patch gets
merged rather than bikeshedded.

## Before you write code

- **Small fix, obvious bug, typo, missing translation** — just open a PR.
- **Anything that changes behaviour, adds a dependency, or touches the pipeline,
  the LLM layer, or billing** — open an issue first and let's agree on the shape.
  A rejected 800-line PR is a bad day for both of us.
- **Security issues** — do not open a public issue. See [`SECURITY.md`](./SECURITY.md).

## Licensing and the CLA

KandiDate is licensed under **AGPL-3.0-only** ([`LICENSE`](./LICENSE)). Two things
follow from that, and it is better to know both up front:

1. **If you run a modified version as a network service, you must offer your
   users its source.** That is the whole point of the AGPL and it is why this
   project can be given away without giving away the ability to sustain it.
2. **Contributions are accepted under a Contributor License Agreement**
   ([`CLA.md`](./CLA.md)). You keep the copyright in your work; you grant the
   maintainer the rights needed to ship it — including under a different licence
   later, which is what makes a commercially-hosted version of this codebase
   possible at all.

If the CLA is a dealbreaker for you, say so in the issue. A patch under
AGPL-only can sometimes still be taken; it just has to be handled deliberately
rather than merged by reflex.

## Development setup

```bash
npm install
pip install -r requirements.txt      # the Python jobfit pipeline
npm run dev                          # one dev server per checkout (the lock is .next/dev/lock)
```

There is no required API key. With none configured the app runs on deterministic
fallbacks and the Claude CLI / Ollama paths — degrading gracefully without keys
is a **product property**, not a dev convenience, so please don't write code that
assumes a provider is present. See the README's "Run it yourself" section.

## The verification gate

Run these before opening a PR. CI runs the same set; a red gate is not a
review comment, it's a blocked merge.

```bash
npm run typecheck        # NOTE: runs Python codegen (schemas:gen) before tsc
npm run test:unit        # node:test over app/**/*.test.ts
npm run test:python:gate # the gated Python suite
npm run lint
npm run design:check     # no raw hex outside app/landing/
npm run i18n:check       # 4-locale message parity
npm run test:e2e         # Playwright
```

## The five conventions that actually bite

1. **4-locale parity.** Every key you add to `messages/en.json` must land in
   `cs`, `de` and `fr` in the same change. next-intl keys are typed, so an
   incomplete catalog is a `tsc` error for everyone, not just a lint warning.
2. **No raw hex outside `app/landing/`.** Everything else resolves through the
   design tokens, because the app ships two themes from one codebase. Read
   [`docs/design/README.md`](./docs/design/README.md) before building UI, and
   verify new surfaces in **both** themes.
3. **Update the doc in the same change.** `docs/` is genre-partitioned and
   [`scripts/docs/feature-doc-map.json`](./scripts/docs/feature-doc-map.json)
   maps source globs to the doc that describes them. A feature doc naming a
   moved file is worse than no doc.
4. **Degrade, don't crash.** When a provider is missing, rate-limited or down,
   the deterministic fallback runs. Never a green lie either: delivery states are
   `sent` / `queued` / `failed`, never optimistic.
5. **Candidate token routes carry a projection, not the row.** Public
   `[token]` surfaces expose an explicit field allowlist. Internal ids never go
   on the wire.

Deeper guidance for automated agents and humans alike lives in
[`.claude/CLAUDE.md`](./.claude/CLAUDE.md).

## Commit and PR style

- Present tense, scoped: `billing: unmeter self-hosted installs`.
- One logical change per PR. If your PR needs a "and also" in the description,
  it's probably two PRs.
- Explain **why** in the body. The what is in the diff.

## What is unlikely to be merged

- Changes that make a provider mandatory, or that remove a deterministic fallback.
- New dependencies that duplicate something already in the tree.
- Reformatting passes bundled with logic changes.
- Features that only make sense for the hosted deployment. The hosted product is
  this software plus operations, not this software plus extras; if it can't be
  useful to a self-hoster, it probably belongs in the ops layer.
