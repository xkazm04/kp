---
name: uat
description: Simulated User Acceptance Testing driven by Characters (representative users with jobs-to-be-done), not feature/code coverage. A capable LLM verifies each user journey in two chronological certification levels — L1 theoretical (over a code-derived surface model, cheap + mass-parallel) then L2 empirical (real browser against the live app, serial) — judging through each Character's own consistent lens (time saved vs the LLM-less way, and senior-in-role quality), with quantified, impact-scored verdicts (estimated time saved + how often × how reachable × how much trust each gap costs). Stack-agnostic; per-app specifics live in the repo's uat/ overlay. Invoke with `/uat init|update|run|recertify|promote [args]`.
---

# Simulated UAT — Character-driven acceptance

This is **evaluative** testing (is the product good enough for a real user to finish their job?), not **verification** testing (does the code do what we told it to?). Traditional suites are structurally blind to three things this catches: **missing pieces**, **quality/fit gaps**, and **journey-level failure** where every step passes its own test yet the user still can't finish.

Method backbone (established inspection methods, automated by an LLM): **Nielsen heuristic evaluation** + **cognitive walkthrough** (task-based, new-user POV, prescribed per-step questions) + **jobs-to-be-done** acceptance. See `uat/rubric.md` for the operational lens.

> Terminology: we use **Character**, never "Persona". A Character is a durable, repo-committed representative user with goals, context, expectations, pet peeves — and their own judgement profile.

> Real model/browser calls are the point — that's what makes this catch what assertions can't. So this is a **deliberate periodic pass, never a per-commit CI gate.** The two-level design below is how we keep it affordable and scalable anyway.

## Two-level certification (chronological)

Each journey is verified in two chronological passes; passing each grants a certification level. Cheap-and-broad first, expensive-and-deep second.

**Level 1 — Theoretical (static, code-grounded).** Build a *surface model* from the code: routes, features, the affordances a user sees (buttons / inputs / controls / links — their "positions"), the inputs each accepts, the state/data it reads, and the navigation between surfaces. The Character then walks the journey *theoretically* over this model — a thought experiment: "given exactly these affordances and this flow, can I finish my job, and would it meet my bar?" **No browser.** Catches structural failure — missing features, dead-ends, affordance/flow gaps — and applies the Character's judgement to the *designed* experience. **Pass → Certification L1 ("structurally sound").** Cheap and **mass-parallelizable** (no browser to serialize) — run it across many Characters at once.

**Level 2 — Empirical (live browser).** Only for journeys that earned L1. Drive the *real* app against the live environment and run the same walkthrough, now (a) confirming the theoretical path actually holds and (b) catching what the code model can't: real rendering, actual latency/timeouts, real-data quirks, visual/UX feel, and whether the live output truly clears the senior-quality bar. **Pass → Certification L2 ("confirmed live").** Serial and long-running by nature — accept that.

Why chronological: L1 is a cheap filter — a journey that fails L1 (a structural gap) never needs browser time — and it lets you scale Characters massively in parallel, reserving the expensive serial L2 for journeys that already proved sound on paper. A finding L1 raised and L2 confirms is the strongest; one L2 raises that L1 missed flags a **gap in the surface model** worth recording.

**L1's structural blind spot is reachability.** It reads code surface-by-surface and implicitly assumes every surface is reachable by *this* Character — so it can validate a fix on a surface the Character can't actually open (wrong project type / plan, gated nav, missing entitlement, no fixture). Keep three verdicts distinct, never one: **fix *landed* ≠ fix *reachable* ≠ fix *unblocks the job*.** L1 can honestly speak only to the first; reachability and job-unblocking are L2's to confirm. (A real instance: an LTV view was fixed to be e-shop-correct, but L2 found e-shop projects never had that module in the nav — the fix was unreachable until the nav gating was opened.)

## Characters carry their own judgement (the consistency harness)

