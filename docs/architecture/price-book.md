# Price book — every rate kp declares, and every one it does not

kp meters model, voice and speech calls into the `llm_usage` ledger, and the rates that turn a
quantity into dollars live in code. This page is the **declared copy** of those rates. It
originates nothing: a rate changes in code first, and the pin tests then force this page to
follow in the same commit.

- `app/_lib/price-book.test.ts` pins the four TypeScript tables (and the Gemini pair) to this
  page, in both directions.
- `pipeline/jobfit/tests/test_price_book.py` pins `MTOK_PRICES` the same way.

Why it exists, and what the council reads from it:
[reviews/2026-10-08-economics-evidence.md](reviews/2026-10-08-economics-evidence.md).

**Reading the table.**

- `basis` is one of `list price`, `estimate`, `known zero`, `provider-reported`, `unknown`.
- `source` and `as_of` are copied from the comment beside the number in code. Where the code
  has none, the book says `unknown` and the basis stays `estimate`. Nobody fills those in from
  memory or from a provider's page; that needs a dated read of the provider, which is the
  operator's call.
- A `known zero` cites the line that establishes it.
- `unknown` is neither a price nor a zero. A reader reports it as unknown.
- A `code home` written `file:TABLE["key"].in` / `.out` / `.key` names the exact entry the pin
  tests compare; a row there whose key has left the code fails the test.

## 1. Meters

### Tokens (USD per million tokens), `MTOK_PRICES`

Prefix match on the model id, input and output priced separately. `cached_tokens` is ignored.
The header at `pipeline/jobfit/llm/base.py:55-60` calls every non-Anthropic row a local
estimate and carries no source or date of its own.

