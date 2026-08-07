<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# kp (CandiDate / KP studio)

Full agent guidance lives in **[`.claude/CLAUDE.md`](./.claude/CLAUDE.md)** —
project overview, commands, architecture, the dual-theme design law, doc-sync
rules, and the conventions that bite. Read it before changing anything. The
short version:

- Recruiting studio: Next 16 canary + React 19, better-sqlite3 (`data/kp.sqlite`),
  custom HMAC auth (open dev mode; prod fails closed without `KP_ALLOW_OPEN=1`),
  spawned Python jobfit pipeline, multi-provider LLM layer that degrades
  gracefully keyless, next-intl (`en`/`cs`/`de`/`fr` — parity is gated).
- `npm run typecheck` runs Python codegen (`schemas:gen`) before `tsc`.
- Verification: `npm run test:unit` · `test:python:gate` · `lint` ·
  `design:check` · `i18n:check` · `test:e2e` (keyless deterministic subset:
  `e2e/journey-role-to-schedule.spec.ts e2e/modal-escape.spec.ts
  e2e/profile-builder.spec.ts`; `KP_E2E_BASE_URL` targets a running server).
- Shared checkout with concurrent agent sessions: **pathspec commits only**
  (`git add <paths>`), never `git add -A`, never stash others' work; when you
  change behavior, update the mapped doc under `docs/` in the same change.
