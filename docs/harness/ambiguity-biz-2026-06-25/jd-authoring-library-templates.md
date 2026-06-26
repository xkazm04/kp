# JD Authoring Library & Templates — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀2 / 🚀3 | Severity: C0/H2/M2/L1

## 1. Public JD pages have no JobPosting structured data — invisible to Google for Jobs
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: SEO / top-of-funnel distribution
- **File**: app/jds/[slug]/page.tsx:34
- **Observation**: `generateMetadata` emits title + description + OpenGraph + Twitter card, but no `application/ld+json` `JobPosting` schema (a repo-wide grep for `JobPosting`/`schema.org`/`ld+json` finds none). Meanwhile the page's only external-distribution control, "Publish to job boards", is a permanently `disabled` "coming soon" button (page.tsx:127). So a live JD has zero free external reach: Google for Jobs (which requires `JobPosting` JSON-LD) is the one organic channel a recruiting SaaS gets, and it is unwired.
- **Why it matters**: Public, shareable JD pages are explicitly the flagship candidate-facing artifact. Without `JobPosting` markup they cannot surface in Google's Jobs rich results — the dominant organic inflow for postings. Every field the schema needs already exists: `title`, body→`description`, `created_at`→`datePosted`, `archived_at`→`validThrough`, plus the grounded salary band (`baseSalary`) and company/location from the linked job. This is the single highest-leverage growth lever in the context.
- **Recommendation**: Render a `<script type="application/ld+json">` `JobPosting` block (datePosted, validThrough from archive, hiringOrganization, jobLocation, and `baseSalary` when the band is available) on the non-archived detail page; reuse the same archived→`noindex` gate already present.
- **Effort**: M

## 2. The inclusivity + specificity lint only runs on AI-generated JDs — dark on the paste and edit paths
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: Differentiator coverage / dark capability
- **File**: app/_lib/jd-lint.ts:118
- **Observation**: `lintJd` (vague-phrase, missing pay/place, research-backed gendered/ageist "exclusionary" detection, over-long must-have list) is imported by exactly one component — `JdBuilderResult.tsx:123` — so it fires only for JDs produced by the AI builder. The "or paste manually" form (`LibraryJdForm.tsx`, the dominant authoring path for recruiters with existing JDs) and the public-page in-place editor (`JdActions.tsx`) never call it. A pasted or hand-edited JD ships with no inclusivity/quality check at all.
- **Why it matters**: JD quality and inclusive language are stated selling points, and the `exclusionary` ruleset (commit 7469c05f, EN+CS, masculine-coded/ageist) is a genuine competitive differentiator — but it's invisible exactly where most real JDs enter the system (paste) and where they're revised (edit). The capability is built, tested, and pure; it's just not surfaced on the two highest-traffic surfaces.
- **Recommendation**: Render the same findings panel (it's a pure function over `body`) in `LibraryJdForm` and inside `JdActions`' edit textarea, gated identically. Near-zero new logic.
- **Effort**: S

## 3. The default "Company standard" template injects "Competitive pay" — the exact phrase the product's own lint flags as vague
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: Self-contradiction / unexamined default
- **File**: app/features/sub_library/render-template.ts:45
- **Observation**: `DEFAULT_TEMPLATE_BODY` hardcodes `## What we offer\n- Competitive pay, hybrid working, meaningful ownership…`. "Competitive pay" matches `VAGUE_PATTERNS` `/competitive\s+(?:salary|compensation|pay)/` in jd-lint.ts:26. This template is the seeded default (templates-store.ts:33, `is_default=1`), so the AI builder auto-selects it and renders the role through it — and the lint, which runs on the rendered markdown, immediately flags product-supplied text as boilerplate. Notably the authors already recognized this anti-pattern: the `about` slot comment (render-template.ts:96–99) says they dropped a canned blurb because "the same sentence into EVERY JD was identical filler the lint itself flags as vague" — yet the offer line repeats the mistake.
- **Why it matters**: Out of the box, the default flow shows the recruiter a quality warning for words the product itself wrote — undermining trust in the lint and contradicting an already-documented design principle. It's a recorded-reasoning gap: the offer line was never held to the standard the `about` line was.
- **Recommendation**: Replace the canned offer line with a concrete `{{...}}` placeholder (or remove it and let the section collapse like `about` does), so the seeded template passes its own lint.
- **Effort**: S

## 4. Templates are only consumable through the 1–2 minute AI build — no manual "start from template" path
- **Lens**: 🚀 Business
- **Severity**: Medium
- **Category**: Built-but-under-wired capability
- **File**: app/features/sub_library/JdBuilder.tsx:135
- **Observation**: `renderTemplate` has a single caller (JdBuilder), and it only ever runs over the AI build's `RoleSpec`. The manual "paste" path (`LibraryJdForm.tsx`) opens a blank textarea with no way to seed the company template, and the public-page editor (`JdActions.tsx`) is free-text too. So the entire template system — full CRUD, default selection, `{{placeholder}}` rendering — can only be exercised by spending a 1–2 minute Gemini run. A recruiter who just wants the company's formatted scaffold to fill in by hand can't get it.
- **Why it matters**: Templates are sold as reusable company formatting, and the manifest reflects a real "template manager" investment — but the cheapest, most common authoring intent (write a JD by hand on the house format) is unsupported, forcing either a blank page or an AI spend. Classic value-left-on-the-table for kp's known dark-capability pattern.
- **Recommendation**: Add a "Start from template" action to `LibraryJdForm` that loads the selected/default template (rendered with empty data, or with raw `{{placeholders}}`) into the body textarea, so manual authoring inherits the company format.
- **Effort**: M

## 5. `MANY_MUST_HAVES = 8` is an unexplained threshold that counts marker words, not must-have list items
- **Lens**: 🌀 Ambiguity
- **Severity**: Low
- **Category**: Magic number / intent-vs-implementation gap
- **File**: app/_lib/jd-lint.ts:63
- **Observation**: The "long must-have list deters under-represented applicants" rule trips when more than 8 `must`/`required`/`musí`/`povinné` tokens appear (jd-lint.ts:62–63, 125–126). But it counts *marker words anywhere in prose*, not actual requirement entries — jd-lint.test.ts:133 confirms it by stringing nine literal "must have/required" markers together. A JD that legitimately writes "you must…", "candidates must…", "must be able to…" in flowing prose inflates the count without having a long requirements list, while a genuine 12-item bullet list that uses "must" only once in its heading won't trip at all. Neither the value `8` nor the choice to count markers (vs. parsing list bullets) has recorded reasoning.
- **Why it matters**: The finding can misfire (false warnings on prose) and under-fire (real long lists), so a quality signal recruiters are taught to trust is built on an undocumented proxy. The intent ("how many must-haves") and the implementation ("how many times the word 'must' appears") quietly diverge.
- **Recommendation**: Document the basis for `8`, and either count bullet items under the must-have heading or rename the finding to reflect what it actually measures (density of requirement language).
- **Effort**: S
