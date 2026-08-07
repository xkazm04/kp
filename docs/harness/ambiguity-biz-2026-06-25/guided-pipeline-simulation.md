# Guided Pipeline Simulation — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀2 / 🚀3 | Severity: C0/H3/M2/L0

## 1. The flagship "Try the live demo" CTA silently dead-ends on any real deployment
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: activation / dark-capability
- **File**: app/api/demo/route.ts:32  (and app/_lib/workspace-lock.ts:39)
- **Observation**: `/api/demo` mints the demo session only when `KP_SECRET` is unset (open dev) OR `demoSessionAllowed()` is true. That flag defaults to **off** — it returns true only if `KP_DEMO_ENABLED` or `KP_MULTI_WORKSPACE` is set. So a normal gated/production deploy (`KP_SECRET` set, defaults otherwise) hits `return NextResponse.redirect(new URL("/", request.url))`: the prospect clicks "Try the live demo" (SparkLanding.tsx:278) and is silently bounced back to the same marketing page — no message, no fallback, no log. Worse, workspace-lock.ts:32-38 documents that the *only* way to make the CTA work in prod (set `KP_DEMO_ENABLED`) hands an anonymous internet visitor a recruiter session that reads the real tenant's PII through ~28 unscoped tables. So the entire guided demo — a large build — is reachable only in `npm run dev` or on a deploy holding **zero real candidate data**.
- **Why it matters**: This is the single highest-intent conversion path for the whole product, and it is structurally unavailable in exactly the deployments real prospects use. The CTA looks live on the landing page but no-ops; the operator gets no signal that their headline growth lever is dark.
- **Recommendation**: When the demo is locked, don't silently redirect to `/`. Land on an explicit state ("Live demo runs on our hosted sandbox — book a slot" / a sandbox subdomain) and surface a build/console warning to the operator. Long-term, ship a dedicated data-less demo workspace so the CTA is honestly clickable in prod without the PII trade-off.
- **Effort**: S

## 2. The conversion-critical demo has zero funnel instrumentation
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: analytics / growth-measurement
- **File**: app/features/simulation/SimulationProvider.tsx:351  (and SimBar.tsx:52)
- **Observation**: `grep` for any `track/analytics/telemetry/capture/posthog/gtag` across `app/features/simulation`, `app/api/sim`, and `app/api/demo` returns **nothing** (the only "analytics" hits are the `tab: "analytics"` navigation label). The run engine knows exactly which phase it reaches (`patch({ phase })` at SimulationProvider.tsx:339), whether it completed (`done` at :616) or failed (:624), whether the viewer paused/stepped/stopped, and when they click the terminal "Get started" CTA (SimBar.tsx:52) — yet none of it is recorded.
- **Why it matters**: This demo exists to convert trials, but there is no way to answer "what % of demo-starts reach Hired?", "which phase loses people?", or "does the demo lift sign-ups?". You cannot optimize an activation funnel you don't measure; the team is flying blind on its primary growth asset.
- **Why it matters (cont.)**: Each phase boundary and CTA click is already a clean instrumentation point, so the cost to add is low relative to the insight.
- **Recommendation**: Emit lightweight events at `start()`, each `step` phase entry, `done`/`error`/`stop`, and the "Get started"/"Run again" clicks (a single `POST /api/sim/track` or existing analytics sink). Report a per-phase drop-off funnel and demo→sign-up conversion.
- **Effort**: M

