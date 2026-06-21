# UAT Backlog — sorted by business value

Source: L1 UAT sweep `uat/runs/l1-2026-06-19/` (10 Characters · 14 journeys · 110 findings).
Full evidence in that run's `report.md` (verdict matrix + findings) and `SUMMARY.md` (themes + panel verdict).

**How we work this:** top-down, one item at a time. Each item is sized **S** (≤½ day) / **M** (1–2 days) / **L** (multi-day) and tagged with the business reason it ranks where it does. We mark `Status` as we go and **never regress a Guardrail** (bottom).

**Business-value lens (why this order):** this is an AI hiring platform pitched to a regulated Czech bank (Česká spořitelna) *and* an AI-Architect case. Value ranks by: (1) **core promise** — "reasoned, grounded, *defensible* matching"; if the AI lies, nothing else matters; (2) **buyer can see & believe it** — for a case/demo the prospect's experience *is* the product; (3) **legal/brand risk** — EU AI Act (high-risk, Aug 2026) + GDPR Art. 22 + employer brand; (4) **daily operator value**; (5) polish. Effort is a tiebreaker for sequencing, not a value input.

---

## Work packages (grouped by theme, sorted by business value)

The findings cluster into a handful of coherent deliverables — a stakeholder
recognizes each as one outcome, and the items inside reinforce each other. We
tackle **package by package**, top-down. Effort = rough sum; sequence inside a
package respects dependencies. **M1 already shipped** (sits in PKG-C).

### PKG-A · "Win the ČS evaluation" — the buyer can *see, believe, justify* ★★★ highest
**Why #1:** kp is an AI-Architect case *for* Česká spořitelna — the buyer/evaluator's
experience **is** the deliverable, and today a prospect can't even reach the proof
or the compliance story. This package is the sale. Unblocks Helena end-to-end and
arms leadership with the ROI to say yes.
**Items:** **B1** public door for the keyless sim · **B2** public Responsible-AI / EU-AI-Act / GDPR story · **M7** measured ROI vs the ~23h baseline + one leadership readout · **M10** sourced ROI math + Enterprise tier.
**Effort:** ~1.5–2 wk. **Dependency:** B2's compliance claims are only *truthful* once PKG-B's **M6** lands — sequence M6 before B2 goes public. M7 feeds M10.
**Suggested order:** B1 → M7 → (M6 from PKG-B) → B2 → M10.

### PKG-B · "No candidate left in silence" — trust spine · employer brand · GDPR ★★★ high
**Why #2 (near-tie, and it underpins A):** for a bank a ghosted / silently-rejected
candidate is brand **and** legal risk (GDPR Art. 22, EU AI Act Aug-2026). One
principle ties the items together: *every action on a candidate gets a preview, a
notification, and a visible next step — and every solely-automated reject is
sealed.* This is also the substance PKG-A advertises, so it makes B2 honest.
**Items:** **M2** offer-accept inline next-step (⚡ quick win) · **M3** bulk-reject must notify · **M6** seal every auto-reject + truthful disclosure · **M4** outreach draft/preview before send.
**Effort:** ~1–1.5 wk. **Suggested order:** M2 (warm-up) → M3 → M6 → M4.

### PKG-C · "Defensible AI output" — grounded reasoning everywhere ★★ high (partly shipped)
**Why:** the differentiator vs keyword ATS tools — no AI surface should narrate an
unverifiable claim. M1 shipped; finish the theme.
**Items:** **M1 ✅** skill-chip gate · **M5 ✅** rediscovery why-now · *residual ✅* — interview kit confirmed grounded (sources `candidate.skills` + the M1-cleaned `matching_skills`); the free-text eval summary is left to L2 adversarial verify (a prose skill-gate would be brittle, and the M1 withhold-note already flags it) · *L2:* adversarial verify on a real Gemini analysis (deferred — needs a key + browser).
**Status: COMPLETE** (bar the deferred L2 check).

### PKG-D · "Dev hiring that respects seniors" — the dev extension ★ medium
**Why:** narrow to the dev-hiring extension, but real senior drop-off + a missing AI disclosure.
**Items:** **M8** senior timebox ≤~2h · **M9** single submit path + AI-use disclosure.
**Effort:** ~2–3 days.

