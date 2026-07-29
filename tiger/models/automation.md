---
type: tiger/model-benchmark
call_site: "[[automation]]"
date: 2026-07-16
lens: 3 (model optimization)
recipe: B (keyless subagent matrix)
engine_constraint: Claude-only (user directive); judge = Fable 5 (English screen judge + native-Czech prose judge)
production_model: claude_cli / haiku-class (one tier for the whole use_case)
subtasks_benchmarked: screen (routing verdict) · outreach (CZ) · rejection (CZ)
recommendation: KEEP haiku for screen (verdict-stable, routing-safe). For CZ candidate-facing prose a bigger model does NOT help — sonnet VIOLATED the gender-neutral rule; keep deterministic templates as the safe floor + add a neutrality/vocative post-check.
---

# Lens 3 — [[automation]] model matrix (2026-07-16)

3 decision-critical subtasks × 3 Claude cells = 9. Inputs: a **borderline** screen case
(medior, match 58, 2 missing must-haves — where advance/hold/reject genuinely depends on
the model) and **Czech** outreach + rejection (to stress the `_NEUTRAL_STYLE` gender-neutral
rules — the known language gap). Blind Fable judges: English for screen, **native-Czech**
for prose with the linguistic rules as ground truth.

## screen (routing-critical verdict) → **KEEP haiku. Downgrade-safe.**
| cell | verdict | confidence | overall /10 |
|---|---|---|---|
| haiku × low | **hold** | 68 | 8 |
| sonnet × high | **hold** | 68 | 9 |
| opus × low | **hold** | 72 | 9 |

**All three routed to `hold` with near-identical confidence (68/68/72)** — the verdict is
stable across the whole tier range. Judge: *"a haiku-class model is safe for this routing
decision; the failure mode that matters (advance/reject on unconfirmed gaps) did not appear
in any cell."* Spread is small and lives only in rationale depth (opus/sonnet argue the
SQL→PostgreSQL adjacency best; haiku padded its redFlags with a nice-to-have + a score
restatement). **No upgrade justified** — mirrors [[match-reasoning]]. The code-side fairness
gate already backstops the verdict regardless of tier.

## outreach + rejection (Czech candidate-facing prose) → a bigger model is NOT the answer
| task | haiku × low | sonnet × high | opus × low |
|---|---|---|---|
| outreach | 6 (rule-clean, but vocative "**Pane Novák**" wrong) | **4 — VIOLATED**: "podílel(a)" | 8 (best; one masc. participle) |
| rejection | 5 (participle-free/neutral, but salutation "**Jan Nováku**" wrong) | **3 — VIOLATED**: "věnoval/a" + "prokázal/a" + a number error | 8 (best; two masc. participles) |

**The headline: sonnet-high was the WORST cell in BOTH prose tasks** — it repeatedly emitted
the exact slashed dual-gender forms (`podílel(a)`, `věnoval/a`, `prokázal/a`) that
`_NEUTRAL_STYLE` (`automation.py:195`) bans by name. The bigger model was actively *worse* on
the one rule that carries fairness/compliance weight. And **no tier was fully clean**: opus
avoided slashed forms only by defaulting to masculine participles (defensible for a known-male
name, not strictly neutral); the one truly participle-neutral draft (haiku's rejection)
botched the vocative. Czech correctness and neutrality-rule compliance failed *independently*.

### What this means (reinforces the backlog, doesn't add a model swap)
1. **The deterministic templates are the safer floor.** The hand-written CZ templates
   (`automation.py:425-438,468-482`) are grammatically correct and neutral by construction —
   safer than any LLM cell here. This makes [[automation]] **finding #1** (the tailored LLM
   rejection draft is generated but never sent — the deterministic template goes instead)
   look less like a bug and more like the **right default**: the resolution leans toward
   *"drop/keep-template"* over *"wire the LLM draft through"*, because the LLM draft carries
   neutrality + vocative risk the template doesn't.
2. **If LLM drafts are used, the lever is a post-check, not a model tier:** reject any output
   containing a slashed-gender form (`\w+\(a\)`, `\w+/a`) and validate the vocative — cheap,
   model-independent, and catches exactly what sonnet got wrong. Reinforces finding #2
   (thread `lang` + the neutrality rule properly).

## Recommendation summary
- **screen → keep haiku** (verdict-stable, routing-safe; no upgrade).
- **outreach/rejection → keep the deterministic templates as the safe default**; do NOT
  upgrade the model to "improve" prose (sonnet regressed on neutrality). Add a slashed-gender
  + vocative post-check to any LLM-drafted candidate message.

## Honest ceilings
- n=1 input per subtask; one candidate name/gender. A female or gender-unknown name would
  stress neutrality differently (masculine-participle dodge would then be wrong too).
- Latency proxies unusable (opus outreach 64s, haiku rejection 98s — scaffolding noise).
- prep/scorecard/offer not benchmarked (prep already threads lang correctly; offer's number
  is code-derived; scorecard is transcript-bound — lower model-choice sensitivity).
