---
type: tiger/model-benchmark
call_site: "[[github-analysis]]"
date: 2026-07-16
lens: 3 (model optimization — portability read)
recipe: B (keyless subagent matrix)
engine_constraint: Claude-only (user directive); judge = Fable 5
production_model: gemini-3-flash-preview (TS-direct SDK — a wrapper bypass, finding #7)
inputs: 1 fixed input — a Java/Spring/Kafka/Postgres benchmark-harness repo + a dotfiles repo vs a Senior Backend JD (must-have incl Kubernetes, absent from signals)
recommendation: FULLY Claude-portable; on the Claude side prefer sonnet/opus over haiku (prose over-claim risk)
---

# Lens 3 — [[github-analysis]] model matrix (2026-07-16)

**The one target of the three that is fully Claude-faithful** — it consumes only text
signals (README, commit subjects, file *names*, language, topics), no vision, no web. So
a Claude cell exercises the *entire* real task, not just a slice. 3 cells × 1 input, blind
Fable judge scoring correctness · conservatism · hidden-strength usefulness · ship-ability.

## Results (blind judge, verbatim input)
| cell | overall /10 | note |
|---|---|---|
| **opus × low** | **10** | Full evidenced set incl. virtual-threads + payment domain; explicitly flags "no production source beyond a benchmark harness" and pushes "Spring beyond Boot" into unverified — most conservative + complete. |
| **sonnet × high** | 9 | Exactly the evidenced set, gaps correctly in unverified, tight signal-backed strengths; only misses the harness-not-production caveat. |
| **haiku × low** | 6 | Structured fields all correct, BUT the summary prose says *"matching 4 of 4 must-haves"* — silently substitutes Kafka for the **missing must-have Kubernetes**. A hiring manager could read that as a clean match. |

All 3 correctly put **Kubernetes/Go/Terraform in unverified_claims** and none hallucinated
a skill — the structured contract was sound on every tier. The spread is entirely in
**prose framing**: haiku's one misleading sentence is the kind of over-claim that gets acted on.

## Recommendation → **Claude-portable; if ported, prefer sonnet (≥) over haiku**
- Unlike a multimodal/grounded site, there is **no capability barrier** to routing this
  through the Python registry on a Claude model — the task is pure text reasoning and every
  tier produced valid, conservative structured output. This **strengthens the case for
  finding #7** (kill the TS-direct Gemini bypass; route through `resolve_provider`), because
  the site is now demonstrably model-portable, not Gemini-locked.
- On quality, sonnet/opus edge haiku only on **prose discipline** (the must-have-count
  slip). The cheap mitigation is prompt-level, not model-level: instruct the summary to
  **name unmet must-haves explicitly** so a cheap model can't blur them. That closes most of
  the gap for ~$0 and keeps haiku viable.
- No basis to prefer opus over sonnet at 15× cost — sonnet already clears the bar.

## Honest ceilings
- n=1 input, one JD/repo shape. A repo with noisier signals (many languages, vendored deps)
  would stress conservatism harder — confirm with a small recipe-A batch.
- This did NOT compare against the **production Gemini flash** cell (Claude-only constraint):
  it establishes Claude *portability + a Claude-tier ranking*, not a Claude-vs-Gemini verdict.
  A cost/quality showdown with flash needs the metered path + a key.
