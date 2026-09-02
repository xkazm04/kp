---
product: "kp"
stack: "an AI-assisted hiring platform (Next.js 16.3 canary with Cache Components + React 19 + TS + Tailwind 4 + better-sqlite3 + next-intl; Python pipeline/ for LLM scoring)"
vault: ["C:/Users/kazda/Documents/Obsidian/kp"]
vault_subdir: Perfect
base_branch: main
wave_size: 3
lot_caps: {}
pool_target: 10
round_shape: round
cooldown_rounds: 2
commit_format: "feat(<context>): <title>"
context_map: context-map.json
active_runs_ledger: ""
locale_count: 2
---

# perfect overlay - kp

First run: create `C:/Users/kazda/Documents/Obsidian/kp` (the user keeps per-project vaults there).
Builds fork from and land on `main`. `round_shape: round`: propose for 1-3 contexts, gate, build that
slate immediately; thin slates keep winning. `locale_count` is a floor - count `messages/*.json`.

Context-map keys in this repo: `filePaths`, `apiRoutes`, `description`. Python (`pipeline/`) needs no
per-worktree install; run python gates from the tree root.

## Gates
- always: `npm run typecheck`, `npm run test:unit`, `npm run lint`
- when `messages/*.json` or user-facing strings touched: `npm run i18n:check`
- when `pipeline/` touched: `npm run test:python`
- slow: none
- builder: `npm run typecheck`, `npm run test:unit` (targeted where possible), `npm run lint`,
  `npm run i18n:check` if strings touched, `npm run test:python` if `pipeline/` touched; report what you
  COULD NOT verify honestly. Only the Director drives live flows, from the main checkout.

## Class B
- `messages/*.json` locale files (add the key to `messages/en.json` AND every other locale; anchored
  insert, never rewrite a file whole; at conflicts re-apply key adds/removes programmatically and run
  `npm run i18n:check`)
- barrel exports

## Class C
- the git index
- `context-map.json`
- generated schemas from `schemas:gen` and generated i18n artifacts (Director regenerates once)

## Repo law
Authority: `docs/design/README.md` for UI; `node_modules/next/dist/docs/` for Next specifics.
- This is NOT the Next.js you know: it's 16.3 canary with `cacheComponents` + `partialPrefetching`.
  Read the relevant guide in `node_modules/next/dist/docs/` before writing Next-specific code;
  `runtime`/`dynamic` route configs are banned.
- Read `docs/design/README.md` before any UI. The app ships TWO themes (Studio Light + Spark Dark) from
  one codebase: never hardcode colors outside `app/landing/`; use brand tokens (ink, paper, steel,
  coral, moss, limewash, dial-*, score-*) and theme-mapped neutrals; compose surfaces from
  `app/_components/ui/recipes.ts` (PANEL, CHIP, BTN_*, EYEBROW, FIELD...); reuse primitives in
  `app/_components/` (Modal, Badge, SegmentedControl, Skeleton) - never hand-roll them. Verify new
  surfaces in BOTH themes before claiming done.
- Every user-facing string goes through next-intl: add the key to `messages/en.json` AND every other
  `messages/*.json` locale; `npm run i18n:check` must pass.
- Respect `context-map.json` scoping; read it before editing.
- Review conventions (Director): dual-theme tokens, `recipes.ts` surfaces, shared primitives in
  `app/_components/`, next-intl keys across ALL locale files, context-map scoping. **Both-themes
  check:** any UI diff must hold in Studio Light AND Spark Dark - look for hardcoded colors outside
  `app/landing/`, missing `dark:` handling in new recipe usage; a diff that only works in one theme is a
  redo, not a merge.
- Doc-sync: user-visible changes update the mapped doc under `docs/` when one exists for that feature
  area.

## Context sources
- `context-map.json` for the queue. Coverage names: `.personas/contexts.txt` (the registered-name list,
  refreshed when the app rescans); fall back to the map name only when that file is absent.

