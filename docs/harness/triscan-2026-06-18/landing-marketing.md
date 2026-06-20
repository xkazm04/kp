# Landing & Marketing — Tri-Lens Scan
> Total: 5
> Severity: 1 Critical / 3 High / 1 Medium / 0 Low
> Lens: 1 bug / 1 ui / 3 biz

## 1. Every CTA is a dead fragment anchor — the landing cannot convert
- **Lens**: 🚀 Business Visionary (primary) / 🐛 Bug Hunter
- **Severity**: Critical
- **Category**: Conversion / broken CTA
- **Value**: impact 10/10 · effort 3/10 · risk 2/10
- **File**: `app/landing/spark/SparkLanding.tsx:308`, `:231`, `:588`; `app/landing/spark/PricingSection.tsx:167`
- **Scenario**: A visitor reads the page, gets excited, and clicks "Start screening free" / "Get early access" / "Pick Starter". Every primary CTA points at `#cta` (which just scrolls to the final CTA section), and that final section's own button is `href="#"` — which scrolls to the top of the page and does nothing. There is no link to `/login`, no signup route, no email-capture form, and no `mailto:` anywhere on the page.
- **Root cause**: The page was built as a visual bake-off prototype; the CTAs were stubbed to in-page anchors and never wired to a destination. `grep` confirms zero `/login`, `/api`, form, or `mailto` references in `app/landing/`.
- **Impact**: 100% of conversion intent is dropped on the floor. This is the top-of-funnel surface and it has no funnel exit — paid traffic, SEO traffic, and word-of-mouth visitors all bounce with no way to act. The single highest-value fix on the page.
- **Fix sketch**: Add a real destination: an early-access email capture (POST to a list/CRM or a simple `/api/early-access` route) behind the four "Get early access"/"Start free" buttons, or at minimum link them to `/login` (the operator entry already exists). Replace `href="#"` at :588 with the same target. Tie pricing-tier CTAs to a `?plan=` query so intent is captured.

## 2. Marketing page is `noindex` AND the OG/title metadata is the wrong product
- **Lens**: 🚀 Business Visionary (primary)
- **Severity**: High
- **Category**: SEO / metadata
- **Value**: impact 8/10 · effort 2/10 · risk 2/10
- **File**: `app/landing/layout.tsx:14`; `app/layout.tsx:34`, `:74-106`; `app/opengraph-image.tsx:5`
- **Scenario**: The landing layout hard-sets `robots: { index: false, follow: false }`, so search engines are told to ignore the entire marketing page. Separately, the page brands itself "KandiDate" but inherits the root `generateMetadata()` title/description ("KP Job Fit & Salary Estimator", "AI-assisted CV seniority scoring…") and the root `opengraph-image.tsx` (renders "Job Fit & Salary Estimator", logo "KP", domain nuda.dev). When the URL is shared on Slack/LinkedIn/Twitter, the card shows the wrong product name and a generic image — none of the "KandiDate / hiring" story.
- **Root cause**: The layout comment says noindex is intentional "until launch", but there is no launch toggle, and the landing layout supplies only `title/description/robots` — it never overrides `openGraph`, so the page falls back to the root estimator OG image and siteName.
- **Impact**: Zero organic discoverability and an off-brand social preview. For a top-of-funnel conversion surface this caps reach at whatever you pay for; even paid/shared links misrepresent the product.
- **Fix sketch**: Gate `robots.index` on an env flag (`process.env.NEXT_PUBLIC_LAUNCHED`) so it flips at launch without a code change. Add a landing-scoped `openGraph` (KandiDate title, hiring description) and a `app/landing/opengraph-image.tsx` route that uses the Spark mark/mascot, so shares show the right brand.

