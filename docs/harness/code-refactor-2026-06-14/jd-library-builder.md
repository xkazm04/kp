> Total: 4 findings (Crit/High/Med/Low: 0/0/3/1)

Context: **jd-library-builder** — Create, AI-generate, template and store job descriptions; browse the JD library and render public JD pages. 20 files read (all in `_scan-plan.json` scope). Read-only scan; no source modified.

All four findings are SAFE, mechanical consolidations of literal duplication that already exists today. I deliberately did **not** flag: `TemplateData.about` (a real `{{about}}` placeholder — intentional template API, not dead), `TEMPLATE_SEPARATOR` / `findVaguePhrases` / `findExclusionaryPhrases` (all referenced by tests + `lintJd`), the bilingual `JD_MARKDOWN_STRINGS` map (a deliberate self-contained literal-key table per kp convention), or merging `composeMarkdown` with `renderTemplate` (they serve different roles — AI-default formatting vs. user-template fill — so a merge would be speculative).

---

## 1. `jd-<slug>` Job-identity string is hand-built in 8+ places
- **Severity**: Medium
- **Category**: duplication
- **File**: `app/api/jds/save/route.ts:65` and `:53` (via saveJd), `app/api/jds/save/ingest-job.ts:40`, `app/api/jds/[slug]/route.ts:60-61`, `app/api/jds/[slug]/ingest-job/route.ts:23`, `app/api/jds/route.ts:16`, `app/features/sub_library/JdBuilderResult.tsx:152,179`, `app/jds/[slug]/page.tsx:54` (+ out-of-scope: `app/api/jds/[slug]/revisions/route.ts:37`, `app/features/simulation/SimulationProvider.tsx:371`)
- **Evidence**: `grep` for `` `jd-${...}` `` returns 10 call sites that all reconstruct the same "a JD's slug maps to Job id `jd-<slug>`" contract by string interpolation. This identity is load-bearing — it's how `getJob("jd-"+slug)`, the apply CTA (`/apply/jd-<slug>`), the analyses sidebar, the status lookup (`statuses[\`jd-${row.slug}\`]`) and the re-ingest path all line up. The contract is documented in `docs/JD_LIFECYCLE.md` but has no single code definition.
- **Impact**: Maintenance/bug risk: if the prefix ever changes (or needs `encodeURIComponent`), every site must be found by grep; a missed one silently breaks the JD↔Job link (a 404 on "Source into Pipeline"). This is exactly the magic-string-identity class kp already centralizes (`jd-limits.ts`, `salary-band.ts`).
- **Fix sketch**: Add `export const jdJobId = (slug: string) => \`jd-${slug}\`;` to `app/_lib/jd-limits.ts` (or a small `jd-identity.ts`). Replace the 8 in-scope interpolations with `jdJobId(slug)`. Pure string fn, no behavior change; the two out-of-scope sites can adopt it opportunistically.

## 2. Identical `RoleSpec` type declared twice in the JD-build data path
- **Severity**: Medium
- **Category**: duplication
- **File**: `app/_lib/jd-build-run.ts:106-114` and `app/api/jds/save/ingest-job.ts:4-12`
- **Evidence**: `grep "type RoleSpec = {"` finds three TS definitions. The two in this context are **byte-identical** (same 7 optional fields: `title, seniority, roleFamily, mustHaves, niceToHaves, responsibilities, languages`) and sit directly on the same flow: `runJdBuild` (jd-build-run) produces the spec, `ingestStructuredJob` (ingest-job) consumes it. The third copy (`app/features/sub_dev/DevTypes.ts:58`) is a *different* shape (no `roleFamily`/`languages`) so it must NOT be naively merged — there is an existing backlog idea `idea-dcf2460d-thread-one-canonical-rolespec` tracking the full three-way unification, which is broader/riskier.
- **Impact**: Maintenance: a field added to the produced spec (e.g. a new section) must be mirrored by hand in the consumer's type or the consumer silently drops it with no type error. Low bundle cost; the value is drift-prevention on a producer→consumer pair.
- **Fix sketch**: Export `RoleSpec` from `app/_lib/jd-build-run.ts` (the producer) and have `ingest-job.ts` `import type { RoleSpec }` from it instead of redeclaring. Scope this to the in-context pair only; leave `DevTypes.RoleSpec` to the dedicated backlog idea.

## 3. "market band → salary label" derivation duplicated across client and server
- **Severity**: Medium
- **Category**: duplication
- **File**: `app/features/sub_library/JdBuilder.tsx:94-97` and `app/_lib/jd-build-run.ts:130-132`
- **Evidence**: Both sites perform the same three-step derivation against a `MarketSalary`: `normalizeMarketSalary(...)` → check `.available` → `formatSalaryRange(suggestedMinimum, suggestedMaximum, { currency, period: "month" })`, producing the salary string that goes into the rendered JD body. JdBuilder yields `""` when unavailable (template slot blank); composeMarkdown omits the line when unavailable. The math + the `period: "month"` choice are identical and both files already import from `salary-band` and `format`.
- **Impact**: Bug risk: the two paths must agree on the band, currency and period or a template-rendered JD and an AI-default JD advertise the salary differently. Today they match only by careful hand-copying.
- **Fix sketch**: Add a pure helper to `app/_lib/salary-band.ts` (already imported by both), e.g. `export function marketSalaryLabel(s: MarketSalary): string { return s.available ? formatSalaryRange(s.suggestedMinimum, s.suggestedMaximum, { currency: s.currency, period: "month" }) : ""; }`. Call it from both sites. (salary-band currently imports only `APP_CURRENCY` from format; adding the `formatSalaryRange` import keeps it in the same module pair and stays pure/testable.)

## 4. Repeated inline POST-to-`/api/jds/save` body in JdBuilderResult save + retry
- **Severity**: Low
- **Category**: duplication
- **File**: `app/features/sub_library/JdBuilderResult.tsx:141-159` (`save`) and `:166-185` (`retryIngest`)
- **Evidence**: `save()` and `retryIngest()` build the same `fetch("/api/jds/save", { method:"POST", headers, body: JSON.stringify({ title, body: markdown, role: result.role, salary: result.salary, company [, slug] }) })` request, differing only by the presence of `slug` and the success-handling. The payload shape is copied verbatim in both handlers.
- **Impact**: Cosmetic/low: a future payload field (or a header change) must be edited in both handlers; easy to update one and forget the other. Both are small, so risk is minor.
- **Fix sketch**: Extract a local `postSave(slug?: string)` that posts the shared body and returns the parsed `{ slug, jobId, jobIngested }`, then have `save`/`retryIngest` call it and apply their own state transitions. Keeps both handlers' distinct error/UI logic intact.
