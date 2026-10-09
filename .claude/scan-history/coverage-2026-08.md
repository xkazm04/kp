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
| `ui-perfectionist` | 1 / 143 | **recorded**, not reconstructed — `decisions-ui-1`, 2026-08-28 (see below). Was 0/143: no ledger line named it after 2026-08-05 |
| `performance` / `code-optimizer` | 4 / 143 | **recorded** 2026-08-28 (see below). The prior `ai-analysis-ux` cell was on the retired 285-map — that context id does not exist in the 143-map, so this map's true prior count was 0 |
| `security-auditor` | 4 per-context | **recorded** 2026-08-28 (see below). 2026-08-20 was a repo-wide *pattern* pass, "not per-context depth" (its own note) |
| `ambiguity` | 4 / 143 | **recorded** 2026-08-28 (see below). Never run before that |

Only 3 of the 4 contexts recorded below can carry a `ui-perfectionist` verdict — the other
three hold no `.tsx`, so their cell reads *n/a*, not *covered*. Counting an n/a as coverage
is how a 0/143 column quietly becomes a green one without anything being read.

## Recorded per-context coverage — 2026-08-28 (branch `ship/kp-stabilize`)

The first rows in this file that were **written at the moment the context was read**, by the
STABILIZE round the section above asked for. Ledger twins: the last four lines of
`scan-sweep.jsonl`. `✓` = read through that lens and judged; *clean* = judged with nothing
found, which IS coverage; *n/a* = the lens has no surface here (no `.tsx` in a `lib` context).

| context | cat | files read | bug-hunter | ui-perfectionist | security-auditor | performance | ambiguity | fixed |
|---|---|---|---|---|---|---|---|---|
| `lib-devcase-12` | lib | 10 / 14 src (+3 branch-new) | ✓ 2 esc | n/a | ✓ clean | ✓ 1 esc | ✓ 2 esc | — |
| `lib-matching` | lib | 10 / 20 src | ✓ 1 → fixed | n/a | ✓ clean | ✓ clean | ✓ 1 note | `f17f2a26` |
| `decisions-ui-1` | ui | 21 / 21 | ✓ clean | ✓ 2 → fixed | ✓ clean | ✓ clean | ✓ 1 esc | `a60cb677` `2bbb5141` |
| `lib-devcase-11` | lib | 8 / 15 src | ✓ clean | n/a | ✓ clean | ✓ clean | ✓ 1 → fixed, 1 esc | `7befae4a` |

**Declared cut.** "files read" counts SOURCE files. The 21 colocated `*.test.ts` files across
the four contexts were consulted only where a fix touched them — they are the round's honest
gap, and the map's file counts include them, which is why the `lib` denominators above are
smaller than the map's 14 / 20 / 15. `lib-devcase-12` and `lib-matching` were covered first
and completely at source level, per the round's brief.

## Recorded per-context coverage — 2026-09-14, ROUND 2 (branch `goals/lens-sweep-round-2`)

Second five-lens round of dev_goal `081c3e5a` ("four missing lenses over the 55 thread
contexts"). Round 1 (2026-08-28, the table above) read 4; this round reads **5 more**,
picked by LEAST reconstructed coverage — each had exactly ONE `bug-hunter` batch in the
table above — and spread across the four steps of the hiring thread so no step goes two
rounds unread.

### What "the 55 thread contexts" means, and a problem with the denominator

The goal's 55 is the seven thread groups of the **143-map**: CV Analysis & Candidate
Profiles (8) + Candidate Matching & Scoring (7) + Developer Assessment (9) + Hiring
Decisions & Automation (8) + Hiring Pipeline (10) + Interview Scheduling (5) + Voice
Interviews (8) = 55. Round 1's four contexts are all inside it.

**That map no longer exists at the repo root.** `context-map.json` now holds **289**
contexts in 27 groups, and not one of the nine context ids in this file's recorded
tables resolves in it (`lib-matching`, `decisions-ui-1`, … all miss). The 143-map was
read out of git — `git show 9c20a787:context-map.json` — to resolve this round's file
lists, and the ids below are its ids, so the 4/55 and 9/55 denominators stay comparable
with round 1. **This is the open question the next round inherits:** either re-express
the goal's 55 against the 289-map (and re-derive what is already covered), or record
that this goal is tracked against a retired map. Guessing a 55-subset of the 289-map is
not it — no combination of its groups sums to 55, so the mapping is a judgement, not an
arithmetic fact.

### The round

`✓` = read through that lens and judged; *clean* = judged with nothing found, which IS
coverage; *n/a* = the lens has no surface here (no `.tsx` in a `lib`/`test` context).

| context | cat | files read | bug-hunter | ui-perfectionist | security-auditor | performance | ambiguity | fixed |
|---|---|---|---|---|---|---|---|---|
| `api-devcase-2` | lib | 11 / 12 src | ✓ 3 esc | n/a | ✓ 1 → fixed, 2 esc | ✓ 1 esc | ✓ 3 esc | `618e410e` |
| `lib-scheduling` | test | 6 / 6 src | ✓ 3 → fixed, 4 esc | n/a | ✓ clean (1 note) | ✓ 3 esc | ✓ 3 esc | `ec85c711` `09dc4afd` `57ea7511` |
| `voice-ui-components` | ui | 14 / 14 src | ✓ 1 → fixed, 7 esc | ✓ 4 esc | ✓ 1 esc | ✓ 2 esc | ✓ 4 esc | `67a73263` |
| `matrix-ui-2` | ui | 22 / 10 map-src | ✓ 1 → fixed, 4 esc | ✓ 1 → fixed, 5 esc | ✓ 1 esc | ✓ 2 esc | ✓ 3 esc | `8bb7b651` `66487a7d` |
| `lib-group-eval` | test | 7 / 7 src | ✓ 6 esc | n/a | ✓ 1 → fixed | ✓ 1 esc | ✓ 2 esc | `7d455839` |

**Declared cuts, stated rather than rounded away.**

- "files read" counts SOURCE files. The **28 colocated `*.test.ts` files** across these
  five contexts were read only for what they already assert (so a covered case is not
  reported as a gap), never audited as code. Same honest gap round 1 declared.
- `api-devcase-2`: `pipeline/jobfit/devcase/submission_eval.py` (556 lines) was **not
  read** — it is the consumer of `canaries` / `planted` / `skippedReasons`, so finding
  D-B3 below (a canary whose quoted flaw is truncated out of the delivered seed) is
  unverified on the scoring side. Deliberate cut for batch size, not an oversight.
- `matrix-ui-2` reads **more** than its map row, not less: the 143-map lists 13 files for
  it and the directory now holds 36 (22 source + 14 tests). All 10 of the map's source
  files were read, plus 12 that did not exist when the map was cut. The `22 / 10` above
  is that, not a typo.
- `voice-ui-components`: `VoiceInterview.tsx` is 962 lines and was read for its state
  machine, effects and cleanup paths rather than line by line.

### The eight fixes, each test-first

Every one landed as a failing test, then the fix, then the gate — one atomic commit each.

| commit | context | lens | what was wrong |
|---|---|---|---|
| `618e410e` | api-devcase-2 | security | the PUBLIC, unauthenticated skill-profile verify route answered its 500 with `jsonError(error, …)`, forwarding the thrown `.message` (SQLITE_* code, constraint text, db path) to an anonymous caller. Now `safeJsonError` + `SKILL_PROFILE_VERIFY_FAILED`; its `FORWARD_CEILING` row is burnt down, not re-declared |
| `ec85c711` | lib-scheduling | bug-hunter | `dateSlotToIso` checked the date per FIELD (`dd <= 31`) and `Date.UTC` overflowed silently — `2026-02-30` booked 2 March, with a server-derived label naming the rolled day so nothing reported the shift |
| `09dc4afd` | lib-scheduling | bug-hunter | the "idempotent re-confirm" branch answered `ok: true` for ANY confirm on a confirmed invite, whatever time it named; the token route then stamped the board and the letter with the REQUESTED slot |
| `57ea7511` | lib-scheduling | bug-hunter | `setIntervalMinutes` and `advanceAfterForcedRun` computed the clock from `enabled` and wrote on `WHERE name = ?` alone — a toggle-off racing either left `enabled = 0` beside an armed `next_due_at` |
| `7d455839` | lib-group-eval | security | `getWorkspaceDefaultLocale()` with no argument: a non-default team's persisted, shared comparison narrative was written in the DEFAULT team's language, and `comparisonLang` recorded that wrong language permanently |
| `67a73263` | voice-ui-components | bug-hunter | `micErrorText`'s message fallback matched a bare "denied", so an ElevenLabs auth failure ("Agent access denied") told the candidate to click the microphone icon in their address bar |
| `8bb7b651` | matrix-ui-2 | bug-hunter | the reasoning popover's cache was keyed `candidate|position` while its request carries `lang`, so after a language switch a cell kept the OLD language's narrative — and the "shown in {language}" note compared that stale value against the new locale |
| `66487a7d` | matrix-ui-2 | ui-perfectionist | a null-score cell paints the unassessed hatch and renders nothing, but announced `matchVal { score: c.score ?? 0 }` — "match 0" to a screen reader, the exact claim the hatch exists to avoid |

**Three of the eight are pinned at the SOURCE, not driven.** `57ea7511` (a cross-process
interleaving), `7d455839` (the spawn is forced to ENOENT in the hermetic suite) and half
of `8bb7b651` / `66487a7d` (no React renderer in this runner) use the contract-test idiom
`app/api/rate-limit-contract.test.ts` established here. That is weaker evidence than a
behavioural drive and is named as such rather than counted as equal.

### Escalated — M and L, with anchors

Not fixed this round. Each was read in context and is stated as the wrong BEHAVIOUR.

**voice-ui-components — one root cause, three victims (M).** `createTimerRegistry`
latches `cleared = true` permanently (`app/_components/voice/timer-registry.ts:47`, and
`voice-portal-gate.test.ts:99` asserts it), while `clearConnectTimer`
(`VoiceInterview.tsx:234`) is `timersRef.current.clearAll()` and is called before every
subsequent `set()`:

- `VoiceInterview.tsx:609-620` — `start()` clears, then schedules the 30s connect latch on
  the registry it just killed. **The connect timeout never arms on any call**: a stalled
  handshake leaves the candidate in `connecting` forever with a hot mic and no error. The
  comment at `:608` states the invariant the code cannot hold.
- `VoiceInterview.tsx:713` — same cause: `onConnected` (`:446`) clears, so the
  `EL_DISCONNECT_GRACE_MS` fallback is inert and a missing `onDisconnect` wedges the call
  in `ending` with the transcript never POSTed.
- `VoiceInterview.tsx:286,304` — `finalize` clears before `waitUntil(…, timersRef.sleep)`;
  a cleared registry's `sleep` resolves immediately (`timer-registry.ts:62`), so the
  closing-answer rescue becomes a 3s microtask busy-loop that starves the macrotask queue
  the DataChannel `onmessage` needs, and always falls through to the "closing turn lost"
  system turn it was written to prevent.

**`VoiceInterview.tsx:525` vs `transport/openai.ts:296,349` (M).** The unmount cleanup
latches `finalizedRef` only when `reachedLiveRef.current` is true, so unmounting DURING
`connecting` lets the in-flight `start()` resume after its awaited `/connect` fetch and
build a new `RTCPeerConnection` + `getUserMedia` AFTER teardown ran. Both guards pass
because the refs were just re-assigned by that same call. The mic stays live until the tab
closes — and with the latch defect above there is not even a 30s timeout behind it.

**`app/_components/voice/useTranscriptPersistence.ts:72-76` (M).** The stash written to
`sessionStorage` under `kp.iv.<sessionId>` includes the interview **capability token** and
the internal session id, is deliberately kept across a network failure (`:208`), and is
replayed on every later mount (`:166-216`) — a one-shot credential at rest in web storage,
readable by any script on the origin.

**`app/_lib/schedule-store.ts:318-343` (M).** `createScheduleInvite` is SELECT-then-INSERT
with no `.immediate()` and only a NON-unique index on `entry_id` (`:104`), so two
concurrent invite requests for one entry can both insert — the two-independently-
confirmable-tokens state the comment at `:289-301` claims to prevent.

**`app/_lib/group-eval-run.ts:837-892` vs `:1018-1024` (M).** `sealDecisionSafe` and
`recordAutomationEvent` fire BEFORE the CAS write. When the CAS then drops the result as
stale (`:1019` only logs), an immutable hash-chained decision record and a pipeline
provenance event already assert a crowned lead that was never persisted and that the modal
will not show.

**`app/_lib/group-eval.ts:167-177` + `group-eval-run.ts:1018` (M).** The
"an invalidation always beats an in-flight run" invariant holds only on the UPDATE branch.
In the `expected.exists === false` branch there is nothing to re-assert, so a run whose
cohort was invalidated mid-flight still lands its `INSERT … DO NOTHING`.

**`app/features/insights/matrix/useMatrixTab.ts:291-294,565` (M).** `sortCol` is returned
as the EFFECTIVE column (nulled when hidden) while the RAW setter is exported, so
`MatrixGrid.tsx:116`'s updater compares against a value its own component never renders,
and a sort on a family-filtered-away column survives invisibly and re-applies later.

**`app/features/insights/matrix/MatrixGrid.tsx:103-128` (M).** Every popover / reasoning /
announce transition re-renders the header row: rows are `memo`'d and the stats strip is,
the `<th>` + sort buttons are not, so N `t("colTitle")` + two `enumLabel` calls per column
are rebuilt through the translator on each. The row-memo work was done to avoid exactly
this class of churn.

**`app/features/insights/matrix/MatrixGridRow.tsx:157` + `matrixTabTypes.ts:57-63` (M).**
`STAGE_INITIAL` maps English stage ids to English initials (S/I/O/H) and renders them as
the visible ring badge, while the same stage in the cell's `title` is localized through
`enumLabel`. A cs/de/fr reader sees an untranslatable Latin initial matching no word on
their screen.

**`app/features/insights/matrix/useMatrixTab.ts:388-390` (M).** `reasoningAbort.current`
holds exactly ONE controller: clicking cell A then cell B overwrites it without aborting
A's in-flight LLM-backed spawn, and when `fetchReasoning` returns early for B the ref
still points at A — so a later `closePopover()` aborts a different cell's request and its
`aborted` branch deletes THAT cell's state.

**`VoiceInterview.tsx:513` (unverified, stated as such).** The unmount effect has `[]`
deps behind an eslint-disable and closes over the first render's `conversation` from
`useConversation`; whether that ends a stale handle depends on SDK internals not in this
tree. Listed because the disable suppresses the check that would have answered it.

### Confirmed S findings NOT fixed this round — carry-over, not clean

Named so the next round starts from evidence rather than re-reading. All verified in
context; none is a style opinion.

- `app/_lib/schedule-store.ts:769-777` — `dueReminders` has no `LIMIT` and no time
  predicate in SQL; never-reminded past slots match forever and are re-selected and
  re-parsed every 60s tick, growing monotonically with installation age.
- `app/_lib/schedule-slots.ts:105-116` — `zonedParts` builds a new `Intl.DateTimeFormat`
  per call, and every other helper funnels through it (~40+ constructions per
  `proposeSlots` over a 21-day horizon). Trivially memoizable per `tz`.
- `app/_lib/schedule-slots.ts:88` vs `:468-476` — `TIMES` is frozen at module load from
  `KP_INTERVIEW_TIMES` while `interviewGridRows` re-reads the env at call time, so after
  a config change the grid offers hours the proposer/validator still refuses.
- `app/_lib/schedule-slots.ts:181` — `proposeSlots` starts at `day = 1`, so today's
  still-future times are never proposed, while `offeredSlotFor:211` accepts them. Costs a
  day of capacity in exactly the fully-booked-horizon case.
- `app/_lib/schedule-store.ts:419` — the `slotAt`-absent collision branch compares the
  display LABEL, a weaker collision domain than the documented ISO identity; unreachable
  in production and unpinned.
- `app/_lib/scheduler-store.ts:129-139` — `ensureSchedule` is check-then-INSERT with no
  `ON CONFLICT DO NOTHING` on a `name PRIMARY KEY` table a second process may touch.
- `app/_lib/scheduler-store.ts:256-275` — `recordRun` writes the run row and the job's
  `last_summary_json` as two statements outside a transaction.
- `app/_lib/scheduler-store.ts:312-314,325-328` — `decisionsForWorkspace` defaults to
  UNFILTERED (safe behaviour opt-in rather than opt-out), and `listRuns` passes the
  caller's `limit` straight through with no clamp, unlike its sibling's 500.
- `app/api/devcase/submit/route.ts` — no `rateLimit()`, while it mails a caller-supplied
  `contact` and can start a lifecycle task; both siblings throttle. Its refusals
  (`:43,:53,:57`, plus `source/route.ts:38,43`) are raw English prose rather than
  `jsonRefusal(CODE, …)`, so they ship untranslated to every locale.
- `app/_lib/repo-snapshot.ts:53-61` — `gh()` fetches with no timeout and no AbortSignal
  behind `Promise.all`; one hung api.github.com connection stalls the handler.
- `pipeline/jobfit/devcase/scenarios.py:196-204` and `submission_scenarios.py:99,101`
  (**D-B1/D-B2**) — two pickers keyed off the same `i`, so family and archetype (and
  behaviour and family) are welded together: only 6 of 18 — and 6 of 36 — combinations
  are ever emitted. The fairness gate and the discrimination metric are therefore
  measured on a diagonal slice, never strong-vs-weak within one family.
- `pipeline/jobfit/devcase/seed_materializer.py:183 vs 203` (**D-B3**) — file contents
  are clamped to `MAX_FILE_CHARS` AFTER the canary is planted, and the canary is
  validated only by `path`, so a flaw quoting text sliced out of the delivered seed is
  still graded against the candidate. Consumer side unread (see cuts).
- `app/_lib/group-eval-run.ts:443` vs `useDecisionsQueue.ts:663` — the server keys the row
  on `validatedSelection` (post consent-suppression and cohort filtering) while the client
  probes with every id it sent, so one suppressed candidate makes the keys differ
  permanently and every reopen re-spawns the full paid pipeline.
- `app/_lib/group-eval.ts:55-70` — a multi-statement `d.exec()` with an explicit
  `BEGIN; … COMMIT;` inside a swallowing try/catch; `exec` does not auto-rollback, so a
  mid-way failure leaves the module's long-lived connection inside an open transaction.
- `app/_lib/group-eval-run.ts:459` — governance stickiness needs one string but calls
  `getGroupEval`, which JSON-parses the entire persisted payload, twice on a selection
  run; `readGroupEvalCohortState` beside it is the cheap single-column read.
- `app/features/insights/matrix/MatrixDataNotices.tsx:87` — `title={m.error}` renders the
  engine's own `matrix_cli` error text to the user, the one thing
  `app/_lib/use-error-message.ts` forbids; every other site in the context obeys it.
- Recipe drift, five sites: `MatrixGrid.tsx:91` and `MatrixReasoningPopover.tsx:44`
  re-type `PANEL` verbatim; `MatrixTab.tsx:203` and `MatrixDataNotices.tsx:69,79`
  re-type `NOTICE` (and the red one's text shade silently differs from the house tone);
  `VoiceTranscript.tsx:49` is `PANEL` minus `shadow-panel`, which is where Spark Dark's
  drawn outline and 16px radius ride, so the candidate's largest surface is the one flat
  square box on the page; `VoiceInterview.tsx:818` / `MicTestPanel.tsx:20` re-type the
  same panel literal character for character.
- A11y: `MatrixGrid.tsx:103-110` sortable headers carry no `aria-sort`;
  `MatrixGridRow.tsx:84` conveys the archetype by colour plus a `title` on a
  non-focusable span; `VoiceInterview.tsx:377-380` focuses `endedCardRef`, which is
  attached only to the COMPLETED card, so a call that ends `failed` strands focus on
  `<body>`.
- `app/api/skill-profile/[token]/verify/route.ts:28-29` — the comment says "the missing
  rate-limit is a separate finding, left untouched here" while the rate limit is enforced
  eight lines above. `app/api/devcase/route.ts:28-29` — the comment says `1e9` "falls back
  to the default"; `caseLimitFrom` accepts and CLAMPS it, so a caller reading the comment
  expects 50 and gets 500.

### Gate output

`npm run typecheck` clean · `npm run lint` 0 errors / 55 warnings (pre-existing) ·
`npm run design:check` OK · `npm run i18n:check` 1 problem, PRE-EXISTING
(`app/features/setup-studio/useWizardSession.ts:660`; the main checkout shows 2) ·
`npm run test:docs`, `docs:check`, `api:check` OK.

`npm run test:unit` — **one failure, pre-existing and untouched by this branch**:
`app/_components/ui/recipes-literals.test.ts` ("recipe literals ratchet"), reporting
undeclared literals in `features/hiring/pipeline/empty/PipelineEmptyState.tsx` and
`features/hiring/pipeline/map/PipelineBoardSubway.tsx`. Neither file is in any of this
round's five contexts and neither was edited here; the same test fails on the main
checkout, with THREE entries rather than two. Not repaired, because re-baselining another
lane's ratchet from inside this round is how a ratchet gets laundered.

`npm run copy:check` could not run in this worktree at all — it executes
`.claude/skills/native-copy/scripts/copy-check.mjs`, a registry-linked skill that does not
exist under a `git worktree`. Environment gap, not a result; it runs from the main
checkout.

### Coverage after this round

| | |
|---|---|
| thread contexts read through all five lenses | **9 / 55** (16.4%) — was 4 / 55 |
| of the whole 143-map | **9 / 143** (6.3%) — was 4 / 143 |
| contexts where `ui-perfectionist` had a surface and ran | 3 (round 1: 1) |
| S findings fixed, test-first | 8 (round 1: 4) |
| M/L escalated with anchors | 11 + 1 unverified |
| confirmed S carried over, named above | 24 |

Read "9 / 55" as the honest number: 46 thread contexts have still never been read through
`ui-perfectionist`, `security-auditor`, `performance` or `ambiguity`. At this round's size
(5 contexts) that is nine more rounds — and the denominator itself needs the decision
recorded at the top of this section before round 3 picks its batch.

## Recorded per-context coverage — 2026-10-09, ROUND 3, READ-ONLY (branch `autopilot/codebase-static-analysis-sweep-1bca33a2`)

**The denominator, decided: this goal stays tracked against the retired 143-map.** Its 55
thread contexts are the seven thread groups of `git show 9c20a787:context-map.json`
(re-counted this round: CV Analysis & Candidate Profiles 8 + Candidate Matching & Scoring 7
+ Developer Assessment 9 + Hiring Decisions & Automation 8 + Hiring Pipeline 10 + Interview
Scheduling 5 + Voice Interviews 8 = 55). Three reasons. The goal was set and measured
against that map. Rounds 1 and 2 count against it. And no subset of the current map's
groups sums to 55, so re-mapping would be a judgement, and it would break comparability
with every number above. Every context id in this section is a 143-map id, and each file
list was resolved from `9c20a787`. The current root `context-map.json` was measured and not
used: **210 contexts in 27 groups** (generated 2026-09-21, last changed `b4bf32d7a`), not the
289 that round 2 wrote. Nothing was re-derived against it.

Third five-lens round of dev_goal `081c3e5a`. **Read-only:** every feature span was under an
open operator Approval until 09:00, so nothing in `app/`, `pipeline/` or `scripts/` changed.
Every finding is recorded here, not fixed. The batch is 5 contexts, each with exactly ONE
reconstructed `bug-hunter` batch in the table above:

- `analyze-ui-1` and `github-analysis`: CV Analysis, a step no five-lens round had read.
- `api-pipeline` and `pipeline-board-5`: Hiring Pipeline, also never read.
- `decisions-ui-2`: Hiring Decisions, which carries the explainability goal.

`app/api/comms/` was neither read nor judged, because another builder was changing a test
there.

### The round

`✓` = read through that lens and judged; *clean* = judged with nothing found, which IS
coverage; *n/a* = the lens has no surface here (no `.tsx` in the context). Counts are new
findings; S/M/L as in round 2.

| context | cat | files read | bug-hunter | ui-perfectionist | security-auditor | performance | ambiguity | fixed |
|---|---|---|---|---|---|---|---|---|
| `analyze-ui-1` | ui | 38 / 19 map-src | ✓ 2 S | ✓ 5 S | ✓ 1 M | ✓ 2 S | ✓ 2 S | - (read-only round) |
| `github-analysis` | lib | 13 / 11 map-src | ✓ 2 S | n/a | ✓ clean | ✓ 2 M | ✓ 2 S | - (read-only round) |
| `api-pipeline` | api | 21 / 11 map-src | ✓ 5 S, 1 M | n/a | ✓ 1 M | ✓ clean | ✓ 1 S | - (read-only round) |
| `pipeline-board-5` | lib | 18 / 12 map-src (3 gone) | ✓ 4 S | n/a | ✓ 1 M | ✓ 1 S, 1 M | ✓ 2 S | - (read-only round) |
| `decisions-ui-2` | lib | 32 / 14 map-src | ✓ 5 S, 1 M | ✓ 3 S | ✓ clean | ✓ 2 S | ✓ 4 S, 1 M | - (read-only round) |

### Declared cuts, stated rather than rounded away

- **"Files read" counts SOURCE files, read in full.** It is map source plus new source in the
  same directories that is in no 143-map context: analyze +19, github +2 (`fence.ts`,
  `skill-ledger.ts`), api-pipeline +10, board +9, decisions +18. All five directories grew;
  `analyze-ui-1`'s doubled.
- **Colocated `*.test.ts` files were read only for what they already assert**, so a covered
  case is not reported as a gap. They were never audited as code. This is the same gap
  rounds 1 and 2 declared.
- **`pipeline-board-5` lists three files that are gone:**
  - `usePipelineBoardScroll.ts` and `usePipelineCandidateDrawerState.ts` were deleted in
    `83f4979fa` (2026-09-16). The drawer state moved to
    `app/features/hiring/pipeline/candidate/state/`, which is not judged here.
  - `usePipelineSavedViews.ts` was deleted in `8e10b4218` (2026-10-08).
  - The board's new `.tsx` (`HumanScorecardByline`, `PipelineEntryNoteThread`,
    `SchedulerJobRow`) belongs to sibling ui contexts and was not judged.
  - The map files `result-view-unpriced.test.ts` under this context, but it tests
    CandidateResultView, which is not in it.
  - `usePipelineBulk.ts` and its two helpers have **no live caller** (the hook is
    unmounted, `usePipelineBulk.ts:3-7`), so R3-pipeline-board-5-4 is real but moot until
    remounted.
- **`decisions-ui-2`:**
  - The subdirectories `docket/`, `ledger/` and `groupEval/` (19 unmapped source files)
    were traced, not judged.
  - The sibling `decisions-ui-1` files were traced only.
  - `app/_lib/pipeline-entry-action.ts`'s reject side effects were not re-read for
    R3-decisions-ui-2-6.
  - The ranker's pool selection was not read (R3-decisions-ui-2-16 is UNVERIFIED for that
    reason).
- **`api-pipeline`:**
  - The `app/_lib/` libraries the routes call were traced at the cited lines, not judged.
  - `stage-hooks.ts`, `candidate-timeline.ts`, `attention.ts` and `proxy.ts` were not read.
    R3-api-pipeline-4's email side effect and R3-api-pipeline-7's demo-session reachability
    are marked accordingly.
- **`github-analysis`:**
  - `repo-snapshot.ts` past line 135 belongs to the dev-case context and was not read.
  - `pipeline/jobfit/devcase/provenance.py` was not read (the fence was judged against the
    TS tests).
  - The `.tsx` consumers were not read.
- **Observed out of lane, not counted:** a timed-out analysis stores the English
  `ANALYZE_TIMEOUT_MESSAGE` as `task.error` (`app/_lib/analyze-run.ts:184`), and
  `AnalyzeApi.ts:382` renders it verbatim in every locale. It belongs to `lib-analyze` /
  `analyze-ui-2`.
- **Line anchors were re-verified on the worktree.** One context's first pass anchored with
  `cat -n` over several files at once, so the numbering ran on across files. Every
  `analyze-ui-1` line was re-anchored with `grep -n` before this table was written. The
  other four were spot-checked.

### Findings

**51 new findings: 42 S, 9 M, 0 L.** One duplicate was not counted (below). Nothing was fixed
(read-only round). "C" = CONFIRMED, traced end to end; "U" = UNVERIFIED, with what was not
read. All `analyze-ui-1` paths are under `app/features/tools/analyze/`; all `decisions-ui-2`
paths are under `app/features/hiring/decisions/` unless rooted.

