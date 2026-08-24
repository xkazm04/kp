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
