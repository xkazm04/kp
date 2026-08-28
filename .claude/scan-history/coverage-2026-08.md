# Reconstructed per-context lens coverage — 2026-08 scan-sweep

> **THIS TABLE IS RECONSTRUCTED, NOT RECORDED.** The sweep of 2026-08-21..25 kept no
> per-context ledger. `.claude/scan-history/scan-sweep.jsonl` records only 13 batch
> lines whose `scope` is a rank range ("contexts 25-36 by risk") with **no context
> names**, and whose `lens_keys` is `["bug-hunter"]` for every one of them. What follows
> is inferred from git: each batch's commit range was resolved from its
> `chore(scan-sweep): batch N snapshot` anchor commit, every commit in the range was
> expanded to its touched files, and each file was matched **exactly** against
> `context-map.json` `file_paths[]`. Written 2026-08-28 on branch `ship/kp-stabilize`
> as milestone 450d1008 goal 1.

## What the evidence can and cannot prove

| | |
|---|---|
| **Proves** | a file belonging to this context was edited by a commit inside this batch's range |
| **Does not prove** | that the context was *assigned* to a batch agent — a cross-cutting fix touches files in contexts nobody read |
| **Does not disprove** | absence of a commit is not absence of a read: a context swept with zero findings lands zero commits and is indistinguishable here from one never opened |
| **Cannot recover at all** | which lens ran. The ledger says `bug-hunter` and only `bug-hunter` for all 13 batches, so every cell below is the same lens; ui-perfectionist, performance, ambiguity and per-context security have **no evidence anywhere in the repo** |

## Method

```
anchors (oldest -> newest, from `git log --grep='scan-sweep'`):
  eec1dbc3 (2026-08-20 repo-wide snapshot)  <- range start
  ca7e1950 batch 2   4fd32fa2 batch 3   4094fa12 batch 4   3e4af020 batch 5
  de6431fc batch 6   d2885eda batch 7   9aeba3de batch 8   0e78f554 batch 9
  8a6ad536 batch 10  88c15a93 batch 11  e6458ec2 batch 12  5bb1c6e4 batch 13
for each range: git log --no-merges A..B; git show --name-only; exact-match file -> context
```

**No `batch 1 snapshot` commit exists** — batch 1 and batch 2 are indistinguishable from
commit topology and are reported together as `1-2`. 115 non-snapshot commits were
expanded (101 of them `fix(...)`); the ledger's own totals for the same window are 817
findings / 484 fixed, and the design record counts 161 commits over a slightly wider
window, so this reconstruction sees a **subset**.

## Coverage summary

| | contexts |
|---|---|
| in the 143-map | 143 |
| with >=1 `fix(...)` commit inside a batch range | **140** |
| with any sweep-window commit touching their files | 142 |
| with **no `fix(...)` evidence** (the miss list below) | **3** |
| swept by any lens other than `bug-hunter` | **0** |

### Contexts with no `fix(...)` evidence

- **`lib-analytics-1`** (Analytics & Reporting, lib, 12 files) — not touched at all in the sweep window
- **`ui-primitives-and-ui-puml`** (Design System & Shared UI, lib, 16 files) — touched by a non-`fix` commit in batch 13 only
- **`e2e-suite`** (Platform Infrastructure, test, 11 files) — touched by a non-`fix` commit in batch 13 only

These three are the honest answer to "which contexts did the sweep miss?" — with the
caveat above that a clean context also leaves no trace.

## Per-context table

`bug-hunter` = batches whose commit range touched this context's files. Evidence = up to
four `fix(...)` shas; `+n` counts the rest. A blank bug-hunter cell means no evidence.


### AI & LLM Infrastructure