| id | lens | sev | file:line | what is wrong | path read | |
|---|---|---|---|---|---|---|
| R3-analyze-ui-1-1 | ui | S | `analyzeSurfaces.ts:10-11` | `DROP_ZONE_FOCUS` uses `focus-within`, but the `sr-only` file input is the label's SIBLING, so keyboard focus on every file picker (and the Replace / Add-variant labels) is invisible. `analyzeDesignSurface.test.ts:57-67` asserts only that the string is present | `AnalyzeFileDropZone.tsx:80-97,144-163`; `AnalyzeProfileInput.tsx:122-123`; `AnalyzeProfileInputFileList.tsx:50-56,85-95` | C |
| R3-analyze-ui-1-2 | ui | S | `AnalyzePasteRow.tsx:35-47` | once text exists the textarea turns `sr-only` but stays in the tab order (only `onBlur` exists), so Tab lands on an invisible field and typing edits the JD with no visible caret | `:41` onBlur, `:46` className | C |
| R3-analyze-ui-1-3 | ui | S | `history/HistoryTab.tsx:83,97,172` | the History load error renders `caught.message` (browser TypeError / SyntaxError text, English in every locale). The non-OK branch drops the route's code (`ANALYSES_LIST_FAILED`); `useErrorMessage` is never used; the box has no `role="alert"` and re-types NOTICE | `app/api/analyses/route.ts:72` → `HistoryTab.tsx:81-100` | C |
| R3-analyze-ui-1-4 | bug | S | `history/HistoryTab.tsx:126-144` | "Load more" during a filter change pairs the NEW generation and query with the OLD query's keyset cursor. The generation check passes, rows merge from the wrong position, and a broader new query gets a silent, never-filled gap | `:40` nextCursor, `:89` set on page 1, `:128,:131,:138` | C |
| R3-analyze-ui-1-5 | ui | S | `AnalyzePriorRunsStrip.tsx:114` | the raw disposition slug (`advance`/`hold`/`pass`) is interpolated into `priorDecidedBody`; cs reads "…označen jako pass" | `messages/cs.json:8958`; contrast `HistoryTab.tsx:30-33` | C |
| R3-analyze-ui-1-6 | bug | S | `AnalyzePriorRunsStrip.tsx:28-91` | `rawSummary` is never reset when the CVs or the JD change, so the previous candidate's or role's "already decided" verdict and report link show beside a different CV until the new hash and fetch resolve | effect `:30-88` | C |
| R3-analyze-ui-1-7 | security | M | `app/api/analyses/route.ts:46-67` | the History LIST serves the real `candidate_label` of consent-expired or anonymized candidates until the deferred sweep runs; the single-row GET masks it (`[slug]/route.ts:31-37`, whose comment names History as the reason). Also leaks through `q` search (`app/_lib/db/analyses.ts:245`), `HistoryTable.tsx:59,66`, `HistoryTriageDrawer.tsx:164` and `/api/analyze/prior`. M: per-row masking is N+1 and search-on-masked-name is a product call | `pipeline.ts:2800` sweep; `candidateLabelWithholdsPii` | C |
| R3-analyze-ui-1-8 | perf | S | `app/api/analyses/route.ts:67` | the workspace-wide facets scan (`analyses.ts:286-301`, correlated NOT EXISTS) re-runs on every keystroke, filter change and Load more; the client already tolerates a missing `facets` | `HistoryTab.tsx:90`; `historyQuery.test.ts:51` | C |
| R3-analyze-ui-1-9 | perf | S | `AnalyzePriorRunsStrip.tsx:40` | every `cvFiles`/`jdSlug`/`blind` change re-hashes every CV with SHA-256 (up to 3 × 8 MB), even on a JD-only pick; `analyzeCvReadability.ts:196` hashes the same files again | deps `:88` | C |
| R3-analyze-ui-1-10 | ui | S | `history/HistoryTable.tsx:67-72,87-92,112-114` | the decision note is `title`-only on a non-focusable span (the comment at `:112` promises "hover/focus"; `ui.md` bans `title=` tooltips); the ↻/⚠ chips carry their meaning only in `title`, so a screen reader hears "↻ 2" | — | C |
| R3-analyze-ui-1-11 | ambiguity | S | `history/historyTriage.ts:38-43` | `afterDecision`, `triageQueue` (`:21`) and `HistoryTypes.ts:59` `distinct` have no production caller. The drawer header (`HistoryTriageDrawer.tsx:4`) promises "walk to the next run still owed a decision", but `onSettled` (`:114-117`) only repaints | grep: only `historyTriage.test.ts:43-49` | C |
| R3-analyze-ui-1-12 | ambiguity | S | `useAnalyzeReadability.ts:25-52` | the comment at `:26` says the WeakSet keeps a removed File unpinned, but `results` is a strong-keyed Map that is never pruned. An `unchecked` (rate-limited/offline) file stays in `started` and is never re-measured, contradicting `analyzeCvReadability.ts:212-214` | `:42` add, `:47` set | C |
| R3-github-analysis-1 | bug | S | `app/_lib/github/cache.ts:20-22` | the cache key truncates the normalized JD to 4000 chars, so two JDs sharing a long boilerplate prefix get one key, and the second role is served the first role's job-fit signals and Gemini review, persisted onto the analysis row. `cache.test.ts:27` pins the collision against its own comment at `:22-23` | `route.ts:54,61-64`; `analysis.ts:131,133`; `analyze-github-stage.ts:95-100,127` | C |
| R3-github-analysis-2 | bug | S | `app/_lib/github/client.ts:117-119,229-231` | GitHub answers `/commits` on an empty repo with 409. That counts as coverage loss, so an empty repo in the shortlist marks the review `partial` (or `error: throttled` if it is the only one); it is never cached, and every retry re-spends ~33 REST calls plus a paid Gemini call | `code-review.ts:148,166,188-199,316` → `analysis.ts:40-41` → `route.ts:97`; `route.test.ts:96-97` mocks `200 []` | C (code); 409 is GitHub's documented response, not probed live |
| R3-github-analysis-3 | perf | M | `app/_lib/github/analysis.ts:82-91` | up to 20 concurrent `/languages` fetches, then 9 concurrent bundle reads (`code-review.ts:148`). That is the burst GitHub's secondary limiter targets; the code's own comment (`:75-76`) names it as the 403 source, and a 403 makes the run uncached, so the user retries into another burst | — | U: no live measurement of trip rate |
| R3-github-analysis-4 | perf | M | `app/_lib/github/analysis.ts:47-51` | `buildGithubAnalysis` takes no caller signal. The route does not pass `request.signal` (`route.ts:90`), and the analyze stage checks `aborted` only around the build (`analyze-github-stage.ts:103,127`), so a cancelled task or a gone client still pays every REST call and the Gemini call | `app/_lib/repo-snapshot.ts:62-77` (20 s timeout only) | C |
| R3-github-analysis-5 | ambiguity | S | `app/_lib/github/analysis.ts:64-73` | the FINDING #3 comment says pagination stopped flagship repos falling out of the "language mix", but `reposForLanguages = ownedRepos.slice(0, 20)` takes the 20 most recently UPDATED, so old flagships are still missing from Language Mix | `route.pagination.test.ts:114` asserts stars only | C |
| R3-github-analysis-6 | ambiguity | S | `app/api/github-analysis/route.ts:31,68` | "up to ~31 GitHub REST calls" (also `cache.ts:5`); the real ceiling is 33 (1 user + 3 pages + 20 languages + 3×3 bundle), more than half of the anonymous 60/h budget the throttle comment leans on | `client.ts:174`; `analysis.ts:73` | C |
| R3-api-pipeline-1 | bug | S | `app/_lib/pipeline-entry-action.ts:565` | a reject on an already-closed entry (rejected/declined/rematched/role_closed) re-applies: another sealed `rejected` record, another event, another queued rejection letter, another ATS `candidate.rejected`. On `declined` it overwrites the candidate's own decline and mails a rejection. The terminal guard is accept-only; a reject keeps the stage, so `expectedStage` passes on a double click, a stale board, or a duplicate id in a batch | `[id]/route.ts:226`, `batch/route.ts:158` → `:562-565` → seal → `db/pipeline.ts:3550-3552` (UPDATE without status predicate; the comment at `:3515` calls reject "idempotent") → `:650` `dispatchRejection` → `comms-dispatch.ts:566` → plain INSERT | C |
| R3-api-pipeline-2 | bug | S | `app/api/pipeline/events/recent/route.ts:30-35` | the live activity feed can freeze. An empty 7-day window answers `cursor: 0`; `?since=0` returns the 200 OLDEST events, which the 7-day filter drops, and the cursor is taken from the FILTERED list, so it never advances. With ≥200 old events no new event (the recruiter's own moves included) appears until reload | `usePipelineBoardData.ts:151-154,180` → `db/pipeline.ts:375-380` | C |
| R3-api-pipeline-3 | bug | S | `app/api/pipeline/command/execute.ts:108` | "advance top N" holds offers back only against its pre-loop snapshot. An offer drafted mid-loop sets `offer_review` without a stage move, so the core re-reads the row and EXTENDS it (`pipeline-entry-action.ts:431,453`) — an unattended offer the bar promises never happens | `command/route.ts:160` snapshot; nothing in the core checks `via: "command_bar"`; tests `command-execution-counts.test.ts:77`, `command-one-core.test.ts:151` cover only a pre-drafted offer | C |
| R3-api-pipeline-4 | bug | S | `app/api/pipeline/command/route.ts:167-170` | an advance_top confirm is not bound to the previewed ids (only reject_below is), so a candidate who entered the top N after the preview is advanced unseen. The `:167` comment ("non-destructive (no email), so unbound") contradicts `:27-30` and `batch/route.ts:41-44` (an advance fires the AI-interview / work-sample invite) | `CommandBar.tsx:69-71`; `pipeline-command.ts:118-126` | C (binding); U: `stage-hooks.ts` not read, so the email itself |
| R3-api-pipeline-5 | bug | S | `app/api/pipeline/[id]/route.ts:172,184-185` | reinstate checks "newest decision is an auto-rejection" outside the write, with `await humanActor()` between check and write; the locked store transaction re-checks only `status='rejected'` (`db/pipeline.ts:1455-1462`). A reopen + human reject landing inside the await gets a sealed "auto-rejection reversed" record written over a human decision. Low likelihood | comment `:163-171` states the invariant | C |
| R3-api-pipeline-6 | bug | M | `app/api/pipeline/command/route.ts:94,160` | the command bar and `GET /api/pipeline` (`route.ts:47`) read through `listPipeline`, which silently stops at `PIPELINE_BOARD_CAP` = 2000 ordered by job title and discards `truncated`. Above 2000 active entries, reject-below misses rows, advance-top ranks a title-ordered slice, preview totals understate, and the board cannot say it is incomplete | `db/pipeline.ts:782,823,834-835` | C |
| R3-api-pipeline-7 | security | M | `[id]/route.ts:219`, `batch/route.ts:121`, `command/route.ts:156` | the move / batch / command limiters key by IP only; behind no trusted proxy every caller shares one bucket (`rate-limit.ts:158-170`), so one team can exhaust the 300/10 min move budget for every team. The add door in the same tree keys `ws:ip` deliberately (`route.ts:84-86,216`) | `rate-limit-contract.test.ts:1355-1430` | C (keys); U: demo-session reachability (`proxy.ts` not read) |
| R3-api-pipeline-8 | ambiguity | S | `batch/route.ts:44-46`; `app/_lib/pipeline-entry-action.ts:131`; `[id]/route.ts:222` | three comments the code contradicts: the dry run checks missing BEFORE terminal (`:63-69`), so a preview answers `PIPELINE_ENTRY_NOT_FOUND` where the real move answers `PIPELINE_TERMINAL_NOT_MANUAL`; "the batch route can't extend offers — see the guard below" (no guard exists; `:453` extends); "the three … actions" lists four | — | C |
| R3-pipeline-board-5-1 | bug | S | `app/_lib/db/agents.ts:845` | `foldActivity` stamps `lastActivityAt` from EVERY ledger row, lifecycle rows included, and every dispatched hire gets one at mint. A just-dispatched agent therefore reads as having data: run metrics say "missed", and `reports_rejected` / `none_accepted` can never fire for a hire that came through the transition door | `agents.ts:807` → `:445` lifecycle row via `mint.ts:137` → `api/agents/route.ts:73,91` → `agentsWorkforceLogic.ts:176,407`; `agents-bridge.test.ts:102` builds the hire without a ledger row | C |
| R3-pipeline-board-5-2 | bug | S | `app/features/hiring/pipeline/usePipelineBoardData.ts:101` | `load()` aborts the previous controller unconditionally, including for an `eventsOnly` call, so a move's success (`:308`) cancels an in-flight FULL reconcile (another move's refusal rollback `:292`, the 30 s poll); the aborted half commits nothing (`:116`). With `PipelineKitOffBoard.tsx:44` firing N moves at once, a refused card stays wrong until the next poll | — | C |
| R3-pipeline-board-5-3 | bug | S | `app/features/hiring/pipeline/useSchedulerControlState.ts:179-200` | scheduler errors are wrapped twice ("Couldn't update the schedule: Couldn't update the schedule: HTTP 500"), a refused "Run now" is labelled as an update failure, and a non-JSON body (proxy 502) renders the SyntaxError's English `e.message` | `:179` `r.json()` → `:180` throw → `:196` → `:199-200`; catalog `pipeline.scheduler.updateFailed` | C |
| R3-pipeline-board-5-4 | bug | S | `app/features/hiring/pipeline/usePipelineBulk.ts:193-195,231-238` | `bulkMove` deselects selected-but-non-actionable rows (`keep` is built from previewed + held-back only); `bulkDecide`/`bulkInvite` keep them. "Failures stay selected" differs per action. No live impact: the hook is unmounted | `:3-7` | C |
| R3-pipeline-board-5-5 | security | M | `app/features/hiring/pipeline/schedulerRunState.ts:89` | `describeTick` renders `tick.error` verbatim: an `e.message` caught inside `tickScheduler` (`app/_lib/scheduler.ts:51-53`), returned in a 200 and forwarded unprojected (`app/api/automation/schedule/route.ts:175-176`). That is the same exception class the route's own catch (`:178-180`) codes as `SCHEDULE_UPDATE_FAILED` because it quotes db paths, SQLite text and Python tracebacks. Operator-only route; `schedulerRunState.test.ts:62-63` pins the verbatim render | — | C |
| R3-pipeline-board-5-6 | perf | M | `app/api/agents/route.ts:58-91` | GET /api/agents is unbounded `listHiredAgents` (retired/failed hires stay forever) plus 3-4 statements per hire, one of them `SELECT *` over the hire's whole ledger incl. `raw_json` (`agents.ts:807`). `getWorkspaceAgentTotals` (`:901`, palette preview, per keystroke) does `SELECT *` over the workspace ledger; the ledger grows a lifecycle row per transition call, refused ones included | `lifecycle.ts:62` | C (cost); U: workforce UI poll cadence |
| R3-pipeline-board-5-7 | perf | S | `app/features/hiring/pipeline/usePipelineTabState.ts:198-205` | `lastBatchDone` starts null, so on mount any succeeded `batch_screen` in the 7-day task window calls `load()`, which aborts the shared mount load (`usePipelineBoardData.ts:192`) and fires a second full `/api/pipeline` read on every visit for a week | effect order documented `:12-14` | C |
| R3-pipeline-board-5-8 | ambiguity | S | `app/features/hiring/pipeline/pipelineBoardStorage.ts:1-2,30-46` | both headers (and `usePipelineTenant.ts:4,20-21,29`) describe saved views as live per-tenant memory after `8e10b4218` deleted them; `adoptTenant` still migrates `kp.pipelineViews` into `kp.pipelineViews:<ws>`, a key nothing reads or clears, so the cross-tenant names the header calls "THE LEAK" are kept forever under the first tenant | grep: no reader of `pipelineViewsKey`; `pipelineBoardStorage.test.ts:56-66` | C |
| R3-pipeline-board-5-9 | ambiguity | S | `app/features/hiring/pipeline/usePipelineFilters.ts:81,100-101,166`; `usePipelineBoardData.ts:202`; `app/_lib/db/tasks.ts:162-167` | four comments contradict the code: filters "do NOT write back to the URL" (`:127-160` does); "saved-view" round-trips (deleted); `/api/pipeline/events?since=` (the code calls `/events/recent`); the dedupe index "on dedupe_key alone … must widen before KP_MULTI_WORKSPACE" (already widened: `core.ts:2605-2610` `uq_tasks_active_dedupe_ws`) | — | C |
| R3-decisions-ui-2-1 | bug | S | `useDecisionsQueue.ts:379,419-427` | a reject waiting in its 8 s undo window is hidden from the ledger but stays in `selectableReviews`, so "Select all → Accept N" advances it. At expiry `commitDecision` 409s, and the undo strip says the reject "did not land" while the candidate sits advanced with prep started. `pendingHeaderCount` also counts hidden rows | `docket/DocketSurface.tsx:79,166` → `:476-488` → `db/pipeline.ts:3587-3595`; `decisionsCommitWindow.ts:183` | C |
| R3-decisions-ui-2-2 | bug (explainability) | S | `DecisionsScreenWaveModal.tsx:73` | after a FAILED re-preview the modal keeps the old rows but compares them to the NEW slider value (`displayedFloor = maxMatch`), so every reject row grows a "family floor N" badge and the summary claims "N rows used a family override" that never existed. The comment at `:68-72` says this was fixed; the fix covers `loading` only | `decisionsScreenWaveMachine.ts:249,252` → `DecisionsScreenWaveLists.tsx:60-71,110` | C |
| R3-decisions-ui-2-3 | bug | S | `useDecisionsQueue.ts:222-237` | the reconsider read keeps only `items`, dropping `{truncated,total}` (route caps at 50 and says it "must not pretend the wave ended there"), so 300 auto-rejects read "50". A non-OK JSON body (401 on session lapse) falls to `p.items ?? []` and EMPTIES the list, against the comment at `:231-235` | `app/api/decisions/reconsider/route.ts:23,72` → `docket/DocketHead.tsx:126-127`; `DecisionsReconsiderQueue.tsx:56` | C |
| R3-decisions-ui-2-4 | bug | S | `useDecisionsQueue.ts:266-296` | a successful reinstate calls only `load()` (`:288`) and never invalidates `reconsiderGate`, so a reconsider read already in flight settles after the row was removed and re-lists it; a second reinstate click 409s. The comment at `:217-220` says the gate covers this "after every reinstate" | contrast `act()` `:612` | C (path); race frequency not measured |
| R3-decisions-ui-2-5 | bug | S | `DecisionsTab.tsx:62-65` | `void navigator.clipboard?.writeText(link); setCopiedOfferId(id)` shows "copied" whether or not anything was copied. On a plain-http self-hosted LAN origin `clipboard` is undefined, and the link the recruiter thinks they copied is the secure offer link | `DecisionsBanners.tsx:88-91`; `export-utils.ts:134` `copyText()` returns success, unused here | C |
| R3-decisions-ui-2-6 | bug | M | `DecisionsModals.tsx:78` | the analysis modal's Reject (one click, `DecisionsAnalysisParts.tsx:246-251`) writes immediately through `act()` (`useDecisionsQueue.ts:580,617-620`), bypassing the undo window the window's own header (`decisionsCommitWindow.ts:2-8`) calls the cure for single-row rejects. Design choice: `WindowDecision` carries no `detail`, so the typed reason cannot ride the window today | — | C to `act()`; U: reject's mail/seal taken from the header, `pipeline-entry-action.ts` not re-read |
| R3-decisions-ui-2-7 | ambiguity | S | `useDecisionsQueue.ts:317-341` | the "JD edited since this score" times are "fetched once (and on live refresh)", but the effect keys on `aiReviewJobKey`, which changes only when the SET of jobs changes; live refresh (`:254-257`) never re-runs it. A JD edited while the tab is open never gains the chip; peer-context (`:344-358`) is the same | — | C; U: whether a JD edit fires the bus, and remount on `?tab=` |
| R3-decisions-ui-2-8 | ambiguity (explainability) | M | `decisionsPeerCompare.ts:7-12,29-40` | rank, median and delta-to-best mix CV-analysis scores with "snapshot at add" scores, and `PeerScore` drops `scoreProvenance`, so no consumer can disclose the mix; `DecisionsPeerViz.tsx:71` discloses only the unscored count. Design choice: disclose, or rank within one producer | — | C |
| R3-decisions-ui-2-9 | ambiguity (explainability) | S | `decisionsAiReviewCardLogic.ts:1-4,68-91` | the model's self-reported confidence is computed and test-pinned (`decisionsAiReviewCardLogic.test.ts:98`) but rendered nowhere. The comments (and `DecisionsShared.tsx:21`) name a deleted `DecisionsAiReviewCard`, and the live consumers (`pipeline/candidate/decision/CandidateDecisionBar.tsx:28`, `CandidateDecisionPanel.tsx:17`) never read `modelSelfReport`. An `llm` verdict with no provider (`:101`) shows no engine line, indistinguishable from a pre-provenance payload | `CandidateDecisionBar.tsx:63-71` | C |
| R3-decisions-ui-2-10 | ambiguity | S | `decisionsDecideOutcome.ts:3-5` | the header says the quick reject and the candidate modal go "all via useDecisionsQueue's act()"; both now go through `commitDecision` | `docket/DocketSurface.tsx:98`; `useDecisionsCandidate.ts:62-63` | C |
| R3-decisions-ui-2-11 | ui | S | `DecisionsScreenWaveModal.tsx:159-172` | with auto-reject off the sliders only LOOK disabled (`pointer-events-none opacity-40` on the wrapper, no `disabled`), so the keyboard still changes them and fires re-previews, and screen readers announce them active | `:165,:172` | C |
| R3-decisions-ui-2-12 | ui | S | `DecisionsBatchBar.tsx:87-116` | "Reject N" (`:108`) unmounts itself to mount the confirm row, and Cancel (`:98`) does the reverse; both drop focus to `<body>` at an irreversible, mail-sending step | — | C |
| R3-decisions-ui-2-13 | ui | S | `DecisionsScreenWaveModal.tsx:90,106,182`; `DecisionsBatchBar.tsx:43,94` | hand-rolled `BTN_PRIMARY` (×2), a hand-rolled ink button, `NOTICE("critical")` without its border, and `PANEL_ACCENT` with the wrong radius and no shadow: flat `rounded-md` buttons in Spark Dark beside recipe buttons. The literals ratchet does not track these shapes | `app/_components/ui/recipes.ts:95-260`; `recipe-debt.json` | C |
| R3-decisions-ui-2-14 | perf | S | `useDecisionsQueue.ts:297` | `fmtDate` constructs an `Intl.DateTimeFormat` per call, once per reconsider row (≤50) per render. Same pattern as round 2's `zonedParts`, different site | — | C |
| R3-decisions-ui-2-15 | perf | S | `useDecisionsQueue.ts:360,376` | `staleSinceOf` and `visibleAiReviews` are fresh identities every render, so the memos in `docket/DocketSurface.tsx:79-89` (rows → locale-sorted `docketGroups` → headline) never hit; the whole ledger model rebuilds on each selection toggle and poll | — | C |
| R3-decisions-ui-2-16 | ambiguity (explainability) | S | `decisionsAnalysisSummaryData.ts:79-91` | the response's `poolTruncated` is ignored; if the ranking pool is capped, a filed but unscored candidate drops out of "the field" and the peer counts without a caveat | — | U: the ranker's pool selection not read |

### Duplicates, not counted

- `app/_lib/group-eval-run.ts:443` vs `useDecisionsQueue.ts:663` (validatedSelection key
  mismatch re-spawns the paid pipeline on every reopen) is the round-2 S carry-over above.
  Pointer update: `:663` is now the hook's return block, and the probe moved to
  `app/features/hiring/decisions/groupEval/useGroupEvalOpen.ts`, a cut directory this
  round, so it was not re-traced.
- Nothing else matched rounds 1-2 or "Known gaps" in
  `docs/architecture/engine-and-prompt-coordination.md`.
- Adjacent to a round-2 item, not the same finding: round 2's carry-over
  "`app/_lib/repo-snapshot.ts:53-61` — `gh()` fetches with no timeout" is **no longer
  true**. `githubRead` now carries `AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS)` (`:76`,
  landed with `bd0cb137e`). R3-github-analysis-4 is the remaining caller-cancel half.

### Confirmed S findings NOT fixed this round — carry-over, written to be taken as-is

Each line is the fix, then the test that fails today and passes after it. One commit per
line, test-first, as round 2 did.

- **R3-analyze-ui-1-1.** Fix: render each input first as `peer sr-only`, change
  `DROP_ZONE_FOCUS` to a `peer-focus-visible:` ring, and give the Replace / Add-variant
  labels the same peer ring. Do not nest the input in the `role="button"` label. Test
  (`analyzeDesignSurface.test.ts`): `DROP_ZONE_FOCUS` contains `peer-focus-visible` and
  not `focus-within`, and each zone's `peer sr-only` input precedes its `<label htmlFor>`.
- **R3-analyze-ui-1-2.** Fix: `onFocus={() => setIsEditing(true)}` on the TextArea. Test
  (`analyzeDesignSurface.test.ts`): the AnalyzePasteRow TextArea declares an `onFocus`
  that sets editing.
- **R3-analyze-ui-1-3.** Fix: on `!ok`, use
  `errorMessage(payload, t("loadFailedStatus",{status}))`; the catch falls back to
  `t("loadFailed")`; render with `role="alert"` and `NOTICE("critical")`. Test (extend the
  source test at `history/historyQuery.test.ts:61`): HistoryTab imports `useErrorMessage`
  and never renders `caught.message`.
- **R3-analyze-ui-1-4.** Fix: `cursorGenRef`, set beside `setNextCursor` on page 1;
  `loadMore` bails (or the button disables) when it differs from `reqGen.current`. Test:
  a pure `cursorBelongsToQuery(cursorGen, currentGen)` in `historyQuery.ts`, tested in
  `historyQuery.test.ts`, plus a source assertion that `loadMore` calls it.
- **R3-analyze-ui-1-5.** Fix: map the slug through the `history` `disposition.<d>`
  labels, as `HistoryTab.tsx:30-33` does. Test (`analyzePriorRuns.test.ts`, source
  contract): the `disposition:` argument is not `summary.decision.disposition` passed bare.
- **R3-analyze-ui-1-6.** Fix: store `{ key, summary }` (file identities + JD slug) and
  render `none` while the key differs. Test: a pure `currentSummary(stored, key)` in
  `analyzePriorRuns.ts`; `analyzePriorRuns.test.ts` asserts a mismatched key answers
  `none`.
- **R3-analyze-ui-1-8.** Fix: compute facets only when `cursor` is absent. Test
  (`analyses-routes.test.ts`): a `cursor=` GET has no `facets` key.
- **R3-analyze-ui-1-9.** Fix: a module `WeakMap<File, Promise<string>>` memo around
  `cvVariantHash`, shared with `measureFile`. Test: the same File hashed twice calls the
  hasher once.
- **R3-analyze-ui-1-10.** Fix: `sr-only` count sentences on the ↻/⚠ chips, and the note
  through `Tooltip` or an expander instead of `title`. Test (source contract): no
  `title={row.decision_note}`, and the chips render the count sentence.
- **R3-analyze-ui-1-11.** Fix (pick one): call `go(afterDecision(rows, slug, mode))` on
  an accepted save, or delete `afterDecision` / `triageQueue` / `distinct` and correct both
  headers. Test (if wired): a source contract that `onSettled` calls `afterDecision`.
- **R3-analyze-ui-1-12.** Fix: prune `results` to the current files on set, and drop
  `unchecked` files from `started`. Test: a pure `pruneReadability(map, files)`.
- **R3-github-analysis-1.** Fix: hash the full normalized JD and drop
  `GITHUB_CACHE_JD_KEY_MAX` (the route already refuses JDs over 20k). Test
  (`app/_lib/github/cache.test.ts`, replacing `:27`): two JDs sharing a 5000-char prefix
  with different tails produce different keys.
- **R3-github-analysis-2.** Fix: in the bundle's commits `.catch`, treat
  `GithubHttpError` 409 as real absence, like a 404. Test
  (`app/api/github-analysis/route.test.ts`): mock `/commits` as 409 and assert
  `codeReview.status === "empty"`, `partial` falsy, and a second POST served from cache
  with no fetches.
- **R3-github-analysis-5.** Fix: slice `rankedRepos`, not `ownedRepos`, for languages, or
  drop "language mix" from the comment. Test (`route.pagination.test.ts`): a page-3
  flagship with a distinct language appears in `languages`.
- **R3-github-analysis-6.** Fix: "up to 33", derived beside `REPO_PAGE_CAP`, in all three
  comments. Test: none (comment only).
- **R3-api-pipeline-1.** Fix: line 565 becomes
  `if (isTerminalEntryStatus(live.status)) return staleResponse(live);` for accept AND
  reject, before the seal, so a refused repeat leaves no record. Test
  (`app/_lib/pipeline-entry-action.test.ts`): reject one entry twice with the same
  `expectedStage`; the second answers 409, and the outbox holds exactly one `rejection`
  row and the decision records exactly one `rejected` record for it.
- **R3-api-pipeline-2.** Fix: cursor from the unfiltered page (`raw.at(-1)?.id ?? since`);
  an empty first page answers the workspace's newest event id, not 0. Test (new
  `app/api/pipeline/events/recent/route.test.ts`): seed 201 events 30 days old, GET,
  record one new event, GET `?since=<cursor>`, assert the new event is returned.
- **R3-api-pipeline-3.** Fix: in the core before `:453`,
  `if (input.via === "command_bar" && current.approvalKind === "offer_review") return err(422, "PIPELINE_TERMINAL_NOT_ADVANCE")`;
  `execute.ts` already counts that code as `heldAtOffer`. Test
  (`command-one-core.test.ts`): snapshot an entry, `setApproval(id, "offer_review", …)`,
  run `advance_top` on the stale snapshot, assert `heldAtOffer === 1`, the approval
  intact, and no offer row.
- **R3-api-pipeline-4.** Fix: `CommandBar` sends `matchedIds` for `advance_top` too;
  `route.ts:170` intersects targets with them, as `resolveRejectTargets` does; correct the
  `:167` comment. Test (`command/route.test.ts`): preview "advance top 1" → A; add a
  higher-scoring B; confirm `confirmIds:[A]`; B untouched.
- **R3-api-pipeline-5.** Fix: resolve `actor` before the check so check and write are
  adjacent sync calls, or better, move the newest-decision predicate into
  `reinstatePipelineEntry`'s locked transaction. Test (store): reinstating an entry whose
  newest decision is a human `rejected` returns null.
- **R3-api-pipeline-8.** Fix: correct the three comments; optionally move the
  `getPipelineEntry` check after the terminal check in `previewItem`. Test
  (`batch/route.test.ts`): a dry run with a missing id and a terminal target expects
  `PIPELINE_TERMINAL_NOT_MANUAL`.
- **R3-pipeline-board-5-1.** Fix: stamp `lastActivityAt` only inside the `rollup` and
  `execution` branches, or filter `kind IN ('execution','rollup')` in both readers. Test
  (`app/_lib/db/agents-store.test.ts`): create a hire, `transitionHiredAgent` once, assert
  `lastActivityAt === null`; `recordAgentExecution`, assert non-null.
- **R3-pipeline-board-5-2.** Fix: separate abort refs for the board and events halves; an
  `eventsOnly` call aborts only the events fetch. Test (`pipelineMovePath.test.ts`,
  source-level): the eventsOnly branch never touches the board controller.
- **R3-pipeline-board-5-3.** Fix: `r.json().catch(() => null)`; on `!r.ok` set the text
  from `errMsg(p, t(body.tick ? "runFailed" : "updateFailed", …))` once; the catch uses
  `t("networkError")`, never `e.message`. Test: extract `scheduleFailureText` into
  `schedulerRunState.ts`; `schedulerRunState.test.ts` asserts an uncoded toggle 500
  contains "Couldn't update the schedule" exactly once and a tick failure does not
  contain it.
- **R3-pipeline-board-5-4.** Fix:
  `untouched = [...selectedIds].filter(id => !attempted.includes(id) && !alreadyThere.includes(id))`.
  Test (`pipelineBulkSelection.test.ts`): active A + rejected B selected; a move settle
  keeps B.
- **R3-pipeline-board-5-7.** Fix: the first effect run records the newest succeeded
  `finishedAt` without loading; only later changes call `load()`. Test: a pure
  `batchDoneTrigger(prev, tasks)` → `seed | reload | none`, where the first observation
  is `seed`.
- **R3-pipeline-board-5-8.** Fix: replace the views migration with removal of
  `LEGACY_VIEWS_KEY` and `pipelineViewsKey(ws)`, and correct both headers. Test
  (`pipelineBoardStorage.test.ts`, replacing `:56-66`): after adoption both views keys
  are null.
- **R3-pipeline-board-5-9.** Fix: delete or rewrite the four sentences. Test: none (comment
  only).
- **R3-decisions-ui-2-1.** Fix: read `hiddenIds(useDecisionCommitWindow())` in
  useDecisionsQueue and drop those ids from `selectableReviews`, `selectedReviewIds` and
  the header count. Test (`decisionsSelectionHygiene.test.ts`): a pure
  `selectableAmong(visible, hidden)` never yields a hidden id, plus a source assertion
  that the hook uses `hiddenIds`.
- **R3-decisions-ui-2-2.** Fix: `previewSucceeded` carries the floor it was computed at
  (as it already carries `spare`), stored as `previewFloor`; the modal compares against
  `previewFloor`, not `maxMatch`. Test (`decisionsScreenWaveMachine.test.ts`):
  succeeded{floor:40} → started → failed → settled leaves `previewFloor === 40`.
