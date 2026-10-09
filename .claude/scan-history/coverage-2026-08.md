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

## What to do with this file

A `/scan-sweep` run should **write this file itself**, per context, at the moment it picks
a context — not reconstruct it afterwards. The 2026-08-28 round did; everything above its
section did not. So the file now has two kinds of row and they are not interchangeable:
treat every **reconstructed** cell as an inference with the confidence stated at the top,
and only the **recorded** table as evidence that a lens actually ran.

The four columns are no longer all empty, and they are still the coverage debt: at
4 / 143 the recorded rows are 2.8% of the map. Read the counts as "started", not "done".