| context | cat | files | bug-hunter (reconstructed) | evidence commits |
|---|---|---|---|---|
| `agent-workforce` | lib | 11 | batch 10 | `a547ad92` |
| `integrations-settings` | ui | 11 | batch 7 | `bf178802` |
| `lib-llm-config` | lib | 18 | batch 10 | `a547ad92` |
| `llm-adapters-and-llm-registry` | lib | 16 | batch 9 | `b5c9ec70` |
| `llm-config-and-agent-workforce` | api | 17 | batch 9 | `c3ae79d3` |
| `models-settings` | ui | 16 | batch 10 | `a547ad92` |
| `py-cli-core-1` | test | 20 | batch 4, batch 5, batch 8, batch 9, batch 10, batch 12 | `029471eb` `62fbf833` `a5b96144` `b68a883e` +4 |
| `py-cli-core-2` | test | 20 | batch 3, batch 5, batch 12 | `0e373798` `a5b96144` |
| `py-cli-core-3` | test | 20 | batch 9, batch 10 | `b5c9ec70` |
| `py-cli-core-4` | test | 20 | batch 4, batch 5, batch 6, batch 12 | `62fbf833` `a5b96144` `3adde834` |
| `py-cli-core-5` | lib | 17 | batch 4, batch 5 | `62fbf833` `a5b96144` |
| `py-eval` | lib | 14 | batch 3, batch 12 | `0e373798` |
| `py-llm-runtime` | lib | 13 | batch 10 | `10864715` |
| `seeds-and-llm-bench` | lib | 15 | batch 9 | `b5c9ec70` |

### Analytics & Reporting

| context | cat | files | bug-hunter (reconstructed) | evidence commits |
|---|---|---|---|---|
| `about-explainer` | ui | 22 | batch 7 | `bf178802` |
| `analytics-and-market-pulse` | api | 18 | batch 4, batch 5, batch 7 | `62fbf833` `fde52f04` `0e4dc7e2` |
| `analytics-tab-1` | ui | 20 | batch 4 | `ce8bd5a7` |
| `analytics-tab-2` | ui | 20 | batch 4 | `ce8bd5a7` |
| `analytics-tab-3` | test | 20 | batch 4, batch 7 | `ce8bd5a7` `bf178802` |
| `db-analytics` | test | 21 | batch 1-2, batch 11 | `ff197b2e` `a3c6b2c5` |
| `lib-analytics-1` | lib | 12 | **none** | — |
| `lib-analytics-2` | lib | 12 | batch 4, batch 10 | `62fbf833` `9f877420` |

### Billing & Monetization

| context | cat | files | bug-hunter (reconstructed) | evidence commits |
|---|---|---|---|---|
| `billing` | test | 10 | batch 1-2, batch 3, batch 11 | `e680f79d` `d7db834b` `337fca05` |
| `billing-core` | lib | 15 | batch 3 | `d7db834b` |
| `billing-ui` | ui | 21 | batch 1-2 | `94c8e7bb` |

### Candidate Matching & Scoring

| context | cat | files | bug-hunter (reconstructed) | evidence commits |
|---|---|---|---|---|
| `lib-matching` | lib | 20 | batch 4, batch 5, batch 6, batch 8, batch 10, batch 11 | `62fbf833` `b820e375` `31a287e9` `ad4897d7` +5 |
| `matrix-ui-1` | ui | 20 | batch 8 | `ad4897d7` |
| `matrix-ui-2` | ui | 13 | batch 9 | `c3ae79d3` |
| `py-match-reasoning` | lib | 10 | batch 10, batch 11 | `3d0925a2` `a3c6b2c5` |
| `py-scoring-core` | lib | 11 | batch 4, batch 10 | `029471eb` `62fbf833` `da80f915` |
| `salary-and-matching-and-analyses` | api | 10 | batch 1-2, batch 11 | `deb34ec8` `a3c6b2c5` |
| `salary-market-and-taxonomy` | lib | 13 | batch 3 | `17e7087c` |

### Candidate Public Surfaces

| context | cat | files | bug-hunter (reconstructed) | evidence commits |
|---|---|---|---|---|
| `candidate-apply` | ui | 17 | batch 9 | `c3ae79d3` |
| `candidate-public-surfaces-1` | ui | 12 | batch 3 | `40b912a9` |
| `candidate-public-surfaces-2` | ui | 12 | batch 7, batch 13 | `bf178802` `6010c6b8` `22cdfa89` |
| `candidate-scheduling-and-candidate-public` | ui | 16 | batch 3 | `7a2a06d0` |
| `landing-1` | ui | 20 | batch 1-2 | `32840be1` |
| `landing-2` | ui | 20 | batch 8 | `073fc853` |
| `landing-3` | ui | 19 | batch 8 | `073fc853` |
| `lib-candidate-apply` | test | 17 | batch 1-2, batch 4, batch 11 | `e625d623` `62fbf833` `4cae55d2` |

### Communications & Channels