Two runs of the same Character must apply the same lens — judgement is **externalized into explicit, scored criteria in the Character file**, not re-improvised each run. Beyond JTBD / expectations / pet-peeves, every Character declares:

- **Motivation — why use the app at all (time-saved, as a NUMBER).** The time the job takes the *traditional, LLM-less way* (e.g. ~45 min by hand) and the time *with* the app — declared as concrete minutes in the Character file, so every run can emit an **estimated time saved per journey + a confidence** (`~38 min saved · medium`), not a vibe. If the flow saves little — or is *slower* (waiting 2 min for output you could rough out faster yourself) — that **is a finding**, and the number says how big. Value you can't measure you can't prioritize.
- **Senior-quality bar — the reliability floor.** The app's AI/automation output must be at least as good as this Character would produce *as a senior in their role*. Output a senior would reject (generic, wrong, shallower than their own work) fails the bar even if it technically "worked".
- **Scored acceptance criteria** — a short list of explicit pass/fail checks derived from the above + their JTBD, applied **identically every run**. This is the harness: the same Character judges the same way across runs (and lets gates multi-sample meaningfully).

These two dimensions (**time-saved**, **senior-quality**) join the rubric's five (completion, effort, clarity, trust, missing-pieces).

## Portable engine vs. per-app overlay

**This skill is the app-agnostic engine.** Everything app-specific — routes, run command, port, auth, seed, language — lives in the repo's **`uat/` overlay** (like ESLint engine vs `.eslintrc`). The skill never hardcodes a route or stack; it reads them from the overlay.

```
uat/
  README.md            # what this is, how to run
  characters/*.md      # durable users (JTBD, expectations, pet peeves, MOTIVATION, SENIOR-BAR, scored criteria, SURFACE-BINDING)
  journeys/*.md        # goals (NOT scripts) + user-POV definition-of-done
  rubric.md            # evaluation lens (7 dimensions) + impact scoring + finding types
  env.md               # how to reach a known, reproducible start state + required FIXTURES (THE per-app file)
  accepted-gaps.md     # baseline of known-and-accepted issues (won't re-surface)
  driver/drive.mjs     # portable browser driver — navigate + capture + one click (L2)
  driver/drive-ai.mjs  # AI-surface driver — fill inputs, generate, wait for the model result (L2)
  runs/<date-slug>/    # journals, findings.json, report.md (+ gitignored shots/)
  .gitignore           # ignores runs/*/shots/
```

A finding is always:
`{ id, journey, character, cert_level, type, severity, impact, dimension, title, expected, got, evidence[], code_check, verdict, resolution, ceiling, suggested_acceptance }`
- `cert_level`: `L1` (theoretical/structural) | `L2` (empirical/live)
- `type`: `missing-feature | quality-gap | broken-flow | confusion | trust`
- `dimension`: `completion | effort | clarity | trust | missing | time-saved | senior-quality`
- `severity`: `blocker | major | minor | polish` — the headline label, but **derive it from `impact`, don't pick it free-hand.**
- `impact`: `{ frequency, reachability, trust_erosion }` each `low|med|high` → a computed rank. **A "major" the Character can't even reach today ranks below a "minor" they hit every single run.** (Real case: a SaaS-shaped LTV view was "major" but *unreachable* in the e-shop nav — near-zero live impact until the nav opened; a timezone day-shift was "minor" but hit every scheduled post.) `reachability` reuses the L1 surface-binding.
- `evidence[]`: for L1, `file:line` of the affordance/gap; for L2, screenshot/ARIA quote/`file:line`
- `code_check`: `confirmed-absent | present-but-missed | present-broken | by-design | n-a`
- `verdict`: `confirmed | refuted | uncertain` (adversarial pass)
- `resolution`: `open | fixed | resolved-verified | by-design | accepted` — `resolved-verified` REQUIRES live L2 evidence the fix is *reachable* and *unblocks the job* (a screenshot/quote), set by `recertify`. "fixed" (code landed) is **not** "resolved".
- `ceiling` (**required on every `resolved-verified` / `by-design`**): the honest limit that remains — what the Character *still can't do* after the fix (e.g. "numbers are per-client but still scaled-demo, not real Ads-synced"; "img2img keeps the whole frame, not packshot→new-scene"). A build's trust lives in naming its own seams.
- Optional: `scope_note`, `l2_priority` (for an L1 finding: what L2 must verify live — e.g. "actual output quality"). A finding may also be a **strength** (positive) — those feed "What passed" + the synthesis.