## Smoke
- Visual pass every ~3 rounds, before proposing - both themes, at least one non-en locale. The dev port
  is volatile (`:3000` is Vibeman; kp lands elsewhere) - probe candidate ports for a `<title>` starting
  "KP" rather than assuming.
- Plan B without a browser: SSR `curl` of the touched routes (with `-H "Cookie: NEXT_LOCALE=cs"` for
  locale checks) grepping for the new surface's markers; the interactive half stays owed in the
  `Perfect.md` cursor.

## Opportunity arcs
- Judged from context-map metadata, `docs/*`, and memory. Active arcs: the V2 matching platform,
  enterprise readiness, multi-market unlock.

## Vetoes
- Features already planned elsewhere; "removed - don't re-suggest" notes; the industry-locked finding.
- The Vibeman ideas backlog (many `backlog:idea-*` skills exist) - don't re-pitch one verbatim.

## User taste
- Thin, evidence-honest slates; "near-polished, N small residuals" is a good verdict (the delta re-scout
  is how a fully-dead board facet's revival was confirmed).
- Bugfixes stand alone.


## Skill improvement log
<!-- migrated 2026-09-01 from $VAULT/Perfect/config.md (vault copy retained, marked migrated) -->
- (2026-09-01, round 24 - eval run, Director as operator delegate) **Reconcile a stale vault against the tree BEFORE trusting its cursor.** The 2026-08-03 vault named 7 remaining directions and a "round-24 lead"; the tree had 545 newer commits, 6 of the 7 had shipped under SHAs a squash had since changed (proven by symbol, not SHA - four of six recorded SHAs were MISSING from the tree), and the lead (an "unauthenticated" schedule GET) was a keyless-dev-mode artifact: proxy.ts fail-closes it. `git merge-base --is-ancestor` is the first question, a signature grep the second.
- **The harness can refuse builders** (20-subagent ceiling twice; then an API session limit killed a builder mid-direction). Building a lot inline as Director worked but spends the Director's context; the builder-death salvage rule paid off exactly as written (the uncommitted diff was complete; the scratch PROBE block had to be stripped before commit).
- **A lint gate's liveness must be probed with a fixture that is supposed to FAIL.** The design-law hex rule was silently off for the whole ui/import layer (flat config replaces `no-restricted-syntax` options; the config header already warned about it for TRANSACTION_SELECTORS). Worse: my own re-arm briefly broke the config syntax and a grep-count pipeline read the crash as "0 findings" - read the gate's exit code, never a grep over its output.
- **Recurring trap:** the commit-msg hook rejects subjects over ~70 chars as "truncated" - one clause in the subject, the story in the body. Hit three times this session (two Director, one builder-brief instruction added after).
- Map drift: the 143-context recalibrated map (2026-08-20) already lags the tree (the matrix dir has 17 files, the map lists 13). Queue provisional until the next rescan; vault context notes were created only for contexts actually scouted this round (matrix-ui-2, candidate-public-surfaces-2), not for all 143.
- (2026-07-29, SMOKE/Phase V) **The 9-round visual-pass deferral was the single most expensive
  process failure of this loop, and it ended the moment I stopped treating "no dev server" as a
  blocker and asked the owner instead.** The fix is now a recipe (see below), it cost 24 seconds
  of `npm install`, and the FIRST live look found a real defect three green gates had missed.
  **Never defer Phase V more than 2 rounds again — deferral compounds silently.**
- **LIVE-WORKTREE RECIPE (add to config Build section):** the node_modules JUNCTION is for
  BUILDERS only — Turbopack rejects it, which is why `next dev` never worked in a worktree. The
  LIVE worktree gets a REAL `npm install` (24s warm) plus a read-only copy of the primary's
  `data/kp.sqlite{,-wal,-shm}`, served on a private port. Fully isolated from concurrent sessions.
- **Verify the process behind a port before trusting it.** :3001 was serving a DIFFERENT project
  entirely (`kiro/ascent`). `Get-NetTCPConnection` → `Win32_Process.CommandLine` settles it. A
  "kp is on :3001" note in the vault was stale and would have produced a completely bogus pass.
- **Query the data store BEFORE hunting surfaces** (smoke mode says this; it paid immediately).
  One SQL inventory told me dev_cases=0 but dev_outbox=40 / group_evals=6 — so I knew instantly
  which owed surfaces were reachable, instead of clicking around an empty tab.
- **NEW STANDING RULE for i18n directions: never let a builder enumerate an enum by eye.** Round
  22 shipped a 4-key catalog against a 13-kind canonical vocabulary (`KNOWN_COMM_KINDS`) that was
  ALREADY set-equality-pinned against every dispatcher one file away. 23 of 40 real rows rendered
  English in a German UI. Three gates were green: the raw-value fallback hid it, `i18n:check`
  compares locales to EACH OTHER (never to the domain vocabulary), and the lookup is a string
  index behind `.has()` so tsc was silent. Every future enum-localization brief must say: "derive
  the key set from the code's canonical list and add a set-equality guard test."
- **Measure UI risks, don't eyeball them.** The flagged German-length risk was settled by
  comparing `scrollWidth > clientWidth` per `th` and reading computed styles under
  `data-theme=dark` — sharper than screenshots, and it kept working after the renderer degraded.
  It also caught a genuine ~3px nav-rail overflow no screenshot glance would have.
- **The false-P0 trap recurred and the vault's own warning saved it.** Screenshots timed out and
  elements vanished from queries; I confirmed via server 200s, a static 3-entry `DEV_VIEWS`, and
  SSR HTML that the APP was fine and the BROWSER was throttled. Then I AMENDED my own commit
  message to drop a "re-checked live" claim I had not completed — hold the Director to exactly
  the honesty standard the briefs demand of builders.
- (2026-07-29, round-22 wrap) FOURTH consecutive full-sweep gate; 8/8 shipped same session across
  two waves with ZERO Director fixes (waves 12 and 13 of the clean streak). Two never-before-seen
  Director failure modes, BOTH caught by builders, both now rules:
  **(a) STRAY-BRANCH EVIDENCE CONTAMINATION.** The primary checkout sat on another session's branch
  with ~1000 dirty files. I gathered proposal evidence with plain greps there and cited two paths
  that DON'T EXIST ON MAIN (`app/features/hiring/pipeline/PipelineCandidateResultView.tsx`,
  `app/features/tools/devcases/*`) — they were that session's uncommitted refactor. The dev SCOUT
  inherited the same error, so a scout brief was contaminated too. RULE: when the primary checkout
  is on a stray branch, gather ALL evidence via `git show main:<path>` / `git ls-tree main` or from
  the perfect-merge worktree — and say so IN the scout prompt, since scouts run in the primary tree.
  **(b) COMMENTS COUNTED AS CODE.** I enumerated "13 pid-recycling files"; only 8 were real — the
  other 5 were already fixed and merely carry post-mortem comments quoting the old bad pattern.
  RULE: strip comments before enumerating a defect class in this repo. This repo's fix commits
  deliberately quote the defect they killed, which makes prose the top false-positive source.
  Both errors cost nothing because the briefs say "verify, don't guess" and builders did — that
  clause is now demonstrably load-bearing twice in a single round. Keep it verbatim.
