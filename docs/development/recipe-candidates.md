# Recipe candidates from ingested job descriptions

`pipeline/jobfit/eval/recipe_candidates.py` reads a corpus of real job descriptions
and writes a **digest of recipe candidates** for the AI registry's `recipes/` lane:
`.ai/recipe-candidates.jsonl` plus a human summary at `.ai/recipe-candidates.md`.

kp never writes into the registry. It produces the digest; an operator later runs
`/assay <path>` inside the registry checkout and decides, candidate by candidate,
which ones become recipes.

## A candidate is not a recipe

| | Recipe (registry `recipes/<domain>/<topic>/<slug>/`) | Candidate (this digest) |
| --- | --- | --- |
| is | mastery: one recurring unit of work with one central judgment | an address plus the evidence for it |
| carries | `description` (need / input / core_action / output), 3-8 `activities` with kinds, `outcomes`, `guidance`, `use_cases`, `connector_types`, `recommended_trigger`, `examples`, `provenance` | a proposed domain/topic/slug/title, need, core_action, output, activity labels, connector types, map terms, verbatim JD evidence, a confidence |
| authored by | a person, through a versioned pull request in the registry | this script, from a JD corpus |
| decided by | the registry's gate (`node scripts/check-recipes.mjs`) | `/assay`, by an operator |

The digest is deliberately **one level below** a recipe. It has no `use_cases`, no
`outcomes`, no `recommended_trigger` and no activity `kind`s, because those are
judgments about the craft that a job posting does not contain. What a posting does
contain is which craft exists, roughly where it lives, and the lines that prove it.

## The mapping rules

These are the registry's rules, applied here and encoded in the live prompt:

- A **responsibility bullet** is an ADDRESS (`<domain>/<topic>`) plus a candidate.
- A **duty line** becomes one `activity_labels` entry: a phrase, never an instruction.
- An **accountability line** ("success looks like") becomes the `output`.
- **Why the role exists** becomes the `need`, phrased as what goes wrong without it.
- A **named tool** (Datadog, Jira, Salesforce) becomes a connector CATEGORY
  (`monitoring`, `ticketing`, `crm`), never the tool name. `desktop` is banned
  outright: every agent has desktop access, so it binds to nothing.
- **Organization-specific facts** (headcount, reporting line, named internal
  systems, locations, salaries) are charter, not recipe. They are dropped. The
  offline path also removes the hiring company's own name from theme selection,
  because a company name recurs across a JD exactly as reliably as a real theme.
- **No em dash and no en dash**, anywhere in any string. The registry corpus is
  written with the ASCII twin ` - ` and the gate enforces it.

### Role family to registry domain

kp routes every JD to one of the 16 role families in `data/taxonomy.json`. The
registry's recipes lane has 10 live domains. `ROLE_FAMILY_TO_DOMAIN` is the join,
and a test pins that all 16 are covered. The non-obvious rows:

| kp role family | registry domain | why |
| --- | --- | --- |
| `healthcare_clinical` | `general_professional` | no clinical domain; what survives de-identification is records, correspondence, scheduling |
| `life_sciences_research` | `general_professional` | no research domain; what generalizes is knowledge curation and reporting |
| `skilled_trades` | `operations_logistics` | field work is dispatched, scheduled and inspected |
| `frontline_service` | `customer_support` | a frontline shift is customer support work |
| `hr_people` | `general_professional` | no people domain; hiring and onboarding read as professional coordination |
| `education_academic` | `general_professional` | no education domain |

## How to run

Offline, deterministic, no network. This is the certified path:

```bash
python -m pipeline.jobfit.eval.recipe_candidates \
  --jd-corpus data/seed_calibration/jobs.json --roles 50 --no-llm \
  --out .ai/recipe-candidates.jsonl --summary .ai/recipe-candidates.md
```

Live, one JSON completion per posting through the `jd_ingest` use case (the Claude
CLI is the local default and is subscription-billed, so this is still keyless):

```bash
python -m pipeline.jobfit.eval.recipe_candidates \
  --jd-corpus data/seed_calibration/jobs.json --roles 50 \
  --out .ai/recipe-candidates.jsonl --summary .ai/recipe-candidates.md \
  --wall-minutes 25
```

| Flag | Meaning |
| --- | --- |
| `--jd-corpus PATH` | required; a JSON array with `title` and any of `jd_text` / `body_text` / `description`, plus an optional `requirements` array |
| `--roles N` | default 50; distinct titles drawn round-robin across role families, so a corpus sorted by family does not hand the whole sample to whichever family sorts first |
| `--limit N` | alias of `--roles` |
| `--out` / `--summary` | default `.ai/recipe-candidates.jsonl` / `.ai/recipe-candidates.md`; relative paths resolve against the repo root |
| `--no-llm` | offline heuristic only |
| `--strict` | exit 1 if any record was dropped, or nothing was produced |
| `--registry PATH` | default `../ai-registry`; read-only, see below |
| `--wall-minutes N` | default 25; when the live budget runs out the remaining postings fall back to the heuristic and the summary says so |

