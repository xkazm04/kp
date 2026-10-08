# Economics evidence — 2026-10-08

A design review. It answers one question: **how does the council's economics row stop
coming back `unmeasured` across kp, inside the project's boundaries?** It reads code and
changes none.

- **Head.** `75f7e84a1` (local `main` when the review started). Every `file:line` below is
  at that head unless the row says otherwise. Line numbers will drift; the claims they back
  should not.
- **Why now.** "Economics is unmeasured" is a must-address on six full councils:
  ats-candidate-egress r1, candidate-application-intake r1, candidate-self-scheduling r1
  and r2, compliant-hiring-decision r1, offer-lifecycle-management r1, and
  ai-assisted-jd-authoring r1. recruitment-funnel-analytics full r1 adds a related line: an
  all-unpriced ledger shows a large `$0.00` headline and `$0.00 / hire`.
- **How the council scores it.** The method is
  `personas/.claude/skills/council/references/member-economics.md`:
  - **1.0**: per-use cost measured from telemetry, and something in the code bounds it.
  - **0.5**: an estimate from a named price book, labelled as an estimate; the bound exists.
  - **0**: an unbounded per-use cost.
  - **`unmeasured`**: metered calls exist, with neither telemetry nor a declared price book.
  - **`not_applicable`**: no metered call, and nothing consumed beyond the local process.

  The pack carries `evidence/telemetry/` and an optional `evidence/price-book.md` (the pack
  table, `council/SKILL.md:160-161`).
- **Feature boundaries.** Each feature's span is the `receipt.json` of its newest full run
  under `personas/.claude/master/kp/headless/council/`:

  | Feature | Run | Head judged |
  | --- | --- | --- |
  | ats-candidate-egress | `2026-10-07-ats-candidate-egress-r1` | `a7972f67` |
  | candidate-application-intake | `2026-10-07-candidate-application-intake-r1` | `63b2329d` |
  | candidate-self-scheduling | `2026-10-08-candidate-self-scheduling-r2` | `7c70ca1f` |
  | compliant-hiring-decision | `2026-10-07-compliant-hiring-decision-r1` | `718f5172` |
  | offer-lifecycle-management | `2026-10-07-offer-lifecycle-management-r1` | `a7972f67` |
  | ai-assisted-jd-authoring | `2026-10-08-ai-assisted-jd-authoring-r1` | `b0515dc0` |
  | recruitment-funnel-analytics | `2026-10-08-recruitment-funnel-analytics-r1` | `a7972f67` |

  Those directories were read and not written.
- **Method.** First, a sweep of every call that leaves the process, run per feature over the
  span plus anything the span reaches at run time. Then the load-bearing citations were
  re-checked by hand at the head above:
  - the ledger schema and its writers;
  - every rate table and its source comments;
  - the spawn defaults;
  - the comms relay ladder;
  - the ATS ladder and its DNS lookup;
  - the calendar fetch;
  - the erasure sweep constants;
  - the two sweeps with no `LIMIT`;
  - the analytics cost read and its panel;
  - the missing limiter on `/api/automation/run`;
  - the missing budget on the `jd_build` doors;
  - the unmetered intake voice mint.

  Other rows carry the sweep's citation.

## The finding in one paragraph

The expected shape holds, with three corrections:

1. **kp already has a price book, in code.** It has simply never been declared.
   `MTOK_PRICES` (`pipeline/jobfit/llm/base.py:61-86`) prices every token-billed model call,
   with dated sources for most rows. Four TS tables price voice and one TS-direct call.
   Every council pack reported "none declared" for two reasons:
   - the overlay names no price book;
   - `monitor.py:13-15` tells a reader that pricing happens server-side in LightTrack. The
     compliant-hiring-decision pack's `price-book.md` quotes that line as its reason.
2. **Ledger rows already exist for nearly every model call.** Python metering is on by
   default (`app/_lib/python-runner.ts:29-33`). Two per-message records already exist for
   the non-LLM egress: `dev_outbox` for mail and `ats_delivery` for webhooks. What has
   never existed is a way for those rows to **reach a council pack**. Packs are built in a
   worktree with no `data/kp.sqlite`, so `evidence/telemetry/` has been empty every time.
   Telemetry, not the ledger, is the binding constraint on 1.0.
3. **Only two metered calls have no record at all:**
   - Google Calendar API calls;
   - the intake studio's realtime voice minutes, which `minute-prices.ts` could price but
     nothing applies.

So the smallest design has four parts:

- **One declared price book.** A doc that copies the existing tables, is pinned to them by
  tests in suites CI already runs, and names zeros and unknowns explicitly.
- **One overlay paragraph** that points the council at it.
- **One aggregate telemetry snapshot** that the pack can copy.
- **One display fix** so the funnel never prints an unpriced sum as `$0.00`.

New rows are needed only for the calendar and for intake voice minutes.

## 1. Inventory, per feature

### The shared plumbing every feature leans on