## 3. The whole guided demo is hardcoded English despite an en/cs i18n app and a Czech-bank persona
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: localization / activation
- **File**: app/features/simulation/SimulationProvider.tsx:366  (and SimExplainDrawer.tsx:32, constants.ts:8)
- **Observation**: Every prospect-facing string in the simulation is a hardcoded English literal — step captions ("Filling the JD builder for…", SimulationProvider.tsx:366), status titles, log lines, the explainer drawer's "How it works"/"Decision criteria" headers (SimExplainDrawer.tsx:32,63), the decision-criteria labels (criteria.ts:56-63), and the SimBar CTAs ("Get started — do it with your roles", SimBar.tsx:52). The simulation uses **zero** `useTranslations`, while 134 other components in the app do — and the marketing CTA that launches it *is* localized (`t("hero.ctaDemo")`, SparkLanding.tsx:279). The demo's own persona is a Czech bank ("Česká spořitelna", constants.ts:9) with a CZK salary band. No comment records why the conversion demo opted out of i18n.
- **Why it matters**: A Czech-speaking buyer arrives from a localized landing page, clicks a localized CTA, and drops into a 100% English guided walkthrough about a Czech bank role. For the first-run experience meant to convert enterprise prospects in a bilingual market, that language whiplash undercuts credibility and conversion — and the silent decision to skip localization is undocumented tribal knowledge.
- **Recommendation**: Route the sim's captions/titles/criteria/CTAs through `next-intl` (cs/en), or document an explicit, dated decision that the demo is English-only for now. At minimum localize the SimBar CTAs and explainer headers.
- **Effort**: M

## 4. `?sim=auto` is never cleared, so reload/share re-triggers an auto-run and silently overrides Step mode
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: edge-case / sticky-trigger
- **File**: app/features/simulation/SimulationProvider.tsx:692
- **Observation**: The auto-start effect fires when `searchParams.get("sim") === "auto"`, guarded only by an in-mount `autoStarted` ref, and force-sets PLAY mode (`stepRef.current = false`, :696). The `sim=auto` param is **never stripped** from the URL; the comment at :691 even acknowledges "the param persisting across nav" as a reason for the ref guard — but the guard only stops a double-fire within one mount. Because `nav()` carries `searchRef.current` forward (:139), `sim=auto` stays in the address bar through the entire run and after it. So a mid-demo refresh restarts the run from scratch (losing the viewer's place), a post-demo refresh auto-replays in PLAY mode even if the user had toggled Step, and a bookmarked/shared `/?sim=auto` link auto-plays for anyone who opens it.
- **Why it matters**: A demo that silently restarts on refresh — and forces PLAY over a user's chosen Step mode — reads as a glitch during exactly the high-stakes first impression this context exists to nail. The trigger condition is ambiguous: "auto-start once" actually means "auto-start on every load while the param lingers."
- **Recommendation**: After consuming `sim=auto`, strip it via `router.replace` (same `buildUrl` path that already drops tab-scoped params) so the trigger is genuinely one-shot; or honor a persisted Step preference instead of forcing PLAY on every load.
- **Effort**: S

## 5. Pacing timings are scattered, unexplained magic numbers with no single source
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: magic-numbers / tribal-knowledge
- **File**: app/features/simulation/SimulationProvider.tsx:488  (also :239,:287,:409, readMs/settleMs across :360-614)
- **Observation**: Only `SLOW_FACTOR = 1.8` (SimulationProvider.tsx:68) and the screen-policy thresholds (constants.ts:57) are centralized and rationalized. Every other timing is a bare literal sprinkled through the walk: `beat(1100)`/`beat(700)` (:239-242), `beat(3400)` "let the viewer read the audit" (:488), `beat(2600)` (:563), per-step `readMs` 2200/1800/1500/1200 and `settleMs` 1000/1200/1400, plus opaque timeouts `9000` (waitDom/waitEntry, :198,:216), `12_000` sourcing deadline (:409), and `25_000` group-eval timeout (:287). The values silently encode "how long a human needs to read this beat," but the choice of each number is undocumented and un-co-located, and they interact with `SLOW_FACTOR` (every `beat` is ×1.8).
- **Why it matters**: Re-pacing the demo (a common ask once real prospects watch it) means hunting ~20 magic literals across a 700-line file and guessing which are read-time vs. server-poll budgets. A wrong tweak to a poll budget (e.g. the 12s sourcing or 25s eval window) can make the demo flake or stall with no obvious link to the edit. This is tribal knowledge that should be a named, documented table.
- **Recommendation**: Lift the pacing/poll constants into `constants.ts` as a named `SIM_TIMING` object (e.g. `readMs`, `settleMs`, `pollTimeoutMs`, `groupEvalTimeoutMs`) with a one-line rationale each, and separate "viewer read time" beats from "server poll budget" timeouts so the two intents aren't conflated.
- **Effort**: S