| meter | unit | rate_usd | basis | source | as_of | code home |
| --- | --- | --- | --- | --- | --- | --- |
| claude-haiku-4-5 input | USD / Mtok | 1.0 | estimate | unknown | unknown | `pipeline/jobfit/llm/base.py:MTOK_PRICES["claude-haiku-4-5"].in` |
| claude-haiku-4-5 output | USD / Mtok | 5.0 | estimate | unknown | unknown | `pipeline/jobfit/llm/base.py:MTOK_PRICES["claude-haiku-4-5"].out` |
| claude-sonnet-4-6 input | USD / Mtok | 3.0 | estimate | unknown | unknown | `pipeline/jobfit/llm/base.py:MTOK_PRICES["claude-sonnet-4-6"].in` |
| claude-sonnet-4-6 output | USD / Mtok | 15.0 | estimate | unknown | unknown | `pipeline/jobfit/llm/base.py:MTOK_PRICES["claude-sonnet-4-6"].out` |
| claude-opus-4-8 input | USD / Mtok | 5.0 | estimate | unknown | unknown | `pipeline/jobfit/llm/base.py:MTOK_PRICES["claude-opus-4-8"].in` |
| claude-opus-4-8 output | USD / Mtok | 25.0 | estimate | unknown | unknown | `pipeline/jobfit/llm/base.py:MTOK_PRICES["claude-opus-4-8"].out` |
| claude-sonnet-5 input | USD / Mtok | 3.0 | list price | platform.claude.com pricing (standard rate; the intro $2/$10 is deliberately not booked) | 2026-08-11 | `pipeline/jobfit/llm/base.py:MTOK_PRICES["claude-sonnet-5"].in` |
| claude-sonnet-5 output | USD / Mtok | 15.0 | list price | platform.claude.com pricing (standard rate) | 2026-08-11 | `pipeline/jobfit/llm/base.py:MTOK_PRICES["claude-sonnet-5"].out` |
| claude-opus-5 input | USD / Mtok | 5.0 | list price | platform.claude.com pricing | 2026-08-11 | `pipeline/jobfit/llm/base.py:MTOK_PRICES["claude-opus-5"].in` |
| claude-opus-5 output | USD / Mtok | 25.0 | list price | platform.claude.com pricing | 2026-08-11 | `pipeline/jobfit/llm/base.py:MTOK_PRICES["claude-opus-5"].out` |
| gemini-3.8-flash input | USD / Mtok | 1.5 | estimate | provider price books (requesty/wavespeed/deepseek listings); booked at the standard rate, not the intro $0.75/$3.75 | unknown (the block is dated 2026-08-11, the model was announced 2026-09-02) | `pipeline/jobfit/llm/base.py:MTOK_PRICES["gemini-3.8-flash"].in` |
| gemini-3.8-flash output | USD / Mtok | 7.5 | estimate | as above; standard rate, not the intro $3.75 | unknown (as above) | `pipeline/jobfit/llm/base.py:MTOK_PRICES["gemini-3.8-flash"].out` |
| gemini-3.6-flash input | USD / Mtok | 1.5 | estimate | provider price books (requesty/wavespeed/deepseek listings) | 2026-08-11 | `pipeline/jobfit/llm/base.py:MTOK_PRICES["gemini-3.6-flash"].in` |
| gemini-3.6-flash output | USD / Mtok | 7.0 | estimate | provider price books (requesty/wavespeed/deepseek listings) | 2026-08-11 | `pipeline/jobfit/llm/base.py:MTOK_PRICES["gemini-3.6-flash"].out` |
| gemini-3-flash-preview input | USD / Mtok | 0.3 | estimate | provider price books (requesty/wavespeed/deepseek listings) | 2026-08-11 | `pipeline/jobfit/llm/base.py:MTOK_PRICES["gemini-3-flash-preview"].in` |
| gemini-3-flash-preview output | USD / Mtok | 2.5 | estimate | provider price books (requesty/wavespeed/deepseek listings) | 2026-08-11 | `pipeline/jobfit/llm/base.py:MTOK_PRICES["gemini-3-flash-preview"].out` |
| gemini-2.5-flash input | USD / Mtok | 0.3 | estimate | provider price books (requesty/wavespeed/deepseek listings) | 2026-08-11 | `pipeline/jobfit/llm/base.py:MTOK_PRICES["gemini-2.5-flash"].in` |
| gemini-2.5-flash output | USD / Mtok | 2.5 | estimate | provider price books (requesty/wavespeed/deepseek listings) | 2026-08-11 | `pipeline/jobfit/llm/base.py:MTOK_PRICES["gemini-2.5-flash"].out` |
| gpt-5-mini input | USD / Mtok | 0.25 | estimate | provider price books (requesty/wavespeed/deepseek listings) | 2026-08-11 | `pipeline/jobfit/llm/base.py:MTOK_PRICES["gpt-5-mini"].in` |
| gpt-5-mini output | USD / Mtok | 2.0 | estimate | provider price books (requesty/wavespeed/deepseek listings) | 2026-08-11 | `pipeline/jobfit/llm/base.py:MTOK_PRICES["gpt-5-mini"].out` |
| gpt-5.4-mini input | USD / Mtok | 0.75 | estimate | provider price books (requesty/wavespeed/deepseek listings) | 2026-08-11 | `pipeline/jobfit/llm/base.py:MTOK_PRICES["gpt-5.4-mini"].in` |
| gpt-5.4-mini output | USD / Mtok | 4.5 | estimate | provider price books (requesty/wavespeed/deepseek listings) | 2026-08-11 | `pipeline/jobfit/llm/base.py:MTOK_PRICES["gpt-5.4-mini"].out` |
| qwen3.8-max input | USD / Mtok | 2.0 | estimate | qwencloud.com model pages | 2026-08-05 | `pipeline/jobfit/llm/base.py:MTOK_PRICES["qwen3.8-max"].in` |
| qwen3.8-max output | USD / Mtok | 6.0 | estimate | qwencloud.com model pages | 2026-08-05 | `pipeline/jobfit/llm/base.py:MTOK_PRICES["qwen3.8-max"].out` |
| deepseek-v4-flash input | USD / Mtok | 0.14 | estimate | unknown (the comment names a GA repricing on 2026-07-31, not a source) | unknown | `pipeline/jobfit/llm/base.py:MTOK_PRICES["deepseek-v4-flash"].in` |
| deepseek-v4-flash output | USD / Mtok | 0.28 | estimate | unknown (as above) | unknown | `pipeline/jobfit/llm/base.py:MTOK_PRICES["deepseek-v4-flash"].out` |

### Tokens, the TypeScript mirror

| meter | unit | rate_usd | basis | source | as_of | code home |
| --- | --- | --- | --- | --- | --- | --- |
| Gemini deep-review input (`github_analysis` rows) | USD / Mtok | 1.5 | estimate | mirror of `MTOK_PRICES["gemini-3.8-flash"].in`; pinned by `app/_lib/github/usage.test.ts` | unknown (as the row it mirrors) | `app/_lib/github/usage.ts:GEMINI_MTOK_PRICE_IN_USD` |
| Gemini deep-review output (`github_analysis` rows) | USD / Mtok | 7.5 | estimate | mirror of `MTOK_PRICES["gemini-3.8-flash"].out` | unknown (as the row it mirrors) | `app/_lib/github/usage.ts:GEMINI_MTOK_PRICE_OUT_USD` |

### Tokens, engines without a table row