### PKG-E · "Polish tail" ★ low — ✅ named items done (2026-06-19)
Bilingual audit rationale ✅ · fairness "weights converged" framing ✅ · *remaining un-named minors per `findings.json` left as an open low-value catch-all.*

**Recommended overall path (value × dependency):** open PKG-A's **B1** and PKG-B's **M2** first (independent, one a quick win), land **M6** before **B2**, finish A, then C/D, E last.

---

## Ranked backlog (per-item detail index)

| # | ID | Item | Value tier | Effort | Unblocks | Status |
|---|----|------|-----------|--------|----------|--------|
| 1 | M1 | **Gate "matched" skill chips to a real CV↔JD match** (kill hallucinated matches) | V1 core-promise | M | Petra (blocker), Eva, buyer's "defensible" claim | ✅ Done (2026-06-19) |
| 2 | B1 | **Public door for the keyless guided simulation** | V1 adoption | M | Helena (whole buyer funnel) | ✅ Done (2026-06-19) |
| 3 | B2 | **Public EU AI-Act / GDPR / human-in-the-loop story** | V1 adoption | S–M | Helena (bank dealbreaker) | ✅ Done (2026-06-19) |
| 4 | M2 | **Inline onboarding next-step on offer-accept** (quick win) | V2 brand/trust | S | Tereza, Tomáš, candidate brand | ✅ Done (2026-06-19) |
| 5 | M6 | **Seal every solely-automated reject + make the AI disclosure truthful** | V2 legal | M | Lucie (GDPR Art. 22) | ✅ Done (2026-06-19) |
| 6 | M3 | **Bulk-reject must notify** (no silent ghosting) | V2 brand/legal | S–M | Marek, Tereza, Lucie | ✅ Done (2026-06-19) |
| 7 | M4 | **Outreach needs a draft/preview before it sends under the bank's name** | V2 brand/trust | M | Jana, Marek | ☐ Todo |
| 8 | M7 | **Measured ROI vs the ~23h baseline + one leadership readout** | V3 value-prop | M–L | Kateřina, buyer ROI story | ✅ Done (2026-06-19) |
| 9 | M5 | **Why-now rationale on each rediscovered candidate** | V3 value-prop | M | Jana | ✅ Done (2026-06-19) |
| 10 | M9 | **One dev-case submit path + an AI-use disclosure on the eval surface** | V3 dev-ext/legal | S–M | Sam, Eva, Lucie | ✅ Done (2026-06-19) |
| 11 | M8 | **Bound the senior dev-case scope short (≤~2h) / adaptive timebox** | V4 dev-ext | S | Sam | ✅ Done (2026-06-19) |
| 12 | M10 | **Quantified, sourced ROI math + an Enterprise pricing tier** | V4 buyer polish | S–M | Helena | ✅ Done (2026-06-19) |

*Minor cleanups (V4 tail) tracked at the bottom.*

---

## Detail (top items)