- **R3-decisions-ui-2-3.** Fix: a pure `readReconsiderResponse(ok, body)` fold returning
  `{items,total,truncated}` or a failure; on failure keep the list; render `total` (`N+`
  as `DecisionsFeedbackLetters.tsx:40` does). Test (`decisionsQueueLoad.test.ts`): a
  non-OK body is a failure, not `[]`, and `truncated`/`total` read through.
- **R3-decisions-ui-2-4.** Fix: on `outcome.ok`, `reconsiderGate.current.invalidate()` (or
  `loadReconsider()`). Test (`decisionsLatestWins.test.ts`, source): the reinstate
  success branch invalidates `reconsiderGate`.
- **R3-decisions-ui-2-5.** Fix: `if (await copyText(link)) setCopiedOfferId(id)`; else
  select the input and show an error toast. Test (source contract): DecisionsTab uses
  `copyText` and sets `copiedOfferId` only on success.
- **R3-decisions-ui-2-7.** Fix: bump a nonce from the live-refresh handler and add it to
  the jd-freshness and peer-context effect deps. Test (source): the jd-freshness effect
  depends on that nonce.
- **R3-decisions-ui-2-9.** Fix (pick one): render `modelSelfReport` in
  `CandidateDecisionBar` under its "model's self-report" label, or drop the field and its
  test; render "LLM" when `verdictSource === "llm"` and the provider is unknown; correct
  the dead component names. Test: rendering → a source assertion that
  CandidateDecisionBar reads `modelSelfReport`; dropping → retire
  `decisionsAiReviewCardLogic.test.ts:98`.
- **R3-decisions-ui-2-10.** Fix: correct the header. Test: none (comment only).
- **R3-decisions-ui-2-11.** Fix: `disabled={!enabled}` on both range inputs. Test
  (`decisionsScreenWaveMachine.test.ts`, which already reads the modal source at
  `:161-176`): both ranges carry `disabled={!enabled}`.
- **R3-decisions-ui-2-12.** Fix: refs that focus "Yes, reject" when the confirm opens and
  return focus to "Reject N" on cancel. Test (source): the focus refs exist and are
  called on both transitions.
- **R3-decisions-ui-2-13.** Fix: compose `BTN_PRIMARY` / `NOTICE("critical")` /
  `PANEL_ACCENT`. Test (source): neither file contains a `bg-coral … text-white` button
  literal.
- **R3-decisions-ui-2-14.** Fix: `useMemo(() => new Intl.DateTimeFormat(locale, …),
  [locale])`. Test (source): no `new Intl.DateTimeFormat` inside `fmtDate`.
- **R3-decisions-ui-2-15.** Fix: `useCallback(staleSinceOf, [jdEditedAt])` and memoise
  `visibleAiReviews`. Test (source): both are wrapped.
- **R3-decisions-ui-2-16** is S but UNVERIFIED. Read the ranker's pool selection first.
  If capped pools can exclude filed candidates, disclose `poolTruncated` in the summary;
  the test is a summary-data case with `poolTruncated: true` that asserts the caveat.

The 9 M findings (R3-analyze-ui-1-7, R3-github-analysis-3/4, R3-api-pipeline-6/7,
R3-pipeline-board-5-5/6, R3-decisions-ui-2-6/8) need a design choice or a multi-file change.
They are anchored in the findings table and escalated, not carried as S.

### Gate output

This round changed no source, so the code gates were run once, on the branch base
`dfecc020f`:

- `npm run typecheck` clean (it rewrote the three `app/_lib/*.generated.ts` files with
  CRLF only, restored).
- `npm run lint`: 0 errors / 49 warnings (pre-existing).
- `npm run test:unit`: 13014 / 13014.
- `node scripts/run-unit-tests.mjs "scripts/kpi/**/*.test.mjs"`: 85 / 85.
- `npm run test:docs` and `npm run docs:check` ran on the tree WITH this section: both exit 0
  (`docs:check`: 22 decision records valid).

### Coverage after this round

| | |
|---|---|
| thread contexts read through all five lenses | **14 / 55** (25.5%) — was 9 / 55 |
| of the whole 143-map | **14 / 143** (9.8%) — was 9 / 143 |
| contexts where `ui-perfectionist` had a surface and ran | 5 (was 3) |
| thread groups with no five-lens context | **0 / 7** — was 2 / 7 (CV Analysis and Hiring Pipeline now hold two each; Interview Scheduling and Voice Interviews still hold only one) |
| S findings fixed | 0 (read-only round) — round 2: 8 |
| new findings recorded | 51 (42 S, 9 M) + 1 duplicate |
| S carried over, written fix-and-test-ready | 42 (41 CONFIRMED, two of them with a named unverified side; 1 UNVERIFIED) |

All five contexts count: every applicable lens ran on each, and the three n/a cells are
contexts with no `.tsx`. 41 thread contexts remain. At five per round that is nine more
rounds, now against a settled denominator.

## Recorded per-context coverage — 2026-10-09, ROUND 4, READ-ONLY (branch `autopilot/codebase-static-analysis-sweep-2fe18012`)

**The denominator is round 3's, unchanged:** the 55 thread contexts of the retired 143-map
(`git show 9c20a787:context-map.json`), decided and re-counted in the round-3 section above.
Every id below is a 143-map id, and each file list was resolved from `9c20a787`.

Fourth five-lens round of dev_goal `081c3e5a`. **Read-only:** every feature span was under an
open operator Approval until 09:00, so nothing in `app/`, `pipeline/`, `scripts/` or
`messages/` changed. Every finding is recorded here, not fixed. The batch is 5 contexts, each
the least reconstructed coverage in its group by the per-group tables at the top of this file
(one `bug-hunter` batch each):

- `voice-runtime-1` and `interview-ui-and-voice-interview-portal-and-interviews`: Voice
  Interviews, which round 3 left holding one five-lens context.
- `schedule-ui-2`: Interview Scheduling, which also held one.
- `matrix-ui-1`: Candidate Matching & Scoring.
- `api-devcase-1`: Developer Assessment.

`app/api/comms/`, the `about.*` / `landing.*` catalog keys,
`app/features/insights/about/chapters.test.ts` and `app/landing/spark/MarketingClaims.test.ts`
were neither read nor judged: another builder was changing them.

### The round

`✓` = read through that lens and judged; *clean* = judged with nothing found, which IS
coverage; *n/a* = the lens has no surface here (no `.tsx` in the context). Counts are new
findings; S/M/L as in round 2.

| context | cat | files read | bug-hunter | ui-perfectionist | security-auditor | performance | ambiguity | fixed |
|---|---|---|---|---|---|---|---|---|
| `voice-runtime-1` | lib | 23 / 10 map-src | ✓ 4 S | n/a | ✓ 2 S | ✓ clean | ✓ 2 S | - (read-only round) |
| `interview-ui-and-voice-interview-portal-and-interviews` | ui | 11 / 9 map-src | ✓ 3 S | ✓ 4 S, 1 M | ✓ 2 S | ✓ 1 S (U) | ✓ 2 S | - (read-only round) |
| `schedule-ui-2` | ui | 39 / 19 map-src | ✓ 6 S, 2 M | ✓ 6 S | ✓ 1 S, 1 M | ✓ 1 S | ✓ 1 S | - (read-only round) |
| `matrix-ui-1` | ui | 21 / 17 map-src | ✓ 6 S | ✓ 6 S | ✓ clean | ✓ 1 M | ✓ 2 S, 1 M | - (read-only round) |
| `api-devcase-1` | api | 17 / 16 map-src | ✓ 6 S, 1 M | n/a | ✓ 1 S, 2 M | ✓ 2 S | ✓ 2 S | - (read-only round) |

### Declared cuts, stated rather than rounded away

- **"Files read" counts SOURCE files, read in full.** It is map source plus new source in the
  same directories that is in no 143-map context: voice +13 (`director*.ts`,
  `director-tools.mjs`, `asr-keywords.mjs`, `discarded-turns.ts`, `mint-error.ts`,
  `provider-traits.ts`, `readiness.ts`, `resume.ts`, `transcript-of-record.ts`), interview +2
  (`simBilling.ts`, `portal-state.ts`), schedule +20, matrix +4 (all in `focus/`), devcase +1
  (`session/session-limits.ts`). `app/_lib/voice/` more than doubled; `schedule/` doubled.
- **No listed file is gone.** All 85 `file_paths` of the five contexts exist on this tree.
- **Colocated `*.test.ts` files were read only for what they already assert**, so a covered
  case is not reported as a gap. They were never audited as code. Same gap as rounds 1-3.
- **`voice-runtime-1`:**
  - The three `.d.mts` declaration files were not opened.
  - `quote-match.ts` and `interview-sim/director-loop.ts` were not read; `interview-run.ts`
    and `interview-agenda.ts` were read only at the lines cited.
  - Performance is *clean* by reasoning, not measurement: about three state derivations
    and one events read of at most ~4100 rows per director exchange, under an IMMEDIATE
    lock, at a rate-limited ≤0.4 requests/s.
- **`interview-ui-and-voice-interview-portal-and-interviews`:**
  - The map puts `app/_lib/db/` in this context's directories, and that directory gained
    ~150 unrelated files. Only the functions `interviews.ts` calls were traced; none was
    counted as read.
  - `app/_components/voice/**` was traced only as far as the props the portal passes.
    `anonymizeEntry` (`app/_lib/db/pipeline.ts`) was not read, which is the open half of
    R4-interview-ui-2.
  - Recipe drift at `interview-lab/page.tsx:51,55` and `InterviewStartPanel.tsx:49` is
    already declared in `recipe-debt.json` / `style-debt.json` and is not filed.
- **`schedule-ui-2`:**
  - The sibling `schedule-ui-1` files (`useScheduleTab.ts`, `ScheduleCalendar.tsx`,
    `ScheduleAiRound.tsx`, `useScheduleInviteLifecycle.ts`) were traced, not judged. Three
    findings below have their fix site there and say so.
  - `ScheduleInterviewTelemetryStrip`, `ScheduleInterviewObservations` and
    `ScheduleInterviewRecordings` pass server enum values into `t(KEY[x])`; whether the
    server narrows them was not checked, so a possible throw is not filed.
- **`matrix-ui-1`:**
  - The new files in the parent `matrix/` directory (`MatrixGridRow.tsx`,
    `matrixSelection.ts`, `useMatrixTab.ts`, …) belong to `matrix-ui-2`, which round 2 read
    through five lenses. They were traced, not judged.
  - The Python reasoning task handler was not read, so R4-matrix-ui-1-5's English-text
    branch is inferred from `app/_lib/tasks.ts:736`; its CODE branch is traced.
  - Recipe drift at `MatchJobCompare.tsx:46`, `MatrixCandidateFocus.tsx:67` and
    `MatchResultsHeader.tsx:73` is declared in `recipe-debt.json:130-140` and is not filed.
- **`api-devcase-1`:**
  - `app/_lib/devcase-session-auth.ts` internals, `readJsonWithLimit`, `task-budget.ts`,
    the billing `meterGate`, `wrapUpRecipients` / `stopVerdict` and `createPipelineEntry`'s
    dedup were not read. So promote double-click idempotency is unjudged, and whether
    `meterGate` bounds redesign spend on a self-hosted install is open.
- **One finding was found by one read and filed under the other context.** The
  `voice-runtime-1` read, checking the claim at `candidate-brief.ts:32-34`, found that
  `app/interview/[token]/page.tsx:157` hands the raw run-of-show to a client component. The
  `interview-ui` read had judged that page's props clean. The code decides: it is filed as
  R4-interview-ui-13, under the context that owns the file, and counted once.
- **Observed out of lane, not counted:** `app/_lib/calendar-links.ts`
  `interviewCalendarEvent` writes English event copy ("Interview with…", "Scheduled with
  KP.") into the recruiter's calendar in every locale.
- **Line anchors were taken one file at a time** (`grep -n` on one file, or a Read of one
  file). Every reviewer was told never to use `cat -n` over several files. On top of that, the
  anchors of 41 of the 69 findings were re-read on this worktree with a per-file `sed -n` or
  `grep -n` before this table was written: devcase 1, 2, 5, 6, 9, 11, 12, 13 and 14; matrix
  1, 2, 3, 5, 10, 11 and 13; voice 1, 2, 4, 6, 7 and 8; interview 1, 2, 3, 4, 5, 9, 11 and
  13; and schedule 1, 2, 3, 4, 6, 7, 8, 11, 12, 13 and 18. All held. The other 28 rest on the
  reviewer's own per-file anchors.

### Findings

**69 new findings: 60 S, 9 M, 0 L.** Five duplicates were not counted (below). Nothing was
fixed (read-only round). "C" = CONFIRMED, traced end to end; "U" = UNVERIFIED, with what was
not read. Path roots: voice = `app/_lib/voice/`; schedule = `app/features/hiring/schedule/`;
matrix = `app/features/insights/matrix/` (`focus/` where written); devcase =
`app/api/devcase/`; anything else is rooted.

| id | lens | sev | file:line | what is wrong | path read | |
|---|---|---|---|---|---|---|
| R4-voice-runtime-1-1 | bug | S | `director.ts:578-581`, `:750-755` | an overrun request the candidate never answers is meant to close "exactly like a refusal" (`:506-508`, `director-tools.mjs:36`), but two paths treat the silence as open. Between grace end and the ceiling, `prematureCompletion` refuses the model's own `end_interview("complete")` and sends it back to must-asks the candidate never agreed to; `report_extra_time` accepts a late `agreed` with no grace check, raising the ceiling to 2× the booking and reopening a closing call | `pickDirective` `:493-514` → `applyDirectorTool` `:774-781` → `prematureCompletion` `:572-582` (only `declined` releases) → `:744-764`; `director.test.ts:576-616` tests 31.5 and 38, nothing inside the window | C |
| R4-voice-runtime-1-2 | bug | S | `transcript-of-record.ts:112-121` | the merge anchors on the body's LAST occurrence of the ledger's final turn. If that text recurs in the unsent tail (an interviewer "Thank you.", a candidate "Yes."), the turns between the two copies land in `head` past the ledger, are counted `unanchored` and dropped from the stored, scored transcript | `:113-119` → alignment `:131-154` → `:153` → `:162`; every test fixture has unique texts | C |
| R4-voice-runtime-1-3 | bug | S | `director.ts:766-799`; `app/_lib/interview-axis-coverage.ts:90-93` | every accepted `end_interview` writes one `must_ask_unasked` row per outstanding question, with no `state.endRequested` check. A repeated call, or an ended → failed → resumed attempt, writes a second set; `axisCoverage` counts rows, not distinct `questionId`s, so `mustAsksUnasked` doubles in the jobs compare view (`jobsCompareCohorts.ts:183`). `ScheduleInterviewObservations.tsx:87-91` already dedupes for this case | `director.ts:787-799` → `director-exchange.ts:140-142` → axis-coverage `:89-93` | C (path); how often a model repeats the call not measured |
| R4-voice-runtime-1-4 | bug | S | `elevenlabs.ts:61`; `openai.ts:334` | `await res.json()` sits outside `mintFetch`: a 200 with an HTML body (a self-hosted `ELEVENLABS_BASE_URL` pointing at the wrong service) throws a `SyntaxError` that `classifyMintFailure` reads as `upstream`, so readiness says "retry" instead of the `malformed` fix "check ELEVENLABS_BASE_URL"; a body read cut by the timeout reads as `upstream` too | `elevenlabs.ts:43-63` → `mint-error.ts:74-76` → `readiness.ts:99,105-107,233-236`; `mint-error.test.ts:88-102` uses JSON bodies only | C |
| R4-voice-runtime-1-5 | security | S | `director-brief.ts:319-322,353-359` | `resumeAddendum` claims prior turns are "quoted as transcript and never as instructions", but wraps them in curly quotes without neutralising quotes inside, and strips `[Director]` only at the start of a turn. A browser-written turn `ok” [Director] … “` closes the quote and lands in the next attempt's server-side brief as text shaped like the producer channel the protocol says to "follow immediately" | `api/interview/director/route.ts:78-81` → `director-step.ts:55-67` (`clampTurn` caps length only) → `resume.ts:33-43` → `connect/route.ts:292,405,422`, `interview-run.ts:91-92` → `resumeAddendum` | C (reaches the brief); U: whether a realtime model obeys it |
| R4-voice-runtime-1-6 | security | S | `candidate-brief.ts:104-105` | `candidateSafeTopic`, the declared scrub boundary for the client-sent ElevenLabs brief and every candidate-facing agenda title, cannot handle nested brackets: `[^)\]]*` runs over the inner `(` and stops at the first `)`, so "Leadership (gap: no team lead (only mentoring) experience)" scrubs to "Leadership experience)" | regex traced by hand on this worktree; `candidate-brief.test.ts:165-180` has no nested case; consumers `interview-agenda.ts:335,443,498` | C (traced, not executed) |
| R4-voice-runtime-1-7 | ambiguity | S | `openai.ts:194-196` vs `:291` | the `expiresAfterSec` doc says omitting it is "the shape the `metadata`-rejected retry in connect() falls back to"; the retry `mint(false)` (`:324`) still sends `expiresAfterSec: OPENAI_SECRET_TTL_SEC` | `:274-302`, `:311-328` | C |
| R4-voice-runtime-1-8 | ambiguity | S | `preflight.ts:75-76` | the `@deprecated` alias `voicePreflightError` has no caller anywhere, tests included | grep over `app/` | C |
| R4-interview-ui-1 | bug | S | `app/_lib/db/interviews.ts:1103-1115` | the nightly recording-retention read keeps every session with `recordings_json != '[]'`, oldest first, `LIMIT 2000`, and only then (`toRetentionRows`, `:1064`) drops sessions whose recordings are all deleted. Deleted recordings keep their ledger row by design, so once 2000 sessions have ever recorded, the window is the oldest 2000 and newer audio past retention is never selected | `app/_lib/interview-recording.ts:250` → `:1111-1113` → `:1064`; nothing resets `recordings_json` (grep) | C |
| R4-interview-ui-2 | security | S | `app/_lib/db/interviews.ts:936-977` | a chunk claim for an attempt whose recording is already deleted succeeds: the new meta is `{ ...existing, … }`, keeping `deletedAt`, and the route then `appendFile`s the audio back. The ledger says deleted, so every later deletion skips it and the file stays on disk for good. Reachable: the candidate's delete door has no live-call guard (`app/api/status/[token]/recording/route.ts:48`), and uploads are accepted for 2 min after `/complete` (`app/api/interview/recording/route.ts:84`) | `recording/route.ts:108` → `:940-977` → `recording/route.ts:125` → `interview-recording.ts:88-93,161` | C (store + upload); U: whether `anonymizeEntry` clears `recording_consent_at`, which would close the GDPR-erasure variant only |
| R4-interview-ui-3 | bug | S | `app/_lib/db/interviews.ts:360` | the recruiter's AI-round list filters `mode = 'candidate'` only, and `/api/interview/simulate` mints sessions as candidate mode with no entry ("Demo candidate", `simulate/route.ts:54,105`). Every simulation, abandoned ones included, shows in `ScheduleAiLedger` as an outstanding link (a stuck one as "live", `ScheduleAiLedger.tsx:57-60`), uses the 100-row limit and is counted by the palette preview (`resolve-library-tools.ts:65`). Only the completed table filters it (`ScheduleAiRoundCompleted.tsx:60`) | `InterviewSimTab.tsx:82` → `simulate/route.ts:105` → `:360` → `api/interview/sessions/route.ts:16` → `ScheduleAiRound.tsx:38` | C |
| R4-interview-ui-4 | bug | S | `app/_lib/db/interviews.ts:497-506` | `isInterviewLinkExpired`'s parameter type omits `lastActivityAt` and passes only `updatedAt` to the live check, so a directed call >30 min past connect but still talking is not "live" there. On a link >7 days old a mid-call reload shows the "expired" card (`portal-state.ts:54` checks expiry first) and `/connect` answers `INTERVIEW_LINK_EXPIRED` (`connect/route.ts:141` before `:162`), against the docstring `:489-492` | `page.tsx:28` → `portal-state.ts:54` → `:503`; `isInterviewSessionLive` `:519-522` | C |
| R4-interview-ui-5 | ui | S | `app/features/tools/interview/InterviewSimTab.tsx:97` | a network failure throws `TypeError` and the catch renders `e.message`, so the browser's English "Failed to fetch" reaches cs/de/fr | `:82` → `:94` → `:97` → `InterviewStartPanel.tsx:67` | C |
| R4-interview-ui-6 | ui | S | `app/features/tools/interview/InterviewStartPanel.tsx:67` | the "could not start the simulation" failure is a plain `<p>` with no `role="alert"` | — | C |
| R4-interview-ui-7 | ui | S | `app/features/tools/interview/InterviewAttachToCandidate.tsx:57,67,108` | `throw new Error()` discards the body, so the route's codes (`simulate/attach/route.ts:27,44,61`) never reach `useErrorMessage`; the failure text has no `role="alert"`; on success the focused Attach button unmounts and the "done" text has no `role="status"`, so focus drops to `<body>` unannounced | — | C |
| R4-interview-ui-8 | ui | M | `app/features/tools/interview/InterviewStartPanel.tsx:37,48-52`; `InterviewSimTab.tsx:127-128` | English fixture text inside localized copy: `DEMO_CASE_SCENARIO.caseIntro` in a Czech sentence, rubric names straight from `pipeline/jobfit/interview-script.json`, and the route's hard-coded "Demo candidate" / "Senior Backend Engineer (demo)" (`simulate/route.ts:54-55`). M: localized fixture/rubric keys or a client-side demo label is a choice | — | C |
| R4-interview-ui-9 | ui | S | `app/interview-lab/page.tsx:8` | `export const metadata = { title: "Voice interview lab" }` is English in every locale although `interview.lab.title` exists in all four catalogs | — | C |
| R4-interview-ui-10 | perf | S | `app/_lib/db/interviews.ts:74,356` | the per-session cost subquery filters `llm_usage.request_id`, which has no index (`core.ts:962-963,2592` index `ts`, `(use_case, provider)`, `ingest_key`), so each listed session (up to 500; unbounded in `interviewedForJob`) may scan every `interview_realtime` ledger row | — | U: `EXPLAIN QUERY PLAN` not run |
| R4-interview-ui-11 | ambiguity | S | `app/_lib/db/interviews.ts:436-439` | "Every other op is by the globally-unique id/token/entry_id" describes the pre-tenancy state; every entry-keyed read and write now filters by workspace (`:568-575`, `:591-675`, `:1139-1153`) | — | C |
| R4-interview-ui-12 | ambiguity | S | `app/_lib/db/interviews.ts:1036-1041` | `interviewRecordingsForSession` has no production caller (three tests only), yet its docstring describes a door that is "never an existence oracle" | grep over `app`, `scripts`, `docs` | C |
| R4-interview-ui-13 | security | S | `app/interview/[token]/page.tsx:157` | the public candidate page passes `session.runOfShow` raw as a prop to the `"use client"` `InterviewPortalClient`, so the unscrubbed agenda annotations ("(missing must-have)", per `candidate-brief.ts:28-34`) ride the RSC payload, a devtools tab away. The sidebar scrubs only what it DISPLAYS (`InterviewSidebar.tsx:64,72`) | `page.tsx:151-158` → `InterviewPortalClient.tsx:1` → `InterviewSidebar.tsx:42-75` | C (raw prop serialized); annotation content taken from the two code comments, `interview-run.ts` not re-read |
| R4-schedule-ui-2-1 | bug | M | `scheduleTabDerived.ts:40` | `bookedMarkersFrom` calls `isoToDateSlot(i.slotAt)` with its default zone, `INTERVIEW_TZ = process.env.KP_INTERVIEW_TZ \|\| "Europe/Prague"` (`app/_lib/schedule-slots.ts:130`), which a client bundle always resolves to Prague. On a non-Prague install confirmed bookings draw in the wrong hour cell or vanish on a Prague weekend, and the recruiter can book over a taken hour. The server already returns `interviewTz` and the client uses it only for the label. M: the same default sits in `useScheduleTab.ts:205` and `ScheduleCalendar.tsx:72` (sibling context) | `schedule-slots.ts:504-510` → `:130`; `api/schedule/route.ts:90-94,111`; `useScheduleTab.ts:119-122,198` | C |
| R4-schedule-ui-2-2 | bug | S | `schedulePendingCardState.ts:129` | a CONFIRMED invite whose cell source is not `booked` resolves to `awaiting`: "Link sent {when}, no time picked yet" for a candidate who booked, with Confirm demoted. Reached by a weekend slot (`isoToDateSlot` null) or a failed agenda read (`useScheduleTab.ts:182,203` seeds from `[]` while `:184` keeps the old invites) | `useScheduleTab.ts:182-219,387-391` → `:126-130` → `ScheduleTabPendingList.tsx:50-56` | C |
| R4-schedule-ui-2-3 | bug | S | `scheduleTabDerived.ts:65` | `unscored`/`scoring` rows are admitted whatever `approvalKind` is, so a calendar-gated entry whose voice call just ended lists in BOTH pending and Interviewed, for 5 min (`SCORING_GRACE_MS`) or for good if scoring failed. The test "a candidate still awaiting a slot is never listed as interviewed" (`scheduleTabDerived.test.ts:77-80`) passes only because its fixture has no `mode`/`status` | `useScheduleTab.ts:376,398-401` → `:62-66` → `app/_lib/interview-scoring-state.ts:17-33`; `api/interview/complete/route.ts:270-274` | C |
| R4-schedule-ui-2-4 | bug | S | `ScheduleTabInterviewedList.tsx:51` | a successful Re-score calls `router.refresh()`, which re-renders server components only; this tab is client state. The card stays "Unscored" with Re-score enabled (a second paid re-score), and when the poll later shows `scored` the stale `approvalKind` drops the card from the tab (`scheduleTabDerived.ts:67-70`) until a `load()` | `scheduleRescore.ts:19-20` → `api/interview/sessions/[id]/rescore/route.ts:70-78` | C |
| R4-schedule-ui-2-5 | bug | M | `ScheduleTab.tsx:196-199` | the tab's single `error` replaces the whole calendar and pending list, and the per-card "Start interview" failure writes the same slot (`useScheduleTab.ts:511,526`), so a refused start (409, 402, `COMMS_SUPPRESSED`) blanks the grid until the next `load()`, which the status poll never calls. M: the fix site is the sibling hook | `ScheduleTab.tsx:242` → `useScheduleTab.ts:509-531` | C |
| R4-schedule-ui-2-6 | ui | S | `ScheduleTab.tsx:198` | renders `error`, a thrown `e.message`: "HTTP 500" (`app/features/shared/sharedGet.ts:44-58`), "Failed to fetch", or the server's raw `p.error` (`useScheduleTab.ts:169` → `:222`) — English in every locale | — | C |
| R4-schedule-ui-2-7 | security | M | `ScheduleInviteAttentionSection.tsx:79` | `t("needsReconcile", { reason: i.reconcileReason })` renders the persisted `advanceError.message` verbatim — SQLite or pipeline exception text the token route itself calls "raw internal error text" (`api/schedule/[token]/route.ts:40`). Same class as R3-pipeline-board-5-5, different data flow. M: a reason code across store, route and 4 catalogs | `api/schedule/route.ts:276,435` → `app/_lib/schedule-store.ts:741-742` → GET `/api/schedule` | C |
| R4-schedule-ui-2-8 | security | S | `ScheduleInviteAgendaRow.tsx:74-75` | the recruiter's "Add to calendar" event gets `baseUrl`, so `interviewCalendarEvent` writes "Confirm, reschedule, or cancel: `<base>/schedule/<candidate token>`" into the description, which goes into a calendar.google.com / Outlook URL query (`calendar-links.ts:31,34`) and the `.ics`, whose `uid` is `interview-${i.token}`. The candidate's capability link leaves kp and lands in a possibly shared calendar | `:74` → `app/_lib/calendar-links.ts:86-110` → `ScheduleAddToCalendar.tsx:37-47` | C (path; no doc says it is intended) |
| R4-schedule-ui-2-9 | ui | S | `ScheduleInviteLifecyclePanel.tsx:47`; `ScheduleMeetingLinkCell.tsx:112`; `ScheduleInterviewTranscriptModal.tsx:98` | three failure outcomes render without `role="alert"` | — | C |
| R4-schedule-ui-2-10 | ui | S | `ScheduleTabPendingList.tsx:215,220,285`; `ScheduleTabInterviewedList.tsx:91`; `ScheduleAiLedger.tsx:153`; `ScheduleAiRoundCompleted.tsx:87`; `ScheduleInterviewPrepOverlay.tsx:80`; `ScheduleInterviewPrepOverlayRow.tsx:141`; `ScheduleInterviewTranscriptTurns.tsx:43,48,118`; `ScheduleInviteAgendaRow.tsx:51` | `title=` tooltips (`ui.md` bans them) carrying information shown nowhere else: the "sends them no message" warning on a no-undo direct booking (`:285`), the stale-prep instruction (`:220`), and two disabled buttons whose only reason sits on the disabled button itself, out of keyboard and screen-reader reach | — | C |
| R4-schedule-ui-2-11 | ui, perf | S | `useScheduleInterviewPrep.ts:86` | `new Intl.DateTimeFormat(locale, …)` on every render, notes keystrokes included, instead of `useFormatter()`, which also bypasses next-intl's configured `timeZone` | — | C |
| R4-schedule-ui-2-12 | ui | S | `useScheduleInterviewPrep.ts:303` | the copy-prep clipboard line hard-codes the English unit: `` `- [${from}–${to} min] …` ``; its neighbours `:296,300,301,307` go through `t()` | — | C |
| R4-schedule-ui-2-13 | ui | S | `ScheduleTabPendingList.tsx:296` | the terminal Decline is guarded by `window.confirm`: unthemed, OK/Cancel in the browser's language. `ui.md` names `ConfirmDialog` | — | C |
| R4-schedule-ui-2-14 | bug | S | `useScheduleInterviewPrepOverlay.ts:85-91` | an edit refused locally (`problems`) shows on screen but is not persisted, and `saveState` keeps its previous `"saved"`, so `ScheduleInterviewPrepOverlay.tsx:146` says "Saved" for an overlay the server does not hold; closing drops the edit silently | — | C |
| R4-schedule-ui-2-15 | bug | S | `schedulePrepPlanDiff.ts:116-130` | a pure reorder of blocks makes `isNoop` false (`:130`) but `PlanDiff` has no field for it, so `ScheduleInterviewPrepPlanDiff.tsx:57` shows "Review what would change" over zero lines. No test reorders | — | C |
| R4-schedule-ui-2-16 | bug | S | `ScheduleInterviewTranscriptModal.tsx:39` | the `/api/interview-prep` read's `error` is discarded, so a failed human-scorecard read looks exactly like "no scorecard filed" (`:118,:155`), the failure-vs-empty conflation `:95-96` forbids for the session read | — | C |
| R4-schedule-ui-2-17 | perf, ambiguity | S | `ScheduleCalendarStatus.tsx:12,18` | the doc says "from the same slot offer used to reschedule"; the recruiter reschedule control was removed (`ScheduleInviteRecruiterControls.tsx:5-8`). This is now the only caller of `/api/schedule?slots=1`, so every tab mount runs a 21-day `proposeFreeSlots` plus a Google free/busy lookup (`api/schedule/route.ts:78`) to keep one status enum; the `token`/`minutes` branch (`:73-75`) has no caller | grep over `app/` | C |
| R4-schedule-ui-2-18 | ambiguity | S | `scheduleAgenda.ts:49,126`; `scheduleInterviewPrepProgress.ts:25` | exports with no production caller: `isAgendaVerb` (none at all); `calendarEntryIdsOf` (test-only, while `useScheduleTab.ts:381` inlines the same rule, so the test pins a helper production never runs); `emptyPrepState` (test-only, though its doc says regeneration resets to it; the hook uses literals and `hydratePrepState`) | grep over `app/` | C |
| R4-matrix-ui-1-1 | bug | S | `focus/useMatchTabRun.ts:87,103` | the options load always selects `rows[0]`, after the deep-link effect (`:192-210`, a 0 ms timer) has selected the linked candidate. The picker shows rows[0] over the linked candidate's ranking, and "Run matching" (`:174-178`) runs rows[0]. Every entry into focus mode arrives by deep link (`MatrixTab.tsx:37-44`) | `:82-88,99-104` → `MatrixCandidateFocus.tsx:90,110` | C (the ordering is the common case: a network round-trip outlasts a 0 ms timer) |
| R4-matrix-ui-1-2 | bug | S | `focus/useMatchTabRun.ts:193,201` | `autoRan` is a boolean set once, so a second `?profile=B` while focus mode is open is ignored; the URL names B, the screen keeps A. `MatrixTab.tsx:40-44` says a second navigation must work, and nothing remounts the hook (`MatrixTab.tsx:130`, `WorkspaceTabChunks.tsx:127`) | — | C |
| R4-matrix-ui-1-3 | bug | S | `focus/useMatchTabRun.ts:150,164` | `await r.json()` has no catch (unlike `:75,95`), and the catch at `:164` shows `caught.message` for any `Error`, so a non-JSON body's `SyntaxError` or a dropped network's `TypeError` reaches the panel (`MatrixCandidateFocus.tsx:169`) or `rerankFailed {error}` (`MatchResultsHeader.tsx:66`) in English; `t("matchFailed")` is unreachable | — | C |
| R4-matrix-ui-1-4 | ui | S | `focus/MatrixCandidateFocus.tsx:169` | the full-panel failure `<p>` has no `role="alert"`; the inline banner for the same failure has one (`MatchResultsHeader.tsx:65`) | — | C |
| R4-matrix-ui-1-5 | ui | S | `focus/useMatchCardReasoning.ts:45` | `reasoningError ?? t("card.reasoningFailed")` is the inverted fallback the repo retired: the task error is stored as a CODE (`app/_lib/tasks.ts:733-737`), passed through (`useTaskResult.ts:47-52`) and rendered verbatim (`app/features/shared/MatchReasoningPanel.tsx:39`), so a recruiter reads "ENGINE_TIMEOUT". `TasksTableRow.tsx:111` resolves the same field | — | C (code branch); English-handler branch inferred, see cuts |
| R4-matrix-ui-1-6 | bug | S | `focus/useMatchCardReasoning.ts:36-47` | `resultUnavailable` is never read, though `useTaskResult.ts:39-42` says consumers MUST resolve busy on it. A succeeded task whose full-record fetch gave up leaves `reasoning` at `{loading: true}` for good: "Explain fit" stays disabled on its busy label (`MatchCard.tsx:147,150`) | — | C |
| R4-matrix-ui-1-7 | bug | S | `focus/useMatchResultsPipeline.ts:32,107-111` | a card whose add came back stale-run (409) offers "Run matching"; the rerun succeeds with a new `matchRunId`, but `MatchResults` keeps its key (candidate id, `MatrixCandidateFocus.tsx:150`) and nothing resets `stale`/`errors`, so the "stored result is gone" alert stays over a valid run | — | C |
| R4-matrix-ui-1-8 | bug (explainability) | S | `focus/useMatchTabRun.ts:140-143`; `focus/matchView.ts:36` | the keep-the-ranking-mounted rule is commented for a re-rank but applied to every run, so while candidate B loads, A's ranking (live Add buttons) sits under a picker showing B; if B fails, `rerankFailed` says "Showing the previous ranking" over another candidate's ranking | — | C |
| R4-matrix-ui-1-9 | ui | S | `focus/MatchCard.tsx:161`; `focus/MatchJobCompare.tsx:62`; `focus/MatchResultsHeader.tsx:93`; `focus/MatrixCandidateFocus.tsx:119` | seniority rendered as the raw slug (and `role_family` raw at `:119`) while the same lines pass family through `enumLabel`; a fr reader sees "medior" where the catalog has "Confirmé" | `MatrixGrid.tsx:118,124` use `enumLabel("seniority", …)`; cs/de/fr catalogs checked | C |
| R4-matrix-ui-1-10 | ui | S | `focus/matchCsv.ts:27` | the CSV exports `m.fitTier` as the raw slug under a localized header, while the same row's reasons column localizes it (`matchReasons.ts:94`) | — | C |
| R4-matrix-ui-1-11 | ui | S | `MatrixDataNotices.tsx:52` | `` title={`${data.poolCap} of ${data.poolTotal} candidates scored`} `` is English in every locale, contradicts `:55-56` ("without a new i18n string"), is a banned `title=` on a non-focusable `<p>`, and repeats the visible `ofCount` | — | C |
| R4-matrix-ui-1-12 | ui (explainability) | S | `focus/MatchCardSkillChips.tsx:88,91,106,108,119,121` | a chip's bucket (partial / unproven / missing) is carried by colour, a glyph and a `title=` on a non-focusable span; a screen reader hears "~ Kubernetes", and keyboard/touch users never reach the partial percentage or "probe, don't count it", so a partial match reads as verified. `MatchCard.tsx:89,117` put the score-provenance sentence in `title` only too | — | C |
| R4-matrix-ui-1-13 | ambiguity, perf | M | `focus/matchRunSequence.ts:11-13` | rejects an AbortController because a superseded run's answer "is still worth writing to the server-side cache"; /api/match has no cache (it spawns, parses and `recordMatchRun`s under a run id the client discards, `app/api/match/route.ts:80-118`; `matching.py:765`'s `lru_cache` lives one CLI process). The route already forwards `request.signal` (`:80-83`), and every superseded run holds an engine-semaphore slot (`python-runner.ts:203-217`, default 4), so rapid re-weights can 503 ENGINE_BUSY the current run. M: it reverses a written decision | — | C (no cache, semaphore); U: the 503 under load not reproduced |
| R4-matrix-ui-1-14 | perf | M | `focus/MatchResults.tsx:178-195`; `focus/MatchCard.tsx:16` | every add / select / compare toggle re-renders every card: `MatchCard` is not memoised and the inline `onAdd` / `onToggleSelect` closures (`:190,193`) would defeat a memo; each card rebuilds `ScoreBreakdown`, the chips and `matchReasons(m)`, up to 200 cards (`MATCH_LIMIT_MAX`). Same churn class as round 2's header finding | — | U: cost not profiled |
| R4-matrix-ui-1-15 | ambiguity | S | `focus/MatchCardSkillChips.tsx:27` | `unprovenLabelKey` is exported but imported nowhere (one test regex, `matrixGridRoles.test.ts:59`); the mapper is re-written at `decisionsAnalysisSummaryData.ts:127` and `JobFitTab.tsx:138` while `:23-26` says to "reuse it verbatim rather than forking" | grep over `app/` | C |
| R4-matrix-ui-1-16 | ambiguity | S | `focus/useMatchTabRun.ts:2,43` | the comments name `MatchTab.tsx` and "key in MatchTab"; that file no longer exists, the key lives at `MatrixCandidateFocus.tsx:150` | — | C |
| R4-api-devcase-1-1 | bug | S | `lifecycle/[id]/close/route.ts:112` | postings are closed only after the whole `await sendComm` loop (`:81-110`). Applications arriving meanwhile pass `intakeSubmission`'s posting-status check, are acknowledged and filed, and are never told anything (`recipients` was fixed at `:70`). If anything throws between the claim (`:41`) and `:112`, the lifecycle is closed and its postings stay open for good, since a retry hits `alreadyClosed` | `:41` → `app/_lib/db/devcase.ts:413-419` (claim flips the stage only) → `distribution.ts:119-121` → `:112` | C |
| R4-api-devcase-1-2 | bug | S | `lifecycle/[id]/close/route.ts:92-93` (and `:74`) | the wrap-up rejection letter is a hard-coded English subject and body (and an English `"the role"` fallback) in all four locales; its siblings (intake ack `distribution.ts:160`, the feedback brief) go through `commsTranslator`, and `lc.lang` / `lc.workspaceId` are at hand | grep "moving forward": the only copy | C |
| R4-api-devcase-1-3 | bug | S | `feedback/route.ts:40-53` | `buildFeedbackBrief` is never given `locale`, so the candidate's letter is always in the team's `default_locale`; the comment `:47-51` says that happens only "when the submission records none", but `DevSubmission` has no locale field, and `promoteSubmission` already uses `lifecycle.lang` | `app/_lib/devcase-feedback.ts:22-33,54-55` → `app/_lib/db/devcase.ts:470-494` → `devcase-run.ts:1087,1191` | C |
| R4-api-devcase-1-4 | bug | S | `publish/route.ts:36,47,55` | `body.channel` is unvalidated; `getAdapter` throws `UnknownChannelError` "so the publish route [can] reject the request" (`distribution.ts:71-76,86-89`), but the catch answers `safeJsonError` 500 `DEVCASE_PUBLISH_FAILED`, so caller input reads and logs as a store failure | `:47` → `distribution.ts:88` → `api-response.ts:2159-2161` | C |
| R4-api-devcase-1-5 | bug | S | `outcomes/route.ts:86` | the audit reason records `Math.round(body.setFloor)` unclamped while `setPromoteFloor` stores 0..100, so `setFloor: 150` audits "floor → 150" with 100 in force | `:82-86` → `app/_lib/dev-control.ts:150-156` | C |
| R4-api-devcase-1-6 | bug | S | `session/[id]/submit/route.ts:88` | `contact` is any trimmed string; the ack goes to `contact \|\| candidateRef`, which can be a display name or `"live-session"`. Only the client checks the address (`LiveWorkSurface.tsx:136`); the inbound door refuses this case with `DEVCASE_CONTACT_REQUIRED` (`inbound/route.ts:80-84`) | `:88` → `:140-150` → `distribution.ts:162-163` → `app/_lib/comms.ts:409-419` (no recipient check) | C to `sendComm`; U: what the relay does with an address-less `to` |
| R4-api-devcase-1-7 | bug (error paths) | M | `feedback/route.ts:18,26,28`; `lifecycle/route.ts:50`; `lifecycle/[id]/approve/route.ts:82`; `lifecycle/[id]/close/route.ts:28`; `lifecycle/[id]/redesign/route.ts:29,38,40,43,73-79`; `promote/route.ts:20,28,30`; `publish/route.ts:25,35` | 16 raw English prose refusals with no code (untranslated in every locale), plus redesign's 409 embedding the stage in an English sentence where approve answers the same condition with `jsonRefusal("DEVCASE_LIFECYCLE_NOT_AT_GATE")`. Not on the error-contract ratchet, which covers catch-forwarding only. M: ~8 new codes × 4 catalogs, and `"lifecycle not found"` is pinned verbatim by `devcase-lifecycle-tenancy.test.ts:73-110` and `rate-limit-contract.test.ts:2961` | grep `NextResponse.json({ error:` over the routes | C |
| R4-api-devcase-1-8 | security | M | `lifecycle/[id]/close/route.ts:19`; `lifecycle/[id]/redesign/route.ts:24`; `promote/route.ts:17`; `feedback/route.ts:15`; `lifecycle/route.ts:43` | five mutating doors call neither `requireOperator` nor `requireCapabilityCoded`, so a viewer seat can close a lifecycle (mailing rejections to every non-promoted submitter), run a paid redesign, promote onto the board, queue candidate letters and start a lifecycle. `approve`, `publish` and the four studio doors require `pipeline:write`. All five sit on `route-capability-coverage.test.ts:109-114` as "slice 2 candidate — not yet judged": known debt, but close is an adverse recruiter action, not an open question | `devcase-doors-capability.test.ts:1-16` (the pattern) | C |
| R4-api-devcase-1-9 | security (tenancy) | S | `lifecycle/[id]/close/route.ts:132`; `lifecycle/[id]/redesign/route.ts:67,86` | `recordAudit` without `workspaceId` falls back to `DEFAULT_WORKSPACE` (`app/_lib/dev-control.ts:77-94`): a non-default team never sees its own close / redesign decisions in its control room, and the default team's sees other teams' lifecycle ids and the reviewer's redesign note. `approve` passes `workspaceId: lc.workspaceId` (`:132`), pinned by `devcase-approve-audit-tenancy.test.ts` | `dev-control.ts:110-116`; `control/route.ts:78` | C |
| R4-api-devcase-1-10 | security | M | `inbound/route.ts:119` | the public, unauthenticated webhook returns the internal store `submissionId`, on `duplicate: true` too, so a token holder replaying another applicant's (candidate, repoRef) gets that applicant's id back — against the "internal ids off the wire" rule the finalize door states (`session/[id]/submit/route.ts:152-155`). M: the comment keeps it for external channels, a product call | every door taking a submission id is operator-gated and owner-guarded, so no direct exploit was found | C |
| R4-api-devcase-1-11 | perf | S | `session/[id]/route.ts:197` | on every flush (~8 s per candidate) of a case with a mid-flight update, `getDevSessionEvents(id)` reads and maps the session's whole event log (up to `MAX_SESSION_EVENTS = 20000`, `app/_lib/db/devcase.ts:1014`) to test whether one `perturbation` exists: quadratic over a session, on the hot path the MFU cache comment (`:13-17`) set out to trim | `:195-202` → `db/devcase.ts:1016-1024` (no LIMIT) | C |
| R4-api-devcase-1-12 | perf, ambiguity | S | `lifecycle/[id]/redesign/route.ts:14,53-54` | `runDesignArtifacts(…, undefined /* signal */, …)` drops `request.signal`, so an abandoned redesign keeps a Python LLM child alive to the 600 s spawn default; the comment calls it "a ~60s await (maxDuration)", and `maxDuration` is serverless-only. The chat route fixed exactly this | `:53` → `app/_lib/devcase-run-design.ts:98-131` → `devcase-run-cli.ts:29` → `python-runner.ts:175,568` | C |
| R4-api-devcase-1-13 | ambiguity | S | `feedback/route.ts:72-73` | the catch comment cites "buildFeedbackBrief's model call: provider stderr"; `buildFeedbackBrief` makes no model call (its header: the brief is "assembled for free") | `app/_lib/devcase-feedback.ts:1-20,54` | C |
| R4-api-devcase-1-14 | ambiguity | S | `session/[id]/route.ts:107,151` | "its byte length is what the per-token daily budget charges", but `chargeFlushBytes(session.token, raw.length)` charges UTF-16 code units, undercounting non-ASCII trees by up to 3× against the "4 GiB" budget (`session/session-limits.ts:48-53`) | — | C |