| context | cat | files | bug-hunter (reconstructed) | evidence commits |
|---|---|---|---|---|
| `api-ats-integration` | test | 15 | batch 6, batch 8 | `2aea9b0f` `4f8f0ef1` |
| `api-comms` | api | 14 | batch 1-2, batch 11 | `603e20cc` |
| `channels-1` | ui | 12 | batch 7, batch 10, batch 11 | `bcb75d68` `a547ad92` |
| `channels-2` | lib | 11 | batch 7, batch 11 | `bcb75d68` |
| `lib-ats-integration` | test | 13 | batch 9 | `5aab8ba9` |
| `lib-comms-11` | test | 13 | batch 9, batch 10 | `b45af82d` `9f877420` |
| `lib-comms-12` | lib | 12 | batch 7 | `bcb75d68` |
| `lib-comms-2` | test | 15 | batch 4, batch 9, batch 10, batch 11 | `62fbf833` `336e9dd7` `9f877420` |

### CV Analysis & Candidate Profiles

| context | cat | files | bug-hunter (reconstructed) | evidence commits |
|---|---|---|---|---|
| `analyze-ui-1` | ui | 20 | batch 8 | `ad4897d7` |
| `analyze-ui-2` | lib | 14 | batch 6, batch 8 | `4a3fcaa3` `ad4897d7` |
| `db-profiles` | test | 12 | batch 7 | `6010c6b8` |
| `github-analysis` | lib | 15 | batch 6 | `4a3fcaa3` |
| `lib-analyze` | lib | 15 | batch 4, batch 6 | `62fbf833` `4a3fcaa3` |
| `lib-profile` | test | 19 | batch 5 | `b7ccfcbc` |
| `profile-ui-1` | ui | 21 | batch 7 | `bf178802` |
| `profile-ui-2` | lib | 20 | batch 8 | `c0338453` |

### Design System & Shared UI

| context | cat | files | bug-hunter (reconstructed) | evidence commits |
|---|---|---|---|---|
| `brand-theming` | lib | 18 | batch 8 | `073fc853` |
| `feature-shared` | lib | 21 | batch 1-2, batch 10 | `483ce22c` |
| `ui-glyphs-1` | lib | 20 | batch 4 | `7ef7a764` |
| `ui-primitives-1` | ui | 20 | batch 13 | `1daac9b2` |
| `ui-primitives-2` | ui | 20 | batch 13 | `1daac9b2` |
| `ui-primitives-3` | ui | 19 | batch 13 | `1daac9b2` |
| `ui-primitives-and-ui-puml` | lib | 16 | _(no fix commit; batch 13 non-fix touch only)_ | — |
| `ui-result-panels-1` | ui | 20 | batch 1-2, batch 4 | `d3bd7aed` |
| `ui-result-panels-and-ui-glyphs` | lib | 11 | batch 13 | `1daac9b2` |
| `ui-table-and-react-hooks` | lib | 14 | batch 13 | `6309c9d3` |

### Developer Assessment

| context | cat | files | bug-hunter (reconstructed) | evidence commits |
|---|---|---|---|---|
| `api-devcase-1` | api | 20 | batch 4 | `106040dd` `62fbf833` |
| `api-devcase-2` | lib | 16 | batch 5 | `b68a883e` |
| `devcase-candidate-and-devcase` | ui | 11 | batch 7 | `aaa1c857` |
| `devcase-workspace-1` | ui | 21 | batch 1-2, batch 8 | `0b82f904` `c0338453` |
| `devcase-workspace-2` | ui | 19 | batch 9 | `c3ae79d3` |
| `devcase-workspace-3` | ui | 20 | batch 8 | `c0338453` |
| `lib-devcase-11` | lib | 15 | batch 1-2, batch 4, batch 12 | `0b82f904` `62fbf833` `fe2fda51` |
| `lib-devcase-12` | lib | 14 | batch 3 | `27ba390b` |
| `py-devcase-1` | lib | 20 | batch 4, batch 8 | `62fbf833` `094207bd` |

### Hiring Decisions & Automation