| meter | unit | rate_usd | basis | source | as_of | code home |
| --- | --- | --- | --- | --- | --- | --- |
| Claude CLI envelope (the local default engine) | per call | the CLI's own `total_cost_usd` | provider-reported | a list-price equivalent of a subscription-billed seat, not spend (`docs/architecture/llm-model-matrix.md:126-127`); a reported zero is booked as unpriced (`pipeline/jobfit/llm/adapters/claude_cli.py:130-132`) | per call | `pipeline/jobfit/claude_cli.py` |
| Deterministic template serve | per call | 0 | known zero | no provider call: `pipeline/jobfit/llm/monitor.py:250-260` writes `cost_usd=0.0`, `source='deterministic'` | n/a | `pipeline/jobfit/llm/monitor.py:emit_deterministic` |
| Ollama on a loopback base URL | per Mtok | none today | unknown | local inference (`pipeline/jobfit/llm/adapters/ollama.py:1-11`), but an Ollama tag never prefix-matches `MTOK_PRICES`, so these rows are NULL (unpriced), not zero. Recorded as unpriced until the adapter books a loopback zero (economics design step 5). An off-box `OLLAMA_BASE_URL` stays unknown. | unknown | none |
| Azure, OpenRouter, gateway and codex adapters | per Mtok | none | unknown | NULL by design or by prefix miss (`pipeline/jobfit/llm/base.py:55-60`); Azure deployments are customer-named | unknown | none |
| Gemini Google Search grounding fee (`grounded_salary`) | per grounded request | none | unknown | tokens are priced through `price_usd`; the grounding fee is priced nowhere (`pipeline/jobfit/gemini.py:345-358`) | unknown | none |

### Audio hour (speech to text), `STT_HOUR_PRICES`

| meter | unit | rate_usd | basis | source | as_of | code home |
| --- | --- | --- | --- | --- | --- | --- |
| assemblyai | USD / audio hour | 0.27 | list price | assemblyai.com/pricing, asynchronous Universal model; a floor estimate (diarization and PII redaction are priced add-ons it does not model) | 2026-09-05 | `app/_lib/stt-prices.ts:STT_HOUR_PRICES.assemblyai` |
| whisper_cpp | USD / audio hour | 0 | known zero | the operator's own CPU: `app/_lib/stt-prices.ts:37-40` | n/a | `app/_lib/stt-prices.ts:STT_HOUR_PRICES.whisper_cpp` |

### Characters (text to speech), `TTS_KCHAR_PRICES`

| meter | unit | rate_usd | basis | source | as_of | code home |
| --- | --- | --- | --- | --- | --- | --- |
| elevenlabs | USD / 1,000 characters | 0.22 | estimate | unknown (the comment says Creator/Pro tiers "land around $0.18-0.30" and 0.22 splits that band; no URL, no date) | unknown | `app/_lib/tts-prices.ts:TTS_KCHAR_PRICES.elevenlabs` |
| piper | USD / 1,000 characters | 0 | known zero | the operator's own machine: `app/_lib/tts-prices.ts:23-26` | n/a | `app/_lib/tts-prices.ts:TTS_KCHAR_PRICES.piper` |
| kokoro | USD / 1,000 characters | 0 | known zero | the operator's own machine: `app/_lib/tts-prices.ts:23-26` | n/a | `app/_lib/tts-prices.ts:TTS_KCHAR_PRICES.kokoro` |

### Conversation minute (realtime voice), `VOICE_MINUTE_PRICES`

| meter | unit | rate_usd | basis | source | as_of | code home |
| --- | --- | --- | --- | --- | --- | --- |
| openai realtime | USD / conversation minute | 0.15 | estimate | unknown (the comment gives "~$0.06-0.24" public estimates and takes the midpoint; no URL, no date) | unknown | `app/_lib/voice/minute-prices.ts:VOICE_MINUTE_PRICES.openai` |
| elevenlabs agents | USD / conversation minute | 0.09 | estimate | unknown (the comment gives "~$0.08-0.10/min" and splits the band; no URL, no date) | unknown | `app/_lib/voice/minute-prices.ts:VOICE_MINUTE_PRICES.elevenlabs` |
| self-hosted realtime voice | USD / conversation minute | 0 | known zero | a session served from a machine the operator runs: `app/_lib/voice/minute-prices.ts:71` | n/a | `app/_lib/voice/minute-prices.ts:voiceMinuteCostUsd` |

### Message (mail), webhook POST, edge Worker

| meter | unit | rate_usd | basis | source | as_of | code home |
| --- | --- | --- | --- | --- | --- | --- |
| Keyless default comms (`OutboxChannel`), plus the `simulation` and `refused` channels | per message | 0 | known zero | no egress, a `dev_outbox` row only: `app/_lib/comms.ts:92-106`, `app/_lib/comms-dispatch.ts:268-276` | n/a | `app/_lib/comms.ts:OutboxChannel` |
| Comms relay, kp's side (`WebhookChannel` POST) | per message | 0 | known zero | kp has no provider contract; the relay is the operator's own endpoint (`app/_lib/comms.ts:140`, POST at `:290`) | n/a | `app/_lib/comms.ts:WebhookChannel` |
| Comms relay, onward mail fee | per message | operator's, not stated | unknown | the relay's mail provider is the operator's contract; nothing in the repo states it | unknown | none |
| ATS webhook POST, kp's side | per POST | 0 | known zero | kp has no provider contract; the receiver is the customer's own system and nothing in the repo prices it (`app/_lib/ats-egress.ts:312`) | n/a | `app/_lib/ats-egress.ts` |
| Edge Worker (`edge/`) | per request | 0 | known zero | the repo's own claim, qualified "at single-operator volume, on Cloudflare's free plan" (`edge/README.md:26-28`) | n/a | none |

