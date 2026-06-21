---
name: tiger
description: Hunts the highest-value surface of an LLM-powered app — the LLM call sites themselves — and drives them to their potential across three lenses. (1) Code quality of the AI plumbing (wrapping/chokepoint, logging/telemetry, caching/dedupe, schema+validation+self-repair). (2) Business value, by reusing the UAT Character method (representative users with jobs-to-be-done + a senior-quality bar + time-saved) but TESTING ONLY THE LLM PIECES — does each prompt's grounding and output clear the bar. (3) Model optimization as an alternative scenario — benchmark the same character inputs across models × thinking levels to find quality degradation/upgrade vs cost/latency. Everything is memorized in a linked **Obsidian vault** (one note per call site / character / model / session) so each scan builds on the last. Stack-agnostic engine; per-app specifics live in the repo's `tiger/` overlay (which IS the vault). Invoke with `/tiger init|scan|run|benchmark|recall|backlog [args]`.
---

# Tiger — hunt the LLM value

> In an LLM-powered app the model calls are the apex surface: they cost the most, vary the most, and carry the most business value. Tiger stalks exactly those — ignores the CRUD around them — and never lets a high-value call site sit under-wrapped, under-grounded, or running an over-priced model. It is the LLM-focused sibling of `/uat` (`.claude/skills/uat.md`): it reuses UAT's Character/JTBD/senior-bar/time-saved/impact-scoring method, but scoped to the prompts and their outputs, and it adds two lenses UAT doesn't have (AI code-quality and model benchmarking).

## What Tiger is (and isn't)

**Is:** a periodic, deliberate pass that (a) builds a durable inventory of every LLM call site, (b) judges each on three lenses, and (c) emits one **session backlog** — the prioritized work to get the most out of the model engines. **Isn't:** a per-commit gate, a generic linter, or a test of non-AI code. If a finding isn't about a model call (or the plumbing/value/economics of one), it's out of scope — that's `/uat` or `/code-review`.

**Real model calls are the point** for lenses 2 and 3 — that's what catches what static reading can't (actual output quality, actual quality-vs-cost trade-off). So Tiger is **cost-aware**: it samples, caches in the vault, and never re-runs an identical (prompt, input, model) it already has a result for.

## The Obsidian vault — durable, linked memory

The `tiger/` overlay **is an Obsidian vault** (a folder of markdown with YAML frontmatter and `[[wikilinks]]`). It is the memory: each run reads the prior vault, diffs against it, and writes back, so scan N+1 follows scan N. Open it in Obsidian to navigate the graph (call sites ↔ characters ↔ models ↔ sessions).

```
tiger/
  Tiger.md                 # home / Map-of-Content: headline state + links to everything
  config.md                # THE per-app file (engine vs overlay): discovery globs, the
                           #   model-invocation recipe, fixtures, what counts as a call site
  call-sites/<id>.md       # one note per LLM call site (the inventory — the core asset)
  characters/<name>.md     # durable LLM-focused Characters (JTBD + senior-bar + criteria)
  models/<model>.md        # per-model×thinking benchmark rollups (quality/cost/latency)
  sessions/<date-slug>.md  # one note per run: scope, scores, backlog, deltas vs last run
  .gitignore               # ignore large/transient capture dirs if any
```

Every note carries frontmatter and links. The vault is **append-and-update**: call-site notes are long-lived (status/score/recommended-model evolve); session notes are immutable run records; the home note always reflects current truth.

### Note schemas

**Call site** (`call-sites/<id>.md`) — the unit of value:
```markdown
---
id: <stable-slug, e.g. ads | campaign-eval | creative-image-gen | patterns-embed>
type: tiger/call-site
modality: text | image | vision | embedding | audio
file: <path:line of the model call>
wrapper: <the chokepoint fn, e.g. generateStructured> | direct
provider: <claude|gemini|leonardo|…>  model: <current model>
schema: <yes/no + where>           grounding: <n/m sources that reach the prompt>
quality_score: <0–5 senior-bar>    code_score: <0–5 plumbing>
recommended_model: <from the last benchmark, or "—">
status: discovered | assessed | benchmarked | improved
last_scanned: <YYYY-MM-DD>
characters: ["[[char-a]]", "[[char-b]]"]
---
## What it does
<the job this call performs, in one line, + entry route/UI surface>
## Prompt & grounding
<system+user prompt summary; the REAL context that should feed it (user data, brand,
costs, competitors, history) and how many actually reach it → grounding n/m, cite file:line>
## Code quality (wrapping · logging · caching)
<chokepoint? typed schema + validate + normalize + self-repair? telemetry (cost/latency/
tokens/attempts)? cache/dedupe by input hash? rate-limit/quota? prompt bloat? — cite file:line>
## Findings
<impact-scored items across the 3 lenses; link [[session]] where raised>
```