| Mechanism | Where | What it records today |
| --- | --- | --- |
| `llm_usage` ledger | schema `app/_lib/db/core.ts:937-959`, indexes `:961-962`; writer `insertLlmUsage` `app/_lib/db/llm.ts:237` | One row per metered call. Columns: `use_case`, `provider`, `model`, the three token counts, `cost_usd` (nullable), `source` (`llm` / `deterministic`), `outcome` (`ok` / `failed`), `reason`, `request_id`. There is **no workspace or job column**, by design: the table is tenancy- and erasure-exempt (`app/_lib/tenancy.ts:484-489`). Nothing prunes it. |
| Python sidecar metering | `app/_lib/python-runner.ts:29-39` (on by default; `KP_LLM_USAGE_LOG` opts out), fold at `:505` → `ingestLlmUsageLog` (`app/_lib/db/llm.ts:278`) | Every `spawnPython` child that makes a model call writes one NDJSON line per call through `monitor.emit_result` (`pipeline/jobfit/llm/monitor.py:263`). A template fallback writes `emit_deterministic` instead: provider `deterministic`, cost `0.0` (`monitor.py:250-260`). A raised call writes `outcome='failed'` with NULL cost (`monitor.py:321-375`). `cost_usd` passes through `numOrNull` (`app/_lib/llm-usage-ledger.ts:142`), so an absent cost stays NULL and is counted as unpriced. |
| Request attribution | `app/_lib/llm-request-context.ts:26-57`; the task runner sets the task id at `app/_lib/tasks.ts:782` | A task's model calls share `request_id = tasks.id`, so the cost of one JD build or one devcase lifecycle is the sum of its rows. A spawn made directly from a route carries no `request_id`. |
| Spawn bounds | `app/_lib/python-runner.ts` | Per-spawn timeout `DEFAULT_TIMEOUT_MS = 600_000`, "a hang backstop, not a deadline" (`:175`). Concurrency: `DEFAULT_MAX_CONCURRENT = 4` (`:217`). Interactive queue wait: `DEFAULT_QUEUE_WAIT_MS = 20_000` (`:221`). Output cap: 64 MB (`:190-192`). |
| Python model-call retry | `pipeline/jobfit/llm/base.py` | `_MAX_ATTEMPTS = 3` (`:37`). Exponential backoff with jitter, capped at the remaining deadline (`:539-543`). The configured timeout is a total across attempts (`:38-43`), default 180 s (`:31`). Provider SDK retries are off, e.g. `adapters/anthropic_api.py:28`. |
| Comms relay | channel pick `app/_lib/comms.ts:323-331`; keyless default `OutboxChannel` `:92-106`; relay `WebhookChannel` `:140`, POST at `:290` | One `dev_outbox` row per logical message (`app/_lib/db/core.ts:794-804`). Status is `queued` (no egress), `sent` or `failed`, with `channel` naming the transport. There is **no attempts, latency or cost column**; only a dead letter logs its attempt count (`comms.ts:317-320`). Ladder: 3 attempts, base 200 ms doubling (`app/_lib/comms-status.ts:70-73`), 10 s per attempt (`comms.ts:74`). There is no SMTP and no SMS transport in the code. |
| ATS webhook | POST `app/_lib/ats-egress.ts:312` | One `ats_delivery` row per (event, entry) (`app/_lib/ats-delivery-store.ts:81-97`) with `attempts`, `last_status` and `last_error`, overwritten per attempt. `attempts` also counts refusals that never touched the network. Ladder: `MAX_ATTEMPTS = 6` (`:23`), `BASE_BACKOFF_MS = 60_000` doubling (`:25`), 5 s per POST (`ats-egress.ts:312`), 4 in flight (`ats-egress.ts:157-161`). |
| SSRF DNS re-vet | `app/_lib/ats-egress-guard.ts:78-84`, used by the ATS POST (`ats-egress.ts:253`) and the relay (`comms.ts:263`) | No record. **No kp-side timeout**; the code admits it at `ats-egress.ts:152-153`. |
| Google Calendar | every call goes through `calendarFetch` (`app/_lib/calendar/edge-fetch.ts:104-126`) | 8 s per attempt (`app/_lib/calendar/constants.ts:32`), with exactly one retry on 429/503 (`edge-fetch.ts:40`, `:125`) after a Retry-After wait of at most 2 s (`:44`). **No per-call record.** Event writes leave only the last state per invite (`calendar_event_state` / `_at`, written by `recordCalendarEvent`, `app/_lib/schedule-store.ts:523-542`). |

### The rate tables that exist

| Table | Prices | Rate (USD) | Source and date, as written | Applied where |
| --- | --- | --- | --- | --- |
| `MTOK_PRICES`, `pipeline/jobfit/llm/base.py:61-86`, via `price_usd` `:89-93` | per million tokens (in, out), prefix match | haiku-4-5 1/5 (`:62`), sonnet-4-6 3/15 (`:63`), opus-4-8 5/25 (`:64`), sonnet-5 3/15 (`:68`), opus-5 5/25 (`:69`), gemini-3.8-flash 1.5/7.5 (`:76`), gemini-3.6-flash 1.5/7 (`:77`), gemini-3-flash-preview 0.3/2.5 (`:78`), gemini-2.5-flash 0.3/2.5 (`:79`), gpt-5-mini 0.25/2 (`:80`), gpt-5.4-mini 0.75/4.5 (`:81`), qwen3.8-max 2/6 (`:83`), deepseek-v4-flash 0.14/0.28 (`:85`) | Claude 5: "platform.claude.com pricing, 2026-08-11" (`:65`). Gemini/OpenAI: "provider price books, 2026-08-11 (requesty/wavespeed/deepseek listings)" (`:70`); gemini-3.8 is "announced 2026-09-02" and booked at the standard rate (`:71-75`). Qwen: "qwencloud.com model pages, 2026-08-05" (`:82`). DeepSeek: "GA 2026-07-31 repriced" (`:84`). **The three Claude 4.x rows (`:62-64`) carry no source or date.** The header calls every non-Anthropic row a "LOCAL ESTIMATE" (`:55-57`). `cached_tokens` is ignored. | The Anthropic, Gemini, OpenAI and Qwen adapters, and the direct Gemini path (`pipeline/jobfit/gemini.py:345-358`). A coverage test requires every default-routed model to be priced (`pipeline/jobfit/tests/test_llm_base.py:334`). |
| Claude CLI envelope | per call | the CLI's own `total_cost_usd` (`pipeline/jobfit/claude_cli.py:1058`); a zero is booked as unpriced (`pipeline/jobfit/llm/adapters/claude_cli.py:130-132`) | provider-reported. The repo says these are **list-price equivalents for a subscription-billed seat** (`docs/architecture/llm-model-matrix.md:126-127`). | the local default engine |
| `STT_HOUR_PRICES`, `app/_lib/stt-prices.ts:41-44` | per audio hour | whisper_cpp 0, assemblyai 0.27 | "$0.27/hour as listed on assemblyai.com/pricing … written from on 2026-09-05" (`:28-30`). Called a floor estimate (`:31-35`). whisper.cpp is a "KNOWN zero" (`:37-40`). | `app/api/stt/route.ts:154`, use case `stt` |
| `TTS_KCHAR_PRICES`, `app/_lib/tts-prices.ts:27-31` | per 1,000 characters | elevenlabs 0.22, piper 0, kokoro 0 | "Creator/Pro tiers land around $0.18-0.30 … 0.22 splits that band" (`:21-23`). **No URL, no date.** | `app/api/tts/route.ts:122`, use case `tts` |
| `VOICE_MINUTE_PRICES`, `app/_lib/voice/minute-prices.ts:22-25` | per conversation minute | openai 0.15, elevenlabs 0.09; self-hosted 0 (`:71`) | "public estimates … ~$0.06–0.24 … 0.15 is the midpoint"; "~$0.08–0.10/min … 0.09 splits that band" (`:17-21`). **No URL, no date.** | only `app/api/interview/complete/route.ts:389`, use case `interview_realtime` |
| `GEMINI_MTOK_PRICE_*`, `app/_lib/github/usage.ts:25-26` | per million tokens, one model | 1.5 / 7.5 | "keep in sync with MTOK_PRICES … (Python is the price book of record)"; pinned by `usage.test.ts` | `github_analysis` rows (`usage.ts:60`) |