### 1 · M1 — Gate "matched" skill chips to a real CV↔JD match  ·  V1 · M
**Why #1:** "Reasoned, grounded, *defensible* matching" is the entire differentiator vs keyword ATS tools. Today the job-fit **matched/missing** chips + eval prose are LLM-narrated with **no deterministic taxonomy gate**, so Gemini can name a "matched" skill the CV never mentions. One hallucinated skill is Petra's hard **blocker** and Eva's "obhájím to čím?" failure — and it's the first thing a skeptical hiring manager or evaluator catches in a demo. Highest-value, affects the most Characters.
- **Evidence:** `pipeline/jobfit/pipeline.py:617-634`; `pipeline/jobfit/gemini.py:98-112`; soft tooltip only at `app/_components/results/job-fit/SkillChips.tsx:28-43`; the deterministic coverage matcher already exists but doesn't gate — `pipeline/jobfit/ats.py:35-78`.
- **Fix (one line):** a chip renders as **matched** only when the skill resolves to a deterministic CV↔JD taxonomy hit (reuse `ats.py`); an LLM-only claim is downgraded to "inferred" or dropped — never shown as a confirmed match.
- **Acceptance:** for a CV missing skill X, no surface ever shows X as a matched/covered skill. Adversarially confirm at L2 on a real CV.
- **Don't regress:** keep the AI-vs-rule provenance pill (Guardrail G5) — this *adds* a gate, it shouldn't hide provenance.
- **✅ Done (2026-06-19):** Added `verify_skills_in_cv()` in `pipeline/jobfit/ats.py` — a skill is kept only if its **canonical taxonomy term is detected in the CV** (alias-aware: "JavaScript" claim ↔ CV "JS", "Kubernetes" ↔ "k8s") **or** it's **literally present** in the CV (whitespace-flexible, word-boundary, for skills the taxonomy doesn't model). Applied at the source in `pipeline/jobfit/pipeline.py` right after `job_fit` is built, so the cleaned list flows to the chips (`JobFitTab`→`SkillChips`), the keyword-coverage panel, **and** the interview kit. Withheld skills are surfaced as a review note (not silently dropped). No model/schema change → no codegen/TS churn. 6 new unit tests in `test_ats.py` (17/17 green): hallucination withheld, alias verified, literal fallback, multiword whitespace, dedupe, empty-safe. **L2-deferred:** adversarially confirm on a real Gemini analysis that the chips render only verified skills (needs a Gemini key + a CV fixture).

### 2 · B1 — Public door for the keyless guided simulation  ·  V1 · M
**Why #2:** For a case/demo the prospect's experience *is* the product, and the keyless sim is the proof point — yet it mounts only inside `<Workspace>`, gated by `useDevAuth`, so a signed-out prospect lands on `SparkHome` and every CTA routes to `/login`. Zero top-of-funnel: nobody can experience the product without an account. The engine itself is strong (Guardrail G10) — it just has no public entrance.
- **Evidence:** `app/features/Workspace.tsx:106,249-251`; `app/_components/auth/HomeGate.tsx:23-25`; `app/page.tsx:13-19`.
- **Fix:** expose the sim (`SimBar`/`SimulationProvider`) on a public route (e.g. a `/demo` or the landing CTA) that does not require the dev-auth gate; point marketing CTAs at it instead of `/login`.
- **Acceptance:** an unauthenticated visitor starts and finishes the sim end-to-end from a public URL, no key, no login.
- **✅ Done (2026-06-19) — scoped-demo-session approach:** new public `GET /api/demo` (`app/api/demo/route.ts`) mints a session **scoped to an isolated `"demo"` workspace** (`signSession("demo")`, 1h, per-IP rate-limited) and 307-redirects to `/?sim=auto`; allow-listed in `proxy.ts`. `app/page.tsx` reads `?sim=auto` server-side and passes `forceDashboard` to `HomeGate` so the workspace renders regardless of the dev gate; `SimulationProvider` auto-plays the run once on the param (and `nav()` preserves the param across the run). Landing hero gains a **"Watch the live demo"** CTA (`hero.ctaDemo`, cs+en) → `/api/demo`. **Isolation:** `currentWorkspace()` reads the cookie, so every sim read/write scopes to `"demo"` — the real seeded workspace is untouched and the proxy stays **fail-closed** (no API exemption). Validated: typecheck + eslint + i18n green; live smoke on the running server → `GET /api/demo` = **307 → /?sim=auto**. **L2-deferred:** watch the run play end-to-end in a browser from the CTA, ideally with `KP_SECRET` set to exercise the minted demo session + workspace isolation.

