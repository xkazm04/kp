# One Thread — L2 certification, 2026-08-29

Live, empirical walk of the `one-thread` journey with **real model calls**, on branch
`l2/kp-thread`. The full Character report lives in the operator's gitignored `uat/`
overlay (`uat/runs/2026-08-29-one-thread-l2/`); this is the durable copy of the verdict,
because `uat/` is not tracked.

**Verdict: L2-conditional.** All five seams hold. Every finding sits *beside* the seams —
in the language layer, the provenance layer, and one input boundary — not in the identity
plumbing the milestone was built to fix.

## How it was run

| | |
|---|---|
| Build | `npx next build --webpack` — clean, `.next/standalone` emitted (first time; see the sibling commit for backlog item 57) |
| Server | `node .next/standalone/server.js`, `NODE_ENV=production`, `KP_ALLOW_OPEN=1`, **no `KP_OFFLINE`** |
| Engines | `/api/health` answered `{gemini:true, claudeCli:true}`. Nesting env stripped at spawn (`CLAUDECODE`, `CLAUDE_CODE_*`, `CLAUDE_EFFORT`, `ANTHROPIC_API_KEY`) so the CLI ran on subscription |
| Database | brand-new `KP_DB_PATH`, self-seeded (120 jobs / 66 profiles / 66 entries) |
| Driver | real Chromium. Eva: `cs-CZ`, `NEXT_LOCALE=cs`, entry cookie. Sam: `en-US`, **no cookie at all** |

**The standalone bundle is not runnable as documented.** Next traces neither
`.next/static` nor `public/` nor the Python `pipeline/` tree into it. The `Dockerfile`
copies all four explicitly (lines 87-93); `e2e/journey-one-thread.spec.ts`'s header and
`uat/env.md` both say a bare `node .next/standalone/server.js`. Followed literally, the
server renders HTML and **404s every JS chunk** — 7 of 16 specs failed that way before
the copies, in shapes that read like product bugs.

## Latency, measured

| Step | Engine | Wall clock |
|---|---|---|
| JD to job (`POST /api/jds/save`) | none, by design | 0.8 s |
| Assignment: analyze + design to the approval gate | Claude CLI | **42 s** / **48 s** |
| Approve to published to collecting (scenario, seed, baseline) | Claude CLI | **54 s** / **72 s** |
| Candidate opens the brief, works, submits | none | 4-6 s |
| Submission evaluation (5 steps) | Gemini 3.6 Flash | **42 s** / **46 s** |
| Promote to board | none | 0.2-0.5 s |
| Voice screen minted from the submission | none | 0.03 s |
| Seal + chain verify | none | 0.03 s |
| **JD to sealed decision** | | **178 s** |

Nothing timed out early; every long wait sat behind a stage label a recruiter can read.
The journey's predicted 15-130 s class is accurate. **No latency finding.**
Model calls observed: **~11**.

## The five seams

| Seam | Verdict | Evidence |
|---|---|---|
| 1 — JD to job to assignment, both directions | **pass** | `jobIngested:true`; `jobId === "jd-"+slug`; `GET /api/jobs/[id]/assignments` lists the case; the ledger's POZICE column names the role; publishing minted a token |
| 2 — submission to identity | **pass** | one submission produced **exactly one** entry; a real `profiles` id (not `ds-…`); **one row for that person**; the real `jd-…` job, not a `dc-…` |
| 3 — score kinds | **fail on the assignment surface, pass on the board** | board: `PŘENOS 0` beside the number. Assignment surface: the same 94 as `· shoda 94`, `94 fit`, and `PŘENOSITELNOST 94` |
| 4 — voice screen from the assignment | **pass** | panel renders under the evaluated submission; mints on the **same** entry; the reverse `?submission=` read resolves and is grounded on the real job; the board side effect is disclosed in Czech |
| 5 — judge independence + human seal | **pass** | "HODNOTITEL = GENERÁTOR" rendered; 1 record, `human:recruiter`, the recruiter's own words, `chain.ok`, `brokenAtSeq:null`, `keyed:false` (disclosed) |