- The DIRECTOR-PROVES-THE-HEADLINE habit paid the most this round: I ran `detected_skills()` myself
  before presenting rather than repeating the scout's claim, so the slate led with a reproducible
  four-line proof instead of an assertion. Generalize: for any direction whose value claim is a
  behavioral defect, RUN IT ONCE at proposal time. Cheap, and it makes the gate trivial for the owner.
- New review lens that earned its keep: **check the fix for OVER-correction, not just correction.**
  A word-boundary guard could silently destroy legitimate matches, so I ran 11 probes covering both
  directions (traps dead AND PySpark/Czech-inflection/.NET/CI-CD/cross-selling preserved). For any
  "stop matching X" direction, always test what must STILL match.
- The integration gate got its first REAL baseline: instead of trusting "72 is the known artifact
  count", I checked out the fork commit in the merge worktree, re-ran the full suite, and diffed
  the normalized failure sets (IDENTICAL). Detached-HEAD checkout inside the merge worktree is safe
  and cheap — make this the standard close for any multi-builder round.
- Scouts CORRECTED TWO STALE VAULT NOTES (propose_weights + embedding_bridge were recorded as
  "stubbed/dormant by design" since round 10; both are live in the product path). Parked/dormant
  notes DECAY. Add to the delta re-scout brief: "re-verify any note claiming a mechanism is
  dormant/stubbed/unused — it may have been wired since."
