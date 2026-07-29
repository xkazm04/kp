---
type: tiger/home
app: kp — AI recruiting / hiring platform (Czech retail bank; ČS-seeded)
last_session: "[[2026-07-15-scan]]"
last_updated: 2026-07-15
call_sites_active: 14
---

# 🐯 Tiger — kp

Hunting the apex surface of an LLM app: the model call sites. This vault is the
durable, linked memory — each `/tiger` run reads it, diffs, and writes back.
Engine: `.claude/skills/tiger.md`. Per-app config: [[config]].

## Headline state (after [[2026-07-15-scan]])
The 2026-06-20 story ("strong wrapper, **broken economics**, 4 bypasses") has
**flipped**. All four T0 critical findings are RESOLVED with live code + regression
tests, so the economics layer is now solid; the frontier has moved to **value &
compliance** in the dev-hiring and group-eval surfaces.

> ✅ **Biggest win:** the `llm_usage` ledger is **rebuilt and DEFAULT-ON** (not gated on
> LightTrack) — table `db/core.ts:623`, writer `db/llm.ts:111`, emitted per-envelope,
> sidecar set on every spawn `python-runner.ts:145`. Cost is stamped on every adapter with
> a priced-model regression test. **kp can now cost and bill its own AI.** ([[_plumbing]])
>
> ⛔ **New top risk:** the devcase dev-hiring judge **still self-grades** (judge = generator;
> `devcase_judge` row exists but is never wired) and **grades blind** (the evaluation never
> sees the submission). Plus the auto-sealed EU-AI-Act `group_eval_lead` decision still lacks
> the model's raw reasoning / promptVersion. See [[2026-07-15-scan]] backlog #1–#3.