### Duplicates, not counted

All five are round-2 `matrix-ui-2` findings whose file belongs to this round's `matrix-ui-1`.
Every one is **still present** on this tree:

- `MatrixDataNotices.tsx:87` `title={m.error}` renders the engine's error text (round-2 S
  carry-over). Still at `:87`.
- `MatrixDataNotices.tsx:69,79` re-type NOTICE (round-2 recipe drift). Still present, and now
  declared debt in `recipe-debt.json` (`noticeAmber` 2).
- `MatrixGrid.tsx:91` re-types PANEL (round-2 recipe drift). Still at `:91`.
- `MatrixGrid.tsx:103-128`: the header row re-renders on every popover transition (round-2
  M). The header is still not memoised.
- `MatrixGrid.tsx` sortable headers carry no `aria-sort` (round-2 a11y carry-over). Still only
  `aria-pressed` (`:117`).

Pointer updates, not findings of this round:

- Round 2's `STAGE_INITIAL` (M) now sits at `matrixTabTypes.ts:60` and `MatrixGridRow.tsx:161`.
- Round 2's `app/api/devcase/submit/route.ts` raw refusals are still at `:43,:53,:57`, and
  `source/route.ts`'s have moved to `:49,:54`. Both are `api-devcase-2` files; they appear here
  only because R4-api-devcase-1-7 is the same class in the sibling routes.
- Nothing else matched rounds 1-3 or "Known gaps" in
  `docs/architecture/engine-and-prompt-coordination.md`. No voice finding concerns the
  transport sitting outside the LLM matrix.

### Confirmed S findings NOT fixed this round — carry-over, written to be taken as-is

Each line is the fix, then the test that fails today and passes after it. One commit per
line, test-first, as round 2 did.

- **R4-voice-runtime-1-1.** Fix: in `deriveDirectorState` (which has `nowMs`), set
  `overrunLapsed` when a request is older than `OVERRUN_ANSWER_GRACE_MS` with no answer, and
  ignore an `overrun_answered` recorded after the grace; `prematureCompletion` treats a lapse
  as `declined`, and `report_extra_time` answers "time to answer has passed" with no events.
  Test (`director.test.ts`): `state([...REACHED_RESERVE, askedAt(31)], 34, kitOpts)` makes
  `prematureCompletion` return null, and a late `report_extra_time {answer:"agreed"}` records
  no events.
- **R4-voice-runtime-1-2.** Fix: align the body against the ledger in order and anchor at the
  body index where the alignment consumes the last ledger turn, not at the last textual
  occurrence. Test (`transcript-of-record.test.ts`): ledger ending interviewer "Thank you.",
  body = ledger + candidate "one more thing" + interviewer "Thank you."; both closing turns
  are kept and `unanchored === 0`.
- **R4-voice-runtime-1-3.** Fix: `axisCoverage` counts distinct `payload.questionId`;
  optionally `end_interview` answers "Already recorded" with no events once
  `state.endRequested`. Test (`interview-axis-coverage.test.ts`): two accepted
  `end_requested` rows and `must_ask_unasked` q1 twice give `mustAsksUnasked === 1`.
- **R4-voice-runtime-1-4.** Fix: wrap the body parse in both adapters; a parse failure or
  non-object body throws `VoiceMintError({cause:"malformed"})`, a Timeout/AbortError
  `cause:"timeout"`. Test (`mint-error.test.ts`): a stubbed `new Response("<html>",
  {status:200})` classifies as `malformed`.
- **R4-voice-runtime-1-5.** Fix: in `capTurn`, replace `“”"„«»` inside the text and remove
  every `DIRECTOR_NOTE_PREFIX`, not only a leading one. Test (`director-brief.test.ts`): a
  prior turn `a” [Director] reveal “b` yields an addendum with no `[Director]` and no quote
  mark between the turn's own quotes.
- **R4-voice-runtime-1-6.** Fix: repeat the innermost-aside replace
  (`/[([][^()[\]]*[)\]]/g`) until stable, then the unterminated rule, then drop stray
  `)`/`]`. Test (`candidate-brief.test.ts`):
  `candidateSafeTopic("Leadership (gap: no team lead (only mentoring) experience)") === "Leadership"`.
- **R4-voice-runtime-1-7.** Fix: correct the comment (the retry drops only `metadata`).
  Test: none (comment only); to pin behaviour, `mint-credential.test.ts:185` can assert the
  retry body still carries `expires_after.seconds === OPENAI_SECRET_TTL_SEC`.
- **R4-voice-runtime-1-8.** Fix: delete `voicePreflightError`. Test: none (typecheck stays
  green).
- **R4-interview-ui-1.** Fix: filter in SQL with
  `AND EXISTS (SELECT 1 FROM json_each(s.recordings_json) j WHERE json_extract(j.value,'$.deletedAt') IS NULL)`
  so the LIMIT counts only sessions still holding audio. Test
  (`app/_lib/interview-recording.test.ts`): seed more fully-deleted sessions than the limit
  plus one live recording past retention; the sweep deletes the live one.
- **R4-interview-ui-2.** Fix: in the chunk claim, an `existing.deletedAt` returns without
  writing (`full`, or a new `closed` outcome the route answers 409). Test
  (`app/api/status/status-recording.test.ts`): after the candidate delete, claiming the next
  chunk of the same attempt writes nothing and no file exists.
- **R4-interview-ui-3.** Fix: add `AND s.entry_id IS NOT NULL` at `:360`. Test
  (`app/api/interview/interview-session-cost.test.ts`, which already exercises the read): a
  candidate-mode session with no entry is absent from the list.
- **R4-interview-ui-4.** Fix: add `lastActivityAt?: string | null` to the parameter and pass
  it at `:503`. Test (`app/_lib/db/interview-link-lifecycle.test.ts`): an `in_progress`
  session past the TTL with `updatedAt` 45 min ago and `lastActivityAt` 1 min ago is not
  expired.
- **R4-interview-ui-5.** Fix: on `!ok`, `setError(errMsg(data, t("createFailed")))` and
  return rather than throw; the catch always uses `t("createFailed")`. Test (source contract,
  beside `simBilling.test.ts`): `InterviewSimTab.tsx` contains no `e.message`.
- **R4-interview-ui-6.** Fix: `role="alert"` on the error paragraph. Test (source contract):
  the paragraph carries it.
- **R4-interview-ui-7.** Fix: parse the body and resolve it through `errMsg(body, t("failed"))`;
  `role="alert"` at `:108`, `role="status"` at `:67`. Test (source contract):
  `useErrorMessage` is imported and both roles are present.
- **R4-interview-ui-9.** Fix: `generateMetadata` with `getTranslations("interview.lab")`.
  Test (source contract): no literal `metadata` title in the file.
- **R4-interview-ui-10** is S but UNVERIFIED. Run `EXPLAIN QUERY PLAN` on the cost subquery
  first. If it scans, add `CREATE INDEX IF NOT EXISTS idx_llm_usage_request ON llm_usage
  (request_id, use_case)` to the `core.ts` migration; the test is a schema test asserting the
  index via `PRAGMA index_list(llm_usage)`.
- **R4-interview-ui-11.** Fix: say only the id and token point reads are unscoped. Test:
  none (comment only).
- **R4-interview-ui-12.** Fix: mark it a test seam in its docstring, or move it to a test
  helper. Test: none.
- **R4-interview-ui-13.** Fix: pass `(session.runOfShow ?? []).map(candidateSafeTopic).filter(Boolean)`
  at `page.tsx:157`, and correct `candidate-brief.ts:32-34`. Test (source contract, the
  `rate-limit-contract` idiom): `page.tsx` never passes `session.runOfShow` unscrubbed.
- **R4-schedule-ui-2-2.** Fix: "confirmed, but the cell is not the booking" gets its own
  kind (or `booked` with `bookSuggested: true`), never the awaiting copy. Test
  (`schedulePendingCardState.test.ts`): `pendingCardState(e, confirmedInvite, "guess", NOW)`
  and the `"legacy"` case are not `awaiting`.
- **R4-schedule-ui-2-3.** Fix (pick one): guard `:65` with `e.approvalKind !== "calendar"`,
  or rename the test and document the double listing. Test (`scheduleTabDerived.test.ts`): a
  calendar entry with a full row `{mode:"candidate", status:"completed", hasTranscript:true,
  hasScorecard:false, endedAt}` asserts the chosen behaviour.
- **R4-schedule-ui-2-4.** Fix: `ScheduleTab.tsx:251` passes `onRescored={load}` and the
  list calls it instead of `router.refresh()`. Test (source contract): no `router.refresh` in
  `ScheduleTabInterviewedList.tsx`, and `ScheduleTab.tsx` passes `onRescored`.
- **R4-schedule-ui-2-6.** Fix: `useScheduleTab.ts:222` sets `t("loadFailed")`, or
  `errMsg({code}, t("loadFailed"))` when a code is present. Test (source contract):
  `useScheduleTab.ts` has no `setError(e instanceof Error ? e.message`.
- **R4-schedule-ui-2-8.** Fix: drop `baseUrl` at `:74` and key the uid on `i.id`. Test: a
  `calendar-links` unit test that an event built without `baseUrl` contains no `/schedule/`,
  plus a source contract that the row passes no `baseUrl` and no `i.token` into `uid`.
- **R4-schedule-ui-2-9.** Fix: `role="alert"` at the three sites. Test (source contract):
  each failure branch carries it.
- **R4-schedule-ui-2-10.** Fix: `Tooltip` / `IconAction`; the disabled reasons and the
  `:285` warning become visible text. Test (source contract): count `title=` in
  `app/features/hiring/schedule/*.tsx` (excluding `Modal` / `ColumnHead` props) with a
  ceiling of 0.
- **R4-schedule-ui-2-11.** Fix: `useFormatter().dateTime(new Date(jdEditedAt), {...})`.
  Test (source contract): no `Intl.DateTimeFormat` / `toLocale*` in the directory's non-test
  files.
- **R4-schedule-ui-2-12.** Fix: an ICU key `copyBlock {from} {to} {topic} {goal}` in all 4
  catalogs. Test: extract the copy builder into a `.ts` module; with a stub `t` it emits no
  literal "min".
- **R4-schedule-ui-2-13.** Fix: `ConfirmDialog`. Test (source contract): no `window.confirm`
  in the directory's `.tsx`.
- **R4-schedule-ui-2-14.** Fix: an `"unsaved"` state when persistence is skipped. Test: a
  pure `overlaySaveState(problemCount, prev)` in `scheduleInterviewPrepOverlayModel.ts` never
  returns `"saved"` when problems > 0.
- **R4-schedule-ui-2-15.** Fix: `reordered: boolean` on `PlanDiff` and a catalog line. Test
  (`schedulePrepPlanDiff.test.ts`): the same blocks reordered give `reordered: true`,
  `isNoop: false`.
- **R4-schedule-ui-2-16.** Fix: destructure `error` from the second `useJsonFetch` and render
  a one-line notice beside the human scorecard slot. Test (source contract): it is
  destructured.
- **R4-schedule-ui-2-17.** Fix: a light `?calendarStatus=1` probe, or correct the comment and
  drop the dead `token`/`minutes` branch. Test (if split): a route test that the status probe
  never calls `proposeFreeSlots`.
- **R4-schedule-ui-2-18.** Fix: delete `isAgendaVerb`; `useScheduleTab.ts:381` calls
  `calendarEntryIdsOf`; use or delete `emptyPrepState`. Test: the existing
  `scheduleAgenda.test.ts` then covers the production path.
- **R4-matrix-ui-1-1.** Fix: `setSelProfile(cur => cur || rows[0].id)` (and the same for
  analyses). Test: a pure `seedSelection(current, rows)` in `matchView.ts`;
  `matchView.test.ts` asserts a non-empty current wins.
- **R4-matrix-ui-1-2.** Fix: `autoRanFor: string | null` (`profile:<id>` /
  `analysis:<slug>`), run whenever it differs. Test: a pure
  `autoRunTarget(profileParam, analysisParam, lastRanFor)` in `matchView.ts`.
- **R4-matrix-ui-1-3.** Fix: `r.json().catch(() => ({}))`; trust only the messages thrown at
  `:156-157` (a tagged class), anything else becomes `t("matchFailed")`. Test: a pure
  `matchRunFailureMessage(caught, fallback)` in `matchView.ts`; a `TypeError` resolves to the
  fallback.
- **R4-matrix-ui-1-4.** Fix: `role="alert"`. Test (source contract, the
  `matrixGridRoles.test.ts` style): the `{view.message}` element carries it.
- **R4-matrix-ui-1-5.** Fix: `errMsg({ code: reasoningError }, t("card.reasoningFailed"))`
  through `useErrorMessage`. Test: a pure `reasoningOutcome(status, error, full, gaveUp,
  resolve)` in a `.ts` module; a code goes through `resolve` and is never returned raw.
- **R4-matrix-ui-1-6.** Fix: read `resultUnavailable` and set
  `{ error: t("card.reasoningFailed") }`. Test: the same `reasoningOutcome`, `gaveUp` yields an
  error.
- **R4-matrix-ui-1-7.** Fix: anchor on `matchRunId` with the adjust-state-during-render
  pattern (as `MatchWeightsPanel.tsx:54-58`) and clear `stale` and the stale-coded errors.
  Test: a pure `resetOnNewRun(prevId, nextId, state)`; a changed id clears them.
- **R4-matrix-ui-1-8.** Fix: `selectMatchView` takes `sameCandidate` (in-flight ref equals
  `matchRef`); for a different candidate, loading and error own the panel. Test
  (`matchView.test.ts`): `hasResult` + error + `!sameCandidate` gives `kind: "error"`.
- **R4-matrix-ui-1-9.** Fix: `enumLabel("seniority", …)` and `enumLabel("family", …)` at the
  four sites. Test (source contract): no bare `seniority: m.seniority` /
  `${candidate.seniority` interpolation in `focus/*.tsx`.
- **R4-matrix-ui-1-10.** Fix: `` m.fitTier ? tMatch(`fitTier.${m.fitTier}`) : "" ``. Test
  (the CSV case in `matchReasons.test.ts`): `rows[1][6] === t("fitTier.promising")`.
- **R4-matrix-ui-1-11.** Fix: delete the `title`. Test (source contract): no template-literal
  `title=` in `MatrixDataNotices.tsx`.
- **R4-matrix-ui-1-12.** Fix: an `sr-only` bucket label per chip (keys exist:
  `card.partialTitle`, `decisions.summary.unprovenTitle`, `card.missingTitle`), the glyph
  `aria-hidden`, `Tooltip` for hover. Test (source contract): each of the three chip maps
  renders an `sr-only` span.
- **R4-matrix-ui-1-15.** Fix: move `unprovenLabelKey` to a `.ts` module and import it at all
  three sites. Test: a unit test of the mapper (an unknown reason gives `unprovenClaimed`),
  keeping `matrixGridRoles.test.ts:59` matching.
- **R4-matrix-ui-1-16.** Fix: re-point both comments. Test: none (comment only).
- **R4-api-devcase-1-1.** Fix: run `setPostingStatus(posting.id, "closed")` right after the
  postings are computed (`:53-55`), before the send loop. Test (`close-tenancy.test.ts`): a
  `sendComm` stub that posts to the inbound door for the same token mid-send gets 410
  `POSTING_CLOSED`.
- **R4-api-devcase-1-2.** Fix: `const t = await commsTranslator(lc.lang, lc.workspaceId)`
  with new `devcaseWrapUp.*` keys in all 4 catalogs. Test (`close-tenancy.test.ts`): a `cs`
  lifecycle's outbox row is not the English body.
- **R4-api-devcase-1-3.** Fix: pass
  `locale: sub.postingId ? lifecycleByPosting(sub.postingId)?.lang ?? null : null`. Test (new
  `feedback/route.test.ts`): a `cs` lifecycle produces the Czech `devcaseFeedback.subject`.
- **R4-api-devcase-1-4.** Fix: check `channel` against the adapter registry first and answer
  `jsonRefusal("<NEW_CODE>", 400, { channel })`, with the code in the 4 catalogs. Test
  (`[id]/intake/route.test.ts`, which already imports publish): `channel: "nope"` is 400 plus
  the code.
