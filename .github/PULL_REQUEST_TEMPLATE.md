<!--
One focused change per PR. If the description needs an "and also", it's two PRs.
Explain WHY in the body — the what is in the diff.
-->

## What and why

## Checklist

- [ ] **The verification gate is green locally** — all seven:
      `npm run typecheck` · `npm run test:unit` · `npm run test:python:gate` ·
      `npm run lint` · `npm run design:check` · `npm run i18n:check` · `npm run test:e2e`
- [ ] **One focused change** — no reformatting passes or drive-by refactors bundled in.
- [ ] **Tests included** if this touches auth, billing, tenancy, rate limits, or the
      LLM chokepoint (`app/_lib/llm-config.ts` / `pipeline/jobfit/llm/`) — mandatory there,
      welcome everywhere.
- [ ] **Docs updated in the same PR** where behavior changed
      (`scripts/docs/feature-doc-map.json` maps source to the doc; the doc-sync hook
      enforces this for agents — humans do it by hand).
- [ ] **4-locale parity** for any copy change: keys added to `messages/en.json` also land
      in `cs`, `de`, `fr`.
- [ ] **Pathspec-scoped commits** — staged with `git add <path>`, never `git add -A`.
- [ ] **Local-first invariants hold**: no provider made mandatory, no deterministic
      fallback removed, nothing hosted-only, nothing phoning home by default.
- [ ] **AI assistance disclosed**: if this PR is substantially agent-generated, say so
      below. Either way, you ran the gate yourself and can explain every line.
- [ ] **CLA**: I have read [`CLA.md`](../CLA.md) and submit this contribution under its
      terms (see [`CONTRIBUTING.md`](../CONTRIBUTING.md)).

## AI assistance

<!-- "None", or which tools/agents and how much of the diff. Disclosure is welcome,
     not penalized — undisclosed bulk agent PRs are what gets closed without review. -->