### Calendar call, REST read

| meter | unit | rate_usd | basis | source | as_of | code home |
| --- | --- | --- | --- | --- | --- | --- |
| Google Calendar API (free/busy, event write, token refresh) | per call | none | unknown | the repo names throttling only (`app/_lib/calendar/edge-fetch.ts:17-18`); no price, no quota number | unknown | none |
| GitHub REST reads (`app/_lib/repo-snapshot.ts`) | per call | none | unknown | no price stated in the repo | unknown | none |

## 2. Records

Where one use of each meter is counted today.

| meter family | record | how a use is counted |
| --- | --- | --- |
| Tokens, speech, realtime voice | `llm_usage` | one row per metered call; group by `use_case`, `provider`, `model`, `outcome`. `cost_usd` NULL is an unpriced call (counted, never zero). `source='deterministic'` rows are the known zero. |
| Cost of one task | `llm_usage.request_id` joined to `tasks.id` | the sum of a task's rows, grouped by `tasks.kind` (one JD build, one devcase lifecycle) |
| Mail | `dev_outbox` | one row per logical message; group by `kind` x `channel` x `status`. No attempts, latency or cost column. |
| ATS webhook | `ats_delivery` | one row per (event, entry); `attempts` and `status`. `attempts` also counts refusals that never touched the network. |
| Google Calendar | none | no per-call record; only the last event state per invite |
| GitHub REST | none | no record |
| Intake realtime voice minutes | none | `voiceUsageRow` exists but is applied on the interview path only |

`npm run economics:snapshot` ([economics/README.md](economics/README.md)) exports aggregates
of the first four records.

## 3. Features

The meters each council feature's span reaches, and how one use is counted.

| feature | meters reached | one use is |
| --- | --- | --- |
| ai-assisted-jd-authoring | tokens (`devcase_analyze`, `devcase_case_design`, `grounded_salary`, `jd_ingest`, `role_intake*`, `agent_fit`); STT; TTS; Gemini grounding (unknown); intake realtime voice (unrecorded) | one JD build = the `llm_usage` rows sharing a `request_id` whose task kind is `jd_build` |
| compliant-hiring-decision | tokens (`devcase_*`); mail; ATS POST (known zero); GitHub REST (unknown) | one devcase lifecycle = the rows sharing a `request_id` whose task kind is the lifecycle; one reject = 1 `dev_outbox` row + 1 `ats_delivery` row |
| candidate-self-scheduling | mail; Google Calendar (unknown) | one booking = up to 1 free/busy + 2 event writes + 2 mails |
| candidate-application-intake | mail (relay: kp's side zero, onward fee unknown) | one application = 1 acknowledgement `dev_outbox` row |
| offer-lifecycle-management | mail; ATS POST (known zero) | one offer = 1 letter + up to 1 reminder `dev_outbox` rows + up to 3 `ats_delivery` rows |
| ats-candidate-egress | ATS POST (known zero) | one delivery = one `ats_delivery` row; its `attempts` is the POST count |
| recruitment-funnel-analytics | none: it reads local SQLite and makes no metered call | n/a |

## 4. Unknowns

Every row above whose basis is `unknown`, and what would resolve it.

| meter | what would resolve it |
| --- | --- |
| Comms relay, onward mail fee | the operator states their relay provider's per-message rate |
| Google Calendar API | a dated read of Google's published quota and price page, entered with its URL; and a per-call record (economics design step 7) |
| GitHub REST reads | a dated read of GitHub's rate-limit and price page; and a record of the calls |
| Gemini Search grounding fee | a dated read of the provider's grounding price; and a count of grounded requests |
| Ollama on loopback | the adapter booking a loopback zero (economics design step 5); an off-box base URL stays unknown |
| Azure, OpenRouter, gateway, codex adapters | a per-deployment rate from the operator |
| Claude 4.x token rows, ElevenLabs TTS, both voice-minute rows, deepseek-v4-flash | a dated read of each provider's page, entered with URL and date (the rate exists; its source does not) |
| gemini-3.8-flash `as_of` | the date the standard rate was read |
| Intake realtime voice minutes | a `llm_usage` row on the intake path (economics design step 6) |
