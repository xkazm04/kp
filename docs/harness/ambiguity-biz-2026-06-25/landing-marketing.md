# Landing & Marketing — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀2 / 🚀3 | Severity: C1/H2/M2

## 1. The entire public landing is never served in production
- **Lens**: 🌀 Ambiguity
- **Severity**: Critical
- **Category**: dark capability / intent-vs-reality contradiction
- **File**: app/_lib/auth/devAuth.ts:23
- **Observation**: `app/page.tsx` says "signed-out visitors see the public landing" and hands `<SparkHome/>` to `HomeGate` as the `landing` slot. But `HomeGate` renders `authed ? dashboard : landing` (app/_components/auth/HomeGate.tsx), and `useDevAuth()` is hard-wired to `true` in production: `DEV_GATE = process.env.NODE_ENV !== "production"` (devAuth.ts:23) → `isDevAuthed()` returns `true` when `!DEV_GATE` (devAuth.ts:25-26) → `getServerSnapshot` returns `true` (devAuth.ts:70). So in prod `/` always mounts the Workspace dashboard, never `SparkLanding`. Meanwhile `/landing` and `/landing/spark` both just `redirect("/")` (app/landing/page.tsx:7, app/landing/spark/page.tsx:8). There is no production URL that serves the marketing landing — hero, pricing, trust, voice teaser, the `/api/demo` CTA — at all. Only `/about` (a different component, AboutCurve) is reachable.
- **Why it matters**: This is the canonical kp "built-but-never-routed" pattern, applied to the single most valuable surface: the whole top-of-funnel acquisition page is dark in production. Every hour spent on the Spark art direction, pricing tiers, compliance story and i18n returns zero acquisition value to real visitors. Whether this is a bug or an un-launched-on-purpose state is undocumented — exactly the ambiguity that lets it persist unnoticed (the dev gate shows it to the team daily).
- **Recommendation**: Decide and record: is the public landing live? If yes, gate `/` on the real auth cookie (not the dev-only localStorage flag) so signed-out prod visitors get `SparkLanding` and signed-in operators get the dashboard. If intentionally not launched, document it in docs/DESIGN.md and add a "coming soon" note so it isn't mistaken for shipped.
- **Effort**: M

## 2. Every pricing & "Talk to sales" CTA dead-ends at the operator password box
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: conversion dead-end / no purchase path
- **File**: app/landing/spark/PricingSection.tsx:93
- **Observation**: All four tier CTAs ("Start free", "Pick Starter", "Pick Growth", "Bring your keys") are `<a href="/login">` (PricingSection.tsx:93), and the enterprise "Talk to sales" CTA is *also* `/login` (PricingSection.tsx:111). `/login` is a single shared-secret box titled "Operator sign-in" / "Enter the operator password" (app/login/page.tsx; messages `login.title`/`login.subtitle`). No signup, account-creation, checkout, or sales-contact route exists anywhere under `app/` (verified: no `*signup*`/`*register*`/`*sales*`/`*contact*` dirs). So a prospect who picks a paid plan, or wants to talk to sales, is dumped on a password prompt for an operator account they don't have. The hero/nav use `DEV_GATE ? signInDev() : assign("/login")` but PricingSection hardcodes `/login`, so the paths aren't even consistent.
- **Why it matters**: The pricing section is the buying moment — four priced tiers + an enterprise ROI pitch — and it is completely non-actionable. The "Start screening free / no card, no clock, open to everyone" promise (messages `landing.pricing.tiers.free`) is contradicted by a single-operator password wall. This is pure lost conversion on the highest-intent click.
- **Recommendation**: Build a real signup/checkout entry (even a waitlist or Stripe link) for the self-serve tiers, and route "Talk to sales" to a contact form or `mailto:`. At minimum, make the CTA target consistent and honest about what happens next.
- **Effort**: M

