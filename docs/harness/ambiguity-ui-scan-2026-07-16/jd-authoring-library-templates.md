# JD Authoring Library & Templates — ambiguity-guardian + ui-perfectionist scan

> Total: 6 findings (0 critical, 1 high, 4 medium, 1 low)

## 1. Generate/retry resolve the chosen template without the caller's workspace — silent format loss for non-default teams, cross-tenant read of default-team private templates
- **Severity**: High
- **Lens**: ambiguity
- **Category**: template-tenancy-bypass
- **File**: `app/api/jds/generate/route.ts:68` (same defect at `app/api/jds/[slug]/retry-analysis/route.ts:23`)
- **Scenario**: A recruiter on a non-default workspace picks their team-private template in the JD builder and hits Generate. The route resolves it via `getTemplate(templateId)` — no second argument — so `templates-store.ts:99` scopes the lookup to `DEFAULT_WORKSPACE_ID`. Their template resolves to `null`, `templateBody` is `undefined`, and the JD is built with the AI-default layout with zero warning. Conversely, any session on any team can pass the id of a DEFAULT-workspace *private* template and have its body rendered into their JD.
- **Root cause**: `getTemplate` has a defaulted `workspaceId` parameter, so forgetting it type-checks fine. The route already awaits `currentWorkspace()` on line 86 for `insertAnalyzingJd` but not for the template resolution two blocks earlier; retry-analysis repeats the copy. The isolation contract these calls break is explicitly pinned in `app/_lib/templates-isolation.test.ts:27` ("ws-a can't read ws-b's private template by id") — the store honors it, the two call sites bypass it.
- **Impact**: For multi-workspace deployments (`KP_MULTI_WORKSPACE`): (a) every non-default team's template choice is silently discarded on Generate AND on every Retry, producing wrongly-formatted JDs that look like an AI whim; (b) a private template's full body leaks across tenants by id guessing — the exact hole the store's WHERE guard and its test exist to close.
- **Fix sketch**: Pass the resolved workspace: `const ws = await currentWorkspace();` then `getTemplate(templateId, ws)?.body` in both routes (retry-analysis should use the JD row's workspace). Additionally, when `templateId` is non-empty but resolution returns `null`, return a 400 ("template no longer available") instead of silently falling back to the AI-default format — the recruiter made an explicit format choice. Consider removing the `workspaceId` default from `getTemplate` so the compiler forces every future call site to decide.

## 2. The section-collapse regex contains an invisible U+E000 character — the code reads as a different (and dangerous-looking) regex than the one that runs
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: invisible-load-bearing-character
- **File**: `app/features/sub_library/render-template.ts:201`
- **Scenario**: A developer (or a reviewer, or an AI assistant) reads line 201 as `/(^|\n)#{1,6} [^\n]*\n(?=\n|$)/g` — i.e. "delete any markdown heading followed by a blank line", which would be a glaring bug (it would eat every conventionally-spaced heading). In fact the literal embeds a raw, invisible U+E000 (`EMPTY_MARK`) between `\n` and the lookahead, so the real pattern is "heading followed by a lone empty-placeholder marker line" — correct. Byte inspection confirms exactly one >7-bit char (0xE000) on that line; every editor, diff, grep and code review renders it as nothing.
- **Root cause**: The sentinel defined two screens up as the escape `"\uE000"` (line 126) is pasted into this regex literal as the raw character instead of interpolating the constant or writing `\uE000` inside the pattern.
- **Impact**: Latent breakage magnet: a formatter/linter that strips private-use characters, a copy-paste refactor, or a well-meaning "simplify this regex" edit silently deletes the load-bearing character; the failure mode (headings of empty sections stop collapsing) only shows on rendered JDs with unfilled sections, far from the diff. It also actively misleads review — the visible text describes a destructive regex the code doesn't run, so reviewers either miss real bugs or "fix" a non-bug.
- **Fix sketch**: Build the pattern from the constant so the dependency is visible: `new RegExp(String.raw`(^|\n)#{1,6} [^\n]*\n${EMPTY_MARK}\n(?=\n|$)`, "g")` (or write `\uE000` as an escape inside the literal). Add one code comment noting the marker is part of the pattern. The existing tests at `render-template.test.ts:249` already pin the behavior, so the refactor is safe to verify.

## 3. Empty-section collapse only works for the seeded template's tight heading style — conventional blank-line templates ship dangling headings to the public JD page
- **Severity**: Medium
- **Lens**: ui
- **Category**: dangling-empty-heading
- **File**: `app/features/sub_library/render-template.ts:201`
- **Scenario**: A recruiter authors a custom template in the ordinary markdown style — a blank line between heading and content: `## About us\n\n{{about}}`. The build supplies no `about` (it never does; see line 173's comment). Verified against the real module: the output keeps `## About us` followed by two blank lines, because the collapse regex requires the marker on the line *immediately* after the heading. The published, candidate-facing JD page renders an empty "About us" section heading over a void.
- **Root cause**: The collapse contract was designed around `DEFAULT_TEMPLATE_BODY`'s tight `## {{heading_about}}\n{{about}}` layout and its tests only pin that shape (`render-template.test.ts:249` uses no blank line). Blank-line-separated headings — what most humans and most markdown tooling produce — fall outside the pattern, and nothing documents that the collapse is layout-sensitive.
- **Impact**: The exact artifact the collapse feature exists to prevent ("an awkward empty section", line 172) reappears on the flagship shareable page for any user-authored template that follows normal markdown conventions; the recruiter has no way to know why the seeded template collapses cleanly but theirs doesn't.
- **Fix sketch**: Widen the collapse to tolerate blank lines between the heading and the lone marker line, e.g. match `heading \n (blank-lines)* marker-line` — `new RegExp(...\n(?:[ \t]*\n)*${EMPTY_MARK}\n(?=\n|$)...)` — and add a pinning test for the blank-line style (both empty → collapsed, and provided → preserved). Alternatively, document in the manager's placeholder help that sections collapse only when the placeholder sits directly under its heading.

## 4. JD save/generate validation errors surface in English inside the fully localized builder — templates got error codes, JDs didn't
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: i18n-error-asymmetry
- **File**: `app/_lib/jd-limits.ts:48` (surfaced at `app/features/sub_library/JdBuilder.tsx:181` and `:148`)
- **Scenario**: A Czech-locale recruiter clicks "Uložit jako koncept" with an over-long body, or deep-links a generate with a too-short need. The builder — every label, hint and gate message localized via `next-intl` — shows a raw English sentence: "Body must be 20,000 characters or fewer." / "Describe the need in at least 11 characters so the AI has something to design from." (client-side `fields.error` at JdBuilder.tsx:181; server `p.error` passthrough at :148 and :197).
- **Root cause**: `validateJdFields`/`validateJdBuildInput` return English-only `error` strings with no stable code. The sibling template system had this exact problem and solved it — `TemplateFieldError` codes in `render-template.ts:271` plus the manager's `localizeTemplateError` — but the JD validators were never migrated, so the two authoring paths in the same panel follow different error contracts.
- **Impact**: Mixed-language UX on the primary authoring surface for 3 of the 4 locales, and an inconsistency trap: future contributors see two competing patterns in adjacent files and don't know which one is house style.
- **Fix sketch**: Mirror the template approach: give `JdFieldsResult`/`JdBuildInputResult` failures a `reason` code (+ max/min values), keep the English `error` for API consumers, and add a `localizeJdError` switch in JdBuilder mapping codes to `library.builder.err*` keys (4 locales). The server routes keep forwarding the English string unchanged, exactly as `/api/templates` does.

## 5. A failed template fetch is indistinguishable from an empty library — the manager's own null-vs-empty design is defeated by `fetchTemplates`' swallow-to-`[]`
- **Severity**: Medium
- **Lens**: ui
- **Category**: error-state-masked-as-empty
- **File**: `app/features/sub_library/render-template.ts:382` (consumed at `app/features/sub_library/JdTemplateManager.tsx:17`)
- **Scenario**: `/api/templates` fails (server restart, DB lock, network blip). The template manager — which deliberately distinguishes `null` (loading skeleton) from `[]` ("genuinely empty", per its own comment on lines 17-18) — renders the dashed "no templates yet" empty note, because `fetchTemplates` catches every failure and resolves `[]`. In the builder the picker silently shrinks to just "AI default format", so the recruiter's next Generate quietly drops their company format. A non-ok 500 response takes the same path (`payload.templates` is `undefined` → `?? []`).
- **Root cause**: The shared fetch contract (line 380: "swallow-to-empty error behavior") hard-codes failure = empty list, which contradicts the manager's tri-state design one import away; the state that would represent "failed" simply cannot be produced by the shared fetcher.
- **Impact**: A transient outage masquerades as data loss ("all our templates are gone") in the manager, and as a silent format downgrade in the builder — both with zero retry affordance, on a surface whose empty state invites the user to re-create templates that still exist.
- **Fix sketch**: Make the contract honest: have `fetchTemplates` throw (or return `{ ok: false }`) on network error / non-ok status, and let the manager keep `null`→skeleton, add an error state with a Retry button, and let the builder keep the last-known list plus a small "templates unavailable" hint. The swallow-to-empty behavior can remain as an explicit `fetchTemplatesOrEmpty` wrapper if some caller truly wants it.

## 6. Failed builds have no status filter — a "failed" chip exists, but the ledger can't filter to it
- **Severity**: Low
- **Lens**: ui
- **Category**: missing-filter-facet
- **File**: `app/features/sub_library/jd-library.ts:191`
- **Scenario**: A recruiter fires several overnight Generates; two fail. The ledger rows show the red "failed" chip (`jdStatusChip`, line 141), but the status filter dropdown offers only All / Analyzing / Live / Draft / Analysis-only — there is no way to list the failures that need a retry; they must be hunted down inside "All".
- **Root cause**: `STATUS_FILTERS` predates the backgrounded-build states and was only partially updated: "analyzing" was added but "failed" wasn't, and `statusCounts` (line 233) likewise counts analyzing but drops failed (and closed/linked) on the floor.
- **Impact**: The one status that demands recruiter action is the one that can't be isolated; on a busy library failed builds silently age out of view, delaying retries.
- **Fix sketch**: Add `{ value: "failed" }` to `STATUS_FILTERS` and a `failed` bucket to `statusCounts`; label it via the existing localized chip vocabulary in `LibrarySavedJdsLedger.statusFilterLabel` (a `chipFailed`/`failedLabel` key already exists for the chip). `filterAndSortJds` already handles any `StatusFilter` generically, so no other change is needed.