- First context ever to scout with ZERO dead ends (dev cluster: every computed field has a live
  reader and a test). Recording it in the context note matters — it means future rounds should NOT
  hunt "wire what exists" there, which is normally this loop's highest-yield direction class.
- Wave-2-from-the-cap worked well: holding a 4th direction out of an at-cap brief and forking it
  from post-wave-1 main cost one extra worktree and produced a clean single-direction build. Prefer
  this over stretching a brief to 4.
- Ask builders for MEASUREMENTS, not assertions, and they deliver: "14 calls → 1, identical sha256
  over the full result payload" and "did the new test fail first? yes, twice, verified by mutation"
  both came from explicit brief clauses. Keep both phrasings.
- (2026-07-27, round-21 wrap) THIRD consecutive full-sweep gate; 8/8 shipped same-session. New
  patterns that worked: (a) a Director-drafted HYGIENE TRIO from prior-round builder Open-Risks
  needed zero scouts and gated 3/3 — builder-flagged exposures are a free direction pipeline;
  (b) launching the sequenced wave-2 builder the moment its dependency merged, while the other
  wave-1 builder still ran, cost nothing and saved a full serial step; (c) Director VERIFIED a
  builder's follow-up list before pitching it (the erasure pair was clean) — always re-verify
  flagged siblings, two of five were wrong.
- The round-3 NUL-byte trap RECURRED (geB cache-key join separator) — git-binary file caught at
  review via the diff STAT (Bin marker), fixed+amended pre-merge. Add to review ritual: scan the
  stat line for `Bin` before reading hunks. Builders' briefs could warn, but the stat check is
  cheaper than brief bloat.
- Builder report prose twice mis-stated its branch (both geA and geB claimed the primary's
  branch name) — branch verification before merge is now demonstrably load-bearing; keep it.
- The pid-recycling defect keeps widening (3 fixed → 8 more found). When a defect CLASS recurs
  a third time, propose the full-codebase sweep as ONE direction instead of chasing files
  round by round.
- (2026-07-27, round-20 wrap) Second consecutive 10/10 gate and the fastest full round yet
  (propose→10 shipped in one sitting, waves 9+10 of the zero-Director-fix streak). What worked:
  (a) the OWED-standalone-direction rule fired for the first time and the billing flake got a
  PROVEN root cause (pid recycling over undeleted temp DBs) instead of a 5th sighting — the
  builder's deterministic pinned-pid repro is the standard to ask for in test-infra briefs;
  (b) region+namespace ownership let TWO builders share one context (jobs) with zero conflicts —
  cheaper than sequencing when regions are provably disjoint; (c) scouts fed the harness-scan
  reports again pre-verified every finding, and BOTH corrected a stated root cause (ROI producer,
  ds- operative cause) — keep phrasing findings as claims to re-verify.
- Builder-flagged same-defect siblings (5 more pid-recycling test files) and consumer gaps
  (AiReviewCard null-offer render) are accumulating into a natural round-21 hygiene slate —
  the "flagged exposures" review lens keeps paying; read Open Risks first.
- Watch: direction-note vault writes via PowerShell mojibake'd UTF-8 once (fixed same session)
  — use [System.IO.File] UTF-8 APIs for vault writes, never Get-Content/Set-Content -Raw.
- (2026-07-27, round-19 wrap) FIRST FULL-SWEEP GATE (10/10 accepted) and the biggest round to
  date shipped in one session: two never-slated contexts scouted deep (full-pipeline briefs +
  "verify the recent harness scan's findings against today's code" — that reuse made both slates
  cheap and every finding pre-verified). The 2-wave / shared-region-sequencing plan produced
  ZERO integration fixes across 4 builders. Keep: feeding scouts an existing per-context scan
  report to re-verify beats scouting from scratch when one exists.