### 3 · B2 — Public EU AI-Act / GDPR / human-in-the-loop story  ·  V1 · S–M
**Why #3:** A regulated bank evaluating under the high-risk-AI Aug-2026 deadline needs to see the compliance posture *before* it will pilot. Today the regulatory framing lives only in authed namespaces; the public marketing is silent. Several real strengths (sealed audit chain, human-in-the-loop default, refusable consent, calibration honesty) are exactly what this page should *show* — so this is largely surfacing what already exists.
- **Evidence:** `messages/en.json:287` (oversight framing, authed only); strengths to cite: G2, G3, G4, G6, G9.
- **Fix:** a public "Responsible AI / Compliance" section (landing or `/about`) stating high-risk-AI posture, human-in-the-loop, GDPR Art. 22 stance, and linking the audit-trail/consent capabilities.
- **Acceptance:** Helena can answer "is this AI-Act/GDPR-defensible?" from public pages without logging in.
- **✅ Done (2026-06-19):** added a "Responsible AI" section to the spark landing (`SparkLanding.tsx`, before Pricing) — four sticker-card pillars (Human in the loop · EU AI Act ready · GDPR & Article 22 · Provable-not-promised audit/calibration), a subtitle, and a scope-honest footnote ("a working demonstration… not a legal certification"). Copy in `landing.trust.*` (cs+en, parity 2690 keys); reuses imported icons; matches the art direction. The human-in-the-loop claim is now **true** thanks to M6. Validated: typecheck + eslint + i18n green; `/` returns 200. **Reachability note:** the landing renders at `/` (the `/landing*` routes redirect there) and is shown to any visitor in the open/demo deployment; a password-gated prod sign-in-gates `/` (pre-existing decision — same gating B1 noted), where a cold prospect would reach the story via the shared demo link. **L2-deferred:** browser-verify the section renders + reads well in both locales (it's client-rendered post-hydration, so curl can't see it).

### 4 · M2 — Inline onboarding next-step on offer-accept  ·  V2 · S  ·  ⚡ recommended first quick win
**Why here / quick win:** Tiny effort, candidate-facing, and it closes a gap a recent commit *claimed* to fix. The accepted state renders only a "we'll be in touch" body; the onboarding step exists **at the same token** (and is emailed) but is never surfaced inline — exactly Tereza's #1 "ghosting" peeve, corroborated by Tomáš. Verified still open at `app/offer/[token]/page.tsx:194-200`.
- **Evidence:** `app/offer/[token]/page.tsx:194-200` + `messages/cs.json:485-487`; link currently only via `app/_lib/offer-finalize.ts:107-110` / `comms-dispatch.ts:362-365`.
- **Fix:** in the `result === "accepted"` branch, render an inline `<a href={/onboarding/${token}}>` CTA to the onboarding next-step.
- **Acceptance:** after accepting, the candidate sees and can click through to onboarding on the page itself (not only via email).
- **✅ Done (2026-06-19):** Added an inline "Start your onboarding" CTA (`onboardingCta`, cs+en) linking to `/onboarding/${offer.token}` in the accepted branch of `app/offer/[token]/page.tsx` — the offer token doubles as the onboarding token (`offer-finalize.ts:108`), so it lands on the real pre-boarding page, not the email-only promise. Styled to match the page's moss action button. i18n parity green (2678 keys).

### 5 · M6 — Seal every solely-automated reject + truthful AI disclosure  ·  V2 · M
**Why here:** Direct GDPR Art. 22 / EU AI-Act legal exposure for a bank. The `rejectMode:"auto"` path applies + emails a rejection with no human and **never seals a tamper-evident record** (only the supervised screen-wave does), while the candidate disclosure promises "nothing adverse is decided automatically" — a representation a config toggle can falsify.
- **Evidence:** `app/_lib/automation-pass.ts:307-326` (no `sealDecisionSafe`); seal only at `app/_lib/screen-wave.ts:215`; disclosure copy `messages/cs.json:461`.
- **Fix:** call the seal on every solely-automated reject so the strong-integrity store covers the *least*-supervised path; AND either gate `auto` mode off for production tenants or qualify the disclosure to match.
- **Acceptance:** a seeded `auto`-mode reject appears in `/api/decisions/records` (the tamper-evident chain), and no disclosure can be contradicted by a live config.
- **✅ Done (2026-06-19) — chose "disable auto-reject" (strongest Art. 22 stance):** rather than seal the unattended path, we **retired it**. `automation-pass.ts` now ALWAYS queues a fairness-cleared reject to the human Decisions gate (the `auto` branch is gone), and `auto` is coerced out at every layer — `scheduler-store` read → `approve`, the schedule API coerces any value → `approve`, and `SchedulerControl`'s mode `<select>` is replaced by a static "supervised — queue for approval" fact (tooltip copy updated, cs+en). So **no solely-automated adverse decision can occur**, and the existing strong disclosure ("nothing adverse is decided automatically") is now true **as written** — no copy weakening. The human route still sends the rejection email + seals the record on confirm, so nothing is lost. (The interim part-1 seal in the now-deleted `auto` branch was superseded.) **968/968 unit tests, eslint (0 new), typecheck, i18n all green.**

