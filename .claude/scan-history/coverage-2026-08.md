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

## What to do with this file

A `/scan-sweep` run should **write this file itself**, per context, at the moment it picks
a context — not reconstruct it afterwards. The 2026-08-28 round did; everything above its
section did not. So the file now has two kinds of row and they are not interchangeable:
treat every **reconstructed** cell as an inference with the confidence stated at the top,
and only the **recorded** table as evidence that a lens actually ran.

The four columns are no longer all empty, and they are still the coverage debt: at
4 / 143 the recorded rows are 2.8% of the map. Read the counts as "started", not "done".