---

## Mode: `init`

Goal: scaffold the `uat/` overlay grounded in **both** the codebase **and real-world references**.

1. **Map the app (generically).** Use a Vibeman `context-map.json` if present; else discover surfaces from the router (Next `app/**/page.tsx` or `pages/**`, React-Router/Vue/Svelte configs, server route table). Separate **public** from **authed** surfaces.
2. **Discover the run recipe → `env.md`.** From `package.json` scripts (or Makefile/Procfile): dev/start command + port. Detect the framework, the UI **language**, any **auth** + whether a dev bypass exists, and whether authed data can be served locally (local DB / seed / fixture). **An offline auth + local-data path is the single biggest unlock for authed coverage** — recommend or wire one if missing.
3. **Understand the target group, then research it (required — this is what keeps Characters app-specific).** First derive *who this app is actually for* from the product itself — its positioning/value prop, pricing tiers, feature set, domain, onboarding, and any "for &lt;audience&gt;" copy → the real user **segments, roles and jobs-to-be-done THIS business serves** (and its actual *buyer*). Then `WebSearch`/`WebFetch` to ground each: the role's real workflow/KPIs/decisions; how comparable products serve the same journeys; what "good" looks like by domain norm; **and how long the job takes the traditional LLM-less way** (anchors time-saved). Record deciding references in `references:`. Offline → training data, mark it.
   > **Never reuse a generic roster across apps.** A dev-tools API, a hospital scheduler and an adtech dashboard have entirely different users — derive the Character set from *this* app's target group every time, or the exercise tests a fiction. If two different apps yield the same archetypes, the target-group discovery wasn't done.