`app/_lib/llm-lighttrack.ts` is named as a rate file in the brief. **It holds no rates.** It is
an optional emitter to LightTrack that forwards `costUsd` as metadata and does nothing when
`LIGHTTRACK_URL` is unset. Its only importer is `github/usage.ts`. There is also one empty
price table: `agent-budget.json` `prices.models` is empty on purpose, and covers dev-lane
spend, not product spend.

### ats-candidate-egress

| Call | Where | Record today | Priced by | Bounds |
| --- | --- | --- | --- | --- |
| Webhook POST, lifecycle events | `app/_lib/ats-egress.ts:312`, via `dispatchAtsEvent` (`:477`) | `ats_delivery` row: attempts, last status | none | See the shared table. Retry sweep reads 50 due rows per tick (`app/_lib/ats-delivery-store.ts:331-337`). Terminal rows pruned after 90 days (`:36`). |
| Retry sweep, same POST | `retryDueAtsDeliveries` (`ats-egress.ts:568-634`, serial); also `POST /api/ats/deliveries` | same row | none | 50 per tick. **The operator door has no `rateLimit()`** (`app/api/ats/deliveries/route.ts`; a grep finds none). |
| Test ping | `app/api/ats/test/route.ts:56` | **none** (`:17`) | none | 20 per 10 min (`:30`) |
| DNS re-vet | `app/_lib/ats-egress-guard.ts:83` | none | none | **No timeout**, and it is held inside a semaphore slot (`ats-egress.ts:152-153`) |
| Import | `app/api/ats/import/route.ts` | n/a, no egress | n/a | 100 records, 2 MB (`:24-25`) |

### candidate-application-intake

| Call | Where | Record today | Priced by | Bounds |
| --- | --- | --- | --- | --- |
| Profile build, `profile_cli` spawn | `app/_lib/applicant-profile.ts:79-81` | **No `llm_usage` row, correctly.** The CLI is "pure logic — no LLM" (`pipeline/jobfit/profile_cli.py:6`). The r1 economics verdict listed this spawn as metered; it is not. | n/a (local CPU) | 60 s (`applicant-profile.ts:57`); 4-slot ceiling |
| Scoring sweep, `recruiter_cli` | `app/_lib/recruiter-run.ts:62-65`, from `app/_lib/automation-pass.ts:325` | none: no model unless `--weights-llm` is passed (`pipeline/jobfit/recruiter_cli.py:87-88`), and the sweep does not pass it | n/a | 240 s (`recruiter-run.ts:13`); 32 spawns per pass (`automation-pass.ts:231`, `:246-249`) |
| Policy pass, `automation_cli policy-pass` | `app/_lib/automation-pass.ts:617` | none: it returns before any model setup (`pipeline/jobfit/automation_cli.py:157-162`) | n/a | **No `timeoutMs`**, so 600 s |
| Acknowledgement, re-ack, knock-out decline, link recovery mails | `app/_lib/application-filing.ts:198-220`, `:257`; `app/api/apply/[id]/route.ts:262-276`; `app/_lib/lead-intake.ts:144-168`; `app/_lib/apply-link-recovery.ts:119-125` | one `dev_outbox` row each | **none** | Relay ladder. Apply door 20/min per (job, IP); quick apply 30/min. Link recovery once per entry per 24 h. **No per-recipient cap** on the decline and ack letters: they go to a typed address. |
| Edge drain | `app/_lib/edge-drain.ts:139`, from `instrumentation-node.ts:376-387` | drain ledger and outbox rows | n/a: the repo says the Worker costs "Nothing, at single-operator volume, on Cloudflare's free plan" (`edge/README.md:26-28`) | 20 s fetch, 5 pages × 50 events. Acks are awaited inside the tick (`app/_lib/inbound-lead.ts:235-242`). |

### candidate-self-scheduling

| Call | Where | Record today | Priced by | Bounds |
| --- | --- | --- | --- | --- |
| Free/busy POST | `app/_lib/calendar/google-calendar.ts:161-182` | **none** | **none; the repo states no Calendar price** (it only names 429/503 throttling, `edge-fetch.ts:17-18`) | 8 s, one retry. Callers are rate limited (candidate GET 60/min, recruiter slots 120/min). |
| Event insert / patch / delete | `google-calendar.ts:263`, `:289`, `:333` | last state per invite only (`schedule-store.ts:523-542`) | none | 8 s, one retry. A patch that finds the event gone re-creates it, so one sync can be up to two writes. |
| Token refresh, code exchange, revoke | `app/_lib/calendar/google-oauth.ts:188-276` | token columns on success; nothing on revoke | none | 8 s, no retry |
| Erasure sweep, one DELETE per event | `app/_lib/calendar/erasure-events.ts:24-26`, wired at `instrumentation-node.ts:262-270` | same state columns | none | 25 per tick (`:26`), 15 min spacing per event (`:24`). **No attempt ceiling and no age ceiling.** A persistently failing delete is retried every 15 minutes forever. |
| Invite, bulk invite, booking confirmation, interviewer brief, reminder mails | `app/_lib/comms-dispatch.ts:856-871` and siblings; bulk `app/api/schedule/invite/bulk/route.ts:119-164`; reminders `app/_lib/interview-reminders.ts:36-39` | `dev_outbox` rows; reminders also keep `reminder_attempts` | none | Bulk invites: `BULK_INVITE_CAP = 100` (`app/_lib/bulk-invite.ts:11`), sent serially. Reminders: 5 attempts with backoff. **`dueReminders` has no `LIMIT`** (`app/_lib/schedule-store.ts:871-893`). |

### compliant-hiring-decision

