# Result caching — the analyze route

To avoid re-paying for identical Gemini calls (a common case while iterating on a JD
against the same CV), the analyze route hashes the inputs and reuses a cached payload
when one is available.

- **Cache key** — SHA-256 of `(PROMPT_VERSION, grounding flag, JD text + JD file
  bytes, company text + company file bytes, CV bytes)`. Computed in
  `app/_lib/cache-key.ts`.
- **Cache store** — `gemini_cache` table in the SQLite workspace DB
  ([workspace-data.md](workspace-data.md)). Each row carries `payload_json`,
  `prompt_version`, `created_at`, `expires_at`. Default TTL 24h; override via
  `KP_CACHE_TTL_HOURS`.
- **Invalidation** — bump `PROMPT_VERSION` in `app/_lib/cache-key.ts` whenever you
  edit the Gemini prompt, the Pydantic schema, the deterministic pre-pass, or the
  taxonomy in a way that should drop old results. Old hashes simply miss the lookup;
  nothing has to be deleted.
- **Behavior** — on cache hit the background analyze task completes near-instantly
  with the cached result. Each user-visible run still gets a fresh row in the History
  view regardless of cache state, so the workspace timeline remains accurate. The
  `cache_hit` flag is logged per request ([../development/logging.md](../development/logging.md)).
- **Implicit caching** — Gemini's own context caching for repeated content (within
  short windows, multi-variant runs against the same JD) is opportunistic and free;
  we don't manage it.
