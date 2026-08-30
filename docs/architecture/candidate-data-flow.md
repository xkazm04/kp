# Candidate data — the map

[`SECURITY.md`](../../SECURITY.md) states the stake plainly: a vulnerability here
is a personal-data breach for **a candidate who never chose to use this
software**. Everything else in `docs/architecture/` is written from the
operator's point of view — what you deploy, what you pin, which hosts you can
block. This page is written from the *candidate's* point of view: their CV, their
phone number, their interview transcript, and every component that touches one.

It exists because that path crosses three runtimes — a Next.js server, a SQLite
file, a **spawned Python process** — and can end at a model provider outside your
network, and until now no single document traced it end to end.
[`self-hosting.md` §6](./self-hosting.md#6-external-egress--the-complete-inventory-air-gap-reference)
lists every host KP may contact; it is indexed by *destination*. This page is
indexed by *the candidate's data*, and the two answer different questions.

> **Scope.** What the code does today. Legal framing (lawful basis, retention
> policy, DPIA, the AI-Act posture) lives in
> [`docs/features/compliance/README.md`](../features/compliance/README.md). The
> auth model that guards these surfaces is
> [ADR 0005](decisions/0005-hmac-sessions-and-capability-tokens.md).

## 1. One CV upload, hop by hop

A recruiter drops a CV on the Analyze surface (or a candidate uploads one at
`/apply/[id]`). This is the flagship path and the most sensitive one in the
product.

| # | Hop | What it holds | Can it leave the machine? |
| --- | --- | --- | --- |
| 1 | `POST /api/analyze` (`app/api/analyze/route.ts`) | The uploaded `File` in memory. Per-IP `rateLimit()` and the billing meter run **before** the multi-MB form parse. Size/type bounds are `app/_lib/upload-constraints.ts`. | No |
| 2 | `createWorkdir()` + `persistFile()` (`app/_lib/python-runner.ts`) | The CV bytes written to an OS temp dir (`$TMPDIR/jobfit-*`). | No |
| 3 | `startTask("analyze", …)` (`app/_lib/tasks.ts`) | The task row holds the **paths and options**, not the file. Detached from the request, so the analysis survives a navigation. | No |
| 4 | `spawnPython(["-m", "pipeline.jobfit.cli", cvPath, …])` (`app/_lib/analyze-run.ts`) | A **child process** with the CV's *path* in `argv` and the parent's env. Pasted JD/company text over 8 KB is spilled to a file rather than passed inline, so it never lands in a command line. | No — but it is where hop 5 becomes possible |
| 5 | The Python engine reads the file and calls a model | **This is the only hop that can egress candidate data.** The flagship analyzer is Gemini multimodal — `pipeline/jobfit/gemini.py`'s `get_client()` — and it uploads the candidate's *whole file*. With no key, or with a local endpoint, nothing leaves. See §4. | **Yes** |
| 6 | `saveAnalysis()` (`app/_lib/db/analyses.ts`) | The pipeline's JSON result into `analyses.payload_json`, plus `cv_hash` (SHA-256 of the CV bytes). | No |
| 7 | `finally { cleanupWorkdir(baseDir) }` (`app/_lib/analyze-run.ts`) | The temp dir and the CV file in it are removed. | — |

Two properties are worth stating outright, because both are easy to assume
wrongly:

- **The CV file is never stored in the database.** It exists as bytes in a temp
  directory for the length of one run. What persists is the *derived* analysis
  and a content hash. Every Python-spawning route follows the same
  `createWorkdir` → `persistFile` → `spawn` → `finally { cleanupWorkdir }` shape
  (`analyze-run.ts`, `applicant-profile.ts`, `automation-run.ts`,
  `campaign-run.ts`, `api/profile`, `api/match`, `api/matrix`, …).
- **`analyses.payload_json` is candidate personal data.** It is derived, not the
  original file, but it is derived *from* a CV and describes a named person.
  Treat it exactly as you would the CV.

## 2. What comes to rest, and where

All of it is in the one SQLite file at `KP_DB_PATH` — that is the whole point of
[ADR 0002](decisions/0002-sqlite-single-file-persistence.md), and it is what
makes "mount the volume in your region" a complete answer to data residency
([`self-hosting.md` §4](./self-hosting.md#4-data-layer--residency)).

| Table · column | Candidate data | Written by |
| --- | --- | --- |
| `analyses.payload_json`, `.candidate_label`, `.cv_hash` | The scored analysis of a real person, and their name | `app/_lib/db/analyses.ts` |
| `profiles.payload_json` | The extracted candidate profile | `app/_lib/db/profiles.ts` |
| `pipeline_entries.contact` | **Email / phone.** The reachback address every outbound message uses | `app/_lib/db/pipeline.ts` |
| `pipeline_entries.notes`, `.profile_gaps_json`, `.github_json`, `.github_handle` | Recruiter notes, gap analysis, linked public repo signal | `app/_lib/db/pipeline.ts` |
| `pipeline_events.detail`, `.actor` | The decision chain — what happened to this person and who did it | `app/_lib/db/pipeline.ts` |
| `interview_sessions.transcript_json`, `.scorecard_json`, `.instructions` | **The voice-interview transcript** and its scoring | `app/_lib/db/interviews.ts` |
| `dev_submissions` | Work-sample answers and their evaluation | `app/_lib/db/devcase.ts` |
| `dev_outbox` | Queued/sent candidate messages, including `failure_detail` | `app/_lib/db/devcase.ts`, dispatched by `app/_lib/comms-dispatch.ts` |
| `consent_events` | The consent audit trail | `app/_lib/consent.ts` |

The candidate-facing categories the `/data/[erasureToken]` page reports back are
derived from what an entry *actually* has, never a hardcoded list — see
`heldDataCategories()` in `app/_lib/data-held.ts`. That function is the closest
thing to a machine-readable version of this table, and it is the one a candidate
sees.

## 3. Copies that are not the database

A data map that only lists tables misses the places a copy lands by accident.

| Copy | Lifetime | Notes |
| --- | --- | --- |
| `$TMPDIR/jobfit-*` | One run | Removed in a `finally`. A SIGKILLed *Node* process (not the child — that is handled) can orphan one; they are ordinary temp files and the OS reclaims them. |
| The Python child's `argv` | One run | Holds **paths**, not content. The 8 KB spill in `app/api/analyze/route.ts` exists so a large paste cannot end up in a command line (visible in `ps`). |
| The child's environment | One run | Inherits the parent's env, including provider API keys. It does **not** carry candidate text. |
| `llm_usage` ledger (`kp-llm-usage-*.ndjson` → the DB) | Ingested then deleted | Metering only: `ts, use_case, provider, model, input_tokens, output_tokens, cost_usd, source`. **No prompt or response text.** |
| Sentry, if `SENTRY_DSN` is set | Per your Sentry retention | Off by default. **Candidate capability tokens are redacted before egress** by a `beforeSend`/`beforeBreadcrumb` pair in `instrumentation.ts` / `instrumentation-client.ts` — without it a single error on `/data/<erasureToken>` shipped a working link to a third party. Keep the token-prefix lists in both files in sync. |
| `npm run db:dump` output | Yours | A full portable copy of everything in §2. Encrypt it and keep it where you keep the volume; see [`releases.md`](./releases.md#rolling-back). |

## 4. Which adapters transmit candidate text — and when you find out

`LLM_PROVIDERS` in `app/_lib/llm-config.ts` is the closed vocabulary:
`anthropic`, `openai`, `azure_openai`, `gemini`, `openrouter`, `qwen`, `ollama`,
`claude_cli`. Whether one egresses is **not** a property of the adapter's name —
it is a property of the endpoint it resolves to.

| Adapter | Ships candidate text to | Egresses? |
| --- | --- | --- |
| `gemini` | `generativelanguage.googleapis.com` | **Yes.** Also the flagship multimodal CV analyzer, which uploads the file itself. |
| `anthropic` | `api.anthropic.com` | **Yes** |
| `claude_cli` | Anthropic, via the local Claude CLI binary | **Yes.** Local *binary*, not local *inference* — the name is the trap. |
| `openrouter` | `openrouter.ai`, then whichever upstream it routes to | **Yes**, and to a party you did not pick directly |
| `azure_openai` | Your configured `AZURE_OPENAI_ENDPOINT` | Your tenant — but off *this* machine |
| `openai` | `api.openai.com`, **or** your `OPENAI_BASE_URL` | Depends entirely on the base URL |
| `qwen` | Its configured endpoint | Depends |
| `ollama` | `OLLAMA_BASE_URL`, stock `:11434` | Normally on-box |

**Does an operator learn this before or after choosing?** Partly before. What
holds today:

- **Keyless is the default, and it degrades rather than blocks**
  ([ADR 0004](decisions/0004-keyless-degradation-is-a-product-property.md)). With
  no keys set, nothing egresses and the product still works on deterministic
  output. The choice to send candidate data off the box is always an *addition*
  by the operator, never a default.
- Settings → Models is where routing is chosen (`app/features/settings/models/`),
  and `docs/architecture/llm-provider-layer.md` describes the layer.
- `KP_OFFLINE=1` makes the answer enforced rather than trusted (§5).

And the gap, stated rather than glossed: **the provider picker does not label a
provider as off-box at the moment of choosing.** An operator who routes
`cv_analysis` to `openrouter` in the Models settings gets no in-product warning
that a candidate's CV is about to reach a third party — they learn it from this
page or from `self-hosting.md`. That is a real finding, and it is in §7.

## 5. Turning it off, and proving it is off

Two levels, and they are not the same strength.

1. **Set no cloud keys.** Then nothing egresses because nothing is configured.
   Trust-based: a leftover `GEMINI_API_KEY` in a `.env.local` defeats it, and
   `get_gemini_api_key()` re-reads those files, so clearing the variable in a
   service unit does *not* clear the key.
2. **`KP_OFFLINE=1`** — enforced, in both runtimes, because neither can see the
   other:
   - **Node:** a global `fetch` guard installed at startup (`app/_lib/offline.ts`)
     rejects any host outside the allowlist before the socket opens.
   - **Python:** cloud engines report unavailable and the call falls back to
     deterministic output (`pipeline/jobfit/llm/offline.py`). This half is
     load-bearing: the Node guard **cannot see a spawned subprocess**, and the
     two Gemini call sites that bypass the adapters — `gemini.get_client()` (the
     one that ships the whole file) and `embedding_bridge.GeminiEmbeddingProvider`
     — live there.
   - A configured `base_url` is not trusted just for being configured:
     `is_local_url()` seals off any public FQDN, so a stray
     `OPENAI_BASE_URL=https://api.openai.com/v1` cannot defeat the seal.

Both are **application-level backstops**. For a guarantee, enforce a network
egress policy at the deployment layer as well — `self-hosting.md` §7 says the
same thing and means it.

## 6. Getting it out and getting rid of it

Candidates reach their own data without an account, by capability link
([ADR 0005](decisions/0005-hmac-sessions-and-capability-tokens.md)):

- `/data/[erasureToken]` — what is held (§2's categories, via
  `heldDataCategories()`), and the erasure request. `pipeline_entries` carries
  `erasure_token`, `anonymized_at`, `consent_given_at`, `consent_expires_at`,
  `consent_source`.
- `/status/[token]` — where they stand, with the decision reasons.
- Every token route returns an **explicit field allowlist**, never a store row
  (`publicInviteView` in `app/api/schedule/[token]/route.ts` is the reference
  shape). Internal ids do not reach the wire.

What a rollback or an erasure **cannot** undo: a message already sent, a model
call already made (and billed), and a capability link already in an inbox. That
list is in [`releases.md`](./releases.md#what-a-rollback-cannot-undo) too, and it
is the same list for the same reason.

## 7. Known gaps

- **No off-box label at the point of choosing.** Settings → Models does not mark
  which providers egress candidate data (§4). This page and `self-hosting.md` §6
  are the only places that say it, and neither is open while an operator picks.
- **Temp files are not shredded.** `cleanupWorkdir` unlinks; it does not
  overwrite. On a journalled or copy-on-write filesystem the CV bytes may survive
  the unlink. Full-disk encryption is the answer, not an app-level shred.
- **No retention sweeper for `analyses` / `profiles`.** `consent_expires_at`
  exists on `pipeline_entries`; a saved analysis has no TTL of its own and is
  removed when its entry is.
- **The map is prose, and prose drifts.** `scripts/docs/feature-doc-map.json`
  couples the files above to this page, so the Stop hook names it when the
  candidate-data path changes — that catches the change, not the wrongness. If
  you find a hop this page misses, the hop is the bug report.

## See also

- [`self-hosting.md`](./self-hosting.md) — §4 residency, §5 model layer, §6 the
  egress inventory by host, §7 air-gap
- [`llm-provider-layer.md`](./llm-provider-layer.md) — how routing is resolved
- [`docs/features/compliance/README.md`](../features/compliance/README.md) — the
  legal and AI-Act framing
- [`SECURITY.md`](../../SECURITY.md) — reporting, and the scope of what a
  vulnerability here means
- [ADR 0002](decisions/0002-sqlite-single-file-persistence.md) ·
  [ADR 0003](decisions/0003-spawned-python-pipeline.md) ·
  [ADR 0004](decisions/0004-keyless-degradation-is-a-product-property.md) ·
  [ADR 0005](decisions/0005-hmac-sessions-and-capability-tokens.md)
