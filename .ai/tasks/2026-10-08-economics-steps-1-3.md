# Economics evidence, steps 1-3 (price book, council overlay, telemetry snapshot)

Design: `docs/architecture/reviews/2026-10-08-economics-evidence.md` (§4.2-4.4, §5 rows 1-3). Closes the "economics unmeasured" must-address on the councils named there.

The operator's decision, 2026-10-08, which binds this branch:

- (a) Every rate the repo does not state stays `unknown`. No provider pricing page was read and no number was filled in from memory. Where the code comment beside a rate has no source or date (`base.py` Claude 4.x rows, `tts-prices.ts` ElevenLabs, `minute-prices.ts` both rows), the book says source `unknown`, as_of `unknown`, basis `estimate`.
- (b) The comms relay: kp's side is a known zero; the onward mail fee is "operator's, not stated" (basis unknown). Google Calendar, GitHub REST and the Gemini grounding fee are `unknown`. The ATS webhook POST is a known zero on kp's side.
- (c) The snapshot runs only on a throwaway keyless database until the operator names `data/kp.sqlite`.
- (d) Steps 4, 5, 6, 7 and 8a-8f are not part of this branch.

What landed (three commits):

1. `docs/architecture/price-book.md` (Meters, Records, Features, Unknowns), one index row in `docs/architecture/README.md`, pin tests `app/_lib/price-book.test.ts` (the four TS tables) and `pipeline/jobfit/tests/test_price_book.py` (`MTOK_PRICES`), both directions. `monitor.py` docstring corrected: LightTrack is an optional cross-check. No rate value and no code that applies a rate changed.
2. `.claude/council/config.md`: `## Economics` after `## Characters`, with the telemetry paragraph amended (copy the newest `telemetry-*.json` when one exists; when none exists, telemetry is absent and the review says so; the snapshot states its database).
3. `scripts/economics/snapshot.mjs` + `__tests__/snapshot.test.mjs`, `npm run economics:snapshot`, `docs/architecture/economics/README.md`.

Meters left `unknown` (book §4): comms relay onward fee; Google Calendar API; GitHub REST reads; Gemini grounding fee; Ollama on loopback (unpriced today, step 5 would book the zero); Azure / OpenRouter / gateway / codex adapters; the source and date of claude-haiku-4-5, claude-sonnet-4-6, claude-opus-4-8, deepseek-v4-flash, ElevenLabs TTS and both voice-minute rows; the `as_of` of gemini-3.8-flash (its block is dated 2026-08-11 but the model was announced 2026-09-02).

Schema deviations from the design: none in the columns the snapshot reads (`llm_usage`, `tasks.kind`, `dev_outbox`, `ats_delivery.status/attempts` all match). One difference in where a table lives: `ats_delivery` is created lazily by `app/_lib/ats-delivery-store.ts`, not `app/_lib/db/core.ts`, so the snapshot treats a missing table as `null`, not zero. The design's "keyless" test is implemented as written: no priced, non-deterministic provider row.

Throwaway run: a fresh `ensureDb()` database (keys unset, `KP_OFFLINE=1`) has `llm_usage` n = 0, so no telemetry json was committed (the instruction for n = 0). `docs/architecture/economics/` holds only the README until the operator runs the snapshot against a database with rows.
