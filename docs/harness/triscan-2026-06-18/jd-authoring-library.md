# JD Authoring Library & Templates — Tri-Lens Scan
> Total: 5
> Severity: 1 Critical / 3 High / 1 Medium / 0 Low
> Lens: 2 bug / 1 ui / 2 biz

## 1. Public JD pages ship zero SEO / share metadata
- **Lens**: 🚀 Business Visionary (primary) · 🎨 UI Perfectionist
- **Severity**: High
- **Category**: SEO / shareability / discoverability
- **Value**: impact 9/10 · effort 3/10 · risk 2/10
- **File**: `app/jds/[slug]/page.tsx:12-19`
- **Scenario**: A recruiter shares `https://…/jds/senior-backend-engineer` (the documented "shareable ?lang=cs links" use case) on LinkedIn / Slack / a careers page. The page only declares `export const dynamic = "force-dynamic"` — there is no `generateMetadata`, so the document `<title>` falls back to the app default, and there is no `description`, canonical, `og:title`/`og:description`/`og:image`, or Twitter card. The link unfurls as a bare URL with generic site chrome, and Google has no title/description to rank.
- **Root cause**: The route never implements `generateMetadata({ params })`; the JD title/body (already loaded via `loadJd`) is rendered only in the body, not surfaced to `<head>`.
- **Impact**: The flagship public artifact of a recruiting SaaS — the thing recruiters paste everywhere — looks broken when shared and is invisible to search. Directly undercuts the "author, publish, share a JD" value proposition and any organic-traffic differentiation vs. Greenhouse/Lever hosted JD pages.
- **Fix sketch**: Add `export async function generateMetadata({ params })` that `loadJd`s the slug and returns `{ title: jd.title, description: <first ~155 chars of body, markdown-stripped>, openGraph: {...}, twitter: { card: "summary" } }`. Reuse the existing not-found guard. ~25 lines, pure read, no schema change.

## 2. `{{about}}` template placeholder is never filled — every custom template silently degrades to boilerplate
- **Lens**: 🐛 Bug Hunter (primary) · 🚀 Business Visionary
- **Severity**: High
- **Category**: template render / data wiring
- **Value**: impact 7/10 · effort 2/10 · risk 2/10
- **File**: `app/features/sub_library/JdBuilder.tsx:134-142`
- **Scenario**: A company authors a branded template whose "About us" section is `## About us\n{{about}}` (exactly the shipped `DEFAULT_TEMPLATE_BODY`, render-template.ts:32-33). The builder renders the AI result THROUGH that template, but the `data` object passed to `renderTemplate` supplies only `title, company, seniority, salary, responsibilities, mustHaves, niceToHaves` — `about` is omitted. `renderTemplate` then hits its fallback (`render-template.ts:95`) and emits the generic "We build technology trusted by millions…" sentence for *every* JD, which the live lint (jd-lint.ts) will itself flag as vague boilerplate.
- **Root cause**: The build pipeline produces no `about` field, and `JdBuilder`'s `displayResult` memo doesn't map one, so the placeholder always resolves to the canned default.
- **Impact**: Branded templates — the core differentiator of the "reusable templates" feature — produce identical filler intros across all roles, the opposite of the inclusivity/specificity message the lint preaches. Recruiters who craft an About section see it replaced by stock copy with no warning.
- **Fix sketch**: Either thread a company/role `about` string into the build result (best) or, minimally, map `about: company.trim() ? \`About \${company}\` : ""` and let the separator-collapse contract drop an empty one; ideally surface "this template uses {{about}} but none was generated" in the manager.

