# Engine and prompt coordination — one matrix for the whole thread

> **Dated 2026-10-09, read at `main` `56fd756a3`** ("docs(tasks): record the
> 8-worker e2e isolation: before table, seven mechanisms, eight clean runs").
> Every `file:line` below is a line at that commit; a cell that could not be
> cited reads *not found*. It answers one question per step of the hiring thread:
> **which engine serves it, which prompt id and version it runs, how it degrades,
> and what moves when that version bumps.**
>
> Companion docs: [llm-provider-layer.md](llm-provider-layer.md) is the *provider*
> contract (adapters, capability matrix, key storage, availability reasons);
> [llm-model-matrix.md](llm-model-matrix.md) is the dated *quality* grid (which
> model is good enough for which op). This file is the *step* view neither holds —
> the one that answers "what happens to interviews if I re-pin the scorecard seat".

The gap this closes was recorded as consistency gap #9 in
[`docs/ship/2026-08-28-one-thread.md`](../ship/2026-08-28-one-thread.md): *"engines
differ per step with different degrade behaviour … prompt versions uncoordinated"*.
The degrade behaviour still differs per step — deliberately, and the differences
are named below rather than flattened away.

## Where each coordination mechanism lives

Nothing here is a new registry. The coordination is three existing mechanisms:

| Mechanism | Lives in | Enforced by |
| --- | --- | --- |
| **Step → engine seat** | `LLM_USE_CASES` (`app/_lib/llm-config.ts:30-64`, 33 entries incl. the `*` catch-all) grouped by `ROUTING_SECTIONS` (`app/features/settings/models/modelsRoutingSections.ts:17-68`) | `modelsRoutingSections.test.ts` — the header (`:9-13`) states every use case must sit in **exactly one** section |
| **Seat → capability floor** | `PROVIDER_CAPABILITIES` (`pipeline/jobfit/llm/capabilities.py:37-58`), `USE_CASE_REQUIREMENTS` (`:74-155`) | `resolve_provider` raises on a routing that cannot serve the seat (`pipeline/jobfit/llm/registry.py:323-347`) |
| **Prompt id → version across the language boundary** | the `*_PROMPT_VERSION` constants (Python) and their TS twins | `pipeline/jobfit/tests/test_prompt_version_sync.py` (8 pairs: `AUTOMATION_VERSION_CONSTANTS` `:36-44` + the reasoning pair `:112-120`) and `test_analysis_prompt_version_sync.py` (the CV analysis prompt, pinned by source fingerprint, header `:7-18`) |

## What "an unconfigured install runs"

With no `KP_LLM_CONFIG` row for a seat, `resolve_provider` returns the Claude CLI
(`registry.py:349-383`, `ClaudeCliAdapter(...)` at `:379`). Two departures:

- **File-input seats** (`cv_analysis`) cannot run on the CLI; the registry routes
  them to Gemini whether or not a key exists (`registry.py:356-358`, deliberately
  not gated on `available()`).
- **A production deployment with a working Gemini key** takes Gemini for every
  JSON seat Gemini can serve (`_production_gemini_default`, `registry.py:80-95`,
  used at `:360-362`). A keyless self-hosted `next start` keeps the CLI (`:84-86`).

Call-site pins (`app/_lib/llm-pins.ts`) fix an engine the routing table cannot
redirect: `role_research`, `gig_brief`, `gig_plan`, `gig_report`, `gig_proposal`
(all Claude CLI, Sonnet 5.5; the gig plan seats also use the pin-only Codex CLI,
`capabilities.py:67-69`). Those are not in the hiring thread and are listed in
[the other seats](#seats-outside-the-hiring-thread) only.

## The matrix

"Seat" is the `LlmUseCase`; "section" is its `ROUTING_SECTIONS` key. Floor =
`USE_CASE_REQUIREMENTS`. Seats absent from that map default to `{json}`
(`capabilities.py:71-73`).

| Step | Seat → section | Default engine · floor | Prompt id @ version (Python ↔ TS) | Keyless / provider failure | What moves on a bump |
| --- | --- | --- | --- | --- | --- |
| **Role intake (text)** | `role_intake` → roles (`modelsRoutingSections.ts:31`) | Claude CLI · `{json}` (`capabilities.py:102`) | `role-intake-v2` (`intake.py:41`); no TS twin | scripted slot engine `deterministic_turn` (`intake.py:1273`); the LLM turn runs through `generate_with_fallback` (`intake.py:1694,1773`) | stamped onto the brief as `prompt_version` (`intake.py:535,1476,1617,1740`); no cache keyed on it found |
| **Role intake (voice)** | `role_intake_voice` → roles | Claude CLI, 30 s cap (`capabilities.py:329-336`) · no capability (`:106`) | no version constant — *not found* | `run_voice_turn` (`intake.py:1794`) falls to the scripted thread | nothing — plain-text utterances, nothing cached |
| **JD ingest** | `jd_ingest` → roles | Claude CLI · `{json}` (`capabilities.py:78`), 6144 tokens (`:194`) | none — *not found* | **raises** when the provider is unavailable (`pipeline/jobfit/jobs_cli.py:48-50`); see Known gaps | nothing — the result is neither cached nor stamped |
| **Repo → role (App master)** | `repo_scan` → roles | Claude CLI · `{json}` (`capabilities.py:99`); the in-checkout read is CLI-only (`:93-98`) | `app-master-v1` (`appmaster.py:49`; `repo_scan.py:66` aliases it) | heuristic dossier via `generate_with_fallback` (`repo_scan.py:1340`) | stamped as the dossier's `prompt_version` (`repo_scan.py:1061`) |
| **CV analysis / job fit** | `cv_analysis` → profiles (`modelsRoutingSections.ts:33`) | **Gemini only** · `{file_input}` (`capabilities.py:118`); only the gemini row advertises it (`:41`) | `v8-2026-10-07-checked-strengths` (`app/_lib/cache-key.ts:36`); no Python constant — the fingerprint test pins the prompt-feeding source instead | **nothing** — no key raises `missing_key` (`pipeline/jobfit/gemini.py:214-218`); no fallback profile exists (`registry.py:353-355`) | the cache key (`cache-key.ts:98`). The last bump (v8) retired pre-"checked strengths" payloads (`cache-key.ts:31-35`) |
| **Matching / reasoning** | `match_reasoning` → matching (`modelsRoutingSections.ts:21`) | Claude CLI · `{json}` (`capabilities.py:75`), base cap by decision (`:309-317`) | `match-reasoning-v5` (`match_reasoning.py:32` ↔ `app/_lib/reasoning-run.ts:31`) | template `deterministic_reasoning` (`match_reasoning.py:250`), source `"deterministic"` (`:554,571`); the narrative is then English whatever `lang` said — `narrative_lang_for` (`:82-88`) | prompt-cache lookup (`reasoning-run.ts:146`) and the stamped `promptVersion` (`:133`) |
| **Group comparison** | `group_compare` → matching | Claude CLI · `{json}` | `group-compare-v4` (`group_compare.py:41`); no TS twin | `deterministic_comparison` (`group_compare.py:172,400-416`) | stamped as `promptVersion` (`group_compare_cli.py:107`) |
| **Weight proposal** | `weight_proposal` → matching | Claude CLI · `{json}`, 16384 tokens (`capabilities.py:198`) | `weight-proposal-v2` (`weight_proposal.py:26`) — defined, **no other reference found** | `deterministic_proposals` (`weight_proposal.py:177,185`) | nothing found reads it |
| **Agent-candidate fit** | `agent_fit` → matching | Claude CLI · `{json}` (`capabilities.py:92`) | `agent-fit-v1` (`agentfit.py:38`) | `generate_with_fallback` (`agentfit.py:354,544`) | stamped as `promptVersion` (`agentfit.py:362`) |
| **Assignment design** | `devcase_analyze`, `devcase_role_design`, `devcase_case_design`, `devcase_interview_scenario`, `devcase_seed` → assignments (`modelsRoutingSections.ts:58-62`) | Claude CLI · `{json}` (`capabilities.py:81-88`) | `need-analysis-v3` (`devcase/analyze.py:18`), `role-design-v5` and `case-design-v7` (`devcase/design.py:30-31`), `interview-scenario-v3` (`devcase/interview_scenario.py:33`), `seed-materializer-v2` (`devcase/seed_materializer.py:29`) | `generate_with_fallback` (`devcase/provenance.py:298`) | each file's own comment names what the last bump retired; no TS twin |
| **Assignment evaluation** | `devcase_evaluate`, `devcase_reflect` → assignments (`:63-64`) | Claude CLI · `{json}` | `case-eval-v2`, `transfer-v2`, `followups-v3` (`devcase/evaluate.py:18-20`), `commit-reflection-v3`, `tooling-signal-v4` (`devcase/reflect.py:28,32`), `baseline-solve-v1` (`devcase/baseline.py:28`), `session-chat-v1` (`devcase/chat.py:31`) | `generate_with_fallback` | same as above |
| **Assignment judging** | `devcase_judge` → assignments (`:65`) | Claude CLI pinned to `claude-haiku-4-5` (`capabilities.py:362,398`) — distinct from the generator by default · `{json}` (`:86`) | the judge rides the evaluation ids — *not found* as its own constant | reports `judge_independence` false rather than self-certifying (`capabilities.py:366-376`) | follows the evaluation ids |
| **Voice interview (transport)** | *not an `LlmUseCase`* | ElevenLabs or OpenAI Realtime | no prompt id — *not found* | connect-time failover to the next available provider in the same request (`app/_lib/voice/connect-failover.ts:87-103`, `failedOver` `:43`) | n/a |
| **Interview scorecard** | `interview_scorecard` → interviews (`modelsRoutingSections.ts:35`) | Claude CLI · `{json}` (`capabilities.py:90`), 6144 tokens (`:205`) | `scorecard-v8` (`automation.py:127` ↔ `automation-run.ts:97`) | deterministic template, disclosed as `verdictSource` (`automation-run.ts:219-231,585-586`) | cache key `version` axis (`automation-cache-key.ts:80-81,167`); locale is also a key axis (`:39`) |
| **Pipeline letters + screening** | `automation` → automation (`:23`) | Claude CLI · `{json}` (`capabilities.py:76`), 4096 tokens (`:190`) | `screening-v4` (`automation.py:93` ↔ `automation-run.ts:66`), `outreach-v4` (`:112` ↔ `:75`), `rejection-v5` (`:113` ↔ `:84`), `interview-prep-v3` (`:114` ↔ `:85`), `rematch-v2` (`:128` ↔ `:98`), `offer-v6` (`:133` ↔ `:104`) | same disclosed template (`automation.py:501` `_generate`) | as the scorecard |
| **Interview kit / feedback letter** | `automation` | Claude CLI | `interview-kit-v1` (`automation.py:1512`), `interview-letter-v1` (`:1875`) | template | nothing — exempt as uncached (`test_prompt_version_sync.py:53-66`) |
| **Campaign copy** | `campaign_pack` → automation | Claude CLI · `{json}` (`capabilities.py:77`), 8192 tokens (`:199`); `anthropic` steps up to Sonnet (`:394`) | `campaign-pack-v1` (`campaign.py:35`) | deterministic builder (`campaign.py:278-337`) | stamped as `promptVersion` (`campaign.py:413`) |
| **Operator companion** | `assistant` → companion | Claude CLI · no capability (`capabilities.py:110`) | prose seat — *not found* | the studio digest answers (`companion_cli.py:24-32`) | n/a |

### Seats outside the hiring thread

Placed in `ROUTING_SECTIONS` but not part of the thread above: `profile_draft`,
`github_analysis` (profiles, `:33`); `posting_translate` (roles, `:31`; no
deterministic twin by design, `capabilities.py:111-116`); the job-seeker seats
`cv_polish` (`cv-polish-v3`, `jobseeker.py:54`), `fit_dialog` (`fit-dialog-v1`,
`jobseeker.py:55`), `extraction_rules` (`extraction-rules-v1`,
`extraction_rules_cli.py:38`), `role_research` (`role-research-v2`,
`role_research_cli.py:81`; pinned, needs `web_research`, `capabilities.py:129`);
and the gig seats `gig_brief` (`gig-brief-v4`, `gig_brief_cli.py:93`),
`gig_plan` (`gig-plan-v1`, `gig_plan_cli.py:89`), `gig_report` (`gig-report-v1`,
`gig_report_cli.py:69`), `gig_proposal` (`gig-proposal-v3`, `gig_proposal_cli.py:56`).
The `*` catch-all is the first section (`modelsRoutingSections.ts:19`).

## The shared degrade contract

Four rules hold across the rows above.

1. **Degrade, never crash — except where a fabricated answer would be worse.**
   A runtime provider failure serves the call site's deterministic fallback. The
   two deliberate exceptions are *absences of data*: CV analysis (no fallback
   profile exists to invent) and JD ingest (Known gaps). A **misconfiguration**
   never degrades — it raises at resolve time (`registry.py:333-347`;
   `capabilities.py:5-8`).
2. **A degraded answer says so, in the payload.** `source` is `"llm"` or
   `"deterministic"`; a model reply that coercion kept *nothing* of is reported
   as deterministic (`devcase/provenance.py:298-330`, `group_compare.py:355-356`,
   `automation.py:501-515`).
3. **The reason survives to the ledger.** `describe_fallback`
   (`provenance.py:212`) stamps a one-line cause; the coded vocabulary
   (`provider_timeout` / `unparseable_output` / `unusable_output` /
   `provider_error`) lives once in `pipeline/jobfit/llm/degradation.py:34-57`,
   below every runner.
4. **An unavailable provider names which unavailability** — `offline_policy`,
   `not_installed`, `missing_key`, … from `registry.provider_availability`
   (`registry.py:189`).

Implementation: **three runners and one shared vocabulary.**
`generate_with_fallback` (`provenance.py:298`) serves the devcase seats **and**
agent fit, role intake, the job-seeker dialogs and repo scan (call sites listed
by `degradation.py:15-17`); matching (`match_reasoning.py:539-571`,
`group_compare.py:392-416`, `weight_proposal.py:177-185`) and automation
(`automation.py:501`) each satisfy the contract in their own function. The
reason codes are shared (`degradation.py`); the control flow is not. The four
gig CLIs classify with the same vocabulary (`gig_brief_cli.py:87`, …) and carry
their own fallbacks.

## Prompt versions: what a bump means and what moves with it

**The changelog is in-source and append-only.** Every bump is a comment next to
the constant naming what changed — `automation-run.ts:30-104` (seven ids in one
block), `devcase/design.py:30-31`, `devcase/evaluate.py:18-20`,
`cache-key.ts:20-36`, and the long NOTE log in
`test_analysis_prompt_version_sync.py:40-149`. This doc is the index, not a
second source of truth.

**When you bump a version, four things move together:**

1. **The Python constant and its TS twin, in the same commit.** Eight pairs are
   gated: the seven `AUTOMATION_VERSION` tasks plus match reasoning. A one-sided
   bump reddens the build (`test_prompt_version_sync.py:139-164`). The CV prompt
   has no twin: bump `cache-key.ts` `PROMPT_VERSION` when the fingerprint test
   says so.
2. **The cache retires itself.** The version is a key axis
   (`automation-cache-key.ts:167`, `cache-key.ts:98`, `reasoning-run.ts:146`).
   A prompt whose bytes changed and whose version did not has not shipped for
   anyone already warm.
3. **The reason, as a comment above the constant** — not in a commit message.
4. **Cost, deliberately.** Retiring a cache is re-spend on the operator's bill;
   where a bump was judged not worth it the decision is written down
   (`test_analysis_prompt_version_sync.py:141-149`).

Versions that are **stamped but not keyed** (`group-compare-v4`, `agent-fit-v1`,
`campaign-pack-v1`, `app-master-v1`, `role-intake-v2`, the devcase ids) move only
provenance on a bump; there is no cache for them to retire in the files read.

## Findings re-checked against the draft (2026-09-14, `add2fc24b`)

| Finding | Status at `56fd756a3` |
| --- | --- |
| (a) The degrade contract has three implementations and two exemptions | **Partly changed.** Still true: three control-flow paths (`provenance.py:298`, matching, `automation.py:501`) and no fallback in `cv_analysis` (`gemini.py:214-218`) or `jd_ingest` (`jobs_cli.py:48-50`). Changed: the shared *vocabulary* now exists once (`llm/degradation.py`, commit `4771dcc46` "feat(tests-llm-eval): drill the shared fallback runner with coded descents"), and `generate_with_fallback` serves more than the devcase seats (agent fit, intake, job-seeker, repo scan). The draft's "the ten devcase seats" count is no longer the right unit. |
| (b) `jd_ingest` hard-fails keyless | **Still true** — `jobs_cli.py:48-50`; the recent commits to `jobs_cli.py` / `jobs.py` (`793c16086` "refactor(candidate-matching): one education module owns both ladders", `ba19ccaff` "fix(jobseeker): read a posting pay chip in the units the ad actually stated") leave the ingest branch as it was. |

Other drift from the draft: `profile_extract` is no longer a seat (not in
`LLM_USE_CASES`; `grep` finds it only in `gemini.py` and a metering test); the
CV prompt is v8 not v6; `screening-v3` → `v4`, `role-design-v4` → `v5`; the
draft's "voice transport has two answers" gap still holds.

## Known gaps

- **JD ingest has no degrade path and no prompt version.** A keyless install can
  do everything in the thread except paste a job ad. The `"deterministic"` source
  `jobs_cli` reports belongs to the sibling `normalize` command, not to ad text.
  Closes when ingest gains a deterministic parse or a cache; add the version
  with it — a version with nothing to retire is not a law.
- **`weight-proposal-v2` is a constant nothing reads** (`weight_proposal.py:26`;
  no other reference found). Closes when the proposal is stamped or cached, or
  the constant is dropped.
- **The voice transport is outside the LLM matrix by construction** — not an
  `LlmUseCase`, so `modelsRoutingSections.test.ts` cannot place it. "Which
  engines does this app use" has two answers and only one is test-enforced.
- **The judge's independence is bought with judge capability.** On the CLI the
  default judge is a cheaper tier than the generator (`capabilities.py:366-376`);
  providers that name one model have no distinct default and report
  `independent: false` until the operator pins the seat.