Cross-cutting: **vocabulary passes** ("ZADÁNÍ" throughout, zero "Cases"), **status legend
passes** (one legend, five tones, translated).

## Findings

### F-1 · blocker · the session flush silently discards the candidate's work

`app/api/devcase/session/[id]/route.ts` filters events to
`{open, edit, decision_log, submit, paste}` and coerces each file to
`contents: String(f.contents ?? "")`. Anything else is dropped **without a word**, and
the route answers `200 {ok:true}`.

The first pass sent `file_open`/`file_edit` and `content` — **the exact payload the
committed `e2e/journey-one-thread.spec.ts` sends**. Result: `dev_session_events` held
zero rows and `files_json` was `[{"path":"DECISIONS.md","contents":""}, …]`. The paths
survived; the work did not.

Everything downstream inherited it. The evaluator reported *"The provided repository
metadata is completely empty… impossible to infer engineering practices"* and scored
**0 on all five dimensions**, transferScore **0**, against a submission that contained a
reasoned DECISIONS.md and a working implementation. The board showed `PŘENOS 0`. Nothing
anywhere said data had been dropped.

Refuse the unknown kind and the missing `contents` (400 naming the field), or at minimum
return the dropped counts beside `seq`. **Second-order:** the CI regression floor has
been flushing empty files and zero events since it was written, and asserts nothing about
the observed log, so it cannot notice.

### F-1b · with the route's real contract, the evaluation is genuinely good — a strength

Re-run with `open`/`edit`/`decision_log` and `contents`: transferScore **94**, dimensions
92/88/94/93/94, `decisionsLogPresent:true`, 11 events, watermark present, chain valid.
The evaluation cites the candidate's actual work **by file and by decision**:

> "Identified and handled the idempotency payload mismatch trap in `src/api/payments.ts`
> by comparing payload hashes and returning a 409 Conflict when a key is reused with
> modified payload."