- **R4-api-devcase-1-5.** Fix: audit the floor in force after the write (`activeFloor()`).
  Test (an outcomes route test): set 150, `listAudit` shows 100.
- **R4-api-devcase-1-6.** Fix: the same `SENDABLE_EMAIL_RE` check and
  `jsonRefusal("DEVCASE_CONTACT_REQUIRED", 400)` before the seal. Test
  (`session-intake-guards.test.ts`): a finalize with no or non-email contact is 400 and the
  session is not sealed.
- **R4-api-devcase-1-9.** Fix: `workspaceId: lc.workspaceId` on all three `recordAudit` calls.
  Test: a twin of `devcase-approve-audit-tenancy.test.ts`; a team lifecycle's close row is
  under `listAudit(…, team.id)` and not the default workspace's.
- **R4-api-devcase-1-11.** Fix: a store helper `hasDevSessionEvent(id, "perturbation")`
  (`SELECT 1 … AND kind = ? LIMIT 1`). Test (`devcase-flush-guards.test.ts`): the
  perturbation still fires exactly once across two flushes, and the route no longer calls
  `getDevSessionEvents` (source assertion).
- **R4-api-devcase-1-12.** Fix: pass `request.signal` and correct the comment. Test: a
  redesign route test with a pre-aborted signal asserts the (stubbed) spawn sees `aborted`.
- **R4-api-devcase-1-13.** Fix: reword the comment to store plus translator. Test: none
  (comment only).
- **R4-api-devcase-1-14.** Fix: `Buffer.byteLength(raw, "utf8")`. Test
  (`devcase-flush-guards.test.ts`): a multi-byte body charges its UTF-8 length.

The 9 M findings (R4-interview-ui-8, R4-schedule-ui-2-1/5/7, R4-matrix-ui-1-13/14,
R4-api-devcase-1-7/8/10) need a design choice or a multi-file change. They are anchored in the
findings table and escalated, not carried as S.

### Gate output

This round changed no source, so the code gates were run once, on the branch base
`4443387e8`:

- `npm run typecheck` clean. It rewrote the three `app/_lib/*.generated.ts` files with CRLF
  only (`git diff --ignore-all-space` empty); they were restored.
- `npm run lint`: 0 errors / 49 warnings (pre-existing).
- `npm run test:unit`: 13014 / 13014.
- `node scripts/run-unit-tests.mjs "scripts/kpi/**/*.test.mjs"`: 85 / 85.
- `npm run test:docs` and `npm run docs:check` ran on the tree WITH this section: both exit 0
  (`docs:check`: 22 decision records valid). `test:docs` also rewrote the three
  `*.generated.ts` files with CRLF only; restored.

### Coverage after this round

| | |
|---|---|
| thread contexts read through all five lenses | **19 / 55** (34.5%) — was 14 / 55 |
| of the whole 143-map | **19 / 143** (13.3%) — was 14 / 143 |
| contexts where `ui-perfectionist` had a surface and ran | 8 (was 5) |
| thread groups with no five-lens context | **0 / 7** — unchanged. Per group: CV Analysis 2/8, Candidate Matching 3/7, Developer Assessment 4/9, Hiring Decisions 3/8, Hiring Pipeline 2/10, Interview Scheduling 2/5, Voice Interviews 3/8. Thinnest by share now: Hiring Pipeline (2/10) and CV Analysis (2/8) |
| S findings fixed | 0 (read-only round) — round 2: 8 |
| new findings recorded | 69 (60 S, 9 M) + 5 duplicates |
| S carried over, written fix-and-test-ready | 60 (59 CONFIRMED, six of them with a named unverified side; 1 UNVERIFIED) |

All five contexts count: every applicable lens ran on each, and the two n/a cells are the two
contexts with no `.tsx` (`voice-runtime-1`, `api-devcase-1`). 36 thread contexts remain. At
five per round that is eight more rounds.

## Recorded per-context coverage — 2026-10-09, ROUND 5, READ-ONLY (branch `autopilot/codebase-static-analysis-sweep-ffb4bb0f`)

**The denominator is round 3's, unchanged:** the 55 thread contexts of the retired 143-map
(`git show 9c20a787:context-map.json`), decided and re-counted in the round-3 section above.
Every id below is a 143-map id, and each file list was resolved from `9c20a787`.

Fifth five-lens round of dev_goal `081c3e5a`. **Read-only:** every feature span was under an
open operator Approval until 09:00, so nothing in `app/`, `pipeline/`, `scripts/` or
`messages/` changed. Every finding is recorded here, not fixed. Round 4 named Hiring Pipeline
(2/10) and CV Analysis (2/8) as the thinnest groups by share, so the batch takes three
contexts from the first and two from the second:

- `db-pipeline`, `lib-offers` and `pipeline-board-1`: Hiring Pipeline.
- `lib-profile` and `profile-ui-1`: CV Analysis & Candidate Profiles.

`app/features/insights/about/`, `app/about/` and `app/landing/spark/` were neither read nor
judged: another builder was changing them.

### The round

`✓` = read through that lens and judged; *clean* = judged with nothing found, which IS
coverage; *n/a* = the lens has no surface here (no `.tsx` in the context). Counts are new
findings; S/M/L as in round 2.

| context | cat | files read | bug-hunter | ui-perfectionist | security-auditor | performance | ambiguity | fixed |
|---|---|---|---|---|---|---|---|---|
| `db-pipeline` | test | 5 / 1 map-src | ✓ 1 S, 1 M | n/a | ✓ 4 S | ✓ 2 S (1 U) | ✓ 2 S | - (read-only round) |
| `lib-offers` | test | 5 / 5 map-src | ✓ 6 S, 2 M | n/a | ✓ 1 M | ✓ clean | ✓ 2 S | - (read-only round) |
| `pipeline-board-1` | ui | 9 / 19 map-src (13 gone) | ✓ 4 S | ✓ 8 S, 1 M | ✓ 1 M | ✓ clean | ✓ 3 S | - (read-only round) |
| `lib-profile` | test | 15 / 12 map-src | ✓ 5 S, 1 M | n/a | ✓ 2 S, 2 M | ✓ 2 S | ✓ 3 S | - (read-only round) |
| `profile-ui-1` | ui | 29 / 20 map-src | ✓ 6 S, 1 M | ✓ 5 S, 1 M | ✓ 1 S, 1 M | ✓ 1 S (U) | ✓ 4 S | - (read-only round) |

### Declared cuts, stated rather than rounded away

- **"Files read" counts SOURCE files, read in full.** It is map source plus new source in the
  same directories that is in no 143-map context:
  - `db-pipeline` +4: `pipeline-core.ts`, `pipeline-events.ts`, `pipeline-calibration.ts`
    (split out of `pipeline.ts` in `bbb2f56c6`, 2026-09-08) and `pipeline-locale.ts`
    (`617e0a197`, "a leaf beside db/pipeline.ts"). `pipeline.ts` itself (3790 lines) was read
    end to end. `app/_lib/db/` holds 41 unmapped sources; the other 37 belong to other
    features and were neither read nor judged.
  - `lib-offers` +0. No unmapped `offer*` source exists in `app/_lib/`.
  - `pipeline-board-1` +3: `HumanScorecardByline.tsx`, `PipelineEntryNoteThread.tsx` and
    `SchedulerJobRow.tsx`, the three `.tsx` that round 3 named and left unjudged. The
    directory's other nine unmapped `.ts` are round 3's `pipeline-board-5` +9, and were not
    re-judged.
  - `lib-profile` +3: `archetype-live.ts`, `archetype-registry-file.ts`,
    `candidate-population.ts`. `app/_lib/` holds 158 unmapped sources; only these three
    belong to this context's subject.
  - `profile-ui-1` +9: `ArchetypeArchiveConfirmModal.tsx`, `profileBulkRefresh.ts`,
    `profileDraftMerge.ts`, `profileEditorBackup.ts`, `profileReadiness.ts`,
    `profileRebuildMerge.ts`, `ProfileRosterRefreshBar.tsx`, `profileRoutingReasons.ts`,
    `useCandidatePopulation.ts`.
- **`pipeline-board-1` lists 13 files that are gone**, from 19 listed sources:
  - `83f4979fa` (2026-09-16) deleted `PipelineAiActionsGrid.tsx`,
    `PipelineBoardStageCell.tsx`, `PipelineBoardToolbar.tsx` and
    `PipelineCandidateDrawer.tsx`.
  - `b7fde0c32` (2026-09-25, "the composition-kit view is the only Hiring pipeline surface")
    deleted `PipelineActivityFeed.tsx`, `PipelineAttentionStrip.tsx`, `PipelineBoard.tsx`,
    `PipelineBoardOffAxisStrip.tsx`, `PipelineBulkActionBar.tsx`,
    `PipelineBulkDecideRow.tsx` and `PipelineBulkOutreachButton.tsx`.
  - `8e10b4218` (2026-10-08) deleted `PipelineCandidateMenu.tsx` and
    `PipelineCandidateRow.tsx`.
  - Their successors live in subdirectories that are in no 143-map context: `kit/` (6
    sources), `orbit/` (29), `candidate/` (23), `map/` (4) and `empty/` (5). None was read
    or judged. **So this context counts as five-lens coverage of what survives of it, not of
    today's board.** The 67 subdirectory sources are the largest unmapped hole in Hiring
    Pipeline.
  - All nine files read have a live importer: CommandBar and PassPreviewModal through the
    shell's SimControlDock, SchedulerJobRow through SchedulerControl, the drawer parts
    through `candidate/`, and HumanScorecardByline from `PipelineHumanScorecardCard.tsx` and
    `JobsCompareInterviewsEvidenceCard.tsx`.
- **No other listed file is gone.** The other four contexts' `file_paths` all exist.
- **The `cat` column follows the map.** The 143-map labels `db-pipeline`, `lib-offers` and
  `lib-profile` `test`, because most of their listed paths are tests. The source judged in
  each is `lib` + `api`, with no `.tsx`, which is why their `ui-perfectionist` cell is n/a.
- **Colocated `*.test.ts` files were read only for what they already assert**, so a covered
  case is not reported as a gap. They were never audited as code. Same gap as rounds 1-4.
- **`db-pipeline`:**
  - The following were traced at the cited lines, not judged: `core.ts` (`recordEvent`, the
    DDL and indexes), `interviews.ts`, `interview-recording.ts`, the interview connect and
    recording routes, the apply and followup routes, `application-filing.ts`, `consent.ts`,
    `consent-expiry-reminders.ts`, `decision-attribution.ts`, `thread-autonomy.ts`,
    `automation-pass.ts`, `automation-run.ts` and `interview-scorecard-commit.ts`.
  - The director's transcript writes after a fresh connect were not traced. That is the open
    side of R5-db-pipeline-1.
  - Round 4 left one question open (R4-interview-ui-2: does `anonymizeEntry` clear the
    recording consent?). It is now answered:
    - `anonymizeEntry` does **not** clear `recording_consent_at` and does not revoke the
      session. Its only `interview_sessions` write is `db/pipeline.ts:2500-2502`.
    - It does delete the recordings, after the commit and best-effort (`:2850-2856`).
    - So the erasure variant is open, and it is filed as R5-db-pipeline-1. R4-interview-ui-2's
      own fix is still needed for the candidate's delete door.
- **`lib-offers`:**
  - Traced, not judged: `pipeline-entry-action.ts`, `comms-dispatch.ts`, `app/offer/[token]/`
    (page, `OfferClient.tsx`, `offer-deadline.ts`) and `instrumentation-node.ts`.
  - R5-lib-offers-5's fix site is `comms-dispatch.ts`, which belongs to the comms context. It
    is filed here because the contradiction is offer-finalize's own comment and the offer
    letter.
  - The Helm chart's container `TZ` was not checked.