4. **Offer a Character count.** Ask the user how many Characters to create — **1** (smoke: one core user), **5** (standard: the main internal roles + at least one external prospect/buyer), **10** (thorough: a wide variety of perspectives/user types). Default 5. Every app warrants a *different* mix — pick Characters spanning the real user types it serves; always include at least one **external prospect/buyer** (they surface credibility/conversion gaps internal users can't).
5. **Draft Characters** (`uat/characters/*.md`, template in `uat/README.md`): each a real role *from this app's target group*, with JTBD, `What good looks like`, pet peeves, **Motivation (time-saved)**, **Senior-quality bar**, **Scored acceptance criteria**, a **Surface binding** (the app variant / project-type + module set this Character actually uses — so findings are tested only on surfaces this Character can reach, never mis-attributed to them by topic), and a **Background / lived experience** + **Voice** (their history, the tools they've been burned by, who they answer to, what's at stake for them, how they actually talk) — the texture that makes their feedback authentic, not generic. All grounded in the research.
6. **Draft Journeys** (`uat/journeys/*.md`): goals with a user-POV definition-of-done, NOT step scripts. Mark each `promotion: discovery`.
7. **Scaffold** `rubric.md`, `accepted-gaps.md`, `driver/drive.mjs`, `.gitignore` if missing.

Output: a short summary + open env questions. Do not run journeys in `init`.

## Mode: `update`

Diff-aware refresh (read `git diff` / recent commits, `context-map.json` if present). For changed surfaces: add/adjust journeys, refresh Character expectations + scored criteria, targeted re-research only for genuinely new capabilities. Never silently drop a journey — mark removed-surface journeys `retired`. Report what changed and why.

## Mode: `run`

Verify a `character × journey` selection through the two levels. Selection: all `promotion: discovery|candidate` journeys; those named in args; `--surface <route>` to scope.
Flags: `--l1` (theoretical only — fast, cheap, mass-parallel), `--l2` (live only, assumes/forces past L1), `--acceptance` (re-run `promotion: acceptance` gates at L2). Default = L1 then L2 on survivors.

### Phase L1 — theoretical (mass-parallel across Characters)
**Dispatch one subagent per `character × journey`** — each reads the code, builds the surface model, walks the journey in-character, and writes a per-Character L1 report + returns a summary; the orchestrator then synthesizes (below). A 10-Character L1 sweep finishes in ~one agent's wall-clock, not 10×.
1. **Build the surface model** from the code — **follow the actual import chain from each affordance to the code that backs it** (button → handler → the `generateStructured`/API call → its prompt); don't guess the file. Capture affordances, inputs, state/data, navigation, and (for AI surfaces) the prompt + grounding that shapes output quality. Cite `file:line`.
   - **Grounding audit — L1's sweet spot, scored as coverage:** for each AI surface, enumerate the user's *real* context the output should use (their data, brand, costs, competitors, history, prior choices) and score **how many of those sources actually reach the prompt** (e.g. `grounding 2/6`). "Good machinery fed thin context" is the most common AI-product defect and is fully visible in code; making it a *number per surface* turns the single highest-value finding-type into a dial you can watch climb across runs (and auto-flags the next app's grounding gaps without a human noticing).
   - **Reachability check (resolve BEFORE judging):** compute the Character's *actually reachable surface set* — follow the nav/entitlement gating (project type → enabled modules, auth, feature flags, plan tier) to the routes this specific Character can open. Judge each affordance only within that set. A finding on a surface outside it isn't "the fix works" — tag it `unreachable` and defer its job-impact verdict to L2 (or flag the gating itself as the real finding). This is the one gap class L1 is structurally blind to, so make it an explicit step, not an assumption.
2. **Walk the journey in-character over the model** — cognitive-walkthrough questions from the rubric, plus the Character's own scored criteria (incl. time-saved and senior-quality applied to the *designed* experience). No browser.
3. **Emit L1 findings** (`cert_level: L1`, impact-scored, each needing live confirmation tagged `l2_priority`) + a per-journey verdict — **three states**: `L1-pass` (structurally sound, no majors → clean to L2), `L1-conditional` (completes structurally but has major findings to fix — still L2-eligible, majors carry forward), or `L1-fail` (a structural gap blocks the job — fix before L2). Also record the journey's **grounding score** and an **estimated time-saved-if-it-all-worked** (the upside the design promises) — L2 then confirms how much of that promise is actually live.

### Phase L2 — empirical (serial, live)
Only for `L1-pass`/`L1-conditional` journeys (or `--l2`). **Start from the L1 handoff — don't re-walk blindly:** pull the L1 report's `l2_priority` items + any `L1-conditional` majors. Those are the *targeted* questions L2 exists to answer (actual output/prose/image quality, real latency, rendering, real-data behaviour). Confirm the L1-pass path still holds, then spend the browser time on that deferred list. **For AI surfaces, exercise the *grounded / non-default* path** — fill the real-context inputs the fix added and assert the live output actually *uses* them (names the supplied competitor, reflects the brand/data/costs); a model/CI gate, if present, already covers the generic path, so L2's unique value is proving the grounded path end-to-end.
1. **Reach the start state** per `env.md` (see *Driver & environment*).
2. **Roam in-character** in a real browser — perceive via screenshot + ARIA snapshot + text; act via click/type; stay in the Character's head and **language**. No script — getting lost is a finding. Keep a first-person **journal**.
3. **Code cross-check** every "missing/broken" claim before recording (`confirmed-absent | present-but-missed → confusion | present-broken | by-design`). This both sharpens real findings and refutes plausible-but-wrong ones.
4. **Emit L2 findings** (`cert_level: L2`). Note any that L1 missed (→ surface-model gap).
5. **Adversarial verify** each kept finding (refuter pass; default `refuted`/`uncertain` unless evidence holds; "is the slow thing a timeout or just slow?"). Only `confirmed` reach the headline.

### Reconciliation sweep (cross-surface consistency — neither per-journey level catches it)
Some defects live *between* surfaces, invisible to any single Character×journey: a load-bearing concept defined in several unreconciled places. After the per-journey passes, pick the **shared concepts** (a metric, a margin/COGS, a brand token, a currency/period, an ID) and trace each across **every surface that uses it** — assert they agree. A mismatch (e.g. margin defined three different ways across profit / inventory / LTV so the numbers can't be made to agree, or a brand token that's "Adamant" on one surface and the client's name on another) is a real finding no walkthrough produces. Emit as `type: trust`, scoped to the surfaces involved.

### Output of a run
- `runs/<id>/findings.json` (schema above), `runs/<id>/report.md` (scorecard: per-journey **cert level reached** + status, an **estimated time-saved + grounding score**, findings ranked by **impact** (not just severity) with evidence + suggested acceptance + each resolved finding's `ceiling`, an appendix of refuted/uncertain, and a **"What passed"** list). Multi-journey → `SUMMARY.md`, which also carries the **reconciliation-sweep** results.
- **Character feedback** (in each `runs/<id>/<character>--<journey>.md`): a candid **first-person review in the Character's voice** — *would I adopt it? · what delighted or frustrated me · does it fit my world · does the output sound like me · is it worth the wait, do I trust it · what's missing for MY job · would I tell a peer?* Produced at **both** levels (L1 over the *designed* experience, L2 over the *live* one), grounded in the Character's Background/Voice. Findings are the actionable layer; this is the **felt verdict** — and across Characters the voices form a **user panel** that surfaces dimensions (craft-identity, patience-economics, adoption conditions, trust) a finding table can't.
- **Synthesis (multi-Character runs — don't skip):** the systemic insight usually lives *across* Characters, not within one. **Dispatch a final synthesis subagent** that reads all the per-Character reports + the reconciliation sweep and writes `SUMMARY.md`: cross-cutting themes (deduped), an **impact-ranked backlog** (frequency × reachability × trust-erosion, not raw severity), a **value ledger** (time-saved + grounding scores rolled up — what the product *promises* vs what's *live*), the **strengths worth protecting** (as decision-useful as gaps — they say what NOT to touch), the **honest ceilings** (what it still can't do), and a **panel verdict** — the single shared sentiment the voices add up to.
- Chat reply: scorecard headline (who reached L1 vs L2, top blockers/majors) + the sharpest Character voices, linking `file:line`/screenshots.

### Trust rules
- **Grounding:** no finding without evidence (L1 → `file:line`; L2 → screenshot/ARIA/`file:line`).
- **Per-character consistency:** judge against the Character's *scored criteria*, identically each run. For gates, multi-sample severity across 2–3 runs and take the majority.
- **Scope honesty + honest ceilings:** deliberately-not-built (demo/case-study disclaimer, backlog) → `scope_note`/out-of-scope, not a defect. **Never fabricate proof/data to "fix" a finding.** Every `resolved-verified`/`by-design` finding must carry a `ceiling` — the limit that remains — so "resolved" never overstates. A Character who distrusts vanity metrics trusts a build *more* when it names its own seams.
- **Impact over label:** rank work by `impact` (frequency × reachability × trust-erosion), not the raw `severity` word — so an every-run papercut outranks an unreachable "major", and the backlog reflects real pain.
- **Baseline:** `accepted-gaps.md` suppresses known/accepted issues; append when the user accepts one.

## Mode: `recertify`

Close the loop after fixes — the artifact that proves the work landed for the *user*, not just the compiler. Given the prior run's `findings.json` (or `--since <commit>`), re-run **only** the affected `character × journey` at L2 against each open finding's specific `l2_priority` question. For each: confirm the fix is *reachable* and *unblocks the job* with fresh live evidence → `resolution: resolved-verified` (+ its `ceiling`); else keep it `open` with exactly what's still missing; if a once-passing check now breaks, mark it `regressed`. Re-measure the journey's **time-saved** and **grounding score** so the run-over-run delta is visible. Output: a diff report (resolved / still-open / regressed + the metric deltas), not a full re-sweep — cheap, targeted, repeatable.

## Mode: `promote`

Turn a clean journey into a low-variance **acceptance** gate. Take a journey that reached **L2-pass** on a stable path: freeze its happy path + the acceptance criteria it satisfied into the journey file, set `promotion: acceptance`, note seed/env + known-accepted frictions. `/uat run --acceptance` re-runs every acceptance journey (L2) against its frozen path → pass/fail vs recorded acceptance. Slow — run deliberately, not on every push.

---

## Driver & environment (L2 — the portable how-to)

Per-app values (base URL, port, auth, seed) come from `uat/env.md`; the mechanics are universal.

- Prefer an interactive browser MCP if connected; else the bundled **`uat/driver/drive.mjs`** (navigate → screenshot + ARIA + text + optional one click). Run from repo root: `MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:<port> SHOT_DIR=uat/runs/<id>/shots node uat/driver/drive.mjs /route shotName [clickRoleName]`. For **AI surfaces** use **`uat/driver/drive-ai.mjs`** — fills inputs, clicks generate, and **polls until the model result settles** (15–130s), optionally asserting the output echoes a supplied real entity (the grounding check). Other multi-step flows: a short bespoke driver reusing these patterns.
- **Fixture readiness (preflight before driving) — demand DISTINCT, realistic data:** `env.md` must enumerate the fixtures the Characters need + how to create them — one project of **every** project-type the Characters bind to, seeded data, and a **share token / public link for client-facing surfaces**. Crucially, assert the seed is **non-empty and non-identical across tenants/clients** before L2 starts: "every client shows the same demo numbers" and "the list is empty so it silently falls back to a sample" are exactly the bugs that *only* surface with multiple distinct fixtures — an empty or clone-stamped store hides them. A Character whose surface has no fixture (or only a clone of another's) is untestable, not passing.
- **Server lifecycle:** reuse an already-running server (don't start a 2nd instance); else start in the background and poll for 200 before driving. **Recover a wedged server** (hangs / `ECONNREFUSED` / bundler cache errors like Turbopack "corrupted database", often after a `git checkout` swapped files under it): kill the port, delete the build cache (`.next`/`.vite`), restart, re-poll.
- **Gotchas (all bit the pilot):** `MSYS_NO_PATHCONV=1` via Git Bash (else a leading-slash route is mangled); use `locator.ariaSnapshot()` (`page.accessibility.snapshot()` was removed in Playwright ≥1.50); don't block on `networkidle` (HMR socket never idles) — `domcontentloaded` + a short settle; role/language-aware selectors; **budget for latency** — dev AI surfaces take 30–130s/call and an early client-timeout is itself a finding.

## Concurrency model
- **L1 is mass-parallel** — no browser to serialize, so run many `character × journey` theoretical passes at once (this is how Character count scales to 10+ cheaply).
- **L2 is serial with long runs** — accept it: queue journeys, drive one live browser session at a time.
- **Artifact/concurrency hygiene:** gitignore `runs/*/shots/`; if another agent commits in the same tree, commit artifacts path-scoped in a quiet window (a long pre-commit gate widens the race).

## Using this on a new app
1. Drop `/uat` into the repo (`.claude/skills/uat.md` — it's a local, copy-to-other-repos asset). 2. `/uat init` → discovers routes/run-recipe/auth/language, researches, **asks how many Characters (1/5/10)**, scaffolds `uat/`. 3. Resolve env open-questions (esp. offline auth + local-data). 4. `/uat run --l1` for a cheap broad sweep; then `/uat run` for full L1→L2. 5. Fix, then **`/uat recertify`** to re-verify just the touched journeys (resolved-verified + metric deltas). 6. `/uat promote` clean journeys into gates.
