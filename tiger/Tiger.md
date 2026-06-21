---
type: tiger/home
app: kp — AI recruiting / hiring platform (Czech retail bank; ČS-seeded)
last_session: "[[2026-06-20-init-scan]]"
last_updated: 2026-06-20
call_sites_active: 13
---

# 🐯 Tiger — kp

Hunting the apex surface of an LLM app: the model call sites. This vault is the
durable, linked memory — each `/tiger` run reads it, diffs, and writes back.
Engine: `.claude/skills/tiger.md`. Per-app config: [[config]].

## Headline state (after [[2026-06-20-init-scan]])
kp has an **unusually strong wrapper** (one `resolve_provider(use_case)` chokepoint,
retry/fallback/capability-gating, prompt-version pinning, a real bench harness) — but
the **economics layer is broken** and **4 call sites bypass the wrapper**, so its
benefits don't reach a large slice of traffic.

> ⛔ **The single biggest finding:** the `llm_usage` ledger **does not exist** (deleted
> 2026-06-14; 0 writers/readers in code). Without LightTrack configured — the default —
> ~100% of LLM traffic emits and persists nothing. The pricing meters have 0% of traffic
> to bill against. See [[_plumbing]] F1 and backlog T0.1.

## The backlog → see [[2026-06-20-init-scan]]
T0 (critical, cross-cutting): rebuild the usage ledger · fix cost stamping · add JSON
self-repair. T1 (config bugs killing built features): campaign env · gemini retry ·
scorecard use_case · github bypass · profile_draft meter · voice cost. T2 (value/
compliance): rejection draft never sent · self-grading judge · eval can't see submission ·
EU-AI-Act audit trail. T3: lang threading (Czech→English) on 5 sites. T4: grounding gaps.

## Call sites (the inventory)

### Active LLM call sites — by value
| site | provider/model | grounding | code | quality | top issue |
|---|---|---|---|---|---|
| [[cv-analysis]] | gemini/flash (direct) | 4/4 | 3 | 4 | retry never wired; uncosted |
| [[voice-interview]] | elevenlabs/openai-rt | 4/4 | 4 | 4 | billed minutes uncosted; silent brief downgrade |
| [[weight-proposal]] | claude_cli/haiku | 5/6 | 4 | 4 | lang dropped (strongest design overall) |
| [[match-reasoning]] | claude_cli/haiku | 5/6 | 4 | 4 | no prior-pipeline context |
| [[github-analysis]] | gemini/flash (direct TS) | 6/7 | 3 | 4 | full wrapper bypass |
| [[devcase]] | anthropic/sonnet+haiku | 2–4/4 | 4 | 4 | self-grading judge; eval can't see submission |
| [[automation]] | claude_cli/haiku | 2–4/5 | 4 | 3 | rejection draft generated but never sent |
| [[interview-scorecard]] | claude_cli/haiku | 4/5 | 3 | 4 | wrong use_case routing; lang dropped |
| [[group-compare]] | claude_cli/haiku | 4/6 | 3 | 3 | EU-AI-Act audit trail; lang dropped |
| [[campaign-pack]] | anthropic/sonnet* | 4/7 | 3 | 3 | sonnet override DEAD (env bug) |
| [[grounded-salary]] | gemini/flash (direct) | 3/4 | 3 | 3 | no cache; CZK lock |
| [[jd-ingest]] | claude_cli | 1/3 | 4 | 3 | role_family bare enum → wrong band |
| [[profile-draft]] | gemini/flash (direct) | 1/2 | 3 | 3 | wrapper bypass; lang dropped |

\* override exists in config but is bypassed in the running app.

### Chokepoint & non-LLM (recorded)
- [[_plumbing]] — the shared `TextProvider` layer (cross-cutting findings live here).
- [[soft-signals]] · [[insights]] · [[sim-offer-draft]] · [[profile-extract]] — confirmed
  non-LLM / dead (so future scans skip them).

## Characters (judgment harness)
Internal: [[petra-recruiter]] · [[katerina-ta-analytics]] · [[tomas-hiring-manager]] ·
[[jana-sourcer]] · [[marek-coordinator]] · [[eva-eng-hiring-lead]] · [[lucie-dpo-compliance]].
External: [[helena-buyer]] · [[hr-media-agency-talent]]. Candidates: [[tereza-candidate]] ·
[[sam-dev-candidate]].

## Models (Lens 3)
[[models/README|Not yet benchmarked]] — blocked on cost stamping ([[_plumbing]] F2/F3).

## Next runs
- `/tiger run --live --chars 3` on the top sites once an env key is confirmed (`config.md`
  open Q1) — confirm the L1 senior-bar verdicts with real generations.
- `/tiger benchmark match-reasoning` after T0.2 — first real Lens-3 cell.
- `/tiger scan` after any backlog fix — diff the vault, measure the delta.