| Call | Where | Record today | Priced by | Bounds |
| --- | --- | --- | --- | --- |
| Devcase lifecycle model calls: about 6 before publishing, then 5 per submission | `app/_lib/devcase-run.ts:48` through `devcase_cli`. Enqueued by approve (`app/api/devcase/lifecycle/[id]/approve/route.ts:135`) and by reconcile (`app/api/devcase/control/route.ts:39-54`). | **`llm_usage` rows**, use cases `devcase_analyze`, `devcase_case_design`, `devcase_interview_scenario`, `devcase_seed`, `devcase_evaluate`. `request_id` is the task id. | `MTOK_PRICES` or the CLI envelope | Agent budget: 6 per 10 min per IP, 15 per hour per workspace (`app/_lib/task-budget.ts:55`). 15-minute watchdog. **The `interview-scenario`, `materialize-seed` and `baseline-solve` spawns get no abort signal**, so a cancel cannot stop them. **The per-posting `listSubmissions` has no `LIMIT`** (`app/_lib/db/devcase.ts:860`); the drain is capped only by `MAX_COLLECT_PASSES = 50` and the watchdog. |
| GitHub REST reads during the lifecycle | `app/_lib/repo-snapshot.ts:151-155`, `:296-325` | **none** | **none in the repo** | 20 s each, 4 MB, no retry |
| Rejection mail: screen wave and human door | `app/_lib/screen-wave.ts:611`; `app/_lib/pipeline-entry-action.ts:650` | `dev_outbox` row plus a sealed decision | none | Relay ladder. The wave is serial over an approved set that a 15-minute, spend-once token signs. 60 waves per 10 min. |
| ATS webhook per reject | `screen-wave.ts:631`; `pipeline-entry-action.ts:674` | `ats_delivery` | none | As for ATS. The screen-wave fan-out has no cohort cap of its own. |
| Automation pass (scoring sweep + policy pass) | `POST /api/automation/run`, which reaches `app/_lib/automation-pass.ts:219` | none (no model) | n/a | **A dry run bypasses the single-flight guard (`automation-pass.ts:219`) and the route has no `rateLimit()`** (`app/api/automation/run/route.ts:17`; a grep finds none). The 4-slot ceiling is the only bound. |
| Control-room poll | `app/control/ControlRoom.tsx:74-97` | n/a, local reads | n/a | 2 s / 6 s cadence, backing off to 60 s on failure. Skips when the tab is hidden. 900 per 10 min. No metered call. |

### offer-lifecycle-management

| Call | Where | Record today | Priced by | Bounds |
| --- | --- | --- | --- | --- |
| Offer letter send | `app/_lib/pipeline-entry-action.ts:328`, which reaches `app/_lib/comms-dispatch.ts:708-729` | `dev_outbox` row plus an `offer_sent` event | none | relay ladder |
| T-48h reminder | `app/_lib/offer-reminders.ts:42`, on the 60 s clock | `reminded_at`, a `dev_outbox` row | none | At most once per arm. **`dueOfferReminders` has no `LIMIT`** (`app/_lib/offers-store.ts:255-269`); sends are serial inside the tick. |
| ATS webhooks: hired, accepted, declined | `app/_lib/offer-finalize.ts:168`, `:175`, `:199` | `ats_delivery` | none | as for ATS |
| Offer letter GET, sim draft, sim link | `app/api/pipeline/[id]/offer-letter/route.ts:36`, `app/api/sim/offer-draft/route.ts`, `app/api/sim/offer-link/route.ts:40` | n/a: template, no egress | n/a | rate limited |

The **model-drafted** offer (`app/_lib/automation-run.ts:565`) is outside this span. It is
metered into `llm_usage` and gets the 600 s default.

### ai-assisted-jd-authoring

| Call | Where | Record today | Priced by | Bounds |
| --- | --- | --- | --- | --- |
| JD build design chain: `analyze-need`, `design-artifacts` | `app/_lib/jd-build-run.ts:372-374`, fan-out of two at `:390` | `llm_usage`, use cases `devcase_analyze` and `devcase_case_design`. These are shared with the devcase lifecycle; they can be separated only by joining `request_id` to `tasks.kind`. | `MTOK_PRICES` / CLI | Width 2, a constant. 600 s per spawn. 15-minute watchdog. **The three doors that start a build** (`app/api/jds/generate/route.ts:107`, `retry-analysis/route.ts:80`, `app/api/intake/[id]/promote/route.ts:85`) **never call `enforceTaskBudget`**. `jd_build` is classed `metered` (`app/_lib/task-budget.ts:81`), but the only callers of `enforceTaskBudget` are the devcase doors. |
| Market salary, `market_salary_cli` | `jd-build-run.ts:173-176` | `llm_usage`, use case `grounded_salary` | Tokens via `price_usd` (`pipeline/jobfit/gemini.py:345-358`). **The Google Search grounding fee is priced nowhere.** | **No `timeoutMs`**, so 600 s. 3 Gemini attempts. |
| Ingest as job, `jobs_cli ingest` | `app/api/jds/[slug]/ingest-job/route.ts:48` | `llm_usage`, `jd_ingest` | `MTOK_PRICES` | 20 per 10 min; 600 s; no signal |
| Intake dialog, voice turn, extraction, dossier | `app/_lib/intake-run.ts:258-343`, `app/api/intake/[id]/message/route.ts:142`, `dossier/route.ts:60` | `llm_usage`, use cases `role_intake`, `role_intake_voice`, `agent_fit` | `MTOK_PRICES` | 45–180 s spawn timeouts (`intake-run.ts:21-25`); per-route limits |
| Dictation and read-aloud | `app/api/stt/route.ts:154`, `app/api/tts/route.ts:122` | `llm_usage`, `stt` and `tts` (cache hits recorded at 0) | `stt-prices.ts`, `tts-prices.ts` | 20 and 60 per 10 min; 1,200 characters per TTS request |
| **Realtime voice mint** | `app/api/intake/[id]/voice-connect/route.ts:94` | **none.** Nothing under `app/api/intake` calls `insertLlmUsage` or a meter (grep). | **`minute-prices.ts` exists but is not applied** | 6 mints per 10 min per intake (`:76`). **No kp-side ceiling on how long a session runs** was found in the route or in `JdsIntakeVoice.tsx`. |
| Winnability | `app/api/jobs/[id]/winnability/route.ts:74` | none: pure, no model (`pipeline/jobfit/winnability.py:22-23`) | n/a | 60 s, 30 per 10 min |
| Build poll | `app/features/library/jds/jdsBuildPoll.ts` | n/a | n/a | 3.5 s backing off to 20 s, 8-minute hard stop |

### recruitment-funnel-analytics

`GET /api/analytics` spawns nothing and calls nothing; it reads local SQLite. The cost it
shows is a readout of the other features' `llm_usage` rows:

- **Window.** `computeCostWindow` (`app/_lib/db/analytics.ts:1085-1107`) sums `cost_usd`
  over `outcome='ok'` rows with `COALESCE(SUM(cost_usd), 0)` (`:1094`).
- **When the figure exists.** The object is non-null whenever `calls > 0` (`:838-849`).
- **Per hire.** `costPerHireUsd = costUsd / hiresClosedInWindow` (`:844`).
- **Stated scope limits** (`:116-129`): account-wide; USD only; unpriced rows "sum to 0 —
  surfaced so '$0' ≠ 'nothing spent'".
