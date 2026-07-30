---
name: perfect
description: Session-after-session product perfection loop. The strongest available model (Fable) directs — it walks the repo's context map context-by-context, proposes challenged, high-value directions per context (features, design elevations, significant optimizations), gates each round's slate with the user, then orchestrates one Opus builder subagent per context in isolated worktrees while making every review/merge decision itself. All state lives in a linked Obsidian vault so any future session resumes the loop exactly where the last one stopped. Invoke with `/perfect [init|propose|build|status|reflect] [context-name]`.
---

# Perfect — the direction-and-delivery loop (kp edition)

> One model is best at *judgment* — seeing what would make a product excellent, challenging its own ideas, reviewing diffs ruthlessly. Cheaper strong models are great at *execution* inside a well-scoped brief. `/perfect` wires the two together in a permanent loop: **Fable directs, Opus builds, the vault remembers.** Each session moves the product measurably closer to the best UX, architecture, and feature quality it can have; no session ever starts from zero.

## Roles — Director and Builders

- **Director (the main session — Fable, or the strongest model available).** Owns everything that is judgment: opportunity-scoring contexts, drafting directions, adversarially challenging them before the user ever sees them, running the acceptance gate, writing builder briefs, answering builders' product questions mid-flight, reviewing every diff, deciding merge/redo/drop, running the repo gates, committing, and writing the vault. The Director **never delegates a decision** to a builder and never rubber-stamps a builder's diff.
- **Builders (Opus subagents, `model: "opus"`, one per context).** Each receives a tight brief (direction specs + acceptance criteria + the context's `filePaths` scope + repo-convention digest) and implements in its **own worktree**. Builders return a structured report; when they hit a genuine product ambiguity they **return the question instead of guessing** — the Director answers via `SendMessage` and the builder continues.
- **Scouts (Explore subagents, cheap).** Produce the per-context current-state brief the Director synthesizes directions from. Never used for judgment.

## The Obsidian vault — durable loop state

Resolve the vault root (first hit wins), then use `$VAULT/Perfect/`:

```bash
for v in "C:/Users/kazda/Documents/Obsidian/kp"; do
  [ -d "$v" ] && VAULT="$v" && break
done
# First run: create C:/Users/kazda/Documents/Obsidian/kp (the user keeps per-project vaults there).
# Portable fallback: if the Obsidian folder doesn't exist at all, use <repo>/.perfect/ (same schema — still an Obsidian-openable folder).
```

```
Perfect/
  Perfect.md               # HOME / Map-of-Content — always reflects current truth:
                           #   mission, the scored context QUEUE with the CURSOR,
                           #   the ACCEPTED POOL (current round's slate; hard cap 10),
                           #   shipped ledger headline, link to last session
  config.md                # per-repo overlay: gates to run, worktree recipe, wave size,
                           #   direction sizing rules, cooldown, + ## User taste + ## Skill improvement log
  contexts/<name>.md       # one per context-map context (long-lived, updated in place)
  directions/<slug>.md     # one per direction (long-lived; the atom of the whole loop)
  sessions/<YYYY-MM-DD[-n]>.md  # immutable run records, each ends with a `next:` pointer
```

**Context note** (`contexts/<name>.md`):
```markdown
---
name: <context-map name>        type: perfect/context
group: <group>                  category: ui|api|lib|data|config
opportunity: <0-10>             # value reach × headroom × strategic fit (Director's judgment)
last_proposed: <YYYY-MM-DD|never>   cooldown_until: <date|—>
directions: ["[[<slug>]]", …]
---
## Current state   (scout brief digest + file:line evidence — refreshed each proposal pass)
## Direction history   (proposed / accepted / REJECTED-and-why — rejections are memory too)
## Shipped   (direction → commit SHA → observed effect)
```

**Direction note** (`directions/<slug>.md`):
```markdown
---
slug: <kebab, stable>           type: perfect/direction
context: "[[<context-name>]]"   lens: feature|ux|optimization|robustness|wildcard
status: proposed | accepted | building | shipped | failed | dropped | rejected
size: S|M|L                     # must fit ONE builder session (≲15 files, no cross-context schema break)
proposed: <date>  accepted: <date|—>  shipped: <date|—>  commit: <sha|—>
---
## What & why   (the user value, one paragraph, no fluff)
## Evidence   (file:line of the gap/opportunity in today's code)
## Acceptance criteria   (3-6 checkable bullets — the builder's contract AND the review checklist)
## Risks / non-goals
## Build record   (builder report digest, review verdict, gate results — filled during build)
```

**Session note**: phases run, contexts covered, accept/reject tallies, build outcomes with SHAs, deltas, and **`next: <the exact resumption instruction for the following session>`**.

Vault hygiene: slugs are stable; **update notes, never duplicate**. Subagents may fail to write files in some harnesses — after any parallel phase the Director MUST `ls` the target dir and **backfill missing notes from the agents' returned content** before trusting "written".

## The loop — a vault-driven state machine

Every invocation starts the same way; the vault decides which phase runs.

### Phase 0 — Recall & register
1. Read `Perfect.md` (+ last session's `next:` pointer). If missing → run **init** (below).
2. Read `context-map.json`; diff against `contexts/*` — new contexts get notes + a queue slot, removed ones get archived (`status: retired` in frontmatter).
3. Repo rituals: make sure you're working from `main` (builds fork from and merge to `main` — if the session starts on a stray branch, note it and base worktrees on `main`). Scan MEMORY.md signals that veto directions (e.g. features already planned elsewhere, "removed — don't re-suggest" notes, the industry-locked finding).
4. Announce the resumption point in one sentence, then go where the state machine points: no gated slate pending → **Propose**; a gated slate awaits (or user said `build`) → **Build**. The unit of work is the **round**: propose for 1–3 contexts, gate, build that slate immediately (the owner can say "hold" at the wave-plan gate). The pool never accumulates past 10 (hard cap), but at steady state a round's slate ships the same session it was gated.

### Init (first run only)
1. Scaffold the vault tree + `config.md` (record: gates = `npm run typecheck`, `npm run test:unit`, `npm run lint`, plus `npm run i18n:check` when `messages/*.json` or user-facing strings are touched and `npm run test:python` when `pipeline/` is touched; wave size = 3; cooldown = 2 rounds).
2. Score every context 0-10 for **opportunity** = user-facing reach × headroom (distance from "perfect", judged from context-map metadata, `docs/*`, and memory) × strategic fit (active arcs in memory — e.g. V2 matching platform, enterprise readiness, multi-market unlock). Write the ranked **queue** into `Perfect.md` with the cursor at the top. Don't deep-read code yet — scoring is refined per-context at proposal time.
3. Write session note; proceed straight into Propose.

### Phase P — Propose (context by context, until the round's slate is gated)
Pick 1–3 contexts for the round (thin is fine); loop over them unless the user says stop:

1. **Cursor** = highest-opportunity context not on cooldown; **at equal opportunity, prefer the least-recently-slated context, and a never-slated context outranks any re-visit** (fresh contexts keep yielding full slates while twice-visited ones go thin). **Prefetch**: before presenting context *k*, launch the scout for context *k+1* in the background — one ahead, never two (staleness risk).
2. **Scout** (Explore, "very thorough", read-only): given the context's `filePaths`, `apiRoutes`, description → return a current-state brief: what exists, what's rough, dead ends, UX seams, perf smells, with `file:line` evidence.
   **2b. Delta re-scout (contexts with prior ships).** Brief the scout to (a) verify the prior rounds' ships still cohere AND delivered their downstream payoff — "did it work", not just "did it merge" (this is how a fully-dead board facet's revival was confirmed); (b) re-verify parked follow-ups against today's code (they drift); (c) walk the user's daily loop for honest residuals. State explicitly that **"near-polished, N small residuals" is a perfectly good verdict** — this phrasing reliably produces zero manufactured findings.
3. **Draft up to 5 directions** — the count is what the evidence honestly supports, **never pad** (thin slates of 1–3 keep winning at the gate; a near-polished context may honestly yield one bugfix). Lens spread as a starting point: **feature** (new user value), **ux** (design/flow elevation), **optimization** (perf/cost/significant simplification), **robustness** (failure modes, observability, architecture), **wildcard** (the non-obvious idea a great PM would pitch). Each sized to ONE builder session; a bigger vision ships as its phase-1 slice.
   **Weight the slate by `config.md → ## User taste`** — the lens spread is a starting point, not a quota. Default depth is the *engine*, not the chrome: for any context with backend/algorithmic substance, most directions should be architecture-level (data model, algorithms, lifecycle, prompt/scoring paths, cost structure); UI surfacing appears at most once-twice unless the user steers otherwise. Scout prompts must match this depth (trace the full pipeline, not just the components).
4. **Challenge before presenting** (the Director argues against itself; a direction that fails any check is replaced, not presented):
   - Does it already exist in code? (scout evidence, not assumption)
   - Was it already proposed/rejected/shipped? (check `contexts/<name>.md` history + memory + the Vibeman ideas backlog — many `backlog:idea-*` skills exist; don't re-pitch one verbatim)
   - Does it conflict with an active arc or a "removed, don't re-suggest" memory?
   - Is the value claim concrete — can I name the user moment it improves?
   - Can one Opus session genuinely ship it behind the acceptance criteria?
   - **Data-path rule** (two premise failures + a three-round projection blind spot earned this): any "surface X gains signal Y from Z" direction requires the scout to have verified the payload actually carries Y at **EVERY read site that should show it** — list projection, detail/drawer, route — not just Y's existence at the write path or one primary reader. A parity claim without a verified data path is not presentable.
5. **Present** the slate in chat — numbered, each: title · lens · size · one-paragraph why · evidence · acceptance criteria. Then gate with **AskUserQuestion (multiSelect)** — the tool caps options at 4 per question AND requires ≥2 options per question, so: ≤4 directions fit one question; 5 split as Q1 = 1–3, Q2 = 4–5; a single-direction slate needs a second option (a rider or an explicit "skip") to be valid (labels = `N · short title`, description = one-line value claim + size). The user can annotate via "Other" (e.g. `edit 2: …`, `stop`); selecting nothing in both = none accepted.
6. Record outcomes in the vault (rejected ones too, with the user's implied reason — rejections steer future proposals). Accepted → `directions/<slug>.md` with `status: accepted`, pool counter++, context gets `cooldown_until`. Update `Perfect.md` after every context, not at session end — a killed session must lose nothing.
7. **A `none` gate that carries a steer** (the user says what they wanted instead) is a re-scout order, not a rejection of the context: promote the steer to `config.md → ## User taste` if it generalizes, re-scout at the steered depth/angle, and re-propose the SAME context once before advancing the cursor. Never re-present any rejected direction.

### Phase B — Build (one Opus builder per context, Fable decides everything)
1. **Wave plan**: group the pool's accepted directions by context → one builder per context, ≤ `config.wave_size` (default 3) concurrent, and **≤ 3 directions per builder brief** (a 4-direction brief exceeded one agent-session budget — split a bigger context into two sequential builders). Present the wave plan in one screen; on user go (or when invoked as `/perfect build`), execute.
   **Coordination rules (these bought five consecutive zero-integration-fix rounds — keep them in every wave):** (a) when two same-wave directions consume the SAME wire/payload format, name the **format owner** in both briefs — the other builder consumes a frozen interface; (b) when two directions touch the same file in the SAME region, **sequence** — fork the dependent builder's worktree only after the dependency merges; different regions of a shared file may run parallel and resolve at merge.
2. **Worktree per builder** — prepared by the Director, NOT via Agent-tool isolation (those worktrees lack `node_modules`):
   ```bash
   git worktree add .claude/worktrees/perfect-<ctx> -b worktree-perfect-<ctx> main
   cmd //c mklink //J ".claude\\worktrees\\perfect-<ctx>\\node_modules" "..\\..\\..\\node_modules"   # junction, NOT copy
   # Python (pipeline/) needs no per-worktree install; run python gates from the worktree root.
   ```
3. **Brief** each builder (see template below); launch with `model: "opus"`, `subagent_type: "general-purpose"`, all briefs in one message so they run concurrently.
4. **Mid-flight decisions**: a builder returning `DECISION NEEDED: …` gets an answer from the Director via `SendMessage` — product calls, trade-offs, and scope cuts are Fable's alone. A builder that stops without its final report gets one `SendMessage` nudge.
   **Builder-death recovery (session limits WILL kill builders):** the instant a builder dies, `git add -A && git commit --no-verify` a `wip(…)` snapshot **inside its worktree** (isolated tree — add-all is safe there; never-lose-work beats commit hygiene). Then the Director either finishes the work inline (review the WIP diff, complete gaps, split into per-direction commits along file boundaries — same-file hunks may share a commit if the message says so) or re-briefs a fresh builder after the limit resets with "continue from the WIP commit".
5. **Review — the Director earns its title here.** Per builder branch: `git diff main...worktree-perfect-<ctx>` and review against each direction's acceptance criteria, repo conventions (dual-theme tokens, `recipes.ts` surfaces, shared primitives in `app/_components/`, next-intl keys across ALL locale files, context-map scoping), and taste. Verdict per direction: **merge** / **redo with notes** (SendMessage, builder fixes in place) / **drop** (`status: failed`, reason recorded). Never merge on "tests pass" alone — read the diff.
   **Docs-vs-code check:** when a diff documents a behavior (contract text, formula, doc comment), grep for the code that implements it before merging — a contract describing behavior the code doesn't have is worse than nothing.
   **Both-themes check:** any UI diff must hold in Studio Light AND Spark Dark — look for hardcoded colors outside `app/landing/`, missing `dark:` handling in new recipe usage; a diff that only works in one theme is a redo, not a merge.
6. **Merge serially**: per direction, `git merge --squash` (or cherry-pick) → ONE atomic commit on `main`, message `feat(<context>): <direction title>` + `Co-Authored-By` footer. Stage per-file, verify `git diff --cached --stat` matches intent (foreign pre-staged files → `git restore --staged` them). Run the config gates on `main` after each merge; a red gate is fixed inline before the next merge.
   **Concurrent-session locale conflicts:** when another session moves `messages/*.json` under a pending pick, don't hand-merge JSON — re-apply the branch's key **adds/removes** programmatically over the current files (flatten base vs branch per locale, set/delete on current, write), then run `npm run i18n:check` before continuing.
   **Concurrent-session DIRTY files blocking a pick:** never stash, never wait — commit around them. (a) Dirty locale file: stage `HEAD + your keys` directly into the index (`git hash-object -w` + `git update-index --cacheinfo`), and write `their-working-copy + your keys` to disk — their uncommitted work stays theirs. (b) Dirty source file: same index trick, content built by `git merge-file` (base=branch-fork, ours=HEAD, theirs=branch), plus a second merge-file for the working copy. (c) **Shared append-files** (generated schemas from `schemas:gen`, barrel exports, generated i18n artifacts): NEVER wholesale-`checkout` a branch's version across sequential picks — patch-union (`git diff branch~..branch -- file | git apply --3way`) or regenerate from source, always.
6b. **Cross-builder integration gate:** parallel builders each verify against the `main` they forked from — their work can be mutually incompatible (one retired a type-union member another targeted; one restructured a component another wrote tests against). After ALL of a wave's picks land, run `npm run typecheck` + the union of the wave's test suites on `main` BEFORE wrap; treat failures as Director-fixed integration commits, not builder redos. When two builders share a direction dependency, fork the dependent builder's worktree AFTER the dependency merges (sequenced builder).
7. **Doc-sync in the same turn**: user-visible changes update the mapped doc under `docs/` when one exists for that feature area.
8. **Cleanup**: per worktree — `cmd //c rmdir` the node_modules **junction FIRST**, then `git worktree remove`, then delete the branch once its commits are on `main`.

### Phase V — Visual pass (every ~3 rounds, before proposing)
Shipped client UI must eventually be SEEN. Every ~3 rounds, before the next propose, drive the accumulated UI changes in the browser — both themes, at least one non-en locale. **Kill and recreate tabs between route hops** (rapid mid-hydration navigations can wedge a Chrome tab; a wedged tab once produced a false P0). **Plan B when the browser is unavailable:** the SSR smoke pass — `curl` the touched routes (with `-H "Cookie: NEXT_LOCALE=cs"` for locale checks) and grep for the new surface's markers — is a sanctioned substitute for the server-rendered half; the INTERACTIVE half stays owed and is tracked in the `Perfect.md` cursor until a browser session clears it. The dev port is volatile — probe candidate ports for a `<title>` starting "KP" rather than assuming.

### Phase W — Wrap (every session, even interrupted ones)
1. Update every touched vault note; write the session note with the **`next:` pointer** (e.g. `next: propose — cursor at pipeline-simulation, pool 7/10` or `next: build wave 2 — <ctx-a> + <ctx-b> remain`).
2. `Perfect.md` headline refreshed: pool count, queue cursor, shipped-total, last-session link.
3. **Reflect on the skill itself**: 2-4 bullets in `config.md → ## Skill improvement log` — what dragged, what the user overrode, what the next round should change. This log is the input for the between-rounds skill revision.

## Direction quality bar (what earns a slot in the 5)

- **Value-first**: names the user moment it improves; "nice refactor" is not a direction unless it unlocks something.
- **Evidence-backed**: cites today's code (`file:line`), not vibes.
- **One-session-shippable**: ≲15 files, no cross-context schema breaks; else slice it.
- **Novel to the vault**: not shipped, not pending, not previously rejected (unless the world changed — say so).
- **Lens-diverse**: default one per lens; substituting a second entry in one lens requires the Director to say why.
- **Bugfixes stand alone**: a live defect is NEVER bundled into an enhancement direction — a rejection of the enhancement would strand the defect. Present the fix as its own (usually S) direction; standalone re-presentation of a previously-bundled fix has been accepted instantly, twice.

## Builder brief template

```
You are an Opus builder for the `<context>` context of kp, an AI-assisted hiring
platform (Next.js 16.3 canary with Cache Components + React 19 + TS + Tailwind 4 +
better-sqlite3 + next-intl; Python pipeline/ for LLM scoring).
Work ONLY in this worktree: <abs path>. Your scope is this context's files:
<filePaths from context-map.json>. Touching other contexts requires DECISION NEEDED.

Implement these accepted directions, one atomic commit each, message `feat(<context>): <title>`:
<per direction: What & why · Acceptance criteria · Evidence file:line · Risks/non-goals>

COMMIT EACH DIRECTION THE MOMENT IT IS DONE AND VERIFIED — never batch commits
for the end of the session. An interrupted session must lose at most the
direction in progress, not everything.

FOREGROUND ONLY: run every compile/test as a blocking foreground command and
wait for it — NEVER spawn a background run and "wait for the notification"
(you will idle forever and the Director has to nudge you). If a command is
expected to take >10 minutes, poll it in a foreground loop instead.

NEVER run `next dev` in this worktree — Turbopack rejects the node_modules
junction. Verify at lib/test level and report what needs a live check.

If you restructure or move a file, grep for source-guard tests asserting its
literals/paths and update them IN the same commit.

SEARCH BEFORE BUILDING: before implementing any new mechanism, grep for an
existing implementation of the same concept and LAYER ON it rather than
forking a parallel system.

Repo law (non-negotiable):
- This is NOT the Next.js you know: it's 16.3 canary with cacheComponents +
  partialPrefetching. Read the relevant guide in node_modules/next/dist/docs/
  before writing Next-specific code; `runtime`/`dynamic` route configs are banned.
- Read docs/design/README.md before any UI. The app ships TWO themes (Studio Light +
  Spark Dark) from one codebase: never hardcode colors outside app/landing/;
  use brand tokens (ink, paper, steel, coral, moss, limewash, dial-*, score-*)
  and theme-mapped neutrals; compose surfaces from app/_components/ui/recipes.ts
  (PANEL, CHIP, BTN_*, EYEBROW, FIELD…); reuse primitives in app/_components/
  (Modal, Badge, SegmentedControl, Skeleton) — never hand-roll them. Verify new
  surfaces in BOTH themes before claiming done.
- Every user-facing string goes through next-intl: add the key to messages/en.json
  AND every other messages/*.json locale; `npm run i18n:check` must pass.
- Respect context-map.json scoping; read it before editing.
- Verify before claiming done: `npm run typecheck`, `npm run test:unit` (targeted
  where possible), `npm run lint`, `npm run i18n:check` if strings touched,
  `npm run test:python` if pipeline/ touched; report what you COULD NOT
  verify honestly. (The kp dev port is volatile — :3000 is Vibeman, kp lands
  elsewhere; only the Director drives live flows, from the main checkout.)

If a product decision is ambiguous, STOP that direction and return `DECISION NEEDED: <question>`
with your recommendation — never guess. Final report format:
per direction → status (done|blocked|decision-needed), commits, files, verification evidence, open risks.
```

## Modes

- **`/perfect`** — resume the loop wherever the vault says it stopped (the default; covers init on first run).
- **`/perfect propose [context]`** — force a proposal pass (optionally jump the cursor to a named context).
- **`/perfect build`** — build now with whatever the pool holds (the per-round norm; the pool rarely holds more than one round's slate).
- **`/perfect status`** — read-only: queue, cursor, pool, in-flight builds, shipped ledger, last session. No agents.
- **`/perfect reflect`** — read `config.md → Skill improvement log` + last sessions and propose concrete edits to THIS skill file.

## Guardrails

- **Never stash, never `git add -A` on the main tree** — per-file staging, staged-count check before every commit; other sessions' work is sacred. (Inside a builder's isolated worktree, add-all WIP snapshots are allowed for death recovery.)
- **Cost discipline**: scouts are Explore-tier; Opus is spent only on accepted work; the Director never re-runs a scout whose brief is < 1 round old (it's in the context note).
- **Honest ledger**: a direction only reaches `shipped` with gates green AND the Director having read the diff; anything else is `failed` with a reason. No silent drops — every accepted direction's fate is recorded.
- **Interruptibility is a feature**: write the vault incrementally (after every context in P, after every merge in B) so a killed session resumes losslessly.
- **The user is the product owner**: the gate is theirs; the Director challenges but never overrides a rejection, and repeated rejections of a lens/context recalibrate the queue scores.