The observed lane is real (*"Opened 4 file(s), edited 3 (observed)… Recorded 1
decision-log edit(s)."*), and the three cover probes flip `detected:false` to `true` with
an honest `handledWell:null` and the note *"observed: candidate worked the probe area"* —
it does not claim that watching someone touch a file means they solved it. The
recommendation then stayed **hold** on a 94 because authenticity came back `suspect`. A
system that refuses to advance a score it cannot authenticate is the right behaviour.

### F-2 · major · one number, three names, on one screen

- `· shoda 94` — `messages/cs.json:7486` `"fit": "· shoda {score}"`, used by
  `DevInterviewKit.tsx:57` with `top.transferScore`. **"Shoda" is Czech for *match*.**
- `94 fit` — `DevCompareSubmissions.tsx:57`, a hardcoded English literal.
- `PŘENOSITELNOST 94` — `DevEvalPanelScores.tsx:35`, correct.
- and in the voice panel's own copy: *"…s otázkami vycházejícími z této **shody**"*.

The correct string already exists one key away: `cs.json:7495` `"přenositelnost {score}"`
/ `en.json:7495` `"transfer fit {score}"`. The board got this right; the surface where
the recruiter actually reads the number did not. This is the journey's own `l2_priority`.

### F-3 · major · the model's output language is bound to nobody

Both directions, one run. **The English candidate got a Czech brief** — title, brief and
all three tasks in Czech on an English-chrome page, generated from an English JD with
`languages:["en","cs"]`. **The Czech recruiter got English narratives** — the summary, all
four strengths, the concern, every follow-up with its listen-for and red flag, and the
lifecycle status line *"published; interview scenario ready; seed materialized; baseline
frozen; sourced 0 candidate(s)…"*, plus the panel headings "Active assignments",
"Assignments", "Define need", "Outbox".

The chrome is translated to four locales and gated. The model output — most of what
either person actually reads — is bound to nobody's locale.

### F-4 · major · the brief promises five starter files; the surface hands two

`case.seed.source === "llm"` while `case.seed.files` is `["README.md","DECISIONS.md"]` and
`case.seed.note` is the **deterministic** provenance marker: the materializer labelled the
deterministic skeleton as an LLM seed. Two consequences, both on the candidate's screen:

1. The brief instructs *"Analyzujte stávající implementaci `POST /v1/payments` v
   `src/api/payments.ts`"* and names three more files. **None of them exist.** The editor
   offers `README.md` and `DECISIONS.md`, neither of which is code — and the reviewer's
   follow-up questions anchor to the same absent files.
2. The internal marker leaks: *"deterministic skeleton — starting materials remain prose;
   the LLM path materializes concrete files"*, untranslated, on a page read in cs/de/fr.
   `app/devcase/apply/[token]/page.tsx:74` suppresses exactly this string when
   `seedRaw.source === "deterministic"` — the guard is right, its input lies.

### F-5 · major · the best-evidence path is reported as a degradation

`combine_source` (`pipeline/jobfit/devcase/provenance.py:100-113`) is a two-valued
concept: all-`llm` gives `"llm"`, all-`deterministic` gives `"deterministic"`, and
**anything else gives `"partial"`**. The tooling step legitimately returns `"observed"`
when it has a real event trace, so every live-work-surface submission with a working
trace lands on `"partial"` and the panel tells the recruiter:

> *"Zhoršená evaluace: některé kroky spadly zpět na deterministické šablony. Před
> postoupením ji zkontrolujte."*

Nothing fell back — `fallbackReason` is `{}` and `perStepSources` is
`{reflect:llm, tooling:observed, evaluate:llm, transfer:llm, followups:llm}`. The
disclosure contradicts its own data and tells her to distrust the strongest read the
system produced.

### F-6 · major · the documented local run recipe cannot work

See "How it was run". Add the four copies (`.next/static`, `public/`, `pipeline/`, the
non-seed `data/*.json`) to the spec header and `uat/env.md`, or point the recipe at
`npm run start`.

### F-7 · minor · a dead LLM call whose zeros become a trust verdict

`reflect` runs against `commits.json`, which is empty **by construction** for a
`session:` submission (`app/_lib/devcase-run.ts:584-608`). It returns a confident negative
narrative with `confidence:0` and `readBeforeWrite:0`, and those zeros are laundered into
the authenticity reasons ("Iteration pattern couldn't be read", "Little evidence of
reading before writing") and rendered as **"JISTOTA 0%"** beside a 94. Skip the step, or
mark its output not-applicable, when `events !== null`.

> **Not a finding, recorded so nobody chases it:** the third authenticity reason,
> "Event-log integrity check failed", was the *driver's* fault — the fixture stamped event
> timestamps up to ~6 min in the future and the server correctly caught it
> (`backdatedEvents: 9`, `maxClockDriftMs: 374995`). The tamper check works.

## Strengths worth protecting

- **No probe leakage** on the candidate's live DOM (absence-scanned for `cover probe`,
  `answer key`, `internal material`, `red flag`).
- **AI-use disclosure + GDPR retention** render before the candidate submits.
- **The design gate refused even WITH keys** — "low grounding confidence (30%/40%) —
  human review" — and named the reason. The keyless refusal is not the only guard.
- **The Decisions card labels the AI's own number**: *"the model's own grade for this
  conclusion. Nobody has compared it with real outcomes."*
- **Judge independence is disclosed** rather than assumed.
- **The seal names a human** and the chain verifies unbroken.

## Coverage this run did NOT achieve

- **Both themes were not exercised.** The theme probe ran against a broken asset state
  and its output was discarded rather than reported. Owed.
- Voice **transport** end to end was not driven. ElevenLabs is configured, no relay is,
  so delivery came back **`queued`** (not `failed`) — and the panel says so. Recorded as
  observed, not assumed.
- `de` / `fr` were not walked; one pass per arm, so no multi-sample severity.
- `operatorApprover()` without `KP_OPERATOR_NAME` seals as `human:recruiter` — a role
  without a name. Known gap AI-Act G5; `scope_note`, as the journey directs.
