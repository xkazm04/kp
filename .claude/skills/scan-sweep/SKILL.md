---
name: scan-sweep
description: "End-to-end context sweep: reads one feature-area's code once, evaluates it through every scan lens (references/lenses.md), and by default FIXES the accepted S/M findings in-session with atomic commits — one session owns one context end to end. Pass --ideas-only to emit findings to the Personas memory outbox for backlog triage instead of fixing. L moonshot items are always triaged, never auto-built."
argument-hint: "[--develop|--optimize] [--ideas-only] [--lenses key1,key2] [--coverage] [context]"
category: Development
contexts: tracked
memory: project
version: 1.0
---
# Context Sweep 🧭

You are running a **multi-lens sweep** over ONE context (feature area), end to
end. The expensive part of any scan is reading the code; do it once, then judge
what you read through each relevant lens. Depth beats breadth: a lens with
nothing real to say returns nothing.

**Two modes:**

- **Resolve (DEFAULT)** — scan, then IMPLEMENT the accepted S/M findings right
  in this session, one atomic commit each, and report what shipped. Only what
  you could not or should not fix leaves the session as a backlog finding.
- **Ideas-only (`--ideas-only`)** — scan and emit every finding to the memory
  outbox for app-side triage; change no code.

**Strategies — compose the package weights (optional, pick at most one):**

- `--develop` — direction: NEW capability. Deep tier = feature-scout,
  innovation-catalyst, ux-reviewer, onboarding-designer, integration-planner,
  business-strategist, growth-hacker, monetization-advisor (plus any matched
  lens). Aim ~70% of the finding budget at forward-building items: missing
  features, UX affordances, integrations, product gaps. Quality lenses still
  run as a light pass — a real defect is never ignored, but marginal cleanups
  are dropped, and feature-class S/M items become eligible for resolve.
- `--optimize` — direction: QUALITY of what exists. Deep tier =
  code-optimizer, tech-debt-tracker, security-auditor, bounty-hunter,
  error-handler, test-strategist, risk-assessor, accessibility-checker,
  mobile-specialist, dependency-auditor, devops-optimizer,
  documentation-auditor. ~70% of the budget at hardening, performance, debt
  and coverage; feature ideas are recorded as findings only — never built
  under this strategy.
- No flag = balanced (matched-first ordering below). Name the strategy in the
  report header and record it in the snapshot's `strategy` field so the
  coverage table can show how each context has been swept.

**Coverage table (`--coverage`):** do NOT scan. Run
`node .claude/skills/scan-sweep/scripts/coverage.mjs` (append `--all` for
every context) and present its per-context table — lens coverage, findings vs
fixed, last strategy and age, least-covered first — the operator's pick list
for the next targeted sweep. Then stop.

Several sweep sessions may run in this repo at once, each owning a different
context — the parallel rules in step 6 are what make that safe.

## 1. Resolve scope

- The **final argument** is the context name. Read `context-map.json` at the
  project root, find the context, and stay inside its `filePaths`.
