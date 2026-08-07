> Total: 5 findings (0c critical, 1h high, 1m medium, 3l low)

## 1. Three consent-event kinds are declared, schema-documented and i18n-mapped but never emitted
- **Severity**: High
- **Category**: dead-code
- **File**: app/_lib/db/pipeline.ts:907 (`ConsentEventKind`) + app/features/sub_pipeline/ConsentPanel.tsx:70-73 (in-scope consumer)
- **Scenario**: `ConsentEventKind` is a 7-member union (`granted | renewed | expiring_notified | expired | anonymized | erasure_requested | erased`). Grepping every `logConsentEvent(` call site (`grep -nE "logConsentEvent\(" app/_lib/db/pipeline.ts`) shows only 4 are ever written: `granted`/`renewed` (line 959) and `anonymized`/`erased` (line 1053). `grep -rn "expiring_notified|erasure_requested"` across the repo (excluding node_modules + `.claude/worktrees/`) finds each ONLY in: the type union, the `core.ts` schema comment, and `ConsentPanel.tsx`'s `eventLabels` map — never as an argument to a write. A standalone `"expired"` consent event is likewise never emitted (the expiry sweep calls `anonymizeEntry`, which logs `anonymized`, not `expired`). So `ConsentPanel.tsx:70`, `:72`, `:73` map three labels that can never render, and three i18n keys (`event.expiring_notified`, `event.expired`, `event.erasure_requested`) are dead.
- **Root cause**: The lifecycle was designed (per docs/GDPR_AND_HIRING_EXTENSIONS.md) with a pre-expiry reminder (`expiring_notified`), a distinct `expired` transition, and an erasure REQUEST-vs-COMPLETION split (`erasure_requested` then `erased`). Only grant/renew/anonymize/erase were wired; the notification path and the request/expiry transitions were never built.
- **Impact**: Reader confusion and audit-trail incompleteness theater: the type/schema/UI advertise a richer GDPR audit trail than is recorded. A maintainer trusting the union may assume an `expired` or `erasure_requested` row exists for compliance evidence when it never will. Translators maintain three never-shown strings in every locale.
- **Fix sketch**: Two honest options — (a) WIRE them: emit `expiring_notified` from the pre-expiry reminder path, emit `erasure_requested` in `data/[token]` POST before `anonymizeEntry`, and log a standalone `expired` in the sweep before anonymizing; or (b) PRUNE to what's emitted: trim `ConsentEventKind` to `granted|renewed|anonymized|erased`, drop the three `eventLabels` entries + i18n keys + the core.ts comment list. Do NOT silently delete the recording side — only the unreachable label/type surface. Prefer (a) if the reminder feature is on the roadmap, since the schema already accepts the rows. (Note: pipeline.ts/core.ts are out of this context's file scope but are the source of the dead union the in-scope ConsentPanel consumes — flagging at the consumer.)

## 2. Erasure POST does not log an `erasure_requested` audit event before scrubbing
- **Severity**: Medium
- **Category**: dead-code
- **File**: app/api/data/[token]/route.ts:33-43
- **Scenario**: The candidate-initiated erasure POST calls `anonymizeEntry(entry.id, "erasure")` directly. `anonymizeEntry` logs a single `erased` event (pipeline.ts:1053). The declared `erasure_requested` kind — meant to record that a candidate ASKED — is never written here or anywhere (`grep -rn "erasure_requested"` returns only type/comment/label, finding 1). Confirmed there is no other erasure entry point: `grep -rn "anonymizeEntry(" ` shows only this route and the expiry sweep call it.
- **Root cause**: The two-step audit (request, then completion) collapsed into one terminal `erased` event during implementation; the request half was dropped but its kind left behind.
- **Impact**: This is the compliance-sensitive direction the prompt warns about — but for STRENGTHENING, not weakening: the audit trail cannot evidence that erasure was candidate-initiated vs sweep-driven beyond the free-text `detail: "reason: erasure"`. Combined with finding 1, it is why `erasure_requested` is dead. Worth surfacing as a deliberate decision rather than leaving a half-built kind.
- **Fix sketch**: Either accept the single-event model and prune `erasure_requested` (finding 1b), or log a distinct `erasure_requested` event at the start of the POST (before `anonymizeEntry`) so the request is recorded even if the scrub later fails. Do NOT remove or weaken the `erased` recording.

## 3. Stale function name in the GDPR design doc
- **Severity**: Low
- **Category**: cleanup
- **File**: docs/GDPR_AND_HIRING_EXTENSIONS.md:33
- **Scenario**: The doc says anonymization "scrub[s] linked profile + analyses PII via `anonymizeProfilePayload`". `grep -rn "anonymizeProfilePayload"` (excl. node_modules + worktrees) returns ZERO hits in code — the real exported function is `anonymizeProfile` (app/_lib/db/profiles.ts:108) which internally calls `scrubPiiFromPayload`. The named symbol does not exist.
- **Root cause**: The helper was renamed (or never named that) after the doc was written; doc not updated.
- **Impact**: A reader searching the codebase for `anonymizeProfilePayload` finds nothing, eroding trust in the doc as a map.
- **Fix sketch**: Replace `anonymizeProfilePayload` with `anonymizeProfile` (+ note it delegates to `scrubPiiFromPayload`).

## 4. Repeated fetch → json → "if (p.error) throw" glue across the two consent/data surfaces
- **Severity**: Low
- **Category**: duplication
- **File**: app/features/sub_pipeline/ConsentPanel.tsx:31-44 and app/data/[token]/page.tsx:32-41
- **Scenario**: Both components hand-roll the identical client pattern: `fetch(url).then(r => r.json()).then(p => { if (p.error) throw new Error(p.error); setView(p) }).catch(...)`. DataPage repeats the same `if (p.error) throw` again in its POST handler (page.tsx:48-50). This is the project's standard JSON-API envelope (`safeJsonError`/`jsonOk`) being unwrapped inline in three places.
- **Root cause**: No shared client fetch helper for the `{ error }` / `jsonOk` envelope, so each consumer re-implements the unwrap.
- **Impact**: Low — small and correct, but the error-detection contract (`p.error`) is duplicated; a future envelope change (e.g. nested `error.message`) must be edited in every copy, and one could drift.
- **Fix sketch**: Extract a tiny `fetchJsonOrThrow<T>(input, init?)` (or `unwrapApi(p)`) helper and use it in both consent surfaces. Optional; only worth it if more such call sites exist.

## 5. Parallel `held` tuple + `heldLabel` lookup map in the erasure page
- **Severity**: Low
- **Category**: structure
- **File**: app/data/[token]/page.tsx:58-65
- **Scenario**: `held = ["cv","contact","answers","interview","scores"]` is declared alongside a separate `heldLabel` Record that re-lists the same five keys mapping each to `t("held.<key>")`. The two lists must be kept in lockstep by hand; the map is only ever read via `heldLabel[h]` inside the `held.map(...)`.
- **Root cause**: The next-intl "no template-literal keys" rule pushes toward explicit literal-key maps, but here the iteration key and the label key are the same string, so the intermediate map is avoidable.
- **Impact**: Minimal — two sources of the same five keys can drift (add a held item to one list, forget the other → silently missing label). Pure tidiness.
- **Fix sketch**: Map directly inside the render, e.g. iterate the tuple and call `t(\`held.${h}\`)` is disallowed by the lint rule, so instead make a single `const HELD = [["cv", t("held.cv")], ...] as const` and map over that one source. Keep the labels translated; do not inline English.