| context | cat | files | bug-hunter (reconstructed) | evidence commits |
|---|---|---|---|---|
| `decisions-ui-1` | ui | 21 | batch 1-2, batch 4 | `40fc5ac3` `ce8bd5a7` |
| `decisions-ui-2` | lib | 20 | batch 4 | `ce8bd5a7` |
| `group-eval-ui` | ui | 21 | batch 1-2 | `a9abd0ba` |
| `lib-automation` | lib | 13 | batch 1-2, batch 10 | `9ff9a7a5` |
| `lib-decisions-1` | test | 12 | batch 7, batch 10 | `0e4dc7e2` |
| `lib-decisions-2` | test | 11 | batch 4, batch 7 | `62fbf833` `f9730d3c` |
| `lib-group-eval` | test | 19 | batch 5 | `7d296db3` |
| `py-automation` | api | 20 | batch 1-2, batch 4 | `78f49e58` `62fbf833` |

### Hiring Pipeline

| context | cat | files | bug-hunter (reconstructed) | evidence commits |
|---|---|---|---|---|
| `api-pipeline` | api | 21 | batch 1-2 | `89fd67cd` |
| `db-pipeline` | test | 15 | batch 6 | `74c65dd8` |
| `lib-offers` | test | 12 | batch 1-2, batch 11 | `e089439f` `337fca05` |
| `lib-pipeline` | test | 20 | batch 8, batch 10 | `5e86aae1` |
| `pipeline-board-1` | ui | 20 | batch 1-2, batch 4 | `d9589bf0` `f4120331` |
| `pipeline-board-2` | ui | 20 | batch 1-2, batch 4 | `d9589bf0` `f4120331` |
| `pipeline-board-3` | ui | 20 | batch 3, batch 4 | `eb667c5e` `f4120331` |
| `pipeline-board-4` | lib | 20 | batch 3, batch 4 | `eb667c5e` `f4120331` |
| `pipeline-board-5` | lib | 16 | batch 3 | `eb667c5e` |
| `pipeline-composer` | ui | 12 | batch 10, batch 13 | `607491c9` |

### Identity, Org & Compliance

| context | cat | files | bug-hunter (reconstructed) | evidence commits |
|---|---|---|---|---|
| `auth-core` | lib | 22 | batch 1-2, batch 11 | `69766cce` `9c8905da` |
| `lib-compliance` | test | 14 | batch 3, batch 4 | `cac9b6f5` `62fbf833` |
| `lib-org` | lib | 16 | batch 1-2, batch 11, batch 12 | `236cfa12` `9c8905da` `4a47eabf` |
| `org-and-auth` | data | 15 | batch 1-2, batch 5, batch 11 | `d77e998e` `7e42d9d5` `9c8905da` |
| `org-workspace-settings` | ui | 14 | batch 3 | `7e959f1f` |

### Interview Scheduling

| context | cat | files | bug-hunter (reconstructed) | evidence commits |
|---|---|---|---|---|
| `calendar-integration` | lib | 15 | batch 1-2, batch 11 | `6a1e5faf` `8d41bdd2` |
| `lib-scheduling` | test | 16 | batch 6 | `decd1aa3` |
| `schedule-ui-1` | ui | 20 | batch 3, batch 4 | `7a2a06d0` `62bd5485` `62fbf833` |
| `schedule-ui-2` | ui | 20 | batch 3, batch 4 | `7a2a06d0` `62fbf833` |
| `scheduling-and-interview-prep` | test | 18 | batch 1-2, batch 11 | `c2dbd267` `4cae55d2` |

### Job & JD Management

| context | cat | files | bug-hunter (reconstructed) | evidence commits |
|---|---|---|---|---|
| `api-jd-library` | api | 19 | batch 10, batch 12 | `f836c48a` `fe2fda51` |
| `api-jobs` | api | 21 | batch 10, batch 12 | `f836c48a` `4a47eabf` |
| `api-role-intake` | api | 11 | batch 6, batch 12 | `cbcfa939` `d6f43c57` |
| `jd-library-1` | ui | 20 | batch 12 | `fe2fda51` |
| `jd-library-2` | lib | 20 | batch 12 | `fe2fda51` |
| `jobs-and-jobs-workspace` | test | 13 | batch 6 | `decd1aa3` |
| `jobs-workspace-1` | ui | 20 | batch 5 | `c9e9fae0` |
| `jobs-workspace-2` | ui | 20 | batch 3, batch 8 | `17e7087c` `ad4897d7` |
| `jobs-workspace-3` | lib | 20 | batch 3 | `17e7087c` |
| `lib-rediscovery` | test | 13 | batch 12 | `4a47eabf` |
| `py-jobs-intake` | lib | 13 | batch 9 | `336e9dd7` |
| `role-intake` | ui | 13 | batch 6 | `31a287e9` |
| `role-intake-and-shared-utils` | lib | 16 | batch 6 | `31a287e9` |

