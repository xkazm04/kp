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