- **The panel.** It prints the headline with `usd(costUsd)` in display size
  (`app/features/insights/analytics/AnalyticsComputeCostPanel.tsx:63`), a small amber
  unpriced line (`:74-78`), and `usd(costPerHireUsd) / hire` (`:93-95`).

So a ledger where every call is unpriced renders `$0.00` and `$0.00 / hire`. The rule
`.claude/rules/ui.md` names is "Absence is '—' with its reason, never 0".

## 2. Boundedness, per call

The method's pin is "a retry with no cap, a fan-out from input, a loop once per item with no
page size, a poll with no ceiling". Every call above has a per-attempt timeout and, where it
retries, a cap with backoff. The exceptions follow, most dangerous first.

| # | Unbounded or weakly bounded | Where | Feature | Would it pin the score? |
| --- | --- | --- | --- | --- |
| U1 | A realtime voice session has no length ceiling, is paid per minute, and is not metered | `app/api/intake/[id]/voice-connect/route.ts:94` | jd-authoring | **Yes.** It is a per-use cost with no bound and no record. The only paid call in this inventory that is both unbounded and unmeasured. |
| U2 | The collect drain makes one model-chain evaluation per pending submission with no page size | `app/_lib/db/devcase.ts:860`; `app/_lib/devcase-orchestrator.ts:508-545` | hiring-decision | A strict reading says yes ("once per item, no page size"). r1 filed it as med because each submission is evaluated once and inflow is throttled. |
| U3 | Dry-run automation passes have no limiter and skip single-flight | `app/api/automation/run/route.ts:17`; `app/_lib/automation-pass.ts:219` | hiring-decision, intake | No: local CPU only (no model in the pass). `app/api/rate-limit-contract.test.ts:1338-1339` says the route "already throttle[s]", and `:1362-1363` implies it (the board command "was the one entry point to it with no throttle"); it does not. |
| U4 | The calendar erasure delete has no attempt ceiling | `app/_lib/calendar/erasure-events.ts:24-26` | self-scheduling | No: the rate is bounded (25 per tick, 15 min per event); only the tail is unbounded. r2 filed it med. |
| U5 | The DNS re-vet has no timeout | `app/_lib/ats-egress-guard.ts:83` | ATS, and every relay mail | No: a time-ceiling gap, not a cost multiplier. r1 filed it med. |
| U6 | Sweeps with no `LIMIT` | `dueOfferReminders` `app/_lib/offers-store.ts:255-269`; `dueReminders` `app/_lib/schedule-store.ts:871-893` | offer, self-scheduling | No: each row is sent at most once per arm, so the set shrinks. A one-time backlog lands in one tick. |
| U7 | The `jd_build` doors skip the per-workspace task budget | `app/api/jds/generate/route.ts:107`; `retry-analysis/route.ts:80`; `app/api/intake/[id]/promote/route.ts:85` | jd-authoring | No: a per-IP limiter (20 per 10 min) still bounds them. Without `KP_TRUSTED_PROXY` all callers share one bucket. |
| U8 | Lifecycle spawns with no abort signal | `app/_lib/devcase-run.ts`, the `interview-scenario` / `materialize-seed` / `baseline-solve` runners | hiring-decision | No: 600 s each, but a cancel cannot stop them. |
| U9 | ATS waiter queue is uncapped; the operator retry door has no limiter | `app/_lib/ats-egress.ts:164`; `app/api/ats/deliveries/route.ts` | ATS | No: bounded by committed events and operator presses. |
| U10 | Decline and ack letters go to a typed address with no per-recipient cap | `app/api/apply/[id]/route.ts:262-276` | intake | No: per (job, IP) limits hold. It is a harassment vector more than a cost. |
| U11 | Salary, policy-pass, offer-draft and ingest spawns fall back to the 600 s default | `jd-build-run.ts:173-176`; `automation-pass.ts:617`; `automation-run.ts:565`; `ingest-job/route.ts:48` | jd-authoring, hiring-decision | No: a loose bound is still a bound. |

## 3. What is free, and what is not applicable

### Free to this deployment: declare it at zero, do not leave it unmeasured

A zero is only declared where the repo itself establishes it.

| Call | Why it is free | Evidence | Recorded at zero today? |
| --- | --- | --- | --- |
| Deterministic template serves | no provider call | `monitor.py:250-260` | yes: `cost_usd = 0.0` |
| Keyless default comms (`OutboxChannel`), plus the `simulation` and `refused` channels | no egress | `comms.ts:92-106`; `comms-dispatch.ts:272-274` | yes: a `dev_outbox` row, no rate needed |
| Piper, Kokoro, whisper.cpp, self-hosted realtime voice | the operator's own CPU | `tts-prices.ts:27-31`; `stt-prices.ts:41-44`; `minute-prices.ts:71` | yes: explicit zeros |
| Ollama on a loopback base URL | local inference | `pipeline/jobfit/llm/adapters/ollama.py:1-11` | **No.** Ollama tags never prefix-match `MTOK_PRICES`, so these rows are NULL (unpriced). An off-box `OLLAMA_BASE_URL` is a different case and stays unknown. |
| Python CLIs that make no model call: `profile_cli`, `recruiter_cli` without `--weights-llm`, `automation_cli policy-pass`, `winnability`, `jobs_cli normalize` | local CPU | `profile_cli.py:6`; `recruiter_cli.py:87-88`; `automation_cli.py:157-162`; `winnability.py:22-23` | n/a: not metered calls at all, and they write no row |
| ATS webhook POST, kp's side | kp has no provider contract; the receiver is the customer's own system | none states a price; nothing in the repo prices it | no rate exists. Declare kp's side at a known zero. |
| The edge Worker | the repo's own claim, qualified "at single-operator volume" | `edge/README.md:26-28` | n/a |

### Not zero, and not known: declare `unknown`, never price it from memory