Exit codes follow the package contract in `pipeline/jobfit/eval/__main__.py`:
**0** the run happened, **1** a `--strict` gate failed, **2** the run could not be
performed (unusable flags, no corpus).

### What the registry is read for

Two things, both read-only, and both degrade:

- `recipes/index.json` gives the existing topic slugs per domain, so a candidate
  can propose an existing topic instead of inventing one. It also gives the topic
  COUNT: a domain at 10 topics is at the lane's cap, and the summary says that any
  candidate there which does not fit an existing topic forces a subdivision.
  (`software_engineering` is at 10 today.)
- `scripts/check-recipes.mjs` gives `RECORDED_CONNECTOR_TYPES`, read with a
  tolerant regex, so the connector vocabulary is the registry's rather than a copy.

When the checkout is absent, both fall back to an embedded copy and the summary
header says `embedded fallback` instead of naming the checkout. kp never writes
into `recipes/`.

## The record schema

One JSON object per line, keys sorted:

| field | |
| --- | --- |
| `ts` | ISO 8601 UTC |
| `source` | `jd:<posting id>`; the first source, kept stable across a merge |
| `sources` | every posting this candidate was seen in |
| `role_title`, `role_family` | from the posting |
| `proposed_domain` | one of the lane's 10 domains |
| `proposed_topic` | an existing topic slug under that domain, or `null` |
| `proposed_slug` | kebab-case, area plus activity |
| `proposed_title` | area plus activity, readable in a list of 200 recipes |
| `need`, `core_action`, `output` | three of the recipe's four description fields (`input` is a judgment the posting does not carry) |
| `activity_labels` | 3 to 8 phrases, in order |
| `connector_types` | recorded categories only, possibly empty, never `desktop`, never a connector id |
| `map_terms` | at least 3 lowercase routing words |
| `evidence` | verbatim JD lines, at least 1 |
| `confidence` | `low` / `medium` / `high` |
| `from` | `kp/recipe_candidates@0.1.0`, with `#heuristic` appended when the record came from the offline path |

`validate_candidate()` holds every record to this schema, live and offline alike.
**An invalid candidate is dropped, never repaired** - repairing it would put words
in the model's mouth - and the reason is printed in the summary's `## Dropped`
section so a systematic failure is visible rather than silently absorbed.

## The offline heuristic

`--no-llm`, and also any posting whose provider call fails, so a run always
finishes. It splits the body into responsibility-like lines (bullets, lines under
a responsibilities heading, or lines carrying an action verb - real corpora arrive
both bulleted and flattened into paragraphs), greedily clusters them into at most
three themes by shared keyword, and templates the need / core action / output from
the theme. Its output is honest about what it is: `confidence: "low"` and a
`#heuristic` suffix on `from`.

## Dedupe

Across postings, two candidates are the same craft seen twice when they share a
`proposed_slug`, or when their `map_terms` overlap at Jaccard >= 0.6 inside the
same domain. The higher-confidence record wins the prose; the evidence, map terms
and sources of both are kept, because a candidate two different postings agree on
is the one an operator should look at first.

## Hand off to `/assay`

The summary ends with the line to run inside the registry checkout:

```
Run /assay .ai/recipe-candidates.jsonl --domain <d> inside the registry
```

The `.ai/registry-leads.jsonl` pipe is **not** the route for these. That pipe
coerces every entry's kind to `technique`, which is the wrong lane.

## Known gaps

- The heuristic's theme is a keyword, so it still produces occasional non-themes
  from adjectives and place names that no stopword list catches. Every such record
  is `confidence: low` and `/assay` is where they die.
- `input`, `outcomes`, `use_cases` and `recommended_trigger` are not proposed at
  all. A posting does not contain them.
- Language: the corpus is English. A non-English posting would run, but the
  keyword tables are English-only and the heuristic would produce noise.
- Topic assignment is a word-overlap match against existing slugs. It proposes
  `null` readily, which is correct but leaves most of the triage to the operator.

## Tests

`pipeline/jobfit/tests/test_recipe_candidates.py` - the heuristic over inline
fixtures, the 16-family domain table against `data/taxonomy.json`, the dedupe
merge, the long-dash rule, the connector-id and `desktop` rejections, and the
end-to-end CLI including `--strict`.
