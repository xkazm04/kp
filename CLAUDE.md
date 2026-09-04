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

This project is organized into **161 contexts** across **17 groups**, covering **3010 source and test files**. The full machine-readable map lives in `context-map.json` at the project root — read it at task start to scope your edits to the relevant context’s files.

Contexts are sized for one agent to hold whole: **8–24 files each, median 17**. Every tracked `.ts/.tsx/.py/.mjs` file belongs to exactly one context — there is no unmapped remainder.

Taxonomy: each context has a `category` (ui · api · lib · data · test); each group has a `domain` (feature · infrastructure · shared).

### Groups

- **AI & LLM Infrastructure** _(domain: infrastructure · 17 contexts)_
- **Platform Infrastructure** _(domain: infrastructure · 16 contexts)_
- **Job & JD Management** _(domain: feature · 14 contexts)_
- **Workspace Shell & Onboarding** _(domain: feature · 12 contexts)_
- **Design System & Shared UI** _(domain: shared · 11 contexts)_
- **Developer Assessment** _(domain: feature · 10 contexts)_
- **Hiring Pipeline** _(domain: feature · 10 contexts)_
- **Voice Interviews** _(domain: feature · 10 contexts)_
- **CV Analysis & Candidate Profiles** _(domain: feature · 9 contexts)_
- **Analytics & Reporting** _(domain: feature · 8 contexts)_
- **Candidate Public Surfaces** _(domain: feature · 8 contexts)_
- **Communications & Channels** _(domain: feature · 8 contexts)_
- **Hiring Decisions & Automation** _(domain: feature · 8 contexts)_
- **Candidate Matching & Scoring** _(domain: feature · 7 contexts)_
- **Identity, Org & Compliance** _(domain: infrastructure · 5 contexts)_
- **Interview Scheduling** _(domain: feature · 5 contexts)_
- **Billing & Monetization** _(domain: feature · 3 contexts)_

> Regenerated 2026-09-02 by an incremental local rescan (`/perfect`): 4 stale paths dropped, 326 files added since the 2026-08-20 map placed by sibling/directory/keyword affinity, and 18 contexts seeded for clusters with no home (companion, edge, repo-scan, voice packages, scripts). Seeded contexts carry `[auto-seeded — pending sweep enrichment]` descriptions. Edits between the markers are overwritten on the next scan; edit `context-map.json` or rescan instead.
<!-- personas:context-map:end -->

## Constraints for the scope you were given

The map above tells you **which files** a context holds. It does not tell you
which rules bind them — and the canonical document is written for the repository
as a whole, so an agent scoped to one context inherits every global rule and has
to infer which apply. Most do not: the `db.transaction()` rules mean nothing in a
design-system context, the dual-theme rules mean nothing in a store module.

[`context-constraints.json`](./context-constraints.json) is the per-scope record
(declared as `contexts.constraints` in [`.ai/manifest.yaml`](./.ai/manifest.yaml)).
Given a file path, resolve every zone whose `paths` glob matches and read its
`constraints`. Zones run general → specific and a file legitimately matches
several — `app/features/hiring/pipeline/PipelineTab.tsx` matches `ui-surfaces`
**and** `i18n-catalogs`, and all of it applies.

Two fields carry the weight:

- **`enforced_by`** separates a constraint a gate will catch from one only a
  reviewer will. `prose` means exactly that — nothing runs, so breaking it costs
  a review round rather than a red build. Never write an `enforced_by` for a gate
  you have not confirmed runs: an invented enforcer tells the next agent it is
  safe to stop thinking.
- **`status`** and the `coverage` block make *"nobody wrote this down"*
  distinguishable from *"there is nothing to write"*. A path matched only by the
  `repo-wide` zone has **assumed** guidance, and `coverage.assumed` names the
  areas knowingly in that state — the largest being `app/_lib/**` outside `db/`.

When you add a rule that binds one area rather than the whole repository, put it
in a zone there; the canonical file is for the ones with no scope.