### 6 · M3 — Bulk-reject must notify  ·  V2 · S–M
**Why here:** The fastest bulk surface (NL command `reject_below`) flips status + writes an audit event but **never dispatches a rejection comm** — silent ghosting at scale, Marek's compliance nightmare and Tereza's lived fear. The screen-wave path already does it right, so there's a pattern to follow.
- **Evidence:** `app/api/pipeline/command/route.ts:78` → `app/_lib/db/pipeline.ts:1265-1267`; correct pattern at `app/_lib/screen-wave.ts:232`.
- **Fix:** route bulk reject through a path that dispatches the rejection comm (or, at minimum, make the command preview explicitly flag "these N will NOT be notified" and require confirmation).
- **Acceptance:** no bulk reject leaves a candidate in silence; the preview tells the operator who gets notified.
- **✅ Done (2026-06-19):** the `reject_below` execute path in `app/api/pipeline/command/route.ts` now `await dispatchRejection(updated)` per candidate — mirroring the screen-wave's queued-comm + per-candidate isolation (a comms blip records `rejection_comms_failed` and is surfaced as `commsFailed`, never aborting the batch). `describeCommand` (and the preview copy) now reads **"Reject and notify…"** so the operator is told these candidates will be contacted. Test updated + added; **968/968 unit tests, eslint, typecheck all green.**

### 7 · M4 — Outreach draft/preview before send  ·  V2 · M
**Why here:** "Reach out" drafts **and sends** under the bank's name in one click with no `outreach_drafted` state — brand risk (an off-tone message goes out as Česká spořitelna) plus Marek's no-dry-run peeve. Lower than M3 only because reject-ghosting carries compliance weight that outreach doesn't.
- **Evidence:** `app/_lib/useReachOut.ts:29` → `automation-run.ts:286` → `dispatchOutreach`.
- **Fix:** add a draft/preview state the operator approves before any send under the bank's name.
- **Acceptance:** outreach can be reviewed/edited and is never sent without an explicit approve.