## Backlog → [[2026-07-16-backlog]] (post-benchmark, consolidated)
**✅ Resolved 2026-07-16 (5):** campaign env bug (#4) · scorecard use_case mis-tag (#6) ·
grounded-salary currency-from-region (#20/B1) · github name-unmet-must-haves (B4) ·
match-reasoning grounding post-check (#2/B3). Full `pipeline/jobfit` suite green (1138 passed).

**Open, ranked:** 1. devcase judge ≠ generator (#11) · 2. devcase eval sees the submission
(#12) · 3. group-eval seal traceability / EU-AI-Act (#13) · 4. cv-analysis derived-fact
post-check (B2) · 5. automation slashed-gender/vocative post-check (B5, with the #10
deliver-or-drop decision) · 6. weight-proposal + jd-ingest lang (#15).

**✅ Lens 3 COMPLETE (5 sites):** every benchmarked site keeps its production model — the
lever is prompts + post-checks, not model tier. See Models section below.

**Closed this period (11):** all of T0 (ledger, cost, self-repair) · T1 gemini-retry,
profile-draft meter, voice ledger · T3 group-compare/scorecard/profile-draft lang ·
T4 jd-ingest role-families · T5 jd-ingest cache. Plus 5 net-new hardening wins
(KP_OFFLINE no-egress, self-host/OpenRouter adapters, HTTP-200-error guard).

## Call sites (the inventory)

### Active LLM call sites — by value (status @ 2026-07-15)
| site | provider/model | grounding | code | top remaining issue |
|---|---|---|---|---|
| [[cv-analysis]] | gemini/flash (direct) | 4/4 | 4 | ✅ retry wired + metered |
| [[voice-interview]] | elevenlabs/openai-rt | 4/4 | 4 | ✅ ledger row + deploy verify; ◐ no runtime override confirm |
| [[weight-proposal]] | claude_cli/haiku | 5/6 | 4 | ◐ lang plumbed but caller drops it |
| [[match-reasoning]] | claude_cli/haiku | 5/6→ | 4 | ◐ richer CV grounding; still no strength-cites-token check |
| [[github-analysis]] | gemini/flash (direct TS) | 6/7 | 4 | ◐ now metered+BYOM; still a TS-direct bypass |
| [[devcase]] | anthropic/sonnet+haiku | 2–4/4 | 4 | ⛔ self-grading judge; eval can't see submission |
| [[automation]] | claude_cli/haiku | 2–4/5 | 4 | ◐ auto-reject retired (GDPR); tailored draft still not delivered |
| [[interview-scorecard]] | claude_cli/haiku | 4/5 | 3 | ✅ lang fixed; ⛔ still mis-tagged use_case=automation |
| [[group-compare]] | claude_cli/haiku | 4/6 | 3 | ✅ lang fixed; ⛔ EU-AI-Act seal traceability; no must-haves |
| [[campaign-pack]] | anthropic/sonnet | 4/7 | 3 | ⛔ env bug still drops BYOM (`route.ts:54`) |
| [[grounded-salary]] | gemini/flash (direct) | 3/4 | 3 | ✅ retry wired; ⛔ no cache; CZK currency lock |
| [[jd-ingest]] | claude_cli | 1/3→ | 4 | ✅ role-families inlined + content-hash cache; ⛔ lang |
| [[profile-draft]] | gemini/flash (direct) | 1/2 | 4 | ✅ metered + lang; ⛔ role_family enum-only |
| [[bench-judge]] | claude_cli (judge) | n/a | 4 | 🆕 model-matrix judge; itself unranked (Lens-3 prior art) |

### Chokepoint & non-LLM (recorded)
- [[_plumbing]] — the shared `TextProvider` layer (economics tier now CLOSED; code_score 3→5).
- [[soft-signals]] · [[insights]] · [[sim-offer-draft]] · [[profile-extract]] — confirmed
  non-LLM / dead (so future scans skip them). CV/lead intake also confirmed deterministic.

## Characters (judgment harness)
Internal: [[petra-recruiter]] · [[katerina-ta-analytics]] · [[tomas-hiring-manager]] ·
[[jana-sourcer]] · [[marek-coordinator]] · [[eva-eng-hiring-lead]] · [[lucie-dpo-compliance]].
External: [[helena-buyer]] · [[hr-media-agency-talent]]. Candidates: [[tereza-candidate]] ·
[[sam-dev-candidate]].

## Models (Lens 3) — 4 sites benchmarked (all Claude-only, blind Fable judge)
- ✅ **[[models/match-reasoning|match-reasoning]] (07-15) → keep haiku / claude_cli.** Near-parity
  across tiers; none flatter the unqualified candidate. Cheap fix: verify a strength cites a real CV token.
- ✅ **[[models/github-analysis|github-analysis]] (07-16) → Claude-portable, prefer sonnet≥haiku.**
  Fully text → the one truly portable target; all tiers valid + conservative. Strengthens finding #7
  (kill the TS-direct Gemini bypass). haiku's lone slip is prose ("4 of 4 must-haves" hiding the K8s gap).
- ✅ **[[models/cv-analysis|cv-analysis]] (07-16) → keep Gemini** (multimodal-only). **Injection
  resistance + EUR currency-inference held on ALL tiers incl. haiku** (two strengths to protect);
  sonnet hallucinated CV tenure → add a derived-fact post-check.
- ✅ **[[models/grounded-salary|grounded-salary]] (07-16) → keep Gemini** (web grounding is the point).
  Surfaced **finding #20 live**: a hardcoded-CZK prompt trapped every tier (incl. opus) into a
  "CZK/month for a Munich job". Promote #20.

> **Meta-lesson (4 benchmarks):** the model tier is rarely the lever here — a bigger model *lost*
> twice. The real levers are **prompt fixes** (CZK lock, name-unmet-must-haves) and **cheap
> post-checks** (strength-cites-token, derived-fact consistency) — all model-independent. The
> in-repo matrix ([[bench-judge]]) covers ~15 text ops; Tiger adds the multimodal/grounded/portability read.

## Next runs
- `/tiger benchmark automation` — the next Claude-native target (downgrade headroom on cheap
  subtasks? upgrade for the routing-critical `screen` verdict / candidate-facing prose?).
- Fold the benchmark's prompt/post-check fixes into the backlog: **promote #20 (CZK lock)**;
  add cv-analysis derived-fact post-check; github "name unmet must-haves" prompt line.
- `/tiger run --live --chars 3` once a provider key is confirmed (`config.md` open Q1).
- Work backlog #1–#5 ([[2026-07-15-scan]]) then `/tiger scan` to measure the delta.
