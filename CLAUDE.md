@AGENTS.md

> **The canonical guidance for this repository is
> [`.claude/CLAUDE.md`](./.claude/CLAUDE.md)** — declared as `guidance.canonical`
> in [`.ai/manifest.yaml`](./.ai/manifest.yaml), which is the machine-readable
> answer to "which file first?". This file and `AGENTS.md` are projections of it.
> If your tool does not expand the `@AGENTS.md` include above, open the canonical
> file directly: it holds the conventions that actually bite (pathspec-only
> commits in this shared checkout, 4-locale message parity, design tokens, the
> `db.transaction()` rules), and neither of the projections repeats them.

<!-- personas:context-map:start -->
## Project Context Map

This project is organized into **143 contexts** across **17 groups**, covering **2377 source and test files**. The full machine-readable map lives in `context-map.json` at the project root — read it at task start to scope your edits to the relevant context’s files.

Contexts are sized for one agent to hold whole: **10–22 files each, median 17**. Every tracked `.ts/.tsx/.py/.mjs` file belongs to exactly one context — there is no unmapped remainder.

Taxonomy: each context has a `category` (ui · api · lib · data · test); each group has a `domain` (feature · infrastructure · shared).

### Groups

- **AI & LLM Infrastructure** _(domain: infrastructure · 14 contexts)_
- **Job & JD Management** _(domain: feature · 13 contexts)_
- **Hiring Pipeline** _(domain: feature · 10 contexts)_
- **Design System & Shared UI** _(domain: shared · 10 contexts)_
- **Platform Infrastructure** _(domain: infrastructure · 10 contexts)_
- **Developer Assessment** _(domain: feature · 9 contexts)_
- **Workspace Shell & Onboarding** _(domain: feature · 9 contexts)_
- **Hiring Decisions & Automation** _(domain: feature · 8 contexts)_
- **CV Analysis & Candidate Profiles** _(domain: feature · 8 contexts)_
- **Voice Interviews** _(domain: feature · 8 contexts)_
- **Communications & Channels** _(domain: feature · 8 contexts)_
- **Analytics & Reporting** _(domain: feature · 8 contexts)_
- **Candidate Public Surfaces** _(domain: feature · 8 contexts)_
- **Candidate Matching & Scoring** _(domain: feature · 7 contexts)_
- **Interview Scheduling** _(domain: feature · 5 contexts)_
- **Identity, Org & Compliance** _(domain: infrastructure · 5 contexts)_
- **Billing & Monetization** _(domain: feature · 3 contexts)_

> Regenerated 2026-08-21 by a local rescan that recalibrated context granularity (was 285 contexts averaging 6.7 files, with 450 source files unmapped). Edits between the markers are overwritten on the next scan; edit `context-map.json` or rescan instead.
<!-- personas:context-map:end -->