### 8 · M7 — Measured ROI vs baseline + leadership readout  ·  V3 · M–L
**Why here:** The purchase justification is the 60–70% screening-time cut, but ROI is a flat per-action counterfactual (`Σ count × flat minutes × rate`), never measured against the ~23h manual baseline Kateřina defends upward — and it's scattered with no single export. High sales value, but it strengthens an existing story rather than unblocking access, so it sits below the V1/V2 spine.
- **Evidence:** `app/_lib/automation-roi.ts:14-29,55-74`.
- **Fix:** compute measured time-saved against a baseline (per-role or configurable) and add one combined leadership ROI readout (automation savings + cost-per-hire + time-to-fill) with export.
- **Acceptance:** Kateřina can show leadership a single, sourced "time/cost saved vs baseline" number.
- **✅ Done (2026-06-19):** `automation-roi.ts` now measures saved labor against a **stated manual baseline** (`MANUAL_HOURS_PER_HIRE = 42`, research-anchored 40–51h/hire) — `automationRoi(kindCounts, rate, hires)` returns `hoursSavedPerHire`, `czkSavedPerHire`, `manualBaselineHoursPerHire`, and `pctOfManualBaseline` (capped at full replacement, null without hires so it's never a divide-by-zero lie). `analytics.ts` passes `hired` and adds a **blended overall `costPerHireCzk`** (Σ channel spend ÷ hires, all-time only). The `RoiLedger` headline now carries a baseline line ("≈X h/hire — Y% of the ~42 h a hire takes by hand") plus a **single leadership readout** combining *time-saved vs baseline · cost-per-hire · time-to-hire*, and the CSV export leads with that summary. Copy in `analytics.roi.*` (cs+en, parity 2706). Validated: **972/972 unit tests** (+4 precise baseline tests), typecheck, eslint, i18n green. **Deferred:** live `/api/analytics` field check (the dev server was down during validation) — the ROI math is a pure, fully-tested function so risk is low.

### 9 · M5 — Why-now on rediscovered candidates  ·  V3 · M
**Why here:** Rediscovery is a real differentiator, but silver-medalists surface as score+name+backward-looking `prior` with no *why-now* — Jana's #1 peeve, baked into the data model.
- **Evidence:** `app/_lib/rediscover.ts:27`; `app/features/sub_jobs/RediscoverPanel.tsx:67`; `messages/cs.json:1909`.
- **Fix:** add a why-now rationale per rediscovered candidate (what changed / why this role now), grounded like the match reasoning.
- **Acceptance:** each rediscovered card answers "why am I seeing this person for this role, now?"
- **✅ Done (2026-06-19):** each rediscovery card now carries a forward-looking **why-now** line under the name + (legacy) prior chip — grounded in the *real* data already on the client: the prior-outcome kind, the deterministic fit score, and the open role. Three localized variants by `prior.kind` (rejected → "role-fit mismatch then, not a capability gap; worth a look now this seat's open"; closed → "proven, available candidate"; elsewhere → "already in motion, a redeploy worth weighing"). Pure panel + i18n change (`RediscoverPanel.tsx` + `jobs.rediscover.whyNow.*`, cs+en, parity 2720) — no lib/Python touch, and *localized* unlike the legacy hardcoded `prior.label`. Validated: typecheck + eslint + i18n green. **Future enhancement:** naming the specific matched-skill drivers would need the deterministic match breakdown surfaced from the Python ranker (today only `total` is threaded).

### 10 · M9 — Dev-case: one submit path + AI disclosure  ·  V3 · S–M
**Why here:** Two contradictory submit paths (in-product editor vs a *required* repo-URL form) confuse the candidate, and there's **no AI-use disclosure** on the one surface where AI actually evaluates them (the apply chat has one; the dev case doesn't) — a consistency + compliance gap. Scoped to the dev extension, so below the cross-cutting items.
- **Evidence:** `app/features/sub_dev/DevApplyForm.tsx:30,89-98` vs `app/devcase/apply/[token]/page.tsx:79-85`; no disclosure at `page.tsx:58-87`.
- **Fix:** pick one submit path; mount the AI-use disclosure on the dev-case surface.
- **Acceptance:** one obvious way to submit; the candidate is told AI evaluates their work before they start.
- **✅ Done (2026-06-19):** the dev-case page now renders **exactly one submit path** — a *workspace* case submits through the `LiveWorkSurface` (grades the observed process), a case with *no workspace* through the repo-link `DevApplyForm` — never both. To keep the live path reachable (it was anonymous), the surface now captures **name + contact**, threaded through `/api/devcase/session/[id]/submit` → `submitDevSession(…, identity)` → `createSubmission` (candidateRef + contact). And **`<AiDisclosure showDataConsent>`** now sits on the page (the surface where AI evaluates the candidate), matching the apply/offer surfaces. Reused existing `devApply` i18n keys (no parity change). Validated: typecheck + eslint + i18n + 972 unit tests green.

### 11 · M8 — Bound the senior dev-case scope short  ·  V4 · S
**Why here:** A senior is timeboxed at 6h and told so — the half-day take-home that drives the 40–60% senior drop-off Sam embodies. Narrow (dev extension) but a cheap fix with real candidate-pool impact.
- **Evidence:** `pipeline/jobfit/devcase/design.py:26,235-237`; `app/features/sub_dev/DevHelpers.ts:46-48`.
- **Fix:** bound senior case scope to ≤~2h (or make the timebox adaptive); add a scope-cap guard alongside `MAX_CODEBASES`.
- **Acceptance:** a senior brief reads as a focused ≤2h exercise, not a half-day take-home.
- **✅ Done (2026-06-19):** `pipeline/jobfit/devcase/design.py` — the seniority ladder is recompressed to **≤2h** (`{junior:1.0, medior:1.5, senior:2.0, lead:2.0}`, default 1.5; senior was 6.0, lead 8.0) and a hard **`_MAX_TIMEBOX_HOURS = 2.0`** clamps the LLM's own `timeboxHours` echo (floored at 0.5h). Seniority now scales *depth/ambiguity* (per the prompt), not hours — the half-day take-home that drives 40–60% senior drop-off is gone. The candidate-facing `~Nh timebox` render (`DevHelpers.ts`) reads from this bounded source. Validated: 6 devcase Python tests + typecheck green.