| Call | What the repo says |
| --- | --- |
| Comms relay, onward delivery | kp POSTs to a relay the operator runs. What that relay's mail provider charges per message is the operator's contract; nothing in the repo states it. |
| Google Calendar API | throttling only (`edge-fetch.ts:17-18`); no price, no quota number |
| GitHub REST reads | no price stated |
| Gemini Search grounding fee | not priced in `gemini.py` or `base.py` |
| Azure, OpenRouter, gateway, codex adapters | NULL by design or by prefix miss (`pipeline/jobfit/llm/base.py:58-60`; the gateway's `_cost_of` returns `None` on purpose) |
| Claude 4.x token rows; ElevenLabs TTS; voice minutes | rates exist, but have no source URL or date (`base.py:62-64`; `tts-prices.ts:21-23`; `minute-prices.ts:17-21`) |

The Claude CLI rows are neither free nor unknown. They carry a provider-reported figure that
the repo calls a **list-price equivalent** of a subscription-billed seat
(`docs/architecture/llm-model-matrix.md:126-127`). The price book should name that basis
rather than pretend the figure is spend or zero.

### Honestly `not_applicable`

- **recruitment-funnel-analytics.** It makes no metered call. The council already says so
  (r1 `verdict-economics.json`), and nothing here changes it. Its cost line is a **display**
  defect, and step 4 closes it.
- **No other feature qualifies.** ats-candidate-egress is the nearest case: its only egress
  is a POST that kp pays nothing for. But its r1 verdict explicitly refused
  `not_applicable` because the POST, the DNS lookup and the ledger are resources beyond the
  process. Declaring kp's side at a known zero gets the same honesty and survives that
  reading.

## 4. The smallest design

### 4.1 The expected shape, tested

**Expected:** one declared in-repo price book that lists or derives from the existing rate
files, plus a ledger row (or a named sibling for non-LLM calls) for every metered call that
lacks one.

**Verdict: it holds, with three amendments. None of them adds a service or a required env var.**

1. **The book copies; it does not originate.** The rates stay where the code applies them:
   `MTOK_PRICES`, the three voice tables, and the one TS mirror. The book is a dated copy,
   pinned to those tables by a test on each side, in suites CI already runs:
   - `test:unit` globs `app/**/*.test.ts`;
   - `test:python:gate` discovers everything under `pipeline/jobfit/tests`
     (`pipeline/jobfit/tests/run_gated.py:369-370`).

   That is the pattern the repo already uses for the one TS mirror (`github/usage.ts`, pinned
   by `usage.test.ts`). It needs no new CI step, so no new row in AGENTS.md's gate table.
2. **Telemetry is the missing half, not ledger rows.** Only two of the seven spans make model
   calls: compliant-hiring-decision and ai-assisted-jd-authoring. Every one of those calls
   already writes a row, except the intake voice minutes. The other five spans make no
   model call. Their egress is mail, webhooks and the calendar, and the first two already
   have per-use records. Adding rows without a way to bring them into a pack moves no
   score. The design adds one read-only aggregate export.
3. **Only one non-LLM call needs a sibling ledger: Google Calendar.**
   - Mail already has one row per message (`dev_outbox`).
   - Webhooks already have one row per delivery, with attempts (`ats_delivery`).
   - Calendar calls have nothing.
   - The intake voice minutes need a row in the **existing** ledger, not a sibling. The
     writer `voiceUsageRow` (`app/_lib/voice/minute-prices.ts:92-108`) exists and is applied
     on the interview path only.

### 4.2 Where the price book lives, and its format

**`docs/architecture/price-book.md`**, one file, indexed in `docs/architecture/README.md`.
It is a cross-cutting contract, which is what that folder holds, and the council pack's own
slot is a markdown file (`evidence/price-book.md`), so the pack can copy it verbatim.

The book has four sections:

1. **Meters.** One table per family (tokens, audio hour, kchar, voice minute, message,
   webhook POST, calendar call, REST read). Columns:
   - `meter`;
   - `unit`;
   - `rate_usd`;
   - `basis`: one of `list price`, `estimate`, `known zero`, `provider-reported`, `unknown`;
   - `source`: URL or document, or `unknown`;
   - `as_of`: a date, or `unknown`;
   - `code home`: the `file:symbol` that applies it, or `none`.
2. **Records.** For each meter, the table and columns that count its uses:
   - `llm_usage` by `use_case`;
   - `dev_outbox` by `kind` × `channel` × `status`;
   - `ats_delivery.attempts`;
   - the calendar sibling once step 7 lands.
3. **Features.** For each council feature, the meters its span reaches and how one use is
   counted. Examples: one JD build = rows sharing a `request_id` whose task kind is
   `jd_build`; one booking = up to 1 free/busy + 2 event writes + 2 mails.
4. **Unknowns.** Every `unknown` row, with what would resolve it.

**Dating and sourcing rule.**

- Each row's `source` and `as_of` are copied from the comment beside the number in code.
- Where the code has none (`base.py:62-64`, `tts-prices.ts:21-23`, `minute-prices.ts:17-21`),
  the book says `unknown` and the basis stays `estimate`. **A builder does not fill them in**:
  filling them means reading a provider's page and dating the read, which is question Q2.
- A `known zero` must cite the line that establishes it (the table in §3).
- A rate changes in code first, and the pin test then forces the book to follow in the same
  commit.

**Pin tests.**

- `app/_lib/price-book.test.ts` parses the book's tables and asserts that every key and value
  of `STT_HOUR_PRICES`, `TTS_KCHAR_PRICES` and `VOICE_MINUTE_PRICES`, and the Gemini pair in
  `github/usage.ts`, appears with the same number. It also asserts the reverse: no rate row
  in the book names a code home that no longer has that key.
- `pipeline/jobfit/tests/test_price_book.py` does the same for `MTOK_PRICES`.

### 4.3 How the council pack finds it — proposed overlay text (not applied)

The method's overlay table has no economics section (`council/SKILL.md:410-430`). This text
is therefore prose that the Director reads in phase 1, step 1, alongside `## Characters`.
Proposed for `.claude/council/config.md`, after `## Characters`:

```markdown
## Economics

kp declares its rates in one place: `docs/architecture/price-book.md`. Copy it verbatim to
`evidence/price-book.md`. Every rate in it is a copy of the table the code applies, pinned by
`app/_lib/price-book.test.ts` and `pipeline/jobfit/tests/test_price_book.py`, so the copy is
the declared book. `pipeline/jobfit/llm/monitor.py` says cost is priced by LightTrack; that
describes an optional cross-check, not the book.

Telemetry: copy the newest `docs/architecture/economics/telemetry-*.json` to
`evidence/telemetry/`, and quote its `window` and `n`. It holds aggregates only. A review
never opens a live database.

The book's "Features" table names, per feature, the meters its span reaches and how one use
is counted. A meter marked `unknown` there is reported as unknown. It is not priced, and it
is not zero.
```

The second paragraph assumes question Q3 is answered "commit the snapshot". If it is not,
that paragraph names wherever the operator puts it.

### 4.4 Telemetry the pack can carry

**`npm run economics:snapshot`** is an operator-run script, not a gate. It opens the
database read-only, from `KP_DB_PATH` or `data/kp.sqlite` (an optional env var, never a
required one). If the server is running, it copies the WAL set first. It writes
`docs/architecture/economics/telemetry-<date>.json` with **aggregates only**:

- `window` (start, end) and the database's row counts;
- `llm_usage` grouped by `use_case` × `provider` × `model` × `outcome`: `n`, token sums,
  `cost_usd` sum, `unpriced_n`;
- per task kind (`llm_usage.request_id` joined to `tasks.kind`): number of tasks, and cost
  per task at p50, p90 and max (one JD build, one devcase lifecycle);
- `dev_outbox` counts by `kind` × `channel` × `status`;
- `ats_delivery` counts by status, with an attempts histogram.

It exports no ids, no recipients, no bodies and no request ids. `llm_usage` holds no
candidate data by construction (`app/_lib/tenancy.ts:484-489`).

A keyless demo database is a legitimate source. Its model rows are `deterministic` at a
known zero, so it measures the shipped default path at `$0` with a real `n`. A keyed
operator database measures real spend. The snapshot states which one it read.

### 4.5 How the funnel stops showing an unpriced sum as `$0.00`

The funnel does not read the book at run time. Rates are applied when a row is written, and
the book copies the tables that apply them. What the funnel must change is how it reads
NULL:

- **`computeCostWindow`** (`app/_lib/db/analytics.ts:1085-1107`) also returns `pricedCalls`.
  Its `costUsd` becomes `null` when `pricedCalls === 0`.
- **`costPerHireUsd`** (`:844`) is computed only when `unpricedCalls === 0`. With any
  unpriced call, it understates by an unknown amount, so it becomes `null` with a reason
  code.
- **The panel** (`AnalyticsComputeCostPanel.tsx:63`, `:74-78`, `:93-95`):
  - all unpriced: the headline is "—" with "N calls, none priced: their models have no rate
    in the price book";
  - partly priced: the headline reads "at least $X", and the amber line stays;
  - per hire: "—" with the unpriced count whenever any call is unpriced.

  Known-zero rows (deterministic, self-hosted) are priced rows at 0, so a keyless demo still
  shows a truthful `$0.00`.
- **The intro copy** "The LLM compute that produced these hires" (r1 economics-1) becomes an
  account-wide statement. That means new message keys in en/cs/de/fr.

## 5. The plan

**Approval-waiting marking.** As of the App Master's last message, all seven features have a
ready full council whose Approval the operator has not decided. Every step that changes code
those features' doors reach is marked **⚠ Approval waiting**.

**Overlap with in-flight work.** A delivery is in flight on automatic advance, the screening
approval and interview confirmation. It writes in `automation-pass.ts` and its neighbours,
so step 8c must be cut after it merges.

| # | Branch (one Sonnet builder each) | Touches | Proven by | Closes | ⚠ |
| --- | --- | --- | --- | --- | --- |
| 1 | `price-book` | `docs/architecture/price-book.md` (new); `docs/architecture/README.md` (one row); `app/_lib/price-book.test.ts` (new); `pipeline/jobfit/tests/test_price_book.py` (new); a docstring correction at `pipeline/jobfit/llm/monitor.py:13-15` that points at the book | the two pin tests; `npm run docs:check` | Moves to **0.5** the token-priced half of jd-authoring and hiring-decision, and all of ATS (a known zero). Moves offer, intake and self-scheduling to 0.5 **only after Q1 and Q2** (relay and Calendar rates). | no: docs, two new tests, one docstring outside every span |
| 2 | *(operator)* overlay | `.claude/council/config.md`, the §4.3 text | the next council pack contains `price-book.md` | makes step 1 visible to the council | no |
| 3 | `economics-snapshot` | `scripts/economics/snapshot.mjs` (new); `scripts/economics/__tests__/snapshot.test.mjs` (fixture DB in tmp); `package.json` (one script); `docs/architecture/economics/README.md` (new) | `node scripts/run-unit-tests.mjs "scripts/economics/**/*.test.mjs"`: aggregates are correct; no id, recipient or body leaves; read-only open. If the operator wants it in CI: one `ci.yml` step plus its AGENTS.md row in the same change (`guidance:check`). | Moves to **1.0**: jd-authoring except voice, hiring-decision's model spend, and ATS (count × known zero). Offer and intake follow once Q1 is answered. | no |
| 4 | `funnel-cost-unpriced` | `app/_lib/db/analytics.ts`; `app/features/insights/analytics/AnalyticsComputeCostPanel.tsx`; `messages/{en,cs,de,fr}.json` | a new `app/_lib/db/analytics-compute-unpriced.test.ts` covering all-unpriced → null and "—", partly priced → lower bound and no per-hire, all-known-zero → `$0.00`; `npm run i18n:check` | funnel r1 economics-2 (`$0.00` headline) and economics-1 (intro overclaim) | **⚠ recruitment-funnel-analytics** |
| 5 | `ollama-local-zero` | `pipeline/jobfit/llm/adapters/ollama.py` (cost 0.0 on a loopback base URL, None off-box); `pipeline/jobfit/tests/test_llm_base.py` | a unit test for each base URL shape | stops a local-model install from rendering as unpriced | no: outside every span |
| 6 | `intake-voice-minutes` | `app/api/intake/[id]/voice-connect/route.ts`; `app/api/intake/[id]/voice-complete/route.ts`; `app/_lib/voice/minute-prices.ts` (use case as a parameter); `JdsIntakeVoice.tsx` (session ceiling) | The final extraction writes one `llm_usage` row, use case `role_intake_realtime`. Its minutes run from the mint stamp to completion, clamped to a declared ceiling. A session past the ceiling is closed client-side and billed at the ceiling. | **U1**, the only paid call that is unbounded and unmeasured. With step 3 it moves jd-authoring to 1.0. | **⚠ ai-assisted-jd-authoring** |
| 7 | `calendar-egress-ledger` | A new `egress_usage` table (ts, meter, provider, outcome, http_status, elapsed_ms, request_id) in `app/_lib/db/core.ts`, exempt in `app/_lib/tenancy.ts` and `ERASURE_EXEMPT` for the reason `llm_usage` is. A writer in `calendarFetch` (`app/_lib/calendar/edge-fetch.ts:104`) and in `google-oauth.ts` `postForm`. Optional: the GitHub reads in `app/_lib/repo-snapshot.ts`. | A tenancy test plus a writer test: one row per attempt, outcome on timeout, nothing on `KP_OFFLINE`. The snapshot learns the table. | self-scheduling to 1.0 (with a Q2 rate or `unknown`) | **⚠ candidate-self-scheduling** |
| 8a | `dns-resolve-timeout` | `app/_lib/ats-egress-guard.ts:78-84` (a timeout on `lookup`) | a test with a stalled resolver | U5. Covers ATS and every relay mail. | **⚠ ats-candidate-egress** |
| 8b | `erasure-sweep-ceiling` | `app/_lib/calendar/erasure-events.ts`; `app/_lib/schedule-store.ts:565-579`; an amendment to ADR 0021 | A test that gives up after N attempts or D days and leaves the row `orphaned` for the recruiter. | U4 | **⚠ candidate-self-scheduling** |
| 8c | `automation-run-limiter` | `app/api/automation/run/route.ts`; `app/api/rate-limit-contract.test.ts` (one new assertion; corrects the comments at `:1338-1339` and `:1362-1363`) | the contract test | U3 | **⚠ compliant-hiring-decision**, candidate-application-intake |
| 8d | `due-sweep-limits` | `app/_lib/offers-store.ts:255-269`; `app/_lib/schedule-store.ts:871-893` (a page `LIMIT`, oldest first) | a backlog test: N > limit drains across ticks | U6 | **⚠ offer-lifecycle-management**, candidate-self-scheduling |
| 8e | `jd-build-budget` | the three doors in U7 (`enforceTaskBudget("jd_build")`) | a door test per route | U7 | **⚠ ai-assisted-jd-authoring** |
| 8f | `lifecycle-spawn-bounds` | `app/_lib/devcase-run.ts` (pass the signal to the three runners); `app/_lib/db/devcase.ts:860` (a page) | cancel kills the child; the drain pages | U2 and U8 | **⚠ compliant-hiring-decision** (reached, not spanned) |

**The order and why.**

- **Steps 1–3 first.** They are pure additions outside every Approval-waiting feature, and
  they flip the most rows.
- **Step 4 next.** It is the only user-visible lie.
- **Step 6 before 7.** It is the one paid call that is both unbounded and unmeasured.
- **Steps 8a–8f last.** Each is independent, and only U1 and a strict reading of U2 would pin
  a score. Their value is in what the council has already filed as med.

**Expected rows once steps 1–4 are done** (with Q1 answered "declare a kp-side zero, with
the onward mail fee named as the operator's"):

| Feature | Row |
| --- | --- |
| ats-candidate-egress | 0.5, then 1.0 with the snapshot |
| intake | 0.5, then 1.0 |
| offer | 0.5, then 1.0 |
| hiring-decision | 1.0 for model spend; mail at 0.5 until the snapshot |
| jd-authoring | 0.5, pinned near 0 by U1 until step 6 |
| self-scheduling | `unmeasured` until Q2, then 0.5; 1.0 after step 7 |
| funnel | `not_applicable`, with its display line closed |

## 6. Alternatives, and why they lose

- **Do nothing: `unmeasured` is honest for a prototype with no outside users.** This is the
  strongest alternative. The method itself calls it "the correct, complete answer", and it
  costs coverage, not score. It loses for three reasons:
  - It costs one re-derivation per council. Six councils have re-read the same absence in
    full, and each will again.
  - The instrument is about 90% built: a ledger with default-on metering, dated rate tables,
    per-message mail and webhook records. What is missing is a pointer and an export, which
    is cheap.
  - The funnel's `$0.00` breaks a stated UI rule whether or not a council ever runs.

  It does win for the narrow set in §3's "unknown" table. If the operator declines Q2,
  "unknown" is the right permanent answer for the Calendar and GitHub reads, and the book
  says so instead of hiding it.
- **LightTrack as the price book.** `monitor.py:13-15` already calls it "the source of truth".
  It loses because it is an external service that is optional today (`LIGHTTRACK_URL`).
  Making it the book makes it required, which breaks "no new external service" and the
  two-minute start. A council pack also cannot read it.
- **One machine-readable rate file that both Python and TS load.** This is the true single
  source, and the endgame if the book grows. Today it means rewiring every rate call site:
  `base.py`, `gemini.py`, the voice and STT/TTS routes, `github/usage.ts`. Three of those
  sit in Approval-waiting features. Pin tests give the same no-drift guarantee for two small
  test files.
- **Generate the book from code.** It drifts less than a copy, but it needs a generator, a
  check mode and a CI step with its AGENTS.md row. Pin tests give the same guarantee with
  existing gates.
- **Put calendar calls into `llm_usage` with a new `source`.** This saves a table. It loses
  because every compute aggregate counts all `outcome='ok'` rows
  (`app/_lib/db/analytics.ts:1090`; `aggregateLlmUsage` in `app/_lib/db/llm.ts`). Calendar
  calls would inflate "LLM calls" on two surfaces, and every reader would need a filter.
- **Give the council read access to the operator's live database.** This gives the freshest
  numbers. It loses because the dispatcher restricts reads of the main checkout (the hiring
  pack's `telemetry/README.md` says so), and `dev_outbox` holds recipients and bodies. An
  aggregate snapshot carries the same `n` and window without that surface.
- **Price Calendar, GitHub, grounding and the relay from public knowledge now.** This is
  forbidden by the method and by the brief. An undated number from memory is the "estimate
  typed as a measurement" the method calls its most damaging error.
- **Add `workspace_id` or `job_id` to `llm_usage` for per-tenant or per-job cost.** The
  council row does not need it: per use is `request_id` → `tasks`. It is a schema and erasure
  change that this repo has deliberately kept off the ledger (`app/_lib/tenancy.ts:484-489`).

## Questions only the operator can answer

1. **Relay mail rate.** kp POSTs to a relay the operator runs, and the onward mail provider's
   fee is the operator's contract. Should the book declare kp's side at a known zero and name
   the onward fee as "operator's, not stated", or should you state your provider's
   per-message rate? This decides intake, offer, self-scheduling and the mail half of
   hiring-decision.
2. **Sourcing rates the repo does not state.** These are Google Calendar API, GitHub REST,
   Gemini grounding, and the undated Claude 4.x, ElevenLabs TTS and voice-minute rows. May a
   builder read each provider's public pricing page and enter it with the URL and the date
   read? Or do they stay `unknown`?
3. **Where telemetry lives.** Should the aggregate snapshot be committed to this public
   repository, and which database is it taken from: your `data/kp.sqlite`, or a throwaway
   keyless run?
4. **The overlay.** Apply the §4.3 text to `.claude/council/config.md`? And should the
   council method itself (in personas) gain an `## Economics` overlay section, so other
   projects do not need prose?
5. **Claude CLI rows.** They are list-price equivalents of a subscription seat. Should the
   funnel show them as spend with that label, or count them separately from metered spend?
6. **Steps marked ⚠.** Dispatch them now, or after you decide those features' Approvals?