- Worktree recipe bug found by a BUILDER (dangling relative junction) — recipe fixed to absolute
  targets above. Also codified: normalized failure-diff gating + the perfect-merge pattern for a
  stray-branch primary checkout.
- Billing contention flake 4TH sighting (7/9/10/19) — the standing rule now TRIGGERS: round 20
  must present the test-isolation direction standalone.
- Locale-file collisions between two same-wave builders were fully avoided by NAMESPACE
  ownership in the briefs (apply.* vs channels.*) — cheaper than sequencing; add to the standing
  coordination rules alongside format-owner.
- Builder-report inaccuracy to watch: one builder REPORTED its commits on the wrong branch
  (they were on its worktree branch — verified before merging). Always verify branch/commit
  reality before reacting to report prose.
- (2026-07-16, round-18 wrap) First round under skill rev 2 ran exactly to spec: a ZERO-direction
  context (JD scouted clean) cost only a scout, the 2-direction shell slate gated cleanly with
  one rejection recorded, and the single-builder round shipped same-session. SIXTH consecutive
  zero-Director-fix round. New signal: contexts are starting to scout CLEAN — the next rounds
  should widen to never-slated/long-idle contexts before re-visiting polished ones.
- The Phase V SSR smoke ran DURING the build round (not deferred to wrap) and verified the
  ship live in Czech within minutes of merge — cheapest possible "did it work" close.
- (2026-07-16, /perfect reflect — SKILL REVISION 2 APPLIED, all 7 edits owner-approved) E1
  per-round slate replaces the 10-pool (10 = hard cap only); E2 delta re-scout formalized
  (coherence + downstream payoff + "near-polished is a good verdict"); E3 rotation heuristic
  (least-recently-slated wins ties, never-slated outranks re-visits); E4 data-path rule in the
  Challenge list + "bugfixes stand alone" in the quality bar; E5 format-owner + same-region
  sequencing in the wave plan; E6 Phase V visual pass (~3-round cadence, SSR smoke plan B,
  tab hygiene, volatile port); E7 brief template (no next dev in worktrees, >10min foreground
  poll, source-guard grep, stale :3001 removed). Queued items from rounds 14-17 all consumed.
- (2026-07-16, round-17 wrap) Delta re-scouts with an explicit "near-polished is a good verdict"
  brief produced exactly honest output: 1 real bug + 2 real S wins, zero manufactured findings.
  The thin-slate norm is fully validated — round 17 was propose->shipped in one sitting with a
  3xS slate. FIFTH consecutive zero-Director-fix round.
- (2026-07-16) New pattern worth keeping: scouts that verify a PRIOR round's fix delivered its
  downstream payoff (the dead source facet) close the loop on "shipped" vs "worked".
- (2026-07-16, round-16 wrap) The SSR-smoke fallback (curl + locale cookie + marker greps) is a
  real substitute when Chrome is down — it verified the verdict banner in both locales for
  cents. Keep it as the visual pass's plan B; the interactive half still needs a browser.
- Builders now CORRECT feasibility maps (nullable-vs-default_factory; the fingerprint half) —
  the briefs' "verify and state" clauses are doing their job. Keep writing maps as claims to
  check, not instructions to follow.
- Four consecutive zero-Director-fix rounds and a 3-direction round that closed a two-round-old
  premise-failure arc: the loop is at a polished steady state. Compact rounds are the new
  normal; the next skill revision (/perfect reflect) should consider lowering the pool target
  from 10 and formalizing the rotation heuristic + plan-B visual pass.
- (2026-07-16, round-15 wrap) Bringing NEVER-SLATED contexts into the loop keeps paying: both
  JD and Shell yielded full accepted slates on first/returning visits, while twice-visited
  contexts (Decisions/Sourcing) had gone thin. Rotation heuristic: prefer the least-recently
  slated context at equal opportunity scores.