**Character** (`characters/<name>.md`) — reuse UAT's, narrowed to outputs:
```markdown
---
name: <First role-tag>     type: tiger/character
maps_to: ["[[call-site]]", …]   # the LLM surfaces this Character exercises
references: [<url> — bar it sets]
---
## Who they are / Background / Voice  (per the UAT template — authentic texture)
## Jobs to be done  (what they hire the MODEL OUTPUT for)
## Senior-quality bar  (the floor: output ≥ what they'd write as a senior in role)
## Time-saved (motivation)  (LLM-less minutes → with-app minutes, as a NUMBER)
## Scored acceptance criteria (judged identically every run, applied to the OUTPUT)
- [ ] grounded in MY real context (names the supplied entity/data, no placeholders)
- [ ] senior-grade (specific, correct, not generic)
- [ ] worth the latency/cost
```

**Model** (`models/<model>.md`): per call-site rows of `{quality, costUsd, latencyMs, verdict}` at each thinking level, + the headline recommendation.

**Session** (`sessions/<date>.md`): scope, the inventory delta, per-lens findings, the impact-ranked backlog, the model-opt recommendations, and the **value ledger** (grounding + time-saved rolled up; what the engine *promises* vs *delivers*).

---

## The three lenses

### Lens 1 — Code quality of the AI plumbing (static, code-grounded)
For each call site, follow the import chain to the actual call and score, citing `file:line`:
- **Wrapping / chokepoint:** is every call funnelled through one provider-switching wrapper (so retries, fallback, cost-stamping, telemetry live in one place), or are SDKs/`fetch` scattered? Typed JSON **schema** + **normalize** + **validate** + **self-repair** re-prompt? One tagged call per tool?
- **Logging / telemetry:** is each call recorded (model, tokens, costUSD, latency, attempts, repaired, demo)? Is there an eval/golden harness fingerprinting prompt+schema so drift surfaces? Are failures observable?
- **Caching / efficiency:** is an identical (prompt, input) **cached / deduped** (input-hash), or recomputed every time? Rate-limited + quota'd? Is the prompt **bloated** (unbounded context, whole records where a digest would do)? Is `temperature`/`maxTokens` sensible? Is grounding text built once and reused?
- Emit code-quality findings + concrete fixes (add cache, add telemetry field, tighten schema, dedupe).

### Lens 2 — Business value (UAT Character method, scoped to the output)
Reuse `/uat`'s engine but point it only at the prompts/outputs:
1. **Characters** (durable in the vault) — a variety of representative users, each `maps_to` the call sites their JTBD hits. Ground them in the app's real target group (don't reuse a generic roster; see UAT init).
2. **L1 (theoretical, mass-parallel):** per `character × call-site`, read the prompt + grounding and judge the *designed* output against the Character's senior-bar + scored criteria + time-saved. Score **grounding n/m** (how much of the user's real world reaches the prompt) — this is Tiger's highest-yield finding type, fully visible in code.
3. **L2 (empirical, optional but ideal):** actually **run the call** with character-shaped inputs and judge the live output (grounded path: assert the output names the supplied real entity / reflects the brand/data, not placeholders). One confirmed live finding beats ten theoretical ones.
- Emit business-value findings (grounding gaps, senior-bar misses, "slower than doing it by hand") + suggested fixes.