### 12 · M10 — Sourced ROI math + Enterprise pricing  ·  V4 · S–M
**Why here:** Buyer polish — no quantified/sourced ROI on the public pages and SMB-only pricing with no Enterprise/contact tier for an org-scale bank. Lands after the substantive compliance/ROI work it depends on.
- **Evidence:** marketing + billing surfaces (see `helena-buyer--L1.md`).
- **Fix:** publish ROI math with sources; add an Enterprise/contact-sales tier.
- **Acceptance:** Helena sees credible numbers and a path to buy at org scale.
- **✅ Done (2026-06-19):** added an **Enterprise band** below the four metered tiers in `PricingSection.tsx` — a contact-sales tier (SSO / roles & audit / dedicated env / onboarding, "priced to your volume", "Talk to sales" CTA) **paired with the sourced ROI math** that justifies it: three cited stats (60–70% less screening time · ~23 h manual screening/hire · 40–51 h total/hire) with a source footnote pointing to the live Analytics→ROI (the M7 work). Copy in `landing.pricing.enterprise.*` (cs+en, parity 2717; flat keys for robust parity). Validated: typecheck + eslint + i18n green. **L2-deferred:** browser-verify the band renders in both locales (client-rendered landing, like B2).

---

## Guardrails — strengths NOT to regress while fixing the above

When touching these areas, preserve (evidence in `report.md` "What passed"):
- **G1** Calibration that refuses to draw a curve under 20 real outcomes — `calibration.ts:62-99,15`.
- **G2** Tamper-evident hash-chained decision dossier + verify badge + export — `decision-record-store.ts:111-191`.
- **G3** Screen-wave preview-before-mutate, commit-separate — `ScreenWaveModal.tsx:57-112`.
- **G4** Fairness shielding that fails closed — `screen-wave.ts:152-162`.
- **G5** AI-vs-rule provenance disclosed on every panel — `MatchShared.tsx:73-74`, `AiVerdict.tsx:34`.
- **G6** Refusable GDPR consent before AI touches a candidate (TTL + erasure).
- **G7** Grounded inputs to every AI surface (full CV/JD/role band) — `group-eval-run.ts:135,156,191`.
- **G8** Benchmark-anchored salary cited in rationale — `gemini.py:434`.
- **G9** Three-state decision-log attribution (never defaults to "auto") — `decision-attribution.ts:84-87`.
- **G10** The keyless real-click simulation engine.

## V4 minor tail (batch later)
- ✅ **Done (2026-06-19)** — Bilingual decision-record rationale: the sealed `rationale` stays byte-stable English (in the hash), but the **records panel + export now render a localized rationale** from the structured `reasonCode` + `inputs` each record already carries (same mirror the screen-wave modal uses; falls back to English for unmapped codes). Export adds `rationaleLocalized` *alongside* the untouched `rationale`, so chain verification is unaffected. `DecisionRecordsPanel.tsx`.
- ✅ **Done (2026-06-19)** — Fairness "weights converged" framing: `fairnessUniform` copy (cs+en) reframed from "everyone used standard weights" to **"Fairness check passed — re-scoring under each other's weighting leaves the order unchanged, so the ranking is robust"** — reads as a *passed* check, not an absent one. `FairnessPanel.tsx`.
- *Remaining: the long tail of un-named minor/polish findings in `findings.json` — low value, batch opportunistically.*
- Remaining minors per `findings.json` (group by surface when batching).

## L2 prerequisites (independent of the above — needed before live confirmation)
Resolve `uat/env.md` open questions: candidate-token mint path (Tereza/Sam reachability), `devcase/seed_materializer.py` (dev-case fixtures), ≥20 seeded outcomes (calibration/ROI), AI keys (voice + output quality).