## 3. Public JD pages expose Edit / Archive / Revert controls to anonymous visitors
- **Lens**: 🐛 Bug Hunter (primary) · 🎨 UI Perfectionist
- **Severity**: Critical
- **Category**: trust boundary / authorization
- **Value**: impact 9/10 · effort 5/10 · risk 4/10
- **File**: `app/jds/[slug]/page.tsx:105` (renders `<JdActions … />`); `app/api/jds/[slug]/route.ts:32` (PATCH); `app/api/jds/[slug]/revisions/route.ts:24` (POST)
- **Scenario**: The JD detail page is explicitly the "public, candidate-facing, shareable" artifact (comments at page.tsx:38-50). Yet it unconditionally renders `JdActions`, which exposes Edit JD, Archive, History and "Revert to this". The backing routes (`PATCH /api/jds/[slug]`, `POST …/revisions`) carry no auth — there is no `middleware.ts` in the app and no session/workspace check in any `app/api/jds/*` handler. Anyone who has the shareable link can rewrite the JD body, archive the role (removing it from the recruiter's library and pickers), or revert it to an arbitrary prior revision. A candidate could quietly edit salary/requirements on the role they're applying to.
- **Root cause**: Mutation UI + mutation routes were added (W8-4 / idea-6a18e0fc) onto a page designed for unauthenticated candidate viewing, without gating the actions behind a recruiter/workspace check.
- **Impact**: Unauthenticated content tampering and denial (archive) of any JD by URL. Even in a local-first deployment this is a footgun the moment the instance is reachable; for any hosted/multi-user mode it is a straightforward integrity hole.
- **Fix sketch**: Gate `JdActions` rendering on an authenticated recruiter session (the same signal `WorkspaceShell` uses) and enforce that gate server-side in the PATCH/revisions/ingest routes; keep GET + Apply CTA public. If truly single-user-local, at minimum hide the controls when the page is viewed via a share context.

## 4. Archived JDs stay publicly indexable (no robots/noindex)
- **Lens**: 🚀 Business Visionary (primary) · 🐛 Bug Hunter
- **Severity**: Medium
- **Category**: SEO / lifecycle hygiene
- **Value**: impact 6/10 · effort 2/10 · risk 2/10
- **File**: `app/jds/[slug]/page.tsx:36,98-103`
- **Scenario**: A recruiter archives a filled role. By design the public page keeps rendering (so existing analysis links don't 404) and shows an "archived" banner — good. But there is no `robots: { index: false }` / `noindex` signal, so the retired role remains in Google's index and keeps drawing candidate traffic to a role that no longer accepts pipeline sourcing. Combined with finding #1's absence of any metadata, there is no place such a signal currently lives.
- **Root cause**: `setJdArchived` flips `archived_at` and the page reads `jd.archived_at` only to show a banner; it never feeds lifecycle state into route metadata.
- **Impact**: Stale, filled roles outrank or dilute live ones in search; candidates land on dead-end roles. Erodes trust in the public JD surface and wastes the SEO equity finding #1 would build.
- **Fix sketch**: In the `generateMetadata` added for #1, return `robots: { index: false, follow: true }` when `jd.archived_at` is set (and optionally for not-yet-sourced drafts). One conditional, no schema change.

## 5. Revert / concurrent-edit clobber with no conflict detection
- **Lens**: 🐛 Bug Hunter (primary)
- **Severity**: High
- **Category**: race / lost update
- **Value**: impact 6/10 · effort 4/10 · risk 4/10
- **File**: `app/_lib/db/jobs.ts:78-93` (`updateJd`), `:111-131` (`revertJd`); `app/jds/[slug]/JdActions.tsx:71-89`
- **Scenario**: The same JD is editable from two surfaces simultaneously — the public-page `JdActions` editor and (via duplicate/library flows) the recruiter view, plus two browser tabs. `JdActions.patch` reads the body into local `draftBody` state at mount, the user edits for a while, and `updateJd` then does a blind `UPDATE jds SET title=?, body=? WHERE slug=?` with no version/`updated_at` precondition. Whoever saves last overwrites the other's edits; the pre-edit snapshot recorded is the *intermediate* state, so the lost edit isn't even reconstructable from history. `router.refresh()` afterward hides that the in-memory draft was stale.
- **Root cause**: `updateJd`/`revertJd` use last-write-wins with no optimistic-concurrency token; the client never sends a base version.
- **Impact**: Silent data loss on a content artifact the product explicitly made revertable to *prevent* data loss. Two recruiters (or a recruiter + a stale tab) editing the same role lose work with no warning.
- **Fix sketch**: Add an `updated_at`/revision counter to `jds`; have `JdActions` send the base value it loaded; make `updateJd`/`revertJd` `UPDATE … WHERE slug=? AND updated_at=?` and 409 on zero rows so the client can prompt "this JD changed — reload". Snapshot-into-history already exists, so recovery is partial today; the guard closes the silent loss.