- **`pipeline-board-1`:**
  - The shell's `app/features/shell/simulation/simControlCenterKit.ts` (`useAutomationPass`)
    was traced, not judged. R5-pipeline-board-1-3, -4 and -15 have their fix site there and
    say so.
  - Style and recipe drift declared in `style-debt.json` / `recipe-debt.json` (CommandBar's
    raw button and red-600, PassPreviewModal's amber shades, ResultView's bare `rounded`,
    SchedulerJobRow's `h-6`) is not filed.
- **`lib-profile`:**
  - Mutating `/api/profile`, `/api/profile/draft` and the two archetype routes have no
    capability gate. They sit on `route-capability-coverage.test.ts`'s ALLOWED list as
    "slice 2 candidate": known debt, not filed.
  - The 300-row analyses scan floor in `candidate-timeline.ts:232-238` is a documented
    trade-off and is not filed.
  - The workspace-blind `listOffersForEntry` (`offers-store.ts:287`) is defense-in-depth only
    (the entry id is already resolved inside the tenant) and is not filed.
- **`profile-ui-1`:** the sibling files (`useArchetypeManagerActions.ts`, `ProfileTab.tsx`,
  `useProfileEditorFields.ts`, `useProfileEditorSubmit.ts`, `candidateMatrixView.ts`,
  `ProfileResultPanel.tsx`) were traced, not judged.
- **Observed out of lane, not counted:**
  - `useProfileEditorFields.ts:266-274`: `applyDraft` overwrites a restore the user has not
    decided on, so the next write deletes the offered backup values.
  - `useArchetypeManagerActions.ts:69,121` and `useProfileEditorSubmit.ts:92,120` parse the
    body before the `ok` check, so a non-JSON 502 renders `e.message`.
  - `useProfileEditorSubmit.ts`: `stale` is never reset by a later save.
  - `SchedulerRunHistory.tsx:60` renders `run.error` like R5-pipeline-board-1-7.
  - `ScheduleInterviewHumanScorecardSection.tsx:51` leaks the stage id like
    R5-pipeline-board-1-11.
  - `/api/comms` has no consent read-gate either (grep only).
- **Line anchors were taken one file at a time** (`grep -n` on one file, or a Read of one
  file). Every reviewer was told never to use `cat -n` over several files.
  - Re-read: every one of the 73 findings had its anchor re-read on this worktree with a
    per-file `sed -n` or `grep -n` before this table was written, about 100 line sites in
    all, plus the 13 pointer lines in the duplicates below. All held.
  - The reviewers' own pass found one anchor off by four lines (`pipeline-entry-action.ts`
    `:326` → `:330`, in R5-lib-offers-3's path) and corrected it.
  - R5-lib-profile-1 was traced end to end a second time, by hand: `TasksProvider.tsx:79-85`
    posts `{kind, params}`, nothing on the path adds `lang`, `tasks.ts:393` casts the params
    through, `profile-draft-run.ts:64` puts `params.lang` into the args, and
    `python-runner.ts:490` → `:450` throws on a non-string. The sync `/api/profile/draft`
    route passes `getServerLocale()` and is unaffected.

### Findings

**73 new findings: 61 S, 12 M, 0 L.** Five duplicates were not counted (below). Nothing was
fixed (read-only round). "C" = CONFIRMED, traced end to end; "U" = UNVERIFIED, with what was
not read. Path roots: db = `app/_lib/db/`; board = `app/features/hiring/pipeline/`; profile =
`app/features/tools/profile/`; anything else is rooted.

| id | lens | sev | file:line | what is wrong | path read | |
|---|---|---|---|---|---|---|
| R5-db-pipeline-1 | security | S | `db/pipeline.ts:2500-2502`, `:2850-2856` | erasure leaves the candidate's AI-interview link live. The schedule and offer tokens are revoked (`:2531-2537`, `:2552`), but the session only has its label, transcript and scorecard blanked: status unchanged, `recording_consent_at` kept. `revokeOpenInterviewSessions` runs only after a reject (`:3643`), `/connect` refuses only terminal entries, and an erased entry stays `active`. An erased person's link can start a paid voice call, and audio upload passes its consent and status gates | `:2817` → `:2500-2502` → `app/api/interview/connect/route.ts:173-176` → `app/api/interview/recording/route.ts:77,84` | C (store and gates); U: the director's transcript writes after a fresh connect |
| R5-db-pipeline-2 | security | S | `db/pipeline.ts:2746-2750`, `:2143` | the erasure claim nulls the erasure, opt-out and applicant tokens but not `lead_token`, and `findEntryByLeadToken` does not filter `anonymized_at`. The emailed "complete your profile" link still resolves to the erased row. A token-proof re-apply backfills `contact` (NULL, so the guard passes), can rebuild the CV into the erased profile, and renews consent: the re-attachment `:1637` and `:1924` forbid. The sweep never sees the row again | `app/api/apply/[id]/route.ts:351` → `app/_lib/application-filing.ts:275,231-232` → `db/pipeline.ts:1974` → `application-filing.ts:261`; `followup/route.ts:72` | C |
| R5-db-pipeline-3 | security | S | `db/pipeline.ts:2746-2750` | erasure leaves `approval_detail` untouched. For `scorecard_review` it holds the interview scorecard verbatim (`app/_lib/interview-scorecard-commit.ts:61`), the same text `scrubEntryLinkedPii` nulls on `interview_sessions` because it quotes the candidate (`:2497`). `approvalDetail` is on the board allowlist (`:129`), so the copy is served on every board poll | `:61` → `setApproval` `:3244` → claim `:2746-2750` → `BOARD_ENTRY_FIELDS` `:129` | C (store, allowlist); U: the Decisions render |
| R5-db-pipeline-4 | security | S | `db/pipeline.ts:2799-2801`, `:2764` | the recruiter's free-text decision note survives erasure twice: `scrubAnalysis` does not null `analyses.decision_note`, and the `disposition_set` echo copies the note into `pipeline_events.detail` (`:1888-1897`), where erasure masks only `candidate_label` (`:2764`). The file's own rule (`:2489-2494`) erases recruiter free text about the person | `app/api/analyses/[slug]/route.ts:153` → `:1888` → `anonymizeEntry` `:2764,2799-2801` | C |
| R5-db-pipeline-5 | bug | S | `db/pipeline.ts:2931-2934`, `:2953-2955` | a renewed consent never gets its pre-expiry reminder. A re-apply renews the grant (new `consent_given_at`, `:2282-2285`), but the old cycle's `expiring_notified` row is permanent, and both the due-list `NOT EXISTS` and the claim's `already` check match any such row ever. The renewed grant is anonymized at expiry with no notice, though the reminder exists so the person can renew or erase first (`consent-expiry-reminders.ts:6-9`) | `application-filing.ts:261` → `recordEntryConsent` `:2285` → `listConsentExpiryNoticeDue` `:2933` → `anonymizeExpiredConsents` `:2865` | C |
| R5-db-pipeline-6 | bug (attribution) | M | `db/pipeline.ts:3216-3218`, `:3280-3295` | `setApproval` writes `approval_set` with no actor, deliberately, so it invents no human. But `DECISION_META.approval_set` is `auto: false` (`app/_lib/decision-attribution.ts:35`), and the autonomy meter (`thread-autonomy.ts:139`) and `summarizeAutomationImpact` fall back to the kind map. Most raisers are machines (`automation-run.ts:633,686,690`, `automation-pass.ts:517`, `stage-hooks.ts:286,361`), so every machine-raised gate counts as a human act: the misattribution the comment says it avoids. M: actor threading or a kind split | `automation-run.ts:633` → `:3285` (actor NULL) → `thread-autonomy.ts:139` → `decision-attribution.ts:241-242` | C |
| R5-db-pipeline-7 | perf | S | `app/_lib/db/core.ts:640`, `:2558`, `:2699` | `pipeline_events` has no index on `entry_id` (only `created_at`, `(workspace_id, created_at)`, `workspace_id`), so every per-entry read scans the tenant's event log: drawer history, `hasEvent` / `hasEventToday` / `hasEventSinceStageChange` (`db/pipeline.ts:3376,3401,3419`), the reconsider and rejected-lane subqueries (`:1350-1352,1377-1379`), and the erasure mask (`:2764`). The automation pass runs the dedupe per alert per entry, up to 2000 entries a tick (`automation-pass.ts:401-403`) | `automation-pass.ts:402` → `:3419` | C (DDL); cost reasoned, not measured |
| R5-db-pipeline-8 | perf | S | `db/pipeline.ts:1925-1929` | `findApplicationByApplicant` runs `SELECT *` over every non-erased entry of the job (github JSON, notes, approval blobs) on each public apply, then matches in JS; `normalizeContact` is trim + lowercase, which `candidateIdByContact` (`:1825-1830`) already does in SQL | public apply → `application-filing.ts:275` → `:1927` | U: per-job volumes not measured |
| R5-db-pipeline-9 | ambiguity | S | `db/pipeline-calibration.ts:1-142`; `db/pipeline-events.ts:197-213`; `db/pipeline-core.ts:1-2,194-198` | dead and drifting split-outs: `pipeline-calibration.ts` has no importer (all three calibration tests import `./pipeline.ts`) and encodes an older rule (`:82-86`, current stage only). `pipeline-events.ts` keeps a stale `PIPELINE_REASON_CODES` missing `commandWaveReversed` and `readdedByRecruiter`, plus importer-less list helpers. `pipeline-core.ts` says "only from sibling pipeline-*.ts", but `automation-pass.ts:15` and `api/pipeline/outcomes/hire-roster.ts:15` import it, and its `nextStageOnAxis` twins the private one at `pipeline.ts:3438-3442` (the pass decides with one copy, the store commits with the other; identical today) | grep over app, scripts, packages, edge, root | C |
| R5-db-pipeline-10 | ambiguity | S | `db/pipeline.ts:3265-3279`, `:330-339`, `:571`, `:3516` | four comments the code contradicts: the three `approval_set` registrations are "still owed" (all exist: `pipelineEventCatalog.ts:92,225`, `decision-attribution.ts:35`, 4 catalogs); `listPipelineEventsSince`'s doc sits on `listRecentPipelineEvents` and `:375` has none; `intakeCapturedManually` is credited to `mergeReapplication`, but the writer is `clearIntakeDegraded` (`:2013`); approve_event's terminal guard is "above" but is below (`:3557`) | — | C |
| R5-lib-offers-1 | bug | S | `app/_lib/offer-reminders.ts:42-43` | `dispatchOfferReminder` returns a `failed` / `refused` outcome rather than throwing (no recipient on an agent-population entry, a relay that records `failed`), and the sweep ignores it and counts `sent += 1`. `offer_comms_failed` is written only in the catch, so a claimed-never-sent reminder is invisible and the heartbeat logs "offer reminders sent: N". `candidate-next-action-server.ts:113` reads the outcome | `:29` → `:42` → `comms-dispatch.ts:1100,1110` → `:346-362` → `:327` `delivered()` → `instrumentation-node.ts:463-464` | C |
| R5-lib-offers-2 | bug | S | `app/_lib/offer-reminders.ts:37-38`; `app/_lib/offers-store.ts:263-266` | the reminder sweep never checks the entry's status. A reject (`db/pipeline.ts:3551`) or a job close leaves the offer `extended`, so a rejected candidate gets "your offer expires in 48h". The interview reminder filters exactly this with `isEntryReminderEligible` (`schedule-store.ts:897-899`), which `markEntryStatus` (`offers-store.ts:435`) cites as its model | `offers-store.ts:263` → `offer-reminders.ts:20,29,37` → `comms-dispatch.ts:1100`; grep `UPDATE offers`: only erasure | C |
| R5-lib-offers-3 | bug | S | `app/_lib/offers-store.ts:331` | the material-change guard compares salary, currency and TTL only. A re-extend after the recruiter edits the draft's `startDate` or `notes` is a verbatim re-send, so `payload_json` is not refreshed, while the letter is built from the live draft (`pipeline-entry-action.ts:330`). The binding accept page renders the stored payload (`offer-finalize.ts:236-237`), so it shows the old date, and the `offer_terms` record is not re-sealed: the letter-vs-page divergence `:318-328` says it prevents | `pipeline-entry-action.ts:286-297` → `offers-store.ts:331,347` → `pipeline-entry-action.ts:304,328-330` → `offer-finalize.ts:214,236-237` | C |
| R5-lib-offers-4 | bug | S | `app/_lib/offers-store.ts:280` | `markOfferReminded` re-checks `reminded_at IS NULL AND status='extended'` but not the deadline the sweep snapshotted (`offer-reminders.ts:20`) before awaiting each dispatch. A re-extend during the loop resets `reminded_at` and moves `expires_at` (`offers-store.ts:357`); the offer is then claimed and nudged with the stale deadline, and the new window's one reminder is spent | `offer-reminders.ts:20,29,42` ‖ `pipeline-entry-action.ts:286` → `offers-store.ts:355-358` | C (likelihood low: two due offers in one tick) |
| R5-lib-offers-5 | bug | S | `app/_lib/comms-dispatch.ts:1081-1088`; `app/_lib/offer-finalize.ts:229-232` | the server-side `formatOfferDeadline` sets no `timeZone`, so the letter and the reminder state the deadline in the server process zone, while the accept page renders it in `INTERVIEW_TZ`. On a UTC host 22:30Z reads "12 Sept, 22:30 UTC" in the letter and "13 Sept, 00:30 CEST" on the page. The comment at `offer-finalize.ts:230-231` ("formatOfferDeadline already accepts this as its third argument") is true only of the client function of the same name | `offer-finalize.ts:229-232` → `app/offer/[token]/offer-deadline.ts:45-49`; `comms-dispatch.ts:681,1105` → `:1064-1088` → `date-format.ts:25-34` | C (code); U: the chart's container TZ |
| R5-lib-offers-6 | bug | M | `app/_lib/offer-finalize.ts:76-88`, `:181-193` | the response is claimed first (row set to `accepted` / `declined`), then `getPipelineEntry`, `getPipelineAxis` and `actOnPipelineEntry` run with no try/catch or compensation. If one throws (SQLITE_BUSY past the 5 s timeout `offers-store.ts:22-26` worries about), the route answers 500 and every retry hits the `alreadyResponded` echo (`:39-46`). The entry stays on Offer for good with no `offer_accepted` event, meter or webhook. M: a compensation or reconcile design | `app/api/offer/[token]/route.ts:58` → `:29,39,76` → `:82,88` → retry `:39-46` | C (path); SQLITE_BUSY frequency not measured |
| R5-lib-offers-7 | bug | M | `app/_lib/offer-finalize.ts:110-113`, `:177` | nothing withdraws an open offer when its entry is rejected or closed. The candidate can still accept: `actOnPipelineEntry` refuses the terminal entry and `offer_accept_blocked` is recorded, but the candidate is answered `{ok: true, status: "accepted", alreadyResponded: false}` and the row is `accepted` for good. They believe they accepted a job they were already turned down for. Adjacent to backlogged "withdraw an extended offer" (`docs/BACKLOG.md` T33); the untruthful success is its own defect | `db/pipeline.ts:3551` → `:29` (still `extended`) → `:76` → `:88` (null) → `:113` → `:177` | C |
| R5-lib-offers-8 | security | M | `app/offer/[token]/OfferClient.tsx:190`; `app/_lib/offers-store.ts:355-358` | an accept is not bound to the terms the candidate saw. A re-extend rewrites salary, currency and deadline in place on the same token, and the POST carries only `{response}`. A tab showing 100k (refresh 60 s plus focus) can accept after a re-extend at 90k, and the binding accept records 90k. M: a terms version on the client, a CAS in `markOfferResponded`, a new code in 4 catalogs | `OfferClient.tsx:190` → `route.ts:52-58` → `offer-finalize.ts:76` → `offers-store.ts:386-388` | C |
| R5-lib-offers-9 | bug | S | `app/_lib/offers-store.ts:214` | the lazy lapse decides "expired" in JS, then runs `UPDATE … WHERE token=? AND status='extended'` without re-asserting the deadline; the sibling sweep (`:236`) does carry `expires_at <= ?`. A re-extend from another connection in the gap would be overwritten to `expired`: the read→compute→write that neither locks nor re-checks | `:210-215` vs `:234-237` | C (needs a second process on the file) |
| R5-lib-offers-10 | ambiguity | S | `app/_lib/offers-store.ts:429`; `app/_lib/offer-finalize.ts:187` | both comments justify the conditional decline with "offer tokens never expire", which the deadline policy (`offer-policy.ts:1-6`, `expireOfferIfDue`, `lapseExpiredOffers`) contradicts. The guard is right; its stated premise is false | grep `never expire` | C |
| R5-lib-offers-11 | ambiguity | S | `app/_lib/offer-policy.ts:88-101`, `:27`, `:22` | `isOfferReminderDue` has no non-test caller, though its doc says it makes "the heartbeat's reminder policy … unit-testable"; the heartbeat runs a SQL copy (`offers-store.ts:263-266`), so `offer-policy.test.ts:84` pins a function production never runs. `OFFER_TTL_MS` is test-only and frozen at module load. `:22` (and `pipeline-entry-action.ts:300`) name `resolveOfferTtlMs`; production uses `resolveOfferTtlDays` | grep over app, scripts, packages, edge, `instrumentation-node.ts` | C |
| R5-pipeline-board-1-1 | bug | S | `board/CommandBar.tsx:76`, `:154-160`, `:203` | Confirm sends the CURRENT input `text`, not the previewed text. The input stays editable while a preview is in flight (`busy` blocks only submit), so a reply can paint a preview of A while the input holds B; Confirm then runs B with `confirm: true`, and for reject_below attaches A's `matchedIds`. "Advance the top N" or "run the policy pass" can execute unseen. Distinct from R3-api-pipeline-4 (which ids), this is which command | `:60-99` → `app/api/pipeline/command/route.ts:165-172` | C (needs the in-flight window) |
| R5-pipeline-board-1-2 | ui (i18n) | M | `board/CommandBar.tsx:97`, `:176`, `:183` | the bar renders the server's `description`, built in English by `describeCommand` (`app/_lib/pipeline-command.ts:66-87`), including the consent sentence "Reject and notify active candidates…" and "Didn't catch that.". The route ships no kind parameters, so the client cannot compose it. M: a parameterised description across route, client and 4 catalogs; `pipeline-command.test.ts:57` pins the English | `command/route.ts:85,104` | C |
| R5-pipeline-board-1-3 | bug | S | `app/features/shell/simulation/simControlCenterKit.ts:178-180` → `board/PassPreviewModal.tsx:166-170` | a network failure on commit sets only the dock's `error`, behind the modal; `commitError` stays null (cleared at `:148`) and Apply just reverts. The "click simply did nothing" defect the modal's doc (`:37-40`) says was fixed, fixed only for coded refusals. Fix site is the shell kit | `SimControlDock.tsx:113-122`; `PassPreviewModal.test.ts` covers the coded path only | C |
| R5-pipeline-board-1-4 | bug | S | `simControlCenterKit.ts:109`, `:133-135` → `board/PassPreviewModal.tsx:178`, `:194-209` | `dryRun` clears `report` before fetching; if the re-preview fails, `preview` keeps the old object, so the modal shows the pre-commit rows with a live Apply and the old unticked set, and the failure line is again only on the dock behind it. While in flight, Apply reads "Running the pass…". The server's drift check bounds the damage. Fix site is the shell kit | `:105-141` | C |
| R5-pipeline-board-1-5 | ui (a11y) | S | `board/PassPreviewModal.tsx:178-209`; `board/CommandBar.tsx:200-209`, `:249-258` | async success unmounts the focused button and drops focus to `<body>`: Apply becomes Re-preview when a report arrives (and `useDialogA11y.ts:133-139` wraps Tab only from first/last/node, so the next Tab escapes the modal); CommandBar's Confirm and Undo unmount the same way | `app/_components/useDialogA11y.ts:124-140` | C |
| R5-pipeline-board-1-6 | bug | S | `board/SchedulerJobRow.tsx:92-100` | the cadence draft re-mirrors only when the stored `intervalMinutes` changes; a failed or refused `setJob` leaves `jobs` untouched (`useSchedulerControlState.ts:195-200` only sets `error`), so the field keeps showing a cadence that was never saved | `SchedulerControl.tsx:107` → `useSchedulerControlState.ts:166-224` | C |
| R5-pipeline-board-1-7 | security | M | `board/SchedulerJobRow.tsx:157`, `:184` | `latest.error` / `run.error` is rendered verbatim inside `runFailedMsg`: for registry jobs the clock persists `e.message` (`instrumentation-node.ts:434`), and GET `/api/automation/schedule` forwards it unprojected (`route.ts:60`, `scheduler-store.ts:395`). Same exception class the POST codes as `SCHEDULE_UPDATE_FAILED`; a different data flow from R3-pipeline-board-5-5 (the tick) and R4-schedule-ui-2-7. M: a stored reason code across clock, store, route and catalogs. Operator-only | as listed | C |
| R5-pipeline-board-1-8 | ui (i18n) | S | `board/SchedulerJobRow.tsx:152-157`, `:184` | the manual jobseeker scan persists a CODE (`app/_lib/tasks.ts:433`, e.g. `ENGINE_FAILED`), and the row renders "Run failed: ENGINE_FAILED" though `errors.ENGINE_FAILED` exists; the comment at `:152-155` ("raw server exception with no machine code") is wrong for this job | `app/_lib/jobseeker/scan.ts:86-97` | C |
| R5-pipeline-board-1-9 | ui (a11y) | S | `board/SchedulerJobRow.tsx:110`, `:115` | the "why it's locked" reason (`unverified`) lives only in `title=` on a disabled button, out of keyboard, touch and screen-reader reach, though the header (`:10-13`) calls it "a courtesy that says WHY"; the toggle's accessible name is just On/Off, so several rows read "On, pressed" | — | C |
| R5-pipeline-board-1-10 | ui | S | `board/PipelineCandidateResultView.tsx:130`; `board/PipelineCommsList.tsx:79`; `board/SchedulerJobRow.tsx:171` | `title=` tooltips, which `ui.md` bans; ResultView's `unpricedTitle` carries an instruction ("Set the amount when you approve the offer") only mouse users see. No ratchet covers `title=` | `style-debt.json`, `recipe-debt.json`: no title rule | C |
| R5-pipeline-board-1-11 | ui (i18n) | S | `board/HumanScorecardByline.tsx:19` | `b.stage` is the pipeline stage id (`app/api/interview-prep/scorecard/route.ts:61,169` → `"Interview"`) interpolated raw, so cs/de/fr read "Kolo: Interview"; the rest of the app uses `enumLabel("stage", …)` (`CandidateModalBody.tsx:62-67`) | `app/_lib/human-scorecard-set.ts:139-142` | C |
| R5-pipeline-board-1-12 | ui (a11y) | S | `board/CommandBar.tsx:174-176`, `:237-238`, `:260`; `board/PipelineEntryNoteThread.tsx:85`; `board/PipelineCandidateNoteField.tsx:26-36` | failure text without `role="alert"`; in NoteField the save-status span sits INSIDE the `<label>`, so the textarea's accessible name becomes "Candidate notes Couldn't save", and the failure is only `aria-live="polite"` | — | C |
| R5-pipeline-board-1-13 | ambiguity | S | `board/PipelineCandidateResultView.tsx:17` | every LLM result is labelled `pipeline.result.claudeCli` ("Claude CLI") whatever the provider; `automation.py:515-553` tags any configured provider (Gemini, OpenAI, Azure, OpenRouter, ollama) `"llm"`, so the provenance chip is false on non-Claude installs | catalogs en/cs/de | C |
| R5-pipeline-board-1-14 | ambiguity | S | `board/PipelineCandidateDrawerTypes.ts:49-63` | the English `APPLIED_LABEL` fallback says "keep the two in step", but `offer_ready` and `advisory` already differ from `messages/en.json` `pipeline.applied`; every key exists in the catalog, so the fallback is unreachable | `PipelineCandidateResultView.tsx:47-52` | C |
| R5-pipeline-board-1-15 | ambiguity | S | `simControlCenterKit.ts:85-87` | the hook's comment says "the pass auto-rejects AND emails candidates"; the modal it feeds (`board/PassPreviewModal.tsx:31-36`) says the pass does NOT auto-reject and sends zero rejection emails. Fix site is the shell kit | — | C |
| R5-pipeline-board-1-16 | ui (a11y) | S | `board/CommandBar.tsx:254` | the Undo button's `aria-label` ("Undo the rejection of N candidates") overrides and does not contain its visible text ("Undo these rejections"), so voice-control users cannot say what they see (WCAG 2.5.3) | en catalog | C |
| R5-pipeline-board-1-17 | ui | S | `board/PassPreviewModal.tsx:108` | `label()` falls back to the raw entry id; when the board read fails (`simControlCenterKit.ts:120-122,132` silently sets `entries=[]`), every row is named by an internal id, with no notice | — | C |
| R5-lib-profile-1 | bug | S | `app/_lib/profile-draft-run.ts:64` | **every AI profile draft started from the editor fails before Python runs.** The CLI gets `"--lang", params.lang`; the editor starts the task with `{ text: aiText }` only (`profile/ProfileEditorAiDraft.tsx:46`), nothing on the path adds `lang`, so `assertSpawnArgs` (added in `e079f23b3`, 2026-09-15) throws on `undefined`. The unit test mocks the spawn, so the check never runs there. A non-string `text` also throws on `.trim()` at `:52` | `ProfileEditorAiDraft.tsx:46` → `TasksProvider.tsx:79-85` → `app/api/tasks/route.ts:108` → `tasks.ts:393` → `:64` → `python-runner.ts:490` → `:450` | C (static trace, re-traced by hand; not executed) |
| R5-lib-profile-2 | security (GDPR) | S | `app/_lib/candidate-timeline.ts:476`, `:346-356`, `:523` | the drawer bundle hides interview and human scorecards when consent has lapsed (`:426`: "a panel is no less PII than one card") but returns each letter's `recipient`, `subject` and `body` unfiltered, the three columns erasure blanks (`db/pipeline.ts:2517`); `rematchLinks[].candidateLabel` (`:523`) shows a lapsed counterpart's real name | `candidateDrawerBundle` → `candidateComms` → `listOutboxFiltered` → `toCandidateComm`; `consent.ts:83-92` | C |
| R5-lib-profile-3 | security (GDPR) | M | `app/_lib/candidate-pool.ts:78-101` | the shared pool builder applies no consent or opt-out gate; only `rediscover.ts:157` filters, and its comment says the gate "belongs before the ranking". `app/api/jobs/[id]/candidates/route.ts:36` and `winnability/route.ts:48` rank erased, lapsed and opted-out people and show their labels. M: where the gate lives is a cross-caller choice | `buildCandidatePool` → both routes | C (candidates); U: winnability output |
| R5-lib-profile-4 | security (GDPR) | M | `app/api/profile/route.ts:150`, `:178`; `app/api/profile/candidates/route.ts:34-35` | profile reads have no consent read-gate: `GET ?id=` returns the full CV payload of a profile whose entry's consent lapsed, and the list and population routes return profile labels plus `analyses.candidate_label` (`candidate-population.ts:223`) until the deferred sweep runs `anonymizeProfile`. Same class as R3-analyze-ui-1-7, on surfaces it does not name. M: per-row masking and search-on-masked-name, as there | `getProfileRecord`, `cachedProfileRecords`, `listAnalysisRecords`, `anonymizeProfile` | C (profile ↔ entry link via `candidate_id`, from the erasure map) |
| R5-lib-profile-5 | bug | S | `app/_lib/archetype-registry.ts:301`, `:341` | `fairnessProtected` is never type-checked (`pickEditable` copies it raw, `validateArchetype` ignores it) and the readers disagree on a non-boolean: TS (`archetypes.ts:73`) needs `=== true`, Python (`registry.py:114`) and the manager UI (`ArchetypeManagerList.tsx:49`) treat truthy as on. A PUT of `"true"` on a custom archetype shows a shield and Python protects it, while `screen-wave.ts` treats it unshielded and can auto-reject | PUT `/api/archetypes/[id]` → `updateArchetype` → `writeRegistry`; `readLiveArchetypes` → `shieldsFromAutoReject` | C (reachable by a raw operator PUT or a hand edit) |
| R5-lib-profile-6 | bug | S | `app/_lib/archetype-registry.ts:133-137` (comment `:122-124`) | the comment says read validation means "what this module will serve is exactly what Python will import", but `validateArchetype` checks only the three slots: a hand-edited fourth weight key passes, Python raises at import (`registry.py:42-46`) and every spawn breaks, while the manager and the live fairness gate call the file fine. Detection reason-kinds are not checked either | `parseRegistryDocument` → `validateRegistry` → `validateArchetype:243` | C |
| R5-lib-profile-7 | bug | S | `app/api/archetypes/route.ts:35`; `app/api/archetypes/[id]/route.ts:30`, `:46` | bare `request.json()`: invalid JSON, `null` or a non-object body (`'key' in "str"` in `pickEditable`) becomes a 500 `ARCHETYPES_WRITE_FAILED`, the bad-input-as-500 class `validateArchetype:235-237` was written to remove; the body size is unbounded (operator-gated) | route → `createArchetype` / `updateArchetype` → `pickEditable` | C |
| R5-lib-profile-8 | security | S | `app/_lib/profile-draft-run.ts:52`; `app/api/profile/draft/route.ts:42` | draft `text` has no length cap anywhere: the sync route reads the body with no limit, the task path takes `params.text` from the client, and `profile_draft_cli.py` puts all of it into a paid prompt. Calls are rate-limited, their size is not; the sibling `/api/profile` caps at 128 KB. A `null` body throws a 500 at `body.text` | route / `tasks` → `runProfileDraft` → `profile_draft_cli._extract_llm` | C |
| R5-lib-profile-9 | bug | S | `app/api/profile/route.ts:294-295` | POST enforces one profile per CV (`:217-219` plus `saveProfileForCv`'s immediate transaction), but PUT re-points lineage to any analysis slug with no ownership check and the hash index is not unique, so a rebuild onto another profile's CV recreates the two-profiles-per-hash state `candidate-population.ts:26-27` calls legacy | PUT → `resolveLineage` → `setProfileLineage` (`db/profiles.ts:283-296`) | C (code); U: whether the UI ever sends another CV's slug |
| R5-lib-profile-10 | perf | S | `app/api/profile/candidates/route.ts:34` | each Profile-tab load reads and schema-parses 200 full CV-analysis payloads (`safeRowParse` with `analysisResultSchema`, `db/analyses.ts:592-617`) to read one field, `v2Profile.archetype` (`candidate-population.ts:220`) | route → `listAnalysisRecords` → `analysisFromRecord` | C |
| R5-lib-profile-11 | bug | M | `app/api/profile/candidates/route.ts:34-35` | the population silently caps at 200 analyses and 200 profiles with no `truncated` flag (unlike `CandidatePool`), so the retire dialog's blast radius (`ArchetypeManager.tsx:79` via `routedCount`) undercounts on larger tenants and older same-CV analyses drop out of a profile row. M: paging or a count query plus the dialog's copy | route → `collapsePopulation` → `routedCount` | C; dialog wording not read |
| R5-lib-profile-12 | perf | S | `app/_lib/candidate-timeline.ts:289`, `:364` | `latestInterviewByEntry` (`SELECT *`, transcript included, `db/interviews.ts:638`) runs twice per drawer open, once for the timeline items and once for the outcome | `candidateDrawerBundle` | C |
| R5-lib-profile-13 | ambiguity | S | `app/_lib/candidate-timeline.ts:249`; `app/_lib/candidate-nps-store.ts:52`; `app/_lib/archetype-live.ts:130`, `:134`; `app/_lib/archetype-registry-file.ts:18` | exports with no production caller: `candidateTimeline` (none at all), `recentCandidateNpsComments` (none), `liveIsKnownArchetype` and `isFairnessProtectedLive` (tests only), `UNREADABLE_REGISTRY_FILE_DIGEST` (never imported) | grep over app, scripts, packages, edge | C |
| R5-lib-profile-14 | ambiguity | S | `app/_lib/archetype-registry.ts:23-24` | "no external importer (the two archetype routes use only create/list/updateArchetype)": `[id]/route.ts:3` also imports `setArchetypeArchived`, and `archetype-live.ts:4` imports `parseRegistryDocument` and `registryWriteGeneration` | imports | C |
| R5-lib-profile-15 | ambiguity | S | `app/_lib/archetype-registry.ts:97-99` vs `app/_lib/archetype-registry-file.ts:28-30` | two registry-path definitions though `archetype-registry-file.ts:9` claims one shared file: the writer and manager use their own `registryPath()`, so `setLiveRegistryPathForTest` moves the live reader and the digest but not the writer, and a test combining the override with `updateArchetype` would rewrite the checked-in `archetypes.json` | both files; the tests' chdir isolation | C |
| R5-profile-ui-1-1 | bug | S | `profile/ArchetypeManager.tsx:182-201` | the actions hook's `error` reaches only the Edit panel; Archive (View panel) and Unarchive (list) run in view mode, so a failed PATCH sets `error` and nothing renders it: retiring or restoring fails silently. A successful unarchive during an open edit calls `setMode("view")` and drops the edit unprompted | `useArchetypeManagerActions.ts:59-81` | C |
| R5-profile-ui-1-2 | bug | S | `profile/ArchetypeManager.tsx:79`; `profile/ArchetypeArchiveConfirmModal.tsx:59` | when the first population read fails, `useCandidatePopulation` leaves `rows` null and sets `failed` (`useCandidatePopulation.ts:48-51`), but the manager receives only `rows`, so the retire dialog says "Counting the profiles routed here…" forever; `:61-64` writes this down as intended, but nothing is counting | `ProfileTab.tsx:108` passes only `population.rows` | C |
| R5-profile-ui-1-3 | bug | M | `profile/CandidateDetailModal.tsx:96` (and sibling `candidateMatrixView.ts:59,64,80`) | `archetypeDisplayKey` checks the build-time archetype list (bau, student, career_switcher), so a candidate routed to a runtime custom archetype shows "Unrouted" in the modal and is filed into the Unrouted lane while the custom lane is dropped as empty, against `ArchetypeArchiveConfirmModal.tsx:9-12` ("the number matches the lane on screen"). `routedCount` avoids this (`candidate-population.ts:244-247`). M: the fix spans the sibling view model | `app/_lib/archetypes.ts:41,95-114` | C |
| R5-profile-ui-1-4 | bug | S | `profile/ProfileEditor.tsx:185-189` | `build()` stores `savedFields = fields` before the save resolves; if a second save fails (error or 409 stale), `result` still holds the first save's, so `showSaved` holds and the panel shows the earlier routing, completeness and "Match now" as if the current form were saved, beside the error | `useProfileEditorSubmit.ts:63-124` (`result` never cleared) | C |
| R5-profile-ui-1-5 | bug | S | `profile/ProfileRosterRefreshBar.tsx:58-74` | nothing aborts the bulk refresh on unmount (the file has no `useEffect`): List→Matrix or opening a row's editor unmounts the bar while `runBulkRefresh` keeps PUTting, the report is lost, and the remounted idle bar can offer a second run over rows still in flight | `ProfileRoster.tsx:186`; `ProfileTab.tsx:77,132-140` | C |
| R5-profile-ui-1-6 | bug | S | `profile/useProfileTabDeepLinks.ts:38-55` (same shape `:63-83`, `:111-135`) | editor openers have no last-request-wins guard; each fetch ends in `setEditor` with a new nonce, which remounts the editor, so Edit then "New profile" before the GET returns replaces the create editor (and what was typed), and two Edit clicks answered out of order open the wrong row | `ProfileTabTypes.ts:47-49`; `ProfileTab.tsx:83,126` | C (path; the window is network latency) |
| R5-profile-ui-1-7 | bug | S | `profile/useProfileTabDeepLinks.ts:137-145` | `reloadArchetypes` parses without checking `r.ok`, so a 500 (`ARCHETYPES_READ_FAILED`) after a manager edit replaces the loaded registry with `[]`: the manager falls into its create-only panel, the matrix loses its lanes, editor segments fall back to the baseline | `app/api/archetypes/route.ts:14-19` | C |
| R5-profile-ui-1-8 | security | M | `profile/profileEditorBackup.ts:42-45` | the backup slot key carries no workspace: a create intake is written to `kp.profileEditor.new`, tab navigation does not clear it, and `WorkspaceTab.switchTo` uses `location.reload()`, which keeps sessionStorage. In the next workspace "New profile" finds no versions and an unchanged baseline, `planRestore` takes the `silent` path (`:139-140`), and workspace A's candidate PII fills workspace B's form, ready to save. M: a tenant-keyed slot plus migration of live slots | `useProfileEditorFields.ts:136-171,193-205`; `WorkspaceTab.tsx:94-102` | C |
| R5-profile-ui-1-9 | security | S | `profile/ProfileEditorAiDraft.tsx:73` | the fallback passed to `resolveError` is `watch.error` itself; for profile_draft `storedFailure` stores the handler's `.message`, which `parseStderrError` fills with trimmed stderr (a Python traceback with paths) or the CLI's English `error`, rendered raw in every locale; `ProfileDraftError.code` is never stored | `app/_lib/tasks.ts:733-736`; `profile-draft-run.ts:68-71`; `python-runner.ts:702-722` | C |
| R5-profile-ui-1-10 | ui (i18n) | S | `profile/ArchetypeManagerEditPanel.tsx:83`, `:103` | `t("weightFieldLabel", { slot })` / `t("dimFieldLabel", { slot })` interpolate the raw slug, so cs reads "skills váha %", and these strings are the inputs' accessible names; `dimSkills` / `dimCareer` / `dimPersonal` exist (`ArchetypeManager.tsx:70`) | `messages/cs.json` `profile.archetypes.*` | C |
| R5-profile-ui-1-11 | ui (i18n) | S | `profile/ArchetypeManagerViewPanel.tsx:94` | checklist chips print the registry's English `c.label` ("seniority", "years of experience") in every locale; `profile.result.checks.<check>` exists and `ProfileResultPanel.tsx:62` resolves it through `labelOr` | `archetypes.json:15-17`; cs catalog | C |
| R5-profile-ui-1-12 | ui (i18n) | S | `profile/CandidateMatrixBoard.tsx:40`; `profile/CandidateMatrixShared.tsx:43`; `profile/ProfileEmptyStates.tsx:167` | for a built-in archetype the lane heading and the empty-state boxes show the registry's English label ("Experienced") — `labelOf` localizes only when `label === id` — while the detail modal shows "Zkušený"; `DistributionBar`'s `aria-label` uses `group.label`, so the Unrouted lane is announced as the slug `unrouted` | `candidateMatrixView.ts:62,65`; cs `enums.archetype` | C |
| R5-profile-ui-1-13 | ui (a11y) | S | `profile/CandidateMatrix.tsx:125`; `profile/ProfileEditor.tsx:336` | the matrix's population-load failure and the editor's save error have no `role="alert"`; every sibling error in the context has one (EditPanel `:110`, AiDraft `:116`, ProfileEditor `:320`) | — | C |
| R5-profile-ui-1-14 | ui (a11y) | S | `profile/ProfileRosterRefreshBar.tsx:109-129` | Confirm, Stop and Dismiss each unmount the button just pressed with no focus target (only Cancel has `autoFocus`); Dismiss can make the whole bar return null, so focus drops to `<body>` | — | C |
| R5-profile-ui-1-15 | ui | M | `profile/ArchetypeManagerList.tsx:81`; `profile/ArchetypeManagerViewPanel.tsx:47`; `profile/CandidateChip.tsx:45,53,89,102`; `profile/CandidateMatrixShared.tsx:66`; `profile/ProfileRosterRefreshBar.tsx:165` | `title=` tooltips (`ui.md` bans them); SeniorityGlyph and RetiredFlag carry theirs on non-focusable spans; the chip's save control (`CandidateChip.tsx:98-106`) is a hand-rolled icon-only button where `IconAction` exists. Not declared debt. M: eight sites across five files and a primitive swap | `style-debt.test.ts`: no title rule | C |
| R5-profile-ui-1-16 | perf | S | `profile/CandidateMatrix.tsx:86-89` | the `columns` memo depends on `archivedArchetypeIds`, which `ProfileTab.tsx:162` rebuilds as a fresh array every render, so every ProfileTab render re-runs `archetypeColumns` and the Board's `groupByArchetype` re-sorts each lane with `localeCompare` | — | U: cost not profiled |
| R5-profile-ui-1-17 | ambiguity | S | `profile/ArchetypeManagerTypes.ts:29-32` | the comment says `weight_out_of_range` "has no message-catalog entry yet", so the manager can only say "Save failed (400)."; `profile.archetypes.validation.weight_out_of_range` exists in all four catalogs and `validationLabel` resolves it | en/cs catalogs; `useArchetypeManagerActions.ts:35-37` | C |
| R5-profile-ui-1-18 | ambiguity | S | `profile/ProfileEmptyStates.tsx:13-24`, `:180` | the header describes two variants behind a local switcher, including "supply"; only the dossier variant exists and there is no switcher; `:180` is a cut-off sentence ("…calling a component factory") | — | C |
| R5-profile-ui-1-19 | ambiguity | S | `profile/CandidateMatrix.tsx:96-99` | an orphaned comment describes a "promote an analysed CV" function no longer here, above `onSave`, which has its own comment | — | C |
| R5-profile-ui-1-20 | ambiguity | S | `profile/ProfileForm.ts:66` | `HydratedForm` has no reference in `app/`; `SeniorityGlyph`, `isRefreshable`, `joinList` and `RefreshRequest` are exported but used only in their own files | grep over `app/` | C |

### Duplicates, not counted

Five recorded findings whose defect site is in this round's files. Every one is **still
present** on this tree:

- **R3-api-pipeline-1** (a reject on a closed entry re-applies). The reject UPDATE with no
  status predicate is now at `db/pipeline.ts:3551` (was ~3550). The "reject is idempotent"
  comment is still at `:3515`.
- **R3-api-pipeline-2** (the live feed's cursor freezes). The store half is unchanged at
  `db/pipeline.ts:375-380`, and `app/api/pipeline/events/recent/route.ts:30-31` still takes
  the cursor from the filtered list.
- **R3-api-pipeline-5** (reinstate re-checks only `status='rejected'`). Still at
  `db/pipeline.ts:1455,1462`.
- **R3-api-pipeline-6** (`listPipeline` silently caps at 2000). Still at
  `db/pipeline.ts:782,823,835`. It also feeds PassPreviewModal's labels.
- **R3-api-pipeline-4** (the advance_top confirm is not bound to the previewed ids).
  `CommandBar.tsx:69-72` still binds only reject_below, and `command/route.ts:167` still says
  "unbound". R5-pipeline-board-1-1 is a different defect: which text is sent, not which ids.

Pointer updates, not findings of this round:

- **R3-analyze-ui-1-7.** The sweep's analyses scrub is now `db/pipeline.ts:2799-2801`.
  R5-lib-profile-4 is the same class on profile surfaces, and is counted as new.
- **R3-decisions-ui-2-1.** The store branch is still `db/pipeline.ts:3587-3595`.
- **R4-interview-ui-2.** Its open half is answered in the cuts above. The erasure variant is
  R5-db-pipeline-1.
- **R3-pipeline-board-5-3.** Still at `useSchedulerControlState.ts:179-180,200`.
- **R3-pipeline-board-5-5.** Still at `schedulerRunState.ts:89`.
- **R3-api-pipeline-3.** Still at `pipeline-entry-action.ts:453-454`.
- **R3-decisions-ui-2-5.** Still at `DecisionsTab.tsx:63-64`.
- **Nothing else matched** rounds 1-4 or "Known gaps" in
  `docs/architecture/engine-and-prompt-coordination.md`. None of its four gaps (JD ingest,
  `weight-proposal-v2`, the voice transport, judge independence) touches these contexts.

### Confirmed S findings NOT fixed this round — carry-over, written to be taken as-is

Each line is the fix, then the test that fails today and passes after it. One commit per
line, test-first, as round 2 did.

- **R5-db-pipeline-1.** Fix: in `anonymizeEntry`, beside `deleteEntryRecordings`, call
  `revokeOpenInterviewSessions(entryId, workspaceId)` in its own try/catch, and set
  `recording_consent_at = NULL` in the `:2501` UPDATE. Test
  (`app/_lib/erasure-full-scrub.test.ts`): erase an entry with an open session; the session
  is `revoked` and `recordingConsentAt` is null, beside the existing token asserts at
  `:210-212`.
- **R5-db-pipeline-2.** Fix: `lead_token = NULL, lead_passed_ko_json = NULL` in the claim
  at `:2746-2750`; `AND anonymized_at IS NULL` in `findEntryByLeadToken` and in
  `mergeReapplication`'s three UPDATEs. Test (`pipeline-erasure-once.test.ts`): mint
  `ensureLeadEnrichToken(id)`, erase; `findEntryByLeadToken(token) === null` and
  `mergeReapplication(id, { contact })` leaves `contact` null.
- **R5-db-pipeline-3.** Fix: `approval_detail = NULL` in the claim UPDATE (whether
  `approval_kind` also clears is the product's call). Test (`erasure-full-scrub.test.ts`):
  `setApproval(id, "scorecard_review", JSON.stringify({ summary: NAME }))`, erase; the
  entry's `approvalDetail` does not contain `NAME`.
- **R5-db-pipeline-4.** Fix: `decision_note = NULL` in `scrubAnalysis`, and
  `UPDATE pipeline_events SET detail = NULL WHERE entry_id = ? AND workspace_id = ? AND kind = 'disposition_set'`
  beside `:2764`. Test (`erasure-analyses-scrub.test.ts`): a decision note naming the
  person, echoed as a disposition, is null in both places after erasure.
- **R5-db-pipeline-5.** Fix: `AND ce.created_at >= pe.consent_given_at` in the `NOT EXISTS`
  at `:2933`, and the same bound (binding `row.consent_given_at`) in the claim at `:2954`.
  Test (`consent-expiry-reminders.test.ts`): notify once (1), renew the consent columns, move
  the expiry into the window; `notifyExpiringConsents` returns 1 again.
- **R5-db-pipeline-7.** Fix:
  `CREATE INDEX IF NOT EXISTS idx_pipeline_events_entry ON pipeline_events (entry_id, kind, created_at)`
  in the `core.ts` migration. Test (new `app/_lib/db/pipeline-events-index.test.ts`):
  `EXPLAIN QUERY PLAN` on `hasEventSinceStageChange`'s SQL uses `idx_pipeline_events_entry`.
- **R5-db-pipeline-8** is S but UNVERIFIED. Fix: do the email branch in SQL
  (`LOWER(TRIM(contact)) = ? … LIMIT 1`) and select only `id, contact, candidate_label,
  created_at` for the name fallback. Test: extend the `findApplicationByApplicant` tests with
  a ~500-entry job and pin the same match (behaviour pin; measure first).
- **R5-db-pipeline-9.** Fix: delete `pipeline-calibration.ts` and the dead exports in
  `pipeline-events.ts` / `pipeline-core.ts`; `pipeline.ts` imports `nextStageOnAxis` from
  `pipeline-core` so one copy exists, and the header admits its two outside importers (mind
  the import-graph budget). Test (new `app/_lib/db/pipeline-siblings.test.ts`): every
  non-test `pipeline-*.ts` has an importer, and `PIPELINE_REASON_CODES` is declared only in
  `pipeline.ts`.
- **R5-db-pipeline-10.** Fix: correct the four comments. Test: none (comment only).
- **R5-lib-offers-1.** Fix: `const outcome = await dispatchOfferReminder(…)`; count `sent`
  only when `delivered(outcome)`, else record `offer_comms_failed`. Test
  (`offer-lifecycle.test.ts`): an entry at Offer with no deliverable recipient, minted with
  `ttlDays: 1`; `sendDueOfferReminders()` returns 0 and the entry has an
  `offer_comms_failed` event.
- **R5-lib-offers-2.** Fix: skip ineligible entries before the claim
  (`if (!entry || !isEntryReminderEligible(entry)) continue;` moved above
  `markOfferReminded`, or a `pipeline_entries` join in `dueOfferReminders`), so a reinstated
  candidate can still be nudged. Test (`offer-lifecycle.test.ts`): `mintOffer(id, 1)`,
  `actOnPipelineEntry(id, "reject")`; `sendDueOfferReminders()` returns 0 and no
  `offer_reminder` outbox row exists.
- **R5-lib-offers-3.** Fix: include the candidate-visible terms (`notes`, `startDate`, via
  one exported `publicOfferTerms`) in `termsChanged`. Test (`offer-reextend-terms.test.ts`):
  re-extend with the same salary, currency and TTL but a new `startDate`; `updated === true`,
  same token, and `offerView(token).startDate` is the new date.
- **R5-lib-offers-4.** Fix: `markOfferReminded(token, whenIso, expectedExpiresAt)` with
  `AND expires_at = ?`; the sweep passes `offer.expiresAt`. Test
  (`offer-lifecycle.test.ts`): snapshot the due row, re-extend with `ttlDays: 14`;
  `markOfferReminded(token, now, snap.expiresAt) === false` and `reminded_at` stays NULL.
- **R5-lib-offers-5.** Fix: `timeZone: INTERVIEW_TZ` in the `dateFormatter` options at
  `comms-dispatch.ts:1081` (the memo key already includes the options), and correct
  `offer-finalize.ts:230-231`. Test (`comms-dispatch-locale.test.ts`):
  `formatOfferDeadline("2026-09-12T22:30:00.000Z", "en")` equals the client
  `offer-deadline.formatOfferDeadline(iso, "en", INTERVIEW_TZ)`; fails today on a UTC runner.
- **R5-lib-offers-9.** Fix: bind `nowIso` and add `AND expires_at IS NOT NULL AND
  expires_at <= ?` to the UPDATE at `:214`. Test: extract `lapseOfferIfDue(token, nowIso)`;
  on a row with a future `expires_at` it leaves the status `extended` (a sync interleave
  cannot be driven directly).
- **R5-lib-offers-10.** Fix: restate the guard's real reasons (several links per entry,
  recruiter moves). Test: none (comment only).
- **R5-lib-offers-11.** Fix: delete `isOfferReminderDue` and `OFFER_TTL_MS`, or filter
  `dueOfferReminders` through the predicate; correct both `resolveOfferTtlMs` comments. Test
  (if kept, `offer-lifecycle.test.ts`): offers at `ttlDays` 1, 2 and 3; `dueOfferReminders()`
  equals the rows for which `isOfferReminderDue(expiresAt)` is true.
- **R5-pipeline-board-1-1.** Fix: store the previewed text on the preview result and send
  `result.text` on confirm (or drop a reply whose request text differs from the input). Test:
  a pure `commandRequestBody(result, text, confirm)`; a preview of A with input B gives
  `body.text === "A"`.
- **R5-pipeline-board-1-3.** Fix (in the shell kit): the commit catch also calls
  `setCommitError({ code: null, capability: null })`. Test (`PassPreviewModal.test.ts`,
  source contract): the kit's commit catch contains `setCommitError(`.
- **R5-pipeline-board-1-4.** Fix (in the shell kit): `setReport(null)` only in the dry run's
  success branch, and a failed re-preview surfaces inside the modal. Test (source contract):
  `setReport(null)` does not precede the fetch in `dryRun`.
- **R5-pipeline-board-1-5.** Fix: a ref on Re-preview focused in an effect keyed on
  `report`; CommandBar refocuses the input after done and after undo. Test (source
  contract): an effect on `report` calls `.focus()`.
- **R5-pipeline-board-1-6.** Fix: re-mirror the draft on the busy true→false edge when the
  field is not focused. Test: a pure `nextIntervalDraft({ stored, mirrored, focused, busy,
  prevBusy, draft })`; a settled write with the stored value unchanged returns the stored
  value.
- **R5-pipeline-board-1-8.** Fix: when `run.error` is a catalogued code render
  `errMsg({ code: run.error }, t("runFailed"))`, else keep the wrapping; correct `:152`.
  Test: a pure `runErrorText(error, resolve)`; `ENGINE_FAILED` resolves through the catalog.
- **R5-pipeline-board-1-9.** Fix: the `unverified` reason as visible text tied by
  `aria-describedby`; the toggle gets `aria-label={copy.toggleTitle}`. Test (source
  contract): no `title=` in the file, and `t("unverified")` is rendered text.
- **R5-pipeline-board-1-10.** Fix: `Tooltip` / `IconAction` at the three sites. Test (source
  contract): `doesNotMatch(/\btitle=\{/)` for the three files.
- **R5-pipeline-board-1-11.** Fix: `stage: enumLabel("stage", b.stage)` via
  `useEnumLabel()`. Test (source contract): the byline matches `enumLabel("stage", b.stage)`.
- **R5-pipeline-board-1-12.** Fix: `role="alert"` on the failure lines; move NoteField's
  status span out of the `<label>`. Test (source contract): per file.
- **R5-pipeline-board-1-13.** Fix: a provider-neutral key (e.g. `aiModel`) in all 4
  catalogs. Test: no `pipeline.result` value matches `/Claude/` in any locale.
- **R5-pipeline-board-1-14.** Fix: delete `APPLIED_LABEL`, or sync it. Test (if kept): every
  key's value equals `en.pipeline.applied[key]`; fails today on `offer_ready` and `advisory`.
- **R5-pipeline-board-1-15.** Fix: rewrite the kit's comment. Test: none (comment only).
- **R5-pipeline-board-1-16.** Fix: drop the `aria-label`, or start the catalog string with
  the visible text. Test: in each locale, `undoWaveLabel` starts with `undoWave`'s text.
- **R5-pipeline-board-1-17.** Fix: fall back to a localized "unknown candidate" label and
  show a notice when `entries` is empty. Test (source contract): `?? id` is gone from
  `label`.
- **R5-lib-profile-1.** Fix: `tasks.ts:393` passes `{ text: String(ctx.params.text ?? ""),
  lang: String(ctx.params.lang ?? "en") }` (the shape `:370` already uses for repo scans),
  the editor stamps its locale into the task params, and the arg becomes one
  `--lang=<value>` element. Test (`profile-draft-run.test.ts`): `runProfileDraft({ text:
  "notes" } as ProfileDraftParams, undefined, spy)` with a spy that runs
  `assertSpawnArgs(args)`; it does not throw.
- **R5-lib-profile-2.** Fix: when `consentWithholdsPii(entry)`, null `recipient`, `subject`
  and `body` on each comm and mask `rematchLinks[].candidateLabel`. Test
  (`candidate-timeline.test.ts`): a lapsed-consent entry with one outbox row; the bundle's
  comm has `body === null` and `recipient === null`, and the verdict is still present.
- **R5-lib-profile-5.** Fix: refuse a non-boolean `fairnessProtected` in `updateArchetype`
  (`fairness_invalid`, 4 catalog entries if the client localizes it), and make
  `shieldsFromAutoReject` read truthy like Python. Test (`archetype-registry.test.ts`): PUT
  `{ fairnessProtected: "true" }` on a custom archetype gives `fairness_invalid`.
- **R5-lib-profile-6.** Fix: `validateRegistry` refuses a `weights` key set that is not
  exactly the three slots. Test (`archetype-registry.test.ts`): a registry with
  `weights.extra` makes `listArchetypes()` throw `registry_invalid`.
- **R5-lib-profile-7.** Fix: `readJsonWithLimit(req, N, {})` and a 400 refusal for a
  non-object body. Test (new `app/api/archetypes/route-body.test.ts`): POST and PUT with
  `"null"` and `"[]"` answer 400, not 500.
- **R5-lib-profile-8.** Fix: `MAX_DRAFT_TEXT` (e.g. 32 KB) in `runProfileDraft`, refused
  400 `invalid_input`, and `readJsonWithLimit` in the route. Test
  (`profile-draft-run.test.ts`): oversized text rejects with status 400 and the spy spawn is
  never called.
- **R5-lib-profile-9.** Fix: before `setProfileLineage`, `findProfileIdBySourceCvHash`; a
  different id is refused 409 `PROFILE_EXISTS`. Test (new
  `app/api/profile/profile-lineage-unique.test.ts`): PUT profile B with profile A's analysis
  slug is 409, and B's `source_cv_hash` is unchanged.
- **R5-lib-profile-10.** Fix: a projection reader with
  `json_extract(payload_json, '$.v2Profile.archetype')`, no payload parse. Test
  (`candidateMatrixContracts.test.ts`, source contract): the route no longer calls
  `listAnalysisRecords`.
- **R5-lib-profile-12.** Fix: read the session once and pass it to both helpers. Test
  (`candidate-timeline.test.ts`, source contract): `latestInterviewByEntry(` appears once.
- **R5-lib-profile-13.** Fix: delete or un-export the five. Test: none (typecheck stays green).
- **R5-lib-profile-14.** Fix: correct the comment. Test: none (comment only).
- **R5-lib-profile-15.** Fix: `registryPath()` returns `archetypeRegistryPath()`. Test
  (`archetype-registry.test.ts`): `setLiveRegistryPathForTest(tmp)` then `createArchetype`
  writes `tmp` and leaves the repo file's bytes unchanged.
- **R5-profile-ui-1-1.** Fix: pass `error` to the View panel and the list with
  `role="alert"`; skip `setMode("view")` after unarchive while editing. Test (source
  contract): `ArchetypeManagerViewPanel` takes an `error` prop.
- **R5-profile-ui-1-2.** Fix: pass `population.failed` through and show a new
  `archiveConfirmUnavailable` (4 catalogs). Test: a pure `retireDialogState(rows, failed)`;
  `(null, true)` is `"unavailable"`.
- **R5-profile-ui-1-4.** Fix: `submit` returns `ok`, and `savedFields` is set only when it is
  true. Test: a pure `shouldShowSaved(result, savedFields, fields, lastOk)`; a failed second
  save gives false.
- **R5-profile-ui-1-5.** Fix: `useEffect(() => () => controllerRef.current?.abort(), [])`.
  Test (source contract): an unmount cleanup aborts the controller.
- **R5-profile-ui-1-6.** Fix: a request counter in a ref, bumped by every opener and by "New
  profile"; `setEditor` only if the token still matches. Test: a pure `latestOnly()` wrapper;
  two promises resolving out of order apply only the second.
- **R5-profile-ui-1-7.** Fix: `r.ok ? r.json() : Promise.reject()`, state untouched on
  failure. Test: a fake-fetch test that a 500 keeps the previous array, or a source contract
  that `reloadArchetypes` checks `r.ok`.
- **R5-profile-ui-1-9.** Fix: `resolveError({ code: watch.error }, t("aiDraftFailed"))`.
  Test (source contract): the second argument is never `watch.error`.
- **R5-profile-ui-1-10.** Fix: map `slot` through `dimSkills` / `dimCareer` /
  `dimPersonal`. Test (source contract): no `{ slot })` in the panel.
- **R5-profile-ui-1-11.** Fix: `labelOr(useTranslations("profile.result"),
  \`checks.${c.check}\`, c.label)`. Test (source contract): the panel uses `checks.`.
- **R5-profile-ui-1-12.** Fix: a pure `laneLabel(col, enumLabel)` (enum for built-in and
  unknown ids, registry label for custom) for the heading, the `aria-label` and the
  empty-state boxes. Test: `laneLabel({ id: "bau", label: "Experienced" })` is the enum
  value and `{ id: "unrouted", label: "unrouted" }` the localized label.
- **R5-profile-ui-1-13.** Fix: `role="alert"` at both lines. Test (source contract): a regex
  over both files.
- **R5-profile-ui-1-14.** Fix: focus Stop on start, the result region (`tabIndex={-1}`) on
  finish, the bar's eyebrow on Dismiss. Test (source contract): each unmounting control has a
  focus target.
- **R5-profile-ui-1-16** is S but UNVERIFIED. Fix: derive the archived ids inside the matrix
  with `useMemo` over `archetypes`. Test (source contract): `ProfileTab` no longer passes
  `archivedArchetypeIds`; profile first.
- **R5-profile-ui-1-17, -18, -19.** Fix: rewrite or delete the stale comments. Test: none
  (comment only).
- **R5-profile-ui-1-20.** Fix: drop `HydratedForm` and un-export the four. Test: none
  (typecheck stays green).

The 12 M findings (R5-db-pipeline-6, R5-lib-offers-6/7/8, R5-pipeline-board-1-2/7,
R5-lib-profile-3/4/11, R5-profile-ui-1-3/8/15) need a design choice or a multi-file change.
They are anchored in the findings table and escalated, not carried as S.

### Gate output

This round changed no source, so the code gates were run once, on the branch base
`8338f2dca`:

- `npm run typecheck` clean. It rewrote the three `app/_lib/*.generated.ts` files with CRLF
  only (`git diff --ignore-all-space` empty); they were restored.
- `npm run lint`: 0 errors / 49 warnings (pre-existing).
- `npm run test:unit`: 13015 / 13015.
- `node scripts/run-unit-tests.mjs "scripts/kpi/**/*.test.mjs"`: 85 / 85.
- `npm run test:docs` and `npm run docs:check` ran on the tree WITH this section: both exit 0
  (`docs:check`: 22 decision records valid). `test:docs` also rewrote the three
  `*.generated.ts` files with CRLF only; restored.

### Coverage after this round

| | |
|---|---|
| thread contexts read through all five lenses | **24 / 55** (43.6%) — was 19 / 55 |
| of the whole 143-map | **24 / 143** (16.8%) — was 19 / 143 |
| contexts where `ui-perfectionist` had a surface and ran | 10 (was 8) |
| thread groups with no five-lens context | **0 / 7** — unchanged. Per group: CV Analysis 4/8, Candidate Matching 3/7, Developer Assessment 4/9, Hiring Decisions 3/8, Hiring Pipeline 5/10, Interview Scheduling 2/5, Voice Interviews 3/8. Thinnest by share now: Hiring Decisions and Voice Interviews (3/8 each), then Interview Scheduling (2/5) |
| S findings fixed | 0 (read-only round) — round 2: 8 |
| new findings recorded | 73 (61 S, 12 M) + 5 duplicates |
| S carried over, written fix-and-test-ready | 61 (59 CONFIRMED, eight of them with a named unverified side or timing window; 2 UNVERIFIED) |

All five contexts count: every applicable lens ran on each, and the three n/a cells are the
three contexts with no `.tsx` (`db-pipeline`, `lib-offers`, `lib-profile`). One caveat
qualifies the count. `pipeline-board-1` counts for what survives of it: 13 of its 19 listed
sources are gone, and their successors under `kit/`, `orbit/` and `candidate/` are in no
143-map context. 31 thread contexts remain. At five per round that is seven more rounds.

## Recorded per-context coverage — 2026-10-09, ROUND 6, READ-ONLY (branch `autopilot/codebase-static-analysis-sweep-8f4055cb`)

**The denominator is round 3's, unchanged:** the 55 thread contexts of the retired 143-map
(`git show 9c20a787:context-map.json`), decided and re-counted in the round-3 section above.
Every id below is a 143-map id, and each file list was resolved from `9c20a787`.

Sixth five-lens round of dev_goal `081c3e5a`. **Read-only:** every feature span was under an
open operator Approval until 09:00, so nothing in `app/`, `pipeline/`, `scripts/` or
`messages/` changed. Every finding is recorded here, not fixed. Round 5 named Hiring Decisions
and Voice Interviews (3/8 each), then Interview Scheduling (2/5), as the thinnest groups by
share, so the batch takes two contexts from each of the first two and one from the third:

- `lib-decisions-1` and `lib-automation`: Hiring Decisions. The first carries the key goal
  that no scorecard, ranking or rejection is produced without a reason the candidate can be
  given; the second, that one role runs end to end without a human step.
- `api-voice-interview` and `lib-voice-interview-11`: Voice Interviews.
- `calendar-integration`: Interview Scheduling.

`messages/{en,cs,de,fr}.json`, `app/features/insights/about/chapters.test.ts` and
`app/landing/spark/market/data.ts` were neither read nor judged: another builder was changing
them. Every finding that would need a catalog read says so.

### The round

`✓` = read through that lens and judged; *clean* = judged with nothing found, which IS
coverage; *n/a* = the lens has no surface here (no `.tsx` in the context). Counts are new
findings; S/M/L as in round 2.

| context | cat | files read | bug-hunter | ui-perfectionist | security-auditor | performance | ambiguity | fixed |
|---|---|---|---|---|---|---|---|---|
| `lib-decisions-1` | test | 5 / 5 map-src | ✓ 4 S (1 U) | n/a | ✓ 1 S, 1 M | ✓ clean | ✓ 2 S | - (read-only round) |
| `lib-automation` | lib | 9 / 8 map-src | ✓ 3 S | n/a | ✓ 1 S, 1 M | ✓ 1 S | ✓ 1 S | - (read-only round) |
| `api-voice-interview` | api | 20 / 12 map-src | ✓ 2 S | n/a | ✓ 2 S | ✓ 1 S, 1 M | ✓ 1 S | - (read-only round) |
| `lib-voice-interview-11` | lib | 11 / 9 map-src | ✓ 2 S | n/a | ✓ 1 S | ✓ clean | ✓ 2 S | - (read-only round) |
| `calendar-integration` | lib | 14 / 11 map-src | ✓ 3 M | n/a | ✓ 2 M | ✓ clean | ✓ 2 S | - (read-only round) |

### Declared cuts, stated rather than rounded away

- **"Files read" counts SOURCE files, read in full.** It is map source plus new source in the
  same directories that is in no 143-map context:
  - `lib-decisions-1` +0. `git ls-files 'app/_lib/decision*' 'app/_lib/approval*'` also
    lists `decision-record-store.ts`, which belongs to `lib-decisions-2` and was traced, not
    judged.
  - `lib-automation` +1: `automation-commit-plan.ts` (the preview-to-commit reconciliation).
  - `api-voice-interview` +8, all unmapped siblings in `app/api/interview/`:
    `director/route.ts`, `entry-id.ts`, `recording/route.ts`, `recording/[sessionId]/route.ts`,
    `sessions/[id]/route.ts`, `sessions/[id]/evidence/route.ts`,
    `sessions/[id]/recording/route.ts` and `sessions/[id]/rescore/route.ts`.
  - `lib-voice-interview-11` +2: `interview-prep-kit.ts` and `interview-duration.d.mts`
    (checked against the `.mjs`: the same six numeric exports). `app/_lib/` holds 46 more
    unmapped `interview-*` sources, 24 at the top level (kit, letter, recording, agenda,
    evidence) and 22 under `interview-sim/`, plus `interview-sim/situations.json`; they
    belong to other subjects and were neither read nor judged.
  - `calendar-integration` +3: `calendar/constants.ts`, `calendar/edge-fetch.ts` and
    `calendar/erasure-events.ts`. Nothing else non-test exists in `app/_lib/calendar/` or
    `app/api/calendar/`.
- **No listed file is gone.** All 73 `file_paths` of the five contexts exist on this tree.
- **The `cat` column follows the map.** The 143-map labels `lib-decisions-1` `test` because
  most of its listed paths are tests; its source is `lib`. No context in this batch has a
  `.tsx`, so `ui-perfectionist` is n/a on all five.
- **Colocated `*.test.ts` files were read only for what they already assert**, so a covered
  case is not reported as a gap. They were never audited as code. Same gap as rounds 1-5.
- **The four message catalogs were not read** (another builder). So whether a
  `decisions.pass.reasons.applyFailed` template interpolates `{detail}`
  (R6-lib-automation-6), whether calendar event copy has catalog keys
  (R6-calendar-integration-5), and whether `INTERVIEW_CREATE_FAILED` is the right copy for a
  revoke are all unverified on the catalog side.
- **`lib-decisions-1`:**
  - Traced, not judged: `app/api/decisions/config/route.ts`, `interview-plan.ts`,
    `decision-record-store.ts` (`:300-360`, `:565-582`), `pipeline-stages.ts`, `tenancy.ts`,
    `auth/roles.ts`, `auth/current-user.ts`, `DecisionsRulesModal.tsx`,
    `decisionsComplianceState.ts`, `useHiringComposer.ts`, the calibration apply-threshold
    and stage-sla routes, `thread-autonomy.ts:139`.
  - The isolation tests cover rows that fail to PARSE, never two organizations; that is why
    R6-lib-decisions-1-1 and -3 are not covered cases.
- **`lib-automation`:**
  - Traced, not judged: `db/pipeline.ts` (`setApproval` `:3220-3300`, `actOnPipelineEntry`
    `:3461-3595`), `pipeline-stages.ts` (`screenStageOutcome`),
    `pipeline/jobfit/automation.py:1005-1035`, `pipeline-entry-action.ts:245-305`,
    `comms-dispatch.ts:708-728`, `recruiter-run.ts`, `scheduler-store.ts`,
    `simControlCenterKit.ts:105-154`, `passReasonText.ts`, `stage-hooks.ts` (outline only).
  - Not read: `getOrCreateOpenOffer` and the body of `sendCandidateComm`. So
    R6-lib-automation-3 is CONFIRMED as far as `extendDraftedOffer` being called on a
    rejected row, and UNVERIFIED that the letter then leaves.
- **`api-voice-interview`:**
  - Traced, not judged: `db/interviews.ts`, `interview-session-status.ts`,
    `interview-scorecard-commit.ts`, `interview-scoring-state.ts`,
    `interview-recording.ts:136-141`, `voice/self-hosted.ts`, `voice/connect-failover.ts`,
    `voice/index.ts:41-55`, `devcase-identity.ts`, `consent.ts:102-106`,
    `auth/public-routes.ts`, `interview-invite.ts` (gate lines), `VoiceInterview.tsx`,
    `InterviewSimTab.tsx`, `app/interview/[token]/page.tsx`.
  - Not filed, recorded elsewhere: `create`, `revoke`, `simulate` and `attach` have no
    `pipeline:write` check; they sit on `route-capability-coverage.test.ts:144,150-152` as
    known debt.
- **`lib-voice-interview-11`:**
  - Traced, not judged: `app/api/interview-prep/route.ts` and `scorecard/route.ts`,
    `db/interviews.ts`, `db/pipeline.ts` (`anonymizeEntry`, the prep scrub), `db/jobs.ts`,
    `automation-run.ts`, `tasks.ts`, `interview-invite.ts`, `interview-kit-booking.ts`,
    `run-of-show.ts`, `useDecisionsQueue.ts`, `useScheduleInterviewPrep.ts`,
    `pipeline/jobfit/automation.py:358-395`.
  - Checked against the group goal: `interview-recommendation.ts` never produces `reject`
    on its own; an unknown value falls back to `hold`, which routes to the human gate, and
    Python (`automation.py:358,363,394-395`) agrees on the set, the lower-casing and the
    fallback. Clean.
  - Checked for R5-lib-profile-1's shape (task params missing `lang`): not present. The
    prep run narrows `lang` with a default (`interview-prep-run.ts:37`) and `--lang` is
    pushed only when set (`automation-run.ts:334-335`).
- **`calendar-integration`:**
  - Traced, not judged: `schedule-store.ts` (`recordCalendarEvent` `:523-543`,
    `invitesWithCalendarEvent`, `erasedInvitesWithCalendarEvent`), `app/api/schedule/route.ts`,
    `app/api/schedule/[token]/route.ts`, `db/pipeline.ts:2532-2537`, `tenancy.ts`,
    `auth/require-operator.ts`, `auth/roles.ts`, `app/api/ats/connections/route.ts`,
    `route-capability-coverage.test.ts`, `IntegrationsCalendarPanel.tsx`,
    `instrumentation-node.ts` (the sweep), `export-utils.ts` (`buildIcs` lives there, outside
    this context), `docs/features/scheduling/README.md:368-385`.
  - Clean on: OAuth state compared in constant time, PKCE S256, the state cookie
    path-scoped and deleted once, redirects built from `publicBaseUrl`, tokens encrypted at
    rest and absent from the client view, every `calendar_connections` statement filtered by
    `workspace_id`, revoke at Google before the row is deleted, typed codes only on the
    callback. Timezone and slot arithmetic are UTC instants and millisecond overlap; the
    wall-clock maths lives in `schedule-slots.ts`, outside this context.
  - Google's answer to a DELETE of a foreign event id (assumed 404) was not exercised; that
    is the open side of R6-calendar-integration-3.
- **Observed out of lane, not counted:**
  - `app/api/intake/[id]/message/route.ts:33` writes `human:${userId}`, an id, where the
    decision log expects a name.
  - The prep GET returns the full payload of a lapsed-consent entry (the R5-lib-profile-4
    class on another surface), and the `interview_prep` task label keeps the candidate's
    name in `tasks` past erasure (`tasks.ts:328,352`; UNVERIFIED).
  - `rescore` and `by-entry` return the session with `token` and `instructions`, which
    `sessions/[id]` strips. Recruiters already receive the link from `/create`.
  - `readStoredToken` (calendar) marks any throw, SQLITE_BUSY included, as
    "undecryptable"; it heals on the next good read.
  - `/api/calendar/google/start`'s 503 returns an English `error` with no code.
- **Line anchors were taken one file at a time** (`grep -n` on one file, or a Read of one
  file). Every reviewer was told never to use `cat -n` over several files.
  - Re-read: before this table was written, 70 per-file `sed -n` / `grep -n` reads on this
    worktree covered at least one anchor of every one of the 34 findings, plus five
    duplicate pointers below. All held. The reviewers' own per-file re-reads covered about
    233 more anchor sites.
  - The reviewers corrected six anchors in their own pass: `schedule/route.ts`
    `cancelAttendance` `:307` → `:309` and `baseUrl` `:544` → `:543`; `[token]/route.ts`
    `baseUrl` `:495` → `:496`; `recordCalendarEvent`'s `WHERE token = ?` is `:535`;
    `VoiceInterview.tsx` `provider` `:1018` → `:1019`; R3-pipeline-board-5-5's coded catch
    is now `schedule/route.ts:177-181`.
  - R6-api-voice-interview-1 was traced a second time by hand: `connect/route.ts:180-181`
    lets `body.provider` override the session's, `:436-447` passes it as `preferred`, the
    served provider is written back only inside `if (failedOver)` (`:460-469`), and
    `complete/route.ts:378` debits only when `session.provider` is not self-hosted.

### Findings

**34 new findings: 26 S, 8 M, 0 L.** Seven duplicates were not counted, and four more
recorded findings got pointer updates (below). Nothing was fixed (read-only round). "C" = CONFIRMED, traced end to end;
"U" = UNVERIFIED, with what was not read. Path roots: lib = `app/_lib/`; iv =
`app/api/interview/`; cal = `app/_lib/calendar/`; anything else is rooted.

| id | lens | sev | file:line | what is wrong | path read | |
|---|---|---|---|---|---|---|
| R6-lib-decisions-1-1 | security | M | `lib/decision-config-store.ts:306-310`, `:296-298`, `:334`; `app/api/decisions/config/route.ts:69` | a save with no scope resolves to `"shown"`, and `shownTier` picks `"org"` for any team without its own override, so `writeConfigRow` replaces the single `workspace_id IS NULL` row. That row is deployment-wide (`uq_decision_config_org` is unique on `phase` alone), and the only check is `pipeline:write`, which `recruiter` and `hiring_manager` hold. One recruiter in org B who saves the screening rules or picks a jurisdiction changes the auto-reject policy and the candidate-facing legal disclosure of every team in org A with no override. The route comment "today operator-gated, single-tenant" is out of date. M: key the default tier by org, or make `"shown"` resolve to `"team"` and ask `org:manage` for org writes | `DecisionsRulesModal.tsx:77-79`, `decisionsComplianceState.ts:80` (no scope) → `route.ts:69` → `store.ts:334` → `:308-309` → `:296-298` → another team's cascade `:134` → `getActiveRegimeId` `:445-446` | C |
| R6-lib-decisions-1-2 | bug | S | `lib/decision-config-store.ts:150-152`; `lib/decision-config-schema.ts:596-600` | a legacy (pre-steps) interview plan is migrated with `DEFAULT_STAGE_AXIS`, and the comment says `getInterviewPlan` "re-runs the migration against the real axis"; it does not, it only prunes (`interview-plan.ts:22-25`). Custom boards (`7a2d3c146`, 2026-08-14) predate the migration (`00aec5392`, 2026-08-22). On a board with no `Interview` column id (e.g. `Tech` + `Panel`), every round lands on `Interview`, is pruned, and the AI round silently disappears, against the migration's own promise (`schema.ts:236-237`) | `interview-plan.ts:23` → `store.ts:150-152` → `schema.ts:603` → `:678` → `:249` → `interview-plan.ts:24` → `prunePlanToAxis` | C (code); U: whether a deployed DB holds that combination |
| R6-lib-decisions-1-3 | bug | S | `lib/decision-config-store.ts:150-154` | the corrupt-row ledger (`:39-53`) promises an unreadable row is never silent, but only catches `JSON.parse`. A legacy plan that parses but fails validation returns the default at `:152`; a stored `null` merges to the default at `:154`; an array merges junk keys onto it. None calls `recordConfigIssue`: the "auto-reject policy reverting unseen" event the ledger exists for | `store.ts:140` → `:151` (not ok) → `:152` | C |
| R6-lib-decisions-1-4 | security | S | `lib/decision-config-schema.ts:607-620` | `validateInterviewPlan` caps rounds at 3 but not the number of steps, and `stageId` only has to be a non-empty string, with no length or identifier rule like `validateStage` (`:445`). A `pipeline:write` seat can store any number of steps with multi-KB ids, at 60 writes per 10 min; every `getInterviewPlan` reader parses the row before pruning drops them | `route.ts:54` → `schema.ts:428` → `:612`, `:619` → `store.ts:286` | C; U: no body cap found on the route |
| R6-lib-decisions-1-5 | bug | S | `lib/decision-hash.ts:16-28` | sealing hashes the in-memory payload, verification hashes `JSON.parse(payload_json)`, and `sortValue` ignores `toJSON`: a `Date` anywhere in `inputs` is `{}` at seal and an ISO string at verify, so the record reads as tampered for good. `inputs` is typed `unknown` | `decision-record-store.ts:311-312,356-358` → `decision-hash.ts:18-25`; verify `:565,574` | U: no live seal passing a `Date` was found |
| R6-lib-decisions-1-6 | bug | S | `lib/decision-attribution.ts:240-243`, `:261`, `:328` | `DECISION_META` is a plain object, so `Object.prototype` names count as kinds: `decisionAttribution("constructor")` is `"human"`, not `"unknown"` (against `:237-239`); `?kind=toString` filters to an empty page instead of being ignored (`:256-257`); `kindLabel` asks the catalog for `kinds.constructor` | `app/api/analytics/decisions/route.ts:161` → `:261`; `thread-autonomy.ts:139` → `:241` | C (no real kind collides today) |
| R6-lib-decisions-1-7 | ambiguity | S | `lib/approval-kinds.ts:3-7`, `:24-26` | the header says PipelineTab "treats ANY non-null kind as needs a human" and that the registry records which surface raises each kind and how it resolves; PipelineTab calls `needsHumanDecision` (`usePipelineTabState.ts:99`) and the registry lists names only. There are six kinds, not the five the context description states | — | C |
| R6-lib-decisions-1-8 | ambiguity | S | `lib/decision-config-schema.ts:413-414`, `:775-776`, `:156-160` | two comments say "the three known fields" (screening has five; there are four phases), and two `/** */` blocks are stacked on `PLANNABLE_ROLES`, the first ("Columns a plan may govern…") orphaned | — | C |
| R6-lib-automation-1 | bug | S | `lib/automation-pass.ts:517-526` | the reject branch queues `rejection_review` with a bare `setApproval`: no stage, status or approval re-check after a Python hop of seconds, and its return is ignored. A recruiter's advance, reject or fresh review during the hop gets a rejection card parked on top of it. The advance branch beside it is CAS'd on stage and approval (`:471`), and `markStaleSkip`'s comment (`:48-52`) claims both branches share it; only advance calls it (`:476`) | `:602` snapshot → `:620-621` hop → `:483` → `:517` → `db/pipeline.ts:3244` (`WHERE id=? AND workspace_id=?`) | C |
| R6-lib-automation-2 | bug | S | `lib/automation-run.ts:632-634`, `:625` | from a non-entry screening stage with route `hold`, `setApproval(screening_review)` runs unconditionally after the model call against the pre-hop `entry`. If a recruiter moved the candidate to Interview meanwhile, the review overwrites its `calendar` approval; with screening gate `auto` and an `advance` recommendation the ratify (`:654-660`) passes its CAS on the approval this function just wrote, and `actOnPipelineEntry` advances from the CURRENT stage: Interview → Offer with no human step. `:625` passes `expectedStage` but not `expectedApprovalKind`, so a `rejection_review` queued during the hop is cleared by the accept. The comment at `:627-628` holds only when `advance` is true | `:362` → `:565-566` → `:619` → `:633` → `db/pipeline.ts:3244` → `:654` → `db/pipeline.ts:3587-3595` | C |
| R6-lib-automation-3 | bug | S | `lib/automation-run.ts:690`, `:716-720` | the offer path writes `offer_review` unconditionally after the drafting hop (no stage or status check), and the "fresh" re-read only tests `approvalKind === "offer_review"`, always true because this function just wrote it; the comment at `:699-700` ("a concurrent decision can't be clobbered") does not hold. A reject during the hop (status `rejected`, approval NULL) gets the approval re-raised, and with offer gate `auto` and a priced draft `extendDraftedOffer` runs for a rejected candidate. Related to R3-api-pipeline-3 (same overwrite-then-extend shape, other site) | `:362` → `:565` → `:690` → `:717-718` → `pipeline-entry-action.ts:286` → `dispatchOffer` (`comms-dispatch.ts:708-728`, no status check) | C to the extend call; U: that the letter is sent (`getOrCreateOpenOffer`, `sendCandidateComm` not read) |
| R6-lib-automation-4 | security | S | `app/api/automation/run/route.ts:17-63` | POST `/api/automation/run` has no `rateLimit()`, and never had one (`git log -S rateLimit`). A dry run skips the single-flight (`automation-pass.ts:219`) and spawns the policy interpreter plus up to `scoringSpawnBudget()` `recruiter_cli` children, persisting nothing, so every click spends again. `rate-limit-contract.test.ts:1336-1340` says this route "already throttle[s]" the sweep; its two siblings (the schedule tick and the `run policy` command) are throttled and pinned, and it has no contract row | route `:63` → `automation-pass.ts:219` → `:608` → `:325` (`rankPoolForJob` → `spawnPython`) → `:620` | C |
| R6-lib-automation-5 | perf | S | `lib/automation-pass.ts:219`, `:602`; `app/api/automation/run/route.ts:63` | the preview the board modal posts (`{dryRun:true}`) runs with no workspace: the global sweep scores every tenant's unscored job groups and decides every tenant's entries, then the route drops the other tenants' rows. The commit from the same modal is team-scoped (`:602`). On a multi-tenant install the preview's scoring budget is spent in global order, so the team's own groups can preview as "awaiting match score" and then be scored and decided in the commit, where `planCommit` counts them `declined`: rows the recruiter was never shown. Breaks "the preview must forecast exactly what the commit produces" (`:25-27`, `:82-85`) | `simControlCenterKit.ts:113-116` → route `:63` → `:219` → `executeAutomationPass(true)`; commit `:151-154` → `:602` | C (path); cost not measured |
| R6-lib-automation-6 | security | M | `lib/automation-pass.ts:536-547` | a per-decision apply failure writes the raw `applyError.message` (better-sqlite3 text) into `d.reasonParams.detail` and `d.reason`. The decisions go to the browser in the POST response (`route.ts:65-72`) and to `scheduler_runs`, served unprojected by GET `/api/automation/schedule` (`scheduler-store.ts:373-395`); the route's own catch keeps this class out of the browser. M: `reason` is the sealed English audit record, so whether the record keeps the detail is a design choice. Distinct from R3-pipeline-board-5-5 (tick.error) and R5-pipeline-board-1-7 (run.error) | as listed; `passReasonText.ts:32` falls back to the raw `reason` | C (wire); U: whether the catalog template interpolates `{detail}` (catalogs not read) |
| R6-lib-automation-7 | ambiguity | S | `lib/automation-pass.ts:48-52`, `:449`, `:25-33`; `lib/automation-fairness.ts:10-15` | comments the code contradicts: `markStaleSkip` "shared by the advance and reject apply branches" (advance only, `:476`); "a comm throw from dispatchRejection" (the pass dispatches nothing); `applyFairnessVerdict`'s doc sits above `PassReasonCode`, ~65 lines from the function (`:99`); the fairness header names `stage == "Screened"` (Python decides by role now, `automation.py:1016`) and says it "re-derives exactly that gate", but checks only archetype and score (`:47-69`), not the role or the no-pending-approval precondition (`automation.py:1022`) | grep | C |
| R6-api-voice-interview-1 | bug | S | `iv/connect/route.ts:180-181`, `:460-469`; `iv/complete/route.ts:372-379` | `body.provider` overrides the session's stored provider, but the provider that served is written back only on a failover, so `session.provider` can name a provider that never served, and `/complete` debits and prices from it. A session minted on the free self-hosted provider (which skipped `meterGate` at `/simulate` `:91`) and dialed on OpenAI is neither debited nor priced; the reverse prices a free call as paid. The honest simulator sends a different provider (`InterviewSimTab.tsx:141-145` passes no `lockSettings`, so the picker shows), and so can any token holder. `complete:374-375` ("set to whoever actually served") is false. Whether the reservation should be re-gated or the body's provider ignored is a design choice; the S fix makes billing truthful | `InterviewSimTab.tsx:141` → `VoiceInterview.tsx:211,1015-1019` → `connect:181` → `:436-447` → `:460` (failover only) → `interviews.ts:805-818` → `complete:378,389` | C (re-traced by hand) |
| R6-api-voice-interview-2 | bug | S | `iv/complete/route.ts:169`, `:256`, `:276`; `lib/interview-session-status.ts:85-90` | only `completed` short-circuits; a `revoked` row stays in the completion write's from-set (`finalizeFromGuard` appends it), so every later POST from the revoked token overwrites `transcript_json`, bounded only by 10 per 10 min per token+IP. `latestInterviewByEntry` (`interviews.ts:639`) ranks transcript-bearing rows first, so the recruiter's modal shows the rewritten text: the holder of a link revoked as "shared too widely" can keep rewriting the evidence | `complete:169` → `:197,204` → `:256` → `:276` → `interviews.ts:782` → `interview-session-status.ts:89` | C |
| R6-api-voice-interview-3 | security | S | `iv/recording/[sessionId]/route.ts:28-36` | playback serves candidate audio with no consent check; its siblings withhold verbatim data when `consentWithholdsPii` is true (`sessions/[id]/route.ts:23-27`, `sessions/[id]/evidence/route.ts:41-44`). `recordingRetentionDue` reads only the decision and call dates (`interview-recording.ts:139-141`), and the row it reads has no consent columns (`interviews.ts:1123`). The voice stays playable after consent expires, and after an erasure whose best-effort delete failed | `:34` → `:36` | C |
| R6-api-voice-interview-4 | security | S | `iv/compare/route.ts:83-88`, `:99-105` | compare returns the candidate's name, the AI summary and `ratings[].evidence` (verbatim quotes) with no consent check, in both the voice and the human-only branch; `by-entry` (`:65-72`) and `sessions/[id]` mask the name and drop the scorecard for the same entry | `interviewedForJob` (`interviews.ts:56-80`); `listEntriesForJob` | C |
| R6-api-voice-interview-5 | perf (+bug) | S | `iv/compare/route.ts:22-26`, `:86` | `telemetryForEntry` re-reads `latestInterviewByEntry` (`SELECT *`, transcript JSON included) per candidate: an N+1 over a scorecard the first query already parsed. That query ranks by transcript then `created_at` with no status filter, while the grid row is the latest COMPLETED session by `ended_at` (`interviews.ts:78`), so a newer failed or revoked session with a transcript supplies the telemetry shown beside another session's scorecard | `:86` → `:22-26` → `interviews.ts:635-643` | C (path); frequency not measured |
| R6-api-voice-interview-6 | perf | M | `iv/complete/route.ts:166-170`, `:199-204` | the "free forever" replay for an already-completed session answers before the limiter, but after a body read of up to 1 MB and a ledger read (limit 20 000), so an unthrottled public loop costs real work per request, and the comment at `:201` ("cost nothing") is false. M: `rate-limit-contract.test.ts:697` pins that ordering, so the fix is a second, higher pre-parse ceiling or a contract change | `:90` → `:141` → `:169-190` → `:204` | C |
| R6-api-voice-interview-7 | ambiguity | S | `lib/student-interview.ts:19`, `:21`, `:281-295` | `devCaseIdFromJobId` and `submissionIdFromCandidateId` have no non-test caller (grep over app, scripts, packages, edge, pipeline). Their doc says `devCaseIdForEntry` / `submissionIdForEntry` "fall back to these"; they don't, `devcase-identity.ts:131-149` re-implements them and the two already drift (`|| null` there, `""` for a bare `dc-` here). The runtime import at `:19` exists only for them and contradicts `:21` ("stays free of runtime imports") | grep | C |
| R6-lib-voice-interview-11-1 | security (GDPR) | S | `lib/interview-prep-run.ts:27`, `:95-106`; `lib/interview-prep.ts:91-97` | a prep task queued or running when the candidate erases writes their real name and CV-derived plan back into the erased row. The label comes from the task params captured at enqueue (`:27`) into the scenario and `candidate_label`; the upsert never checks `anonymized_at`; erasure cancels no task (`app/api/data/[token]/route.ts:86`); and `anonymizeEntry`'s `anonymized_at` guard (`db/pipeline.ts:2745-2750`) means the row is never scrubbed again. The slow work outside a transaction does not re-check the row before writing | `useDecisionsQueue.ts:441` → `tasks.ts:326` → `:27` → `:52` → `run-of-show.ts:146-148` → `:78` → `:95` → `:101` → `:106` → `interview-prep.ts:96`; scrub undone: `db/pipeline.ts:2559-2560` | C (static trace) |
| R6-lib-voice-interview-11-2 | bug | S | `lib/interview-prep-kit.ts:52-55` (claim `:39-42`) | `prepKitForEntry` finds the "open link" with `latestInterviewByEntry`, which ranks any session with a transcript above newer ones (`interviews.ts:639`). After a reissue following a completed interview (allowed: `interview-invite.ts:112-115` refuses only a live call), the old completed session wins, its status is not open, and the pin is lost: the modal shows the latest published kit with `pinned: false` while the candidate's link is pinned to the older version and `/connect` builds from that pin (`connect/route.ts:302-307`). The case `:39-42` says it prevents. `liveInterviewByEntry` exists for this (`interviews.ts:664-665`) | prep GET → `:52` → `interviews.ts:635-643` → `:53-55` → `latestPublishedKit` | C |
| R6-lib-voice-interview-11-3 | bug | S | `lib/interview-prep.ts:230-235` (also `:205-215`) | accepting a staged plan stamps `created_at` with the time of the accept, not of the generation. A JD edited between staging and accept clears the "JD edited since" chip though the accepted plan was built from the old JD (the prep task is fed the job, `automation-run.ts:317-319`): the defect `:66-72` describes for imports, in another door. `pending-plan.test.ts:176` pins "moved", not "moved to the generation time" | `useScheduleInterviewPrep.ts:201` → `interview-prep-run.ts:96-98` → `stageInterviewPrepPlan` `:205-215` (no time stored) → `route.ts:236` → `:235` → `isPrepStale` `:324-325` | C |
| R6-lib-voice-interview-11-4 | ambiguity | S | `lib/interview-prep.ts:282-285`, `:155-156` | `getHumanScorecard` is "read by single-card surfaces", but has no production caller (only `panel-scorecards.test.ts` and a comment at `scorecard/route.ts:206`); `:155-156` names it first among the key's readers | grep over app, scripts, packages, edge | C |
| R6-lib-voice-interview-11-5 | ambiguity | S | `lib/interview-recommendation.ts:27` | the header points to `docs/features/pipeline/README.md §2.5`; the doc has no numbered 2.5, and the contract is under the unnumbered `## Recommendation / route vocabulary` (`:1597`) | — | C |
| R6-calendar-integration-1 | security | M | `app/api/calendar/google/route.ts:33-35`; `start/route.ts:17-19`, `:41-43`; `callback/route.ts:38-40`, `:85` | all three calendar routes are gated only by `requireOperator`, which admits any live member session, a viewer seat included. A viewer can disconnect and revoke the team's grant, or run start + callback to replace it with their own Google account (`saveCalendarConnection` upserts on `(workspace_id, provider)`); every interview event, candidate email as attendee, then lands on the viewer's calendar, and the viewer's free/busy filters what candidates are offered. Schedule routes ask `pipeline:write`, the ATS credential routes `org:manage`; the comment "OPERATOR-only, like the ATS credential routes" is false. The callback binds the grant to whichever workspace is current at callback time (the state carries none). `route-capability-coverage.test.ts:101` lists only `route.ts` as "not yet judged"; start and callback are GETs that write, which that ratchet cannot see. M: a capability choice across three routes and the ratchet | `require-operator.ts:23-47` → `roles.ts:36` → `callback:85` → `token-store.ts:174-182`; cf. `ats/connections/route.ts:45`, `schedule/route.ts:133` | C |
| R6-calendar-integration-2 | bug | M | `cal/event-sync.ts:91-99`, `:122`; `lib/schedule-store.ts:523-536` | the write-back is read → network → write with no re-check: create-vs-update is decided from the caller's snapshot, then `recordCalendarEvent` writes by token alone through `COALESCE`. A cancel during an in-flight create sees no event id and removes nothing, then the create lands and records "written" on a cancelled invite (permanent after a withdraw); two overlapping syncs both POST and the first event loses its handle; an erasure during a create rewrites the token (`db/pipeline.ts:2532-2536`), so `record(oldToken)` matches nothing and an event with the erased person as attendee has no handle `erasedInvitesWithCalendarEvent` can find. M: a CAS on the invite's state plus a compensating delete | `[token]/route.ts:485-497` → `event-sync.ts:91-93` → `google-calendar.ts:259-268` → `:99` → `:67-70` → `schedule-store.ts:535` | C (window: one Google round trip, up to ~18 s with retry) |
| R6-calendar-integration-3 | bug | M | `cal/google-calendar.ts:330-337`, `:299`; `cal/event-sync.ts:96-98`, `:122-125`; `cal/token-store.ts:186-187` | an event id is not bound to the grant that wrote it: `calendar_id` stays "primary" across a reconnect, `account_email` is never written, and the invite records no owner. After a reconnect to another Google account, a cancel deletes the old id against the new account; line 337 treats 404 as success, records "removed" and clears the handle while the event stays on the old calendar; a reschedule gets "gone" and re-creates, leaving a ghost. Contradicts "Deletes exactly the event kp created" (`event-sync.ts:112`) and "Nothing is orphaned" (`free-busy.ts:63-64`). M: a grant id on the invite | `callback:85` (no `accountEmail`) → `token-store.ts:186-187` → `event-sync.ts:124-125` → `google-calendar.ts:330-337` → `schedule-store.ts:527` | C (code); U: Google's 404 for a foreign id assumed, not exercised |
| R6-calendar-integration-4 | security | M | `lib/calendar-links.ts:95`, `:103`; `cal/event-sync.ts:54` | the server write-back passes `baseUrl` (`schedule/route.ts:160,543`; `[token]/route.ts:496`), so the Google event on the team's shared hiring calendar carries "Confirm, reschedule, or cancel: `<base>/schedule/<candidate token>`". That token alone authorises withdraw, propose, reschedule and cancel (`[token]/route.ts:236-244`), so anyone with event-detail access holds the candidate's capability link. `docs/features/scheduling/README.md:373-376` presents the body as intended, so the fix is a design choice. R4-schedule-ui-2-8 is the same builder through the "Add to calendar" button; its fix does not reach this path | as listed | C |
| R6-calendar-integration-5 | bug (locale) | M | `lib/calendar-links.ts:81`, `:93-104` | `interviewCalendarEvent` hardcodes English ("Interview · …", "Candidate", "Interview with … for …", "Stage:", "Match score:", "Join:", "Confirm, reschedule, or cancel:", "Scheduled with KP.", "Online interview"), and since event-sync (`event-sync.ts:54`) this copy is written into the real Google event in every locale, not only into the client-side template link. Round 4 observed it out of lane and did not count it; it is counted here for the first time. M: a server-side translator plus 4 catalogs | `event-sync.ts:54` → `calendar-links.ts:93-104` | C (literals); U: catalog keys (catalogs not read) |
| R6-calendar-integration-6 | ambiguity | S | `app/api/calendar/google/route.ts:29`; `start/route.ts:60` | both routes retype `/api/calendar/google/callback`, which is declared once as `GOOGLE_OAUTH_CALLBACK_PATH` (`cal/google-oauth.ts:30-32`, "Registered verbatim"); a change to the constant would leave the panel telling operators to register the wrong redirect URI | grep: no importer of the constant outside `google-oauth.ts` | C |
| R6-calendar-integration-7 | ambiguity | S | `cal/token-store.ts:17-20`, `:25-27`; `lib/calendar-links.ts:6` | "the row is already keyed by workspace + account email": the key is `PRIMARY KEY (workspace_id, provider)` (`:78`); `accountEmail` is "shown so an operator can tell whose calendar", but nothing writes it (`google-calendar.ts:342-348` says so on purpose); `calendar-links.ts:6` still calls OAuth sync "a later Solution Ⓐ", shipped in `event-sync.ts` | — | C |

### Duplicates, not counted

Seven recorded findings whose defect site or live path is in this round's files. Every one is
**still present** on this tree:

- **R5-db-pipeline-6** (machine-raised `approval_set` counted as human).
  `decision-attribution.ts:35` is still `approval_set: { auto: false, … }`; the machine
  raisers are still `automation-run.ts:633,686,690` and `automation-pass.ts:517`.
- **R5-db-pipeline-7** (`pipeline_events` has no `entry_id` index). The per-alert dedupe still
  runs at `automation-pass.ts:401-403`.
- **R5-db-pipeline-9** (`pipeline-core.ts` has outside importers). `automation-pass.ts:15`
  still imports `nextStageOnAxis` from it.
- **R3-pipeline-board-5-5** (the tick's `e.message` forwarded). `schedule/route.ts:175-176`
  still returns `tick` unprojected; the coded catch beside it is now `:177-181`.
- **R5-db-pipeline-1** (erasure leaves the AI-interview link live). `connect/route.ts:173-176`
  still refuses only terminal entries; `recording/route.ts:77,84` unchanged.
- **R4-interview-ui-4** (a long live call reads as expired). `connect/route.ts:141` still
  runs the expiry check before the live check at `:162`; the fix site
  (`interviews.ts:497-506`) was not re-read.
- **R4-voice-runtime-1-5** (`resumeAddendum` does not neutralise quotes). The live path is
  `director/route.ts:78-84`; the fix site in `director-brief.ts` was not re-read.

Pointer updates, not findings of this round:

- **R4-interview-ui-2.** Still at `interviews.ts:957-958` (`{ ...existing }` keeps
  `deletedAt`). The recruiter's delete route `sessions/[id]/recording/route.ts:46` is a
  second door to the same root.
- **R4-interview-ui-3.** Still at `interviews.ts:360`.
- **R4-interview-ui-10.** The cost subquery is still at `interviews.ts:74`.
- **R4-interview-ui-13.** `app/interview/[token]/page.tsx:157` still passes the raw
  `runOfShow`.
- **R4-schedule-ui-2-8.** Related to R6-calendar-integration-4: same builder, a different
  door, and its fix does not close this one. Both are counted.
- **R3-api-pipeline-3.** Related to R6-lib-automation-3: the same overwrite-then-extend
  shape at another site. Both are counted.
- **Nothing else matched** rounds 1-5 or "Known gaps" in
  `docs/architecture/engine-and-prompt-coordination.md`. None of its four gaps (JD ingest,
  `weight-proposal-v2`, the voice transport, judge independence) touches these contexts; the
  voice-transport gap is about the LLM matrix placing the transport, not about these routes.

### Confirmed S findings NOT fixed this round — carry-over, written to be taken as-is

Each line is the fix, then the test that fails today and passes after it. One commit per
line, test-first, as round 2 did.

- **R6-lib-decisions-1-2.** Fix: in the `interviewPlan` branch of `getDecisionConfig`, read
  the workspace's `pipelineStages` and migrate with
  `migrateLegacyInterviewPlan(legacy, thatAxis)`; correct `schema.ts:596-600`. Test
  (`decision-config-isolation.test.ts`): a board `[Accepted, Screened, Tech interview, Panel
  interview, Offer, Hired]` and a raw legacy plan `[ai, human topN 3]`; `getInterviewPlan(ws)`
  has the ai round on `Tech` and the human round on `Panel` (today: no rounds).
- **R6-lib-decisions-1-3.** Fix: on `!migrated.ok` call `recordConfigIssue(phase, tier,
  workspaceId, new Error(migrated.error))`, and refuse a parsed value that is not a plain
  object through the same ledger. Test (same file): a raw row
  `{"screeningGate":"maybe","rounds":[],"offerGate":"human"}` read once gives
  `getDecisionConfigHealth().total === 1`; a raw `"null"` screening row does the same.
- **R6-lib-decisions-1-4.** Fix: refuse `raw.steps.length > PIPELINE_STAGES_MAX` and apply
  `validateStage`'s id pattern to `stageId`. Test (`decision-config-schema.test.ts`): 13
  distinct steps, and one step with `stageId: "x".repeat(41)`, both give `ok: false`.
- **R6-lib-decisions-1-5** is S but UNVERIFIED. Fix: `sortValue` honours a `toJSON` function
  first, or the seal hashes `JSON.parse(payloadJson)`. Test (`decision-hash.test.ts`):
  `decisionContentHash("", p) === decisionContentHash("", JSON.parse(JSON.stringify(p)))` for
  `p = { inputs: { at: new Date(0) } }`.
- **R6-lib-decisions-1-6.** Fix: `Object.hasOwn(DECISION_META, k)` at `:241`, `:261` and
  `:328` (or a null-prototype map). Test (`decision-attribution.test.ts`):
  `decisionAttribution("constructor") === "unknown"` and
  `resolveDecisionKindFilter("toString", null)` deep-equals `{ matchesNothing: false }`.
- **R6-lib-decisions-1-7.** Fix: rewrite the header and JSDoc (PipelineTab uses
  `needsHumanDecision`; the registry lists names). Test: none (comment only).
- **R6-lib-decisions-1-8.** Fix: "five screening fields" at both sites; merge the two doc
  blocks at `:156-160`. Test: none (comment only).
- **R6-lib-automation-1.** Fix: give `setApproval` an `expectedStage` option (`AND stage = ?`,
  and `status = 'active'` when raising) and pass `{ expectedStage: snapshotStage,
  expectedApprovalKind: entrySnap?.approvalKind ?? null }` in the reject branch; on false call
  `markStaleSkip(d)` and skip `markQueuedForApproval`. Test (`automation-pass.test.ts`): a bau
  entry at Screened with score 20, snapshot taken, then a human `accept`;
  `applyPassDecisions([reject], staleSnap, s)` leaves `approval_kind` not
  `rejection_review`, `d.reasonCode === "staleSkip"`, `s.held === 0`.
- **R6-lib-automation-2.** Fix: `setApproval(…, { expectedStage: entry.stage,
  expectedApprovalKind: entry.approvalKind ?? null })` at `:633` (with the -1 extension),
  returning `skipped_stage_changed` on false; add `expectedApprovalKind` at `:625`. Test
  (`automation-run.test.ts`): a screening-stage fixture, gate `auto`, a fake LLM answering
  route hold / recommendation advance; `const p = runAutomationTask(…)`, then a synchronous
  human accept, then `await p`; the stage is exactly one step past screening (not Offer) and
  `applied === "skipped_stage_changed"`.
- **R6-lib-automation-3.** Fix: guard `:690` the same way, and at `:718` also require
  `fresh.status === "active" && fresh.stage === entry.stage`. Test
  (`automation-run.test.ts`): an Offer-stage fixture, offer gate `auto`, a priced draft;
  start the task, reject synchronously, await; no open offer exists for the entry,
  `applied !== "offer_sent"`, and `approval_kind` is null.
- **R6-lib-automation-4.** Fix: `RUN_PASS_RATE_LIMIT = { limit: 10, windowMs: 10 * 60_000 }`
  keyed `automation-run:${clientIpFrom(request.headers)}`, after the
  `AUTOMATION_SELECTION_INVALID` 400 and before `await currentWorkspace()` (it is synchronous,
  so it stays out of the pinned `isPassInFlight()` gap); correct the contract comment at
  `:1336-1340`. Test (`rate-limit-contract.test.ts`): a new row for
  `./automation/run/route.ts` with `expensive: "await runAutomationPass({ dryRun, selection })"`
  and `servedBefore: 'jsonRefusal("AUTOMATION_SELECTION_INVALID", 400)'`; red until the
  limiter lands.
- **R6-lib-automation-5.** Fix: `runAutomationPass({ dryRun, workspace })`, so a dry run runs
  `executeAutomationPass(true, undefined, workspace)` over `entriesForPass(…, workspace)`, and
  relabel the preview `summary` as team-scoped. Test: extract a pure
  `passEntries(entries, { dryRun, selection, workspace })`; a dry run for workspace A
  excludes workspace B's entries (or a source pin in `run/route.test.ts` that the dry-run
  call carries `workspace`).
- **R6-lib-automation-7.** Fix: rewrite the four comments (for the fairness header, amend it
  or add the role check). Test: none (comment only).
- **R6-api-voice-interview-1.** Fix: after `connectWithFailover`, when `failedOver` or
  `served !== session.provider`, call `setInterviewSessionProvider(session.id, served,
  failedOver ? provider : null)` and refuse with `refuseLeftLive` on false; correct
  `complete/route.ts:374-375`. Test (new
  `app/api/interview/connect/connect-provider-persist.test.ts`, on the
  `connect-response-contract` mocked-fetch harness): a candidate session on `elevenlabs`,
  POST `{ token, consent: true, provider: "openai" }`;
  `getInterviewSessionById(id).provider === "openai"` (today `"elevenlabs"`).
- **R6-api-voice-interview-2.** Fix: accept a revoked row in `completeInterviewSession` once
  per attempt (`status='revoked' AND (ended_at IS NULL OR ended_at < updated_at)`). Test
  (beside `complete-usage-attribution.test.ts:115`): complete, revoke, POST again with
  different turns; the second answer is not `ok` and the stored transcript equals the first.
- **R6-api-voice-interview-3.** Fix: load `getPipelineEntry(row.entryId, ws)` and answer the
  same 404 when `consentWithholdsPii`. Test (`recording-door.test.ts`): upload a chunk with
  `recordedCall()`, give the entry a past `consent_expires_at`; GET playback is 404 (today
  200).
- **R6-api-voice-interview-4.** Fix: index `listEntriesForJob` by id and, for a withheld
  entry, mask the label with `maskCandidateName` and null `summary` and `ratings[].evidence`
  in both branches. Test (compare route test): a scored session on a consent-expired entry
  has `summary === null`, no evidence, and a masked label.
- **R6-api-voice-interview-5.** Fix: parse `telemetry` from `scorecard_json` inside
  `interviewedForJob` and delete `telemetryForEntry`. Test: a completed session with
  telemetry plus a newer failed session with a transcript on the same entry;
  `candidates[0].telemetry` equals the first session's (today null).
- **R6-api-voice-interview-7.** Fix: delete both functions and the `:19` import; move their
  cases onto `devCaseIdForEntry` / `submissionIdForEntry`. Test: none (deletion; typecheck
  stays green).
- **R6-lib-voice-interview-11-1.** Fix: in `commitGeneratedPrep`, do the read, merge and
  write in one `db().transaction(…).immediate()` with no await; re-read
  `pipeline_entries.anonymized_at` and write nothing when set; take `candidate_label` from
  the entry row, not the task params. Test (new unit-db file shaped like
  `interview-prep-staleness.test.ts`): create an entry labelled "Jana Novakova", save a prep,
  `anonymizeEntry(id, "erasure", WS)`, then `commitGeneratedPrep(id, "Jana Novakova", …)`;
  `getInterviewPrep(id, WS).candidateLabel !== "Jana Novakova"` and the payload deep-equals
  `{}`.
- **R6-lib-voice-interview-11-2.** Fix: choose the pinned session with a status-filtered
  query (newest `created` / `in_progress` / `failed` by `created_at` DESC, like
  `liveInterviewByEntry`). Test (`interview-prep-overlay.test.ts:279`): before the v1-pinned
  link, complete a session A with one transcript turn; `pinned?.kitId === v1.id` and
  `pinned === true` (today v2 and false).
- **R6-lib-voice-interview-11-3.** Fix: store the generation time beside the staged plan
  (`pendingPlanGeneratedAt`) and use it at `:235`. Test (`pending-plan.test.ts`): stage,
  tick, `updateJd`, tick, accept; `isPrepStale(after.createdAt, prepJdEditedAt(id, WS)) ===
  true`. `:176` still passes.
- **R6-lib-voice-interview-11-4.** Fix: delete `getHumanScorecard`, move
  `panel-scorecards.test.ts` onto `getHumanScorecards`' headline, fix `:155-156`. Test: none
  (typecheck stays green).
- **R6-lib-voice-interview-11-5.** Fix: cite the heading by name. Test: none (comment only).
- **R6-calendar-integration-6.** Fix: build `redirectUriToRegister` from
  `GOOGLE_OAUTH_CALLBACK_PATH` in both routes. Test (`start/route.test.ts`, source contract):
  neither route file contains the literal `"/api/calendar/google/callback"`;
  `start/route.test.ts:119` keeps the value pinned.
- **R6-calendar-integration-7.** Fix: rewrite `token-store.ts:19-20` (the key is
  `(workspace_id, provider)`) and `:25-27` (always null today), and name `event-sync.ts` at
  `calendar-links.ts:6`. Test: none (comment only).

The 8 M findings (R6-lib-decisions-1-1, R6-lib-automation-6, R6-api-voice-interview-6,
R6-calendar-integration-1/2/3/4/5) need a design choice or a multi-file change. They are
anchored in the findings table and escalated, not carried as S. Five of them are in
`calendar-integration`, where every defect found crosses the Google boundary or the route
capability model.

### Gate output

This round changed no source, so the code gates were run once, on the branch base
`876b7300e`:

- `npm run typecheck` clean. It rewrote the three `app/_lib/*.generated.ts` files with CRLF
  only (`git diff --ignore-all-space` empty); they were restored.
- `npm run lint`: 0 errors / 49 warnings (pre-existing).
- `npm run test:unit`: 13019 / 13019.
- `node scripts/run-unit-tests.mjs "scripts/kpi/**/*.test.mjs"`: 85 / 85.
- `npm run test:docs` and `npm run docs:check` ran on the tree WITH this section: both exit 0
  (`test:docs`: 6 suites, 29 / 29; `docs:check`: 22 decision records valid). `test:docs` also
  rewrote the three `*.generated.ts` files with CRLF only; restored.

### Coverage after this round

| | |
|---|---|
| thread contexts read through all five lenses | **29 / 55** (52.7%) — was 24 / 55 |
| of the whole 143-map | **29 / 143** (20.3%) — was 24 / 143 |
| contexts where `ui-perfectionist` had a surface and ran | 10 (unchanged: all five of this round are n/a) |
| thread groups with no five-lens context | **0 / 7** — unchanged. Per group: CV Analysis 4/8, Candidate Matching 3/7, Developer Assessment 4/9, Hiring Decisions 5/8, Hiring Pipeline 5/10, Interview Scheduling 3/5, Voice Interviews 5/8. Thinnest by share now: Candidate Matching (3/7), then Developer Assessment (4/9), then CV Analysis (4/8) and Hiring Pipeline (5/10) |
| S findings fixed | 0 (read-only round) — round 2: 8 |
| new findings recorded | 34 (26 S, 8 M) + 7 duplicates |
| S carried over, written fix-and-test-ready | 26 (25 CONFIRMED, four of them with a named unverified side; 1 UNVERIFIED) |

All five contexts count: every applicable lens ran on each, and the five n/a cells are the
five contexts' `ui-perfectionist`, none of which has a `.tsx`. No context lost sources, so
no caveat qualifies the count this round. 26 thread contexts remain. At five per round that
is six more rounds.

## What to do with this file

A `/scan-sweep` run should **write this file itself**, per context, at the moment it picks
a context — not reconstruct it afterwards. The 2026-08-28 round did; everything above its
section did not. So the file now has two kinds of row and they are not interchangeable:
treat every **reconstructed** cell as an inference with the confidence stated at the top,
and only the **recorded** table as evidence that a lens actually ran.

The four columns are no longer all empty, and they are still the coverage debt: at
4 / 143 the recorded rows are 2.8% of the map. Read the counts as "started", not "done".