## 3. No social proof, no humans, no trust signals anywhere on the page
- **Lens**: 🚀 Business Visionary (primary) / 🎨 UI Perfectionist
- **Severity**: High
- **Category**: Conversion / trust
- **Value**: impact 7/10 · effort 4/10 · risk 2/10
- **File**: `app/landing/spark/SparkLanding.tsx:484-598` (between Voice teaser and CTA)
- **Scenario**: A skeptical buyer evaluating an AI hiring tool — a category with real bias/legal anxiety — scrolls the whole page and finds zero customer logos, testimonials, named users, metrics ("X CVs screened"), GDPR/EU-AI-Act assurance, or even a founder face. The only "proof" is illustrative mock data (Jana N., score 87) and the mascot. The headline promise ("humans in charge", "every decision keeps its receipt") is asserted but never substantiated.
- **Root cause**: Prototype content; the page leans entirely on illustration and copy. Czech-market hiring + AI screening is precisely where trust/compliance proof drives conversion.
- **Impact**: High-intent B2B visitors stall at "is this real / is this safe?" with nothing to resolve it, so they don't convert even when the value prop lands. This is the difference between a demo and a sellable page.
- **Fix sketch**: Add one trust strip between Voice and Pricing: a row of "trusted by" placeholders (or "join N Czech teams in early access"), one or two short quotes, and an explicit GDPR / EU-AI-Act / data-residency line tied to the existing "human gate" story. Even an early-access counter beats nothing.

## 4. `whileInView` content can be left invisible (animation never fires / no reduced-motion fallback)
- **Lens**: 🐛 Bug Hunter (primary) / 🎨 UI Perfectionist
- **Severity**: High
- **Category**: Animation / content visibility
- **Value**: impact 7/10 · effort 3/10 · risk 3/10
- **File**: `app/landing/spark/SparkLanding.tsx:379-410`, `:418-478`, `:546-560`; `app/landing/spark/PricingSection.tsx:106-171`
- **Scenario**: Every section below the hero (steps, feature cards, voice transcript, all four pricing tiers, the headings) starts at `initial={{ opacity: 0, y: … }}` and only becomes visible via `whileInView`. Two failure modes: (a) `useReducedMotion` is honored for the hero/confetti/marquee but **not** for these `whileInView` blocks — a reduced-motion user still gets the opacity-0→1 reveal, and if Framer's in-view detection is delayed or the element is already in view on load without an intersection event, content can stay at opacity 0; (b) the pricing cards and steps have no animation-failure fallback, so a hydration hiccup or a browser that mis-fires IntersectionObserver leaves the entire pricing table blank.
- **Root cause**: `whileInView` is used as the only path to `opacity: 1`; reduced-motion is not branched for these variants (unlike the hero), and there is no CSS/`viewport`-immediate fallback.
- **Impact**: On reduced-motion devices, slow connections, or bfcache restores, pricing and features — the conversion-critical sections — can render invisible or jarringly re-animate. Silent content loss on the most important fold.
- **Fix sketch**: Branch on `reduceMotion` to set `initial={false}` (or `opacity:1`) for the in-view blocks as already done for the hero; or set `whileInView` opacity defaults via CSS so the static state is visible-by-default and motion only enhances. Add `viewport={{ once: true, amount: 0 }}` tolerance.

## 5. Hero headline + marquee risk overflow / layout shift on small screens
- **Lens**: 🎨 UI Perfectionist (primary)
- **Severity**: Medium
- **Category**: Responsive / mobile polish
- **Value**: impact 5/10 · effort 3/10 · risk 2/10
- **File**: `app/landing/spark/SparkLanding.tsx:267` (h1 `text-5xl`), `:362-374` (marquee), `:319` ("try it — hover the pile ↓")
- **Scenario**: On a 360px phone the hero `<h1>` is `text-5xl` with a hard `<br/>` and an inline underlined word; "Hear it interview" + "Start screening free" buttons wrap; the hand-note "try it — hover the pile ↓" instructs an interaction that does not exist on touch (no hover), so the primary "try the product" affordance is dead on mobile. The marquee relies on `overflow-x-clip` on `<main>` but the animated `w-max` strip plus the rotated sticker cards can still nudge horizontal scroll. The mascot column (`Image` 460×460) sits in a `0.85fr` track that on mobile stacks full-width, pushing the fold.
- **Root cause**: Desktop-first sticker layout; touch has no hover equivalent for the headline "hover the pile" CTA, and type scale jumps straight from `text-5xl` to `sm:text-7xl` with no intermediate clamp.
- **Impact**: Mobile (the majority of cold social/ad traffic) gets a cramped hero, a dead "hover" instruction, and possible horizontal jiggle — a weak first impression exactly where it matters most.
- **Fix sketch**: Use a fluid clamp for the h1, swap the "hover the pile" copy to "tap the pile ↓" (the cards already toggle on click), verify `StampableCv` tap toggling reads well on touch, and constrain the mascot/marquee within the clip on the smallest breakpoints.