- "Arm-late for free" (J3) is the pattern name for: check whether existing polling/derivation
  makes the better UX free before settling for the honest-but-lossy fallback. Builders find it
  when the brief ASKS the question explicitly.
- Three consecutive zero-Director-fix rounds: the sequenced-fork + format-owner + data-path
  rules have eliminated the integration-fix tax. Keep them in every brief.
- (2026-07-16, round-14 wrap) A projection gap (listPipeline omitting source_*) sat under THREE
  rounds of shipped attribution work — every scout verified the WRITE path and the DRAWER read,
  none checked the LIST read. Add to the data-path rule: verify the projection at EVERY read
  site that should show the field, not just the primary one.
- The command-verbs rejection recalibrates: shipped-but-low-traffic machinery does not earn
  expansion directions even when cheap — "wire-what-exists" applies to DATA reaching surfaces,
  not to growing verb sets.
- Deliberately thin slates keep winning (Analytics 2/2). The 10-pool can close across 3 contexts
  comfortably; never pad.
- (2026-07-15, round-13 wrap) SECOND premise failure on a parity/composition direction
  (intake-sees-the-signals; round 10's shortlist handoff was the first). NEW RULE for the
  Director: before pitching "surface X gains signal Y from surface Z", the scout must verify
  the DATA PATH (the payload/schema actually carries Y at X's read site), not just Y's existence
  elsewhere. Both failures were caught by builders honoring escape clauses — the clauses work;
  cheaper to catch at proposal time.
- Builder REFUSING a spec'd change on evidence (scientist merge) and the Director endorsing it
  is the system working — record refusals as product judgments in the vault so they're never
  re-proposed.
- The visual pass caught a live i18n defect and killed a false P0 in one sitting — worth the
  30-minute tab-freeze detour. Cadence: run it every ~3 rounds, and kill/recreate browser tabs
  between route hops (rapid mid-hydration navigations can wedge a tab).
- Deliberately thin slates (CV: 3, Profile-Match: 1 rider) were all accepted — the owner rewards
  the quality bar over the count of 5. Keep not padding.
- (2026-07-15, round-12 wrap) Scouts that VERIFY premises kill stale directions before the gate
  (the "no hire->variant link" premise died on evidence). Keep scout prompts asking "is this
  follow-up still true?" — three of six follow-ups had shifted.
- A builder finding the DEEPER defect (sole-PK write-drop under the flagged symptom) validates
  briefs that state the SYMPTOM and authorize root-causing: "the route fix alone was necessary
  but insufficient" is the sentence we want builders writing.
- Same-file wave collisions now handled by sequencing S3-after-S1 (CoachPanel) — but the
  D1/D2 same-file (analytics route) collision was accepted knowingly and cost one conflict
  resolution. Rule of thumb confirmed: sequence when the SAME REGION changes, parallel + resolve
  when regions differ.
- Vault follow-up discipline: the in-browser visual pass debt is now 3 rounds deep — next
  session should START with it (or a UAT smoke) before proposing round 13.
- (2026-07-15, round-11 wrap) Same-wave parallel builders produced DUPLICATE parsers of one wire
  format (B1 drawer + A3 log both parsing rematch details) — the coordination lesson from round
  8 generalizes: when two accepted directions in one round consume the SAME data format, name
  the format owner in both briefs. Director dedup was cheap (c02bd5f) but avoidable.
- Builder-flagged out-of-scope hazards (A2's familyFloors wipe) keep paying: fix at the deepest
  seam (store write boundary), not the flagged caller — covers unknown callers too.
- Two rounds fully built in one day; the banked-prefetch-scout rhythm (exactly one ahead) is
  the loop's steady state. Wave-2 builders forked post-merge continue to produce ZERO
  integration fixes.
- (2026-07-15, round-10 wrap) A builder STOPPING on a false direction premise (P3: the
  group-eval cohort was seed-only) and the Director escalating to the OWNER GATE mid-build
  worked exactly as designed — better than drop-and-requeue: the owner chose the wider fix and
  it shipped same-round. Lesson for the Director: when pitching composition directions, verify
  the two surfaces actually share a data population (the scout brief covered each surface
  separately; the JOIN was asserted, not evidenced).
- Prefetch+bank scouts is now steady-state: round 11's cursor brief was banked before round 10's
  build finished. Keep one scout ahead, never two (staleness risk).
- Billing test contention flake: 3rd sighting (rounds 7/9/10, different files). Pattern: fails
  in full parallel run, passes isolated + rerun. If a 4th sighting occurs, propose a
  test-isolation direction rather than re-running around it.
- (2026-07-15, round-9 wrap) Sequenced wave-2 builders (fork AFTER the dependency merges) fully
  eliminated the cross-builder integration fixes of round 8 — zero shape-vs-read collisions this
  round. Keep the pattern: shared-file builders sequence, disjoint builders parallelize.
- Builders honor scope boundaries well ("flagging rather than silently widening" twice this
  round) — the Director completing the out-of-scope half as a small follow-up commit (afd586f)
  is cheaper than widening briefs; keep briefs tight.
- Two of four Director fixes were HONESTY-at-the-edge catches builders' lib-level view missed
  (nullable verdict rendered as "within market"; live prior boosted as if terminal). Review
  lens that keeps paying: "what does the CONSUMER of this new value render in the weird case?"
- (2026-07-14, round-8 wrap) Coordination briefs between same-wave builders sharing a payload
  contract REDUCE but don't ELIMINATE integration risk — the shape change and the read still met
  only at the Director's merge (c94b372). Next time a shared contract changes mid-wave, put the
  CONTRACT ITSELF in one builder's scope and make the other consume a frozen interface, or
  sequence them. Standalone defect re-presentation is now proven twice (calibration-409 accepted
  instantly). Source-guard tests keep tripping on legitimate refactors (rate-limit marker this
  round, calibration guard in round 4) — builders should grep for source-guards over files they
  restructure and update them IN the same commit.
- (2026-07-14, round-7 wrap) The activation pattern proved out: "ship the capability" (round 4)
  then "make the product actually exercise it" (round 7) produced the best metric of the loop
  (non-tech resolution 0→74.3%) — scouts should always ask "what exercises this?" when verifying
  a shipped capability. Root-cause-over-patch paid again (one confirm reducer vs five reset
  call sites). Builders now self-catch hazards the brief warns about (collision lint caught real
  Czech-word traps during authoring). Standalone-bugfix presentation worked (confirm-gap accepted
  instantly where round-6's bundled fix was rejected). Watch: one transient parallel-runner
  test flake after a board merge.
- (2026-07-14, round-6 wrap) 14/14 shipped, zero redos, one Director hardening (builders now
  reliably FLAG their own exposures in Open Risks — read that section first at review). Two
  patterns worth keeping: "wire the X that already exists" directions (lint engine, batch engine,
  entry handle) are the highest-value-per-token class we have found — scouts should explicitly
  hunt for built-but-unwired mechanisms; and honesty-branch briefs ("if the engine can't, mark it
  unavailable — never silent fallback") consistently produce the right builder judgment.
  Gate-calibration note: the first rejected direction that bundled a LIVE BUG with an enhancement
  (calibration-rec-integrity) left the bug unfixed — bundle bugfixes separately from behavior
  changes next time so a rejection doesn't strand a defect.
- (2026-07-14, round-5 wrap) Smoothest round yet: zero DECISION NEEDED, zero Director fix
  commits, 12/12 shipped in ~2.5h wall-clock. What worked: delta re-scouts keep proposal cost
  low and catch what the previous round itself broke or left half-wired; briefing builders with
  the REJECTED-sibling context ("this is the carved-out minimal fix — do NOT add affordances")
  prevents scope re-creep; asking builders to verify API fields against vendored docs/references
  before wiring. Taste is now well-calibrated: three rejections all fit one pattern — no new
  machinery expansions (metering, comms templates, exports owned elsewhere); fixes that close
  drift/honesty gaps in existing surfaces sail through 100%.
- (2026-07-14, round-4 wrap) Worked: delta re-scouts on 1-round-old briefs (cheap, caught the lock
  SPLIT and a latent bug round 1 itself introduced); harness-before-content sequencing (coverage
  gate then taxonomy authoring — the gate caught a real collision during authoring); Director
  finishing builders' flagged follow-ups inline (relay confirm, lineage threading) instead of
  re-briefing. Two gate rejections this round — both "persist/surface more state" features; taste
  signal: the user prefers closing loops in EXISTING surfaces over new stateful views. Rounds are
  getting cheaper per direction (13 shipped, 3 scouts, zero DECISION NEEDED).
- (2026-07-14, round 4 in-flight) Process slip: chained `git commit` onto the gate commands in one
  Bash call — a typecheck failure scrolled past and the commit landed red (amended immediately).
  RULE: run gates, READ them, then commit in a separate call. Also: a failed Edit pair (file-not-
  read error) meant only half a two-part change was re-applied — after any Edit error, re-verify
  BOTH halves landed before running gates.
- (2026-07-14, round-3 wrap) Worked: cross-builder seam management via mid-flight SendMessage (C1
  adopted C2's runCached prop; the merge conflict was a trivial union); sequencing A1 after A2
  (zero conflicts); re-verifying banked-scout claims with fresh greps before presenting.
  Dragged/learned: source-guard tests can assert the exact literal a tenancy fix must change —
  expect guard updates as part of scoping work; same-millisecond timestamp tie-breaks must use
  rowid, not a random slug (real bug, caught only in the slower full suite); a literal NUL byte as
  a key separator makes git treat a source file as binary — use the u0000 escape. Three rounds in
  one conversation works for the vault but stretches context — prefer wrapping after ~2 waves.
- (2026-07-13, round-2 wrap) Worked: sequencing S2 after S1 on shared files (zero conflicts); catching an
  already-shipped direction at review (zero builder spend); V1's harness-validation loop caught a real
  regression the Director would have merged (naive craft rules broke the language gate) — "validate via the
  existing harness" in a brief is worth its cost. Dragged: V1 backgrounded the eval sweep despite FOREGROUND
  ONLY (stalled twice, 2 nudges) — next round, add "if a command takes >10 min, poll it in a foreground loop"
  phrasing; my scope-check nudge misread legitimate ablation as a rabbit hole (harmless, but check dumped run
  artifacts before accusing). Locale files auto-merged cleanly across all cherry-picks this round.
- (2026-07-13, round 2) Stale-scout trap round 2: the scheduling scout claimed "human scorecard invisible to compare" but main had shipped exactly that on 2026-07-04 (PREP1 union in the compare route — a file OUTSIDE the scouted context). RULE EXTENDED: any direction whose value claim is "X is invisible to / dead-ends before Y" requires the Director to grep Y's actual files (route + component) before presenting, not just the scouted context. Caught at review this time (zero builder spend), but it survived the proposal gate.
- (2026-07-13, round-1 wrap) What worked: ff-merge for a builder that forked from current main tip preserved atomic commits with zero ceremony; cherry-pick handled the rest with auto-merging locales; the "refuse to duplicate" builder guardrail caught a bad direction. What dragged: worktree route tests hit a NextRequest dual-module-identity artifact (node_modules junction) — builders worked around it (DB-level tests / verify in main checkout); consider a proper fix (test-alias-loader resolving next/server to one identity) before round 2. All 5 builders finished without a single DECISION NEEDED — briefs with explicit acceptance criteria + "pick least-invasive and note it" works.
- (2026-07-13) "Already exists?" challenge failed once: the engine scout scoped to pipeline/ and called winnability "CLI-only" — a full UI (CoachPanel) existed in app/. RULE: before proposing "surface engine capability X in the UI", the Director must grep app/ for existing consumers of X (route + component), not trust a single-context scout's exposure claim. Cost: one wasted Opus builder launch (it self-detected and refused to duplicate — that guardrail worked).