## 3. Home page ships off-brand, off-category SEO/OG metadata
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: SEO / discoverability
- **File**: app/layout.tsx:34
- **Observation**: Root metadata is `SITE_TITLE = "KP Job Fit & Salary Estimator"` / description "AI-assisted CV seniority scoring and salary estimation pipeline for the Czech market" (app/layout.tsx:34-35), and the keyword list is entirely CV-scoring/salary terms (layout.tsx:86-93) — nothing about hiring, recruiting, ATS, voice screening or the brand name. `app/page.tsx` has no `generateMetadata`, so the home landing inherits this. Yet the product on that page is **KandiDate**, an end-to-end AI hiring platform (hero: "KandiDate reads every CV, runs the first interview out loud, books the calendar…"). The team clearly knows how to do page-level metadata — `/about` got a proper "About — KandiDate" title + OG block (app/about/page.tsx:10-18) — the far more important home page was simply missed. There is also no `app/sitemap.ts` or `app/robots.ts` (only `icon.svg`, `apple-icon.tsx`, `opengraph-image.tsx` exist), despite /about's own comment that it is "meant to be found".
- **Why it matters**: The page that gets indexed and link-previewed sells a "salary estimator" under a no-name title — undersells the product, omits the brand, and targets the wrong search intent for a recruiting SaaS. This is the cheapest large acquisition lever on the list.
- **Recommendation**: Add `generateMetadata` to `app/page.tsx` (or fix the `meta` catalog) with the KandiDate hiring positioning + recruiting keywords, and add a `sitemap.ts`/`robots.ts` so the public surfaces are crawlable.
- **Effort**: S

## 4. No first-party social proof anywhere on the landing
- **Lens**: 🚀 Business
- **Severity**: Medium
- **Category**: trust / credibility gap
- **File**: app/landing/spark/SparkLanding.tsx:331
- **Observation**: The page's "proof" elements are: a scrolling marquee of feature phrases ("CV scoring in seconds", "AI voice interviews"… messages `landing.marquee`, SparkLanding.tsx:331-345), a Responsible-AI compliance section (SparkLanding.tsx:533-579), and enterprise stats that are explicitly sourced from *industry studies*, not customers ("Sources: 2025 industry recruiting-time studies (SHRM…)", PricingSection.tsx:125). There are zero customer logos, named testimonials, review counts, or case studies.
- **Why it matters**: For a tool asking buyers to trust AI with hiring decisions, "who already uses this and what happened" is among the strongest conversion levers — and it's entirely absent. The compliance pillars answer "is it safe?" but nothing answers "does it work for people like me?"
- **Recommendation**: Add a logo wall / 1–3 testimonial slots (i18n-driven like the rest of the page) between the feature and pricing sections; even a single quantified pilot result would lift credibility.
- **Effort**: M

## 5. "Variant A — Spark" vs the retired "Signal" art direction is undocumented tribal knowledge
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: undocumented decision / dangling label
- **File**: app/landing/spark/SparkLanding.tsx:28
- **Observation**: The header comment labels this file "Variant A — Spark" (SparkLanding.tsx:28), and FeaturePreviews.tsx:24 describes its figures as "the Signal variant's product figures, re-skinned into Spark's sticker language" — so a second art direction ("Signal", and per the project brief a "Studio") was built and then removed. But only `spark/` survives in the tree, there is no "Variant B" anywhere, and nothing records *why* Spark won or whether Signal/Studio might return. The "Variant A" label now dangles with no counterpart, and the `tokens.ts` "fixed art direction" claim has no decision log behind it.
- **Why it matters**: This is precisely the "two art directions — which ships, and why?" ambiguity. A future contributor can't tell whether Signal/Studio is dead, paused, or expected back, and the orphaned "Variant A" naming invites someone to go looking for a non-existent Variant B. The reasoning that should be a one-paragraph ADR is instead scattered tribal knowledge in code comments.
- **Recommendation**: Record the decision (Spark is the shipped direction; Signal/Studio retired on <date> because <reason>) in docs/DESIGN.md, and drop the now-meaningless "Variant A" label from the comments.
- **Effort**: S