### Lens 3 — Model optimization (the alternative scenario)
The characters are the **consistent judgment harness** that makes cross-model comparison fair. For the selected call sites:
1. Hold the prompt + character input fixed; **run it across a model matrix** — models × thinking/effort levels (per `config.md`'s invocation recipe).
2. Have the **same Character criteria** judge each output (blind to which model) → a quality score per cell; record **cost + latency** per cell.
3. Find the frontier: the cheapest/fastest cell that still clears the senior-bar (a **downgrade** opportunity — money saved at equal quality) and any call site where a **stronger** model/thinking meaningfully lifts business quality (an **upgrade** worth the spend). Watch for **degradation** (a model that silently drops grounding or hallucinates).
- Emit a per-call-site model recommendation: `keep | downgrade to X | upgrade to Y` with the quality/cost/latency evidence, written to `models/*` and the call-site note's `recommended_model`.

> Quality is judged by Characters, never by the model under test grading itself. Use a separate judge (a third model or the orchestrator) and prefer adversarial/majority judging for close calls, exactly as UAT does.

---

## Modes

- **`init`** — scaffold the `tiger/` vault + `config.md`; run the first **inventory scan** (discover every call site → `call-sites/*`); derive the app's target group and **ask how many Characters (1/5/10)**; draft Characters; write `Tiger.md`. No lens runs yet. (Mirrors `/uat init`; if `/uat` already exists, offer to adapt its Characters.)
- **`scan`** — re-inventory, **diff against the vault**: new / removed / changed call sites (prompt or schema drift vs the recorded fingerprint), update notes, flag regressions. Cheap; run often.
- **`run [--lens code|value|model|all] [--chars N] [--live]`** — the full pass. Default `--lens all`, L1 only; `--live` adds Lens-2 real generations and Lens-3 benchmark on the selected/highest-value call sites. **Mass-parallel:** one subagent per `call-site` (Lens 1) and per `character × call-site` (Lens 2). Writes a `sessions/<date>` note + refreshes call-site notes + the backlog.
- **`benchmark <call-site> [--models …] [--thinking …]`** — Lens 3 only, deep, for one call site.
- **`recall`** — read the vault and summarize current state (top call sites by value, open backlog, last session, model recommendations) without re-scanning.
- **`backlog`** — (re)emit the impact-ranked backlog from current findings across all three lenses.

## The session backlog (the deliverable)

One impact-ranked list (frequency × reachability × value, not raw severity — same scoring as UAT), each item tagged by lens and linking its `[[call-site]]`:
- **code** — wrapping/logging/caching fix (e.g. "dedupe identical campaign-eval calls — input-hash cache; saves N calls/run").
- **value** — grounding/quality fix (e.g. "feed competitor data into the SEO prompt — grounding 1/5 → 4/5").
- **model** — model/thinking swap (e.g. "ads → Haiku@low: equal senior-bar, −80% cost, −40% latency"; "lead-reply → keep Sonnet, Haiku drops empathy").
Plus a **value ledger** (grounding & time-saved rolled up; promised vs delivered) and the **strengths to protect**. The chat reply is the headline + sharpest findings, linking `file:line` and vault notes.

## Concurrency & trust
- **Mass-parallel** Lens 1 + Lens 2-L1 (no I/O to serialize — one subagent per unit). Lens 2-L2 and Lens 3 make real calls → serial-ish and **cost-bounded** (sample call sites; cache every result in `models/*` keyed by (call-site, model, thinking, input-hash) so re-runs are free).
- **Evidence or it didn't happen:** every finding cites `file:line` (static) or a captured output/metric (live).
- **Adversarial judging** for value + model verdicts; default to "not better" unless the output earns it.
- **Honest ceilings:** name what still isn't grounded/optimized after a fix (e.g. "cheaper model holds for the generic path; the grounded path still needs Sonnet").
- **Vault hygiene:** call-site `id`s are stable across runs; never duplicate a note — update it. Record the model/prompt **fingerprint** so `scan` can detect drift.
- **Vault-write verification (learned 2026-06-20):** a discovery/scan subagent may be unable to write files in some harnesses and will return the note bodies inline instead. After any parallel scan, the orchestrator MUST `ls` the target dir, diff against the expected `id` set, and **backfill** any missing notes from the agents' returned content — don't trust "wrote N notes" without checking.
- **Lens-3 recipe that works:** dispatching one subagent per matrix cell with the Agent tool's `model`/`effort` params, fed the tool's *real* system prompt + a fixed character input, returns clean schema JSON and a usable latency proxy (subagent wall-clock) — no external API keys needed. Judge the cells with a separate model, never the one under test.

## Using Tiger on a new app
1. Drop `/tiger` into the repo (`.claude/skills/tiger.md`). 2. `/tiger init` → discovers call sites, writes `config.md` (discovery globs + how to invoke each model tier + fixtures), asks Character count, scaffolds the vault. 3. Resolve `config.md` open questions (esp. the model-invocation recipe for Lens 3). 4. `/tiger run` for a cheap broad pass; `/tiger run --live` for real generation + benchmark. 5. Work the backlog; re-`scan`/`run` to measure the delta in the vault.
