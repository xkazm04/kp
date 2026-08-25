# Logging

Per-request structured JSONL logs help debug pipeline regressions and track token
usage without rerunning the full e2e suite.

| File | Written by | One line per |
| --- | --- | --- |
| `tmp/pipeline.log` | `pipeline/jobfit/logger.py` | `analyze_cv()` invocation — request_id, CV path, JD/company flags, total + per-stage durations, Gemini token usage (`prompt_tokens`, `candidate_tokens`, `total_tokens`, `cached_tokens`), error |
| `tmp/analyze.log` | `app/_lib/logger.ts` | `/api/analyze` request — request_id, route, candidate label, JD slug, `cache_hit` flag, duration, saved slug, error |
| `tmp/github.log` | `app/api/github-analysis/route.ts` | `/api/github-analysis` request — request_id, GitHub user, REST repo count, `code_review` status, duration, error |

Logs are append-only JSONL (one JSON object per line) so they're tail-friendly and
grep-able. Override the directory with `KP_LOG_DIR`; the default `tmp/` is
gitignored.

Set `KP_LOG_PROMPTS=1` for full Gemini prompt + response capture per request to
`tmp/prompts/<request_id>-prompt.txt` and `<request_id>-response.txt`. Off by default
since these contain CV PII and can be 5–20 KB each. Useful when chasing a "Gemini
returned non-JSON output" regression or comparing prompt revisions. It is a debugging
switch, not a production setting.

LLM-call tracing across every provider (LightTrack) is a separate, opt-in plane:
[`../architecture/llm-provider-layer.md`](../architecture/llm-provider-layer.md)
→ Observability.