### Platform Infrastructure

| context | cat | files | bug-hunter (reconstructed) | evidence commits |
|---|---|---|---|---|
| `app-shell` | ui | 14 | batch 12 | `fe2fda51` |
| `build-scripts-1` | lib | 20 | batch 5, batch 11 | `688cd04d` |
| `db-core` | test | 18 | batch 3, batch 4, batch 11 | `8b846b6e` `62bd5485` `fdf3da3f` |
| `e2e-suite` | test | 11 | _(no fix commit; batch 13 non-fix touch only)_ | — |
| `landing-and-i18n-and-dev-inspector` | lib | 12 | batch 10, batch 12 | `9f877420` `8771f1ab` |
| `lib-infra-runtime-1` | lib | 20 | batch 5 | `b820e375` `7e42d9d5` |
| `lib-infra-runtime-2` | lib | 17 | batch 12 | `cf518565` |
| `lib-shared-utils-1` | lib | 20 | batch 4, batch 12 | `62fbf833` `cf518565` |
| `root-config` | lib | 13 | batch 6, batch 7, batch 10, batch 11, batch 12, batch 13 | `cbcfa939` `476268b0` `a3c6b2c5` `d6f43c57` +1 |
| `test-infra-and-build-scripts` | lib | 12 | batch 13 | `9e5bef53` `22cdfa89` |

### Voice Interviews

| context | cat | files | bug-hunter (reconstructed) | evidence commits |
|---|---|---|---|---|
| `api-voice-interview` | api | 18 | batch 1-2, batch 6, batch 11 | `e19105e0` `cbcfa939` `337fca05` |
| `eval-voice-and-voice-runtime` | lib | 14 | batch 6 | `3adde834` `cbcfa939` |
| `interview-ui-and-voice-interview-portal-and-interviews` | ui | 10 | batch 4 | `62bd5485` |
| `lib-voice-interview-11` | lib | 15 | batch 1-2, batch 10 | `15f41b10` |
| `lib-voice-interview-12` | lib | 14 | batch 4, batch 6 | `62fbf833` `3adde834` |
| `py-interview-signals` | lib | 10 | batch 4 | `029471eb` `62fbf833` |
| `voice-runtime-1` | lib | 19 | batch 5 | `7f8506a4` |
| `voice-ui-components` | ui | 14 | batch 6 | `3adde834` |

### Workspace Shell & Onboarding

| context | cat | files | bug-hunter (reconstructed) | evidence commits |
|---|---|---|---|---|
| `api-guided-simulation` | api | 17 | batch 9 | `c3ae79d3` |
| `api-workspace` | api | 18 | batch 9 | `5aab8ba9` |
| `background-tasks` | ui | 22 | batch 7 | `476268b0` |
| `background-tasks-and-onboarding-setup` | lib | 22 | batch 4, batch 7, batch 10 | `7ef7a764` `476268b0` |
| `guided-simulation-1` | ui | 20 | batch 5 | `b6139341` |
| `internal-explorers` | ui | 19 | batch 5 | `44484698` |
| `onboarding-setup-1` | ui | 20 | batch 5, batch 10 | `b6139341` |
| `shell-nav` | ui | 21 | batch 13 | `652b9dd2` |
| `shell-workspace-1` | ui | 20 | batch 13 | `652b9dd2` |

## Lens columns that stay empty

| lens | contexts covered | evidence |
|---|---|---|
| `bug-hunter` | 140 / 143 | reconstructed above |
| `ui-perfectionist` | 0 / 143 | no ledger line names it after 2026-08-05 |
| `performance` / `code-optimizer` | 1 / 143 | only `ai-analysis-ux` on 2026-08-05, on the retired 285-map — that context id does not exist in the 143-map |
| `security-auditor` | 0 per-context | 2026-08-20 was a repo-wide *pattern* pass, "not per-context depth" (its own note) |
| `ambiguity` | 0 / 143 | never run |

## What to do with this file

The next `/scan-sweep` run should **write this file itself**, per context, at the moment
it picks a context — not reconstruct it afterwards. Until it does, treat every cell here
as an inference with the confidence stated at the top, and treat the four empty lens
columns as the real coverage debt.