- **No context argument → pick the least lens-covered context yourself.** Read
  `context-map.json` and `.claude/scan-history/scan-sweep.jsonl` (if present).
  Choose, in this order: the first context in map order with NO snapshot at all;
  else the context whose snapshots' `lens_keys` union is SMALLEST (fewest lenses
  ever applied); tie → the one whose latest snapshot is oldest. State the choice
  and why in the report header ("never swept" / "lens coverage 4/22, oldest
  <date>") so coverage rotation is auditable.

## 2. Load shared awareness (do this BEFORE reading code)

- `.personas/backlog-digest.json` (if present) — the project's live backlog
  memory: pending / accepted / rejected idea titles. **Never re-propose
  anything on those lists, including rephrasings of rejected titles.** A
  rejected title is a durable human "no".
- `.claude/conventions.json` (if present) — the repo's hard gates. A finding
  that violates a declared gate is a defect you are about to introduce, not a
  finding.
- `.claude/scan-history/scan-sweep.jsonl` (if present) — prior sweep
  snapshots for the trend line.

## 3. Pick the lens package

- If `--lenses key1,key2,...` was passed, use exactly those keys.
- Otherwise the package is **ALL lenses in `references/lenses.md`**, ordered
  matched-first: lenses whose `Match` regex hits the context's name,
  description, keywords, tech stack, API surface, or file paths go first (they
  get the deepest attention); the remaining lenses follow as a lighter pass —
  most will honestly report "nothing real", and that clean verdict is itself
  coverage worth recording.
- If prior snapshots for this context already carry `lens_keys`, put the
  never-applied lenses first within each tier — the package's job is to close
  lens coverage, not re-walk the covered ones.
- List matched vs. remaining lens keys in the report header.

## 4. Survey, then judge

1. Read the context's files and collect evidence FIRST — form no verdicts while
   still reading.
2. Run any cheap deterministic check that applies (type-checker, linter,
   existing script) and reconcile; deterministic findings belong to those tools,
   not to this sweep — do not restate them as findings.
3. Then walk the lens package **sequentially**. Per lens: at most **3**
   findings, each grounded in `file:line` evidence. Zero findings is a valid
   and common result — say "nothing real" and move on. Prefer one deep finding
   over three shallow ones.
   **Yield expectation for a FULL package: around 20 findings** on a healthy
   in-band context (most from 5-8 lenses, the rest honestly clean). Under ~10
   usually means you stopped at the surface — dig again before declaring
   clean. **Risk naturally grows with repeat sweeps of the same context**:
   round 1 harvests the low-destruction layer; later rounds are EXPECTED to
   surface medium-risk items the first pass deferred. That is the design, not
   scope creep — the triage gate (step 5) is what keeps it safe.
4. **Budget: at most 30 findings per context, lifetime.** Before emitting,
   subtract what prior snapshots already reported for this scope (`findings`
   counts) and never re-emit a finding already reported in a prior run or
   present in the backlog digest. When the remaining budget is smaller than
   what you found, keep the highest-impact items and say what was cut.
5. **Value/destruction rubric — score both sides.** Value = user-visible or
   developer-measurable gain (impact). Destruction = risk of breaking working
   code PLUS churn (lines rewritten per unit of gain). Order all work
   value-first, destruction-last. Two hard rules learned from calibration:
   - **"Unused/dead" claims require proof**: a tech-debt finding that says
     dead/unused MUST cite its zero-consumer grep in the evidence. Verified
     dead-code removal is the best value/destruction class there is; guessed
     dead-code removal is the worst.
   - **Repo-declared incremental migrations** (i18n string extraction, design
     token adoption — whatever the repo's conventions call fix-as-you-touch)
     ARE in scope for the nearest lens in the files you already read, but only
     where no deterministic gate already tracks them, and never as a bulk
     migration.

## 5. Size classes — the routing decision

Classify every candidate finding:

- **S** — localized: one file, one mechanism (a rename, a guard, an attribute).
- **M** — a few files or one subsystem seam; a normal PR.
- **L** — structural / moonshot: architecture-grade work spanning modules
  (the kind an architect pass would propose: new layers, protocol redesigns,
  cross-cutting migrations).

Routing:

- **Resolve mode has a TRIAGE PHASE before the execution phase.** Split the
  queue by destruction:
  - **Low destruction** (risk ≤ 3 and not pure churn): auto-execute, no ask.
  - **Above-medium destruction** (risk ≥ 4), **pure churn** (refactors of
    working code with no user-visible or measurable gain), **value-uncertain
    product items** (instrumentation, speculative features — low risk but the
    operator owns the value judgment), and **L items**:
    STOP and triage with the operator in the terminal — one line per item
    (title, value, what could break), operator picks which proceed. Accepted
    items join the execution phase; declined ones are dropped or emitted as
    backlog findings per the operator's word. Unattended (Fleet/app
    dispatch, no operator): risk ≥ 4 and churn items are NEVER built — emit
    them as findings with honest scores so the app's backlog gates them; L
    items emit with `"size":"L"` and effort ≥ 8.
  - Execution runs only AFTER triage resolves, highest value first.
  Never build an L item in a sweep session.
- **Ideas-only mode:** everything routes to the outbox; same L triage rule.

## 6. Resolve mode — implement the S/M findings now

Work the accepted list highest-impact first, one finding at a time:

1. **One atomic commit per finding.** Fix, verify, commit, then start the
   next. Never stack two findings' edits in one working state.
2. **Verify before committing** with the repo's own gates for the surface you
   touched (`.claude/conventions.json` names them; else the obvious ones —
   type-check, lint, the module's tests). A fix that fails its gate is either
   repaired inline or fully reverted — never committed red, never left
   half-applied.
3. Commit message: `fix(<context>): <finding title>` plus a body line naming
   the lens — the finding's provenance survives in history.
4. **A fix that grows beyond its size class mid-flight gets demoted, not
   forced.** If an S fix starts touching a third file or a shared surface you
   did not anticipate, stop, revert the attempt, and emit it as a finding
   with the honest larger size.

**Parallel-session rules (several sweeps share this repo, one context each):**

- Edit ONLY inside your context's `filePaths`, plus their tests and any
  generated artifacts the repo's conventions REQUIRE you to regenerate for
  those edits. A needed change outside that boundary is not yours to make —
  emit it as a finding naming the foreign file instead.
- Stage with explicit pathspecs only (`git add <file> <file>`) and commit with
  explicit paths — never `git add -A`/`.`/`-u`, never `git stash`, never
  reset another session's work. Before each commit, confirm the staged list
  is exactly your files.
- Shared/generated surfaces other sessions also write (locale bundles,
  generated types, checksum manifests): make the edit and its regen, commit
  IMMEDIATELY, and keep that commit minimal — shared files must never sit
  uncommitted while you work on the next finding.

## 7. Report

Header first:

- `Method: full (context: <name>, lenses: <keys>)` — or
  `⚠️ DEGRADED: <what was skipped and why>` if you sampled, skipped a lens, or
  hit a limit. A degraded sweep reported as complete is worse than no sweep.

Resolve mode leads with what SHIPPED — one line per fixed finding
(`✔ <title> — <commit sha>`), then the unfixed findings; ideas-only mode
lists findings only. Per finding, a short section:
- **Title** — concise and actionable.
- **Finding** — what and why it matters, with `file:line` evidence.
- **Recommendation** — the concrete change (or the commit that made it).
- **Scores** — size S/M/L + effort / impact / risk, each 1–10.

End with a one-line summary (X fixed, Y proposed across M lenses).

## 8. Emit to the memory outbox

Append to `.personas/memory-outbox.jsonl` (create `.personas/` if needed),
ONE JSON object per line, nothing else on the line.

**A FIXED finding is a progress node, not a finding** — it must not land in
the backlog as open work:

```json
{"type":"node","kind":"progress","skill":"scan-<lens-key>","context":"<context name>","title":"Fixed: <finding title>","body":"<commit sha>; <one-line gist>"}
```

Each UNFIXED finding (everything, in ideas-only mode):

```json
{"type":"finding","skill":"scan-sweep","lens":"<lens-key>","context":"<context name>","title":"<finding title>","body":"<what + why + recommendation, condensed>","evidence":"<file:line — one-line proof>","size":"S|M|L","effort":3,"impact":7,"risk":2}
```

Escalation — emit at most one per lens, ONLY when that lens produced a
critical finding (impact ≥ 8) or 3 real findings in this context:

```json
{"type":"escalation","skill":"scan-sweep","lens":"<lens-key>","context":"<context name>","reason":"<≤120 chars: what the deep pass should chase>"}
```

Coverage — one node line per lens you actually evaluated (found something or
not), plus one for the sweep itself:

```json
{"type":"node","kind":"progress","skill":"scan-<lens-key>","context":"<context name>","title":"Sweep pass: <lens-key> over <context>","body":"<n> findings; <one-line gist or 'clean'>"}
{"type":"node","kind":"progress","skill":"scan-sweep","context":"<context name>","title":"Sweep of <context>","body":"<lenses evaluated>; <fixed> fixed, <open> proposed, <e> escalations"}
```

Keep the outbox lean — the ingest caps at 200 lines / 512 KB and accepts at
most 30 finding lines per pass; a full-package sweep emits ≤30 findings plus
one coverage node per evaluated lens (a clean lens still gets its node — that
IS the per-lens coverage record). The Personas app ingests and DELETES this
file when a Fleet session exits or the Skills Manager opens; findings land in
the project backlog deduped against everything already known.

## 9. Persist a snapshot

Append one line to `.claude/scan-history/scan-sweep.jsonl` (create the
directory if needed). `lens_keys` = every lens actually evaluated this run —
it is the per-context lens-coverage ledger the no-arg picker and the
package-ordering rule read. `findings` counts BOTH fixed and proposed (both
spend the 30-item budget):

```json
{"at":"<ISO-8601>","scope":"<context>","mode":"resolve|ideas","strategy":"develop|optimize|balanced","lens_keys":["<key>","<key>"],"lenses":<n>,"findings":<n>,"fixed":<n>,"escalations":<n>,"degraded":<true|false>,"note":"<≤80 chars>"}
```

If prior lines exist for the SAME scope, add a trend line to the report
("Trend for <context>: 12 → 7 → 9 findings"); otherwise say "first sweep of
this context, no trend yet".

<!-- Generated from scan_agents.toml by scripts/skills/scan-agents-to-skills.mjs.
     The retired single-lens scan-* skills have no successor file: a focused
     deep pass is `/scan-sweep --lenses <key> <context>`. -->

---

## Skill Reflection

After the run’s real work is done, reflect twice — autonomously, without asking the user. Be honest about volume: most runs produce NOTHING for lane 2. An empty reflection is a valid result; a forced lesson is pollution. Calibration: nothing (common) / one line (sometimes) / a lesson entry (occasionally) / a redesign proposal (rare).

Lane 1 — PROJECT learnings (what the next session in THIS repo needs): write via the MEMORY BLOCK contract if this prompt carries one, else append node lines to `.personas/memory-outbox.jsonl` per that contract. Project-specific insight only.

Lane 2 — METHOD learnings (what would improve THIS SKILL for every project):
1. If nothing generalizes beyond this repo, stop here.
2. Append an entry to `LESSONS.md` in this skill’s directory: `## <version-used> — <YYYY-MM-DD> — <project-name>` followed by `- ` bullets (create the file with a `# Lessons — <skill>` heading if absent). Record the version the run USED, not a bump target. Wrap a bullet in a `### Redesign proposal` sub-block when it argues for a methodic redesign you are NOT applying now.
3. Version bump — ONLY when you also edit SKILL.md to apply the improvement in the same change: minor (1.2 → 1.3) for a prompt/step refinement, major (1.x → 2.0) for a methodic redesign. Update the `version:` frontmatter field (add `version: 1.1` if the file had none — absent means 1.0). Never bump without an applied edit; never edit the method without a bump.
4. Sync ritual (only when you bumped): (a) commit the skill directory as a STANDALONE commit on the current branch — message `skill(<name>): v<new> — <one-line reason>` — containing nothing but this skill’s files; (b) copy the updated skill directory to `~/.claude/skills/<name>/` (overwrite) so sibling projects can adopt it. EXCEPTION: read `.personas/skill-registry.json` first — if the library already carries a HIGHER version than yours, do not overwrite it; keep your lesson in LESSONS.md and note the version conflict in the entry.

Sibling awareness: `.personas/skill-registry.json` (repo root, when present) lists this skill’s installed version, the workspace library version, and which sibling projects run it at which version with recent usage. Use it to judge whether a lesson is worth a bump (heavily-used siblings raise the bar for majors) and to notice you are BEHIND (library newer than yours → prefer recording the lesson over editing a stale method).
