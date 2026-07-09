# Privacy, Consent & Provenance — bug-hunter + ui-perfectionist scan

> Context: GDPR consent capture/gating, AI-usage disclosure, candidate self-service erasure, and the provenance dossier recording how each data point was derived.
> Files reviewed: 10 of 14 (plus supporting: db/pipeline.ts, db/interviews.ts, db/analyses.ts, db/channels.ts, comms.ts, api/interview/by-entry, messages/en.json, GDPR doc)
> Total: 5

## 1. Erasure never reaches interview transcripts or comms — the most sensitive PII survives Art. 17

- **Severity**: Critical
- **Lens**: bug-hunter
- **Category**: retention-deletion-correctness / right-to-erasure
- **File**: `app/_lib/db/pipeline.ts:1070-1123` (`anonymizeEntry`); `app/_lib/db/interviews.ts` (`latestInterviewByEntry` / `transcript_json`, `revokeInterviewLinks:~244`); `app/_lib/comms.ts:41,64`; `app/api/interview/by-entry/route.ts:14`; promise in `messages/en.json:753,758`
- **Scenario**: A candidate does a voice interview (its `transcript_json` — their own verbatim spoken answers — is stored on `interview_sessions`, keyed by `entry_id`) and receives templated emails (each `comms`/outbox row keeps `recipient` = their email + a personalized `body`). They then click "erase my data" on `/data/[token]`. `anonymizeEntry` scrubs only `pipeline_entries`, `pipeline_events`, the linked profile, and `analyses`. It never touches `interview_sessions` or the outbox, so the full transcript stays readable via `GET /api/interview/by-entry?entry=<id>` and the emailed PII persists. `revokeInterviewLinks` even documents that it "never touches completed — the transcript is evidence."
- **Root cause**: The erasure scope was enumerated table-by-table (`GDPR_AND_HIRING_EXTENSIONS.md:33` lists profile + analyses; "keep scorecards") and the raw transcript + comms surfaces were simply never added. The prior scan's Critical #1 (analyses un-scrubbed) was fixed for `analyses` alone; the same class remains open for every other PII-bearing table.
- **Impact**: A GDPR-erased candidate's recorded interview answers and email remain in the DB and on internal APIs — a reportable retention breach. Worse, `/data` affirmatively tells the subject "We'll permanently remove your … interview records" (`en.json:758`) and lists "Any interview records and notes" as held (`:753`): a compliance-grade false statement.
- **Fix sketch**: Make erasure enumerate every entry-linked PII table from one registry — scrub/blank `interview_sessions.transcript_json` (+ scorecard free-text) and null `comms.recipient`/redact `body` inside the same `anonymizeEntry` transaction. Add a test asserting no entry-linked table holds PII after erasure, so a new table can't silently opt out.

## 2. Erasure joins analyses by raw `candidate_label` — misses on casing drift, over-scrubs namesakes

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: state-corruption / retention-correctness
- **File**: `app/_lib/db/pipeline.ts:1099-1101` (`WHERE candidate_label = ?`, raw) vs `app/_lib/db/pipeline.ts:662-668` (`LOWER(TRIM(candidate_label)) = ?`, the canonical link)
- **Scenario**: `anonymizeEntry` scrubs linked analyses with an exact, case- and whitespace-sensitive `WHERE candidate_label = ?` on the un-normalized label — but the app's own candidate↔entry linkage (`findActiveEntriesByCandidateLabel`) matches on `LOWER(TRIM(...))`. (a) An analysis saved as `"jan novák "` (padded/lowercased at a different intake) won't equal the entry's `"Jan Novák"`, so its full CV `payload_json` survives erasure — a silent scrub MISS. (b) Two real people sharing a label (common in the Czech seed corpus) share the exact raw string, so erasing one scrubs the OTHER's analyses too, workspace-blind — silent destruction of a non-consenting record.
- **Root cause**: `candidate_label` is a non-unique, non-normalized display string used as an erasure join key; the two code paths disagree on normalization. The comment calls over-scrubbing "the safe direction," but that conflates *this* subject's data with a stranger's.
- **Impact**: Erasure both under-deletes (PII survives on a casing mismatch) and over-deletes (wipes a namesake's valid analysis). Both are invisible — the audit logs `erased` regardless.
- **Fix sketch**: Give `analyses` a real `entry_id`/`candidate_id` FK stamped at save time and scrub by that; until then, at minimum normalize both sides identically (`LOWER(TRIM(...))`) and scope the scrub to the entry's workspace so a cross-tenant namesake is never touched.

## 3. Consent TTL expiry is computed but enforced only by a deferred sweep — never at read time

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: consent-enforcement-gap
- **File**: `app/_lib/consent.ts:53-62` (`consentStatus` → `"expired"`); `app/api/pipeline/[id]/consent/route.ts:23-26`; enforcement lives only in `app/_lib/db/pipeline.ts:1130-1149` (`anonymizeExpiredConsents` sweep)
- **Scenario**: The moment a consent passes `consent_expires_at`, `consentStatus` returns `"expired"`, but nothing consults that at a read boundary. The candidate drawer, transcript modal, and `/api/analyses/[slug]` all keep serving the full CV/analysis PII until the *next* run of the periodic sweep — and the sibling Tasks finding notes the sweep silently stops if the heartbeat clock dies. So an expired-consent candidate's PII stays fully displayed and processable for an unbounded window, with no read-time gate that fails closed.
- **Root cause**: Expiry enforcement was implemented as a background reclaim job, not as a precondition. The lawful-basis check exists (`consentStatus`) but is used only for chips/labels, not to withhold PII or block processing when it reads `"expired"`.
- **Impact**: Retention/processing of PII past its consent ceiling whenever the sweep lags or is stalled — the exact guarantee the TTL exists to provide, deferred to a best-effort job.
- **Fix sketch**: Gate the PII-bearing read paths on `consentStatus` (treat `"expired"`/`"anonymized"` as no-PII, serving only the de-identified record) so enforcement is synchronous and independent of the sweep, which then becomes an optimization rather than the sole control.

## 4. `/data` erasure failure collapses the whole page to a bare error with no retry

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: missing-ui-state / error-handling UX
- **File**: `app/data/[token]/DataClient.tsx:73-86` (error short-circuits the entire render), `:43-56` (`erase` sets `error`, no reset)
- **Scenario**: The subject clicks "Erase my data"; the POST fails transiently (network blip, `SQLITE_BUSY`). `erase()` calls `setError(t("eraseFailed"))`, and because the top-level render is `{error ? <bare <p>> : !view ? … : …}`, the page discards everything — role, company, the "what we hold" list, and the erase button — and shows only a one-line error. `error` is never cleared, so there is no in-page retry: the only recovery is a full reload, and the candidate can't tell whether their erasure partially applied.
- **Root cause**: `error` is treated as a terminal, page-level state rather than a dismissible inline alert on the erase action; the initial-load error and the action error share one flag and one all-or-nothing branch.
- **Impact**: A GDPR self-service action a candidate is legally entitled to complete dead-ends on any transient failure, with no retry and ambiguous outcome — poor trust on exactly the page where trust matters most.
- **Fix sketch**: Split load-error from action-error; render the action error as an inline alert beside the (re-enabled) erase button so the subject can retry without losing context, and keep the surrounding page intact.

## 5. `/data` over-claims held data and its terminal states have no page heading

- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: visual-consistency / a11y
- **File**: `app/data/[token]/DataClient.tsx:58-65` (static `held` list), `:67-101` (headings)
- **Scenario**: The "what we hold" list is a hardcoded five-item array, so every candidate is told we hold their "interview records and notes" and "assessment scores" even if they only applied and were never interviewed or scored — an over-statement on a transparency surface. Separately, the `<main>` renders its `<h1>` only in the active branch; the loading, error, and erased/anonymized states render with no `h1` at all, so a screen-reader user landing on a terminal state gets a headingless page (weak landmark/hierarchy).
- **Root cause**: The held list is decoupled from what the token projection actually reports (the GET already knows `anonymized`; it could report which categories exist), and the heading lives inside one conditional branch instead of at the page root.
- **Impact**: Minor transparency inaccuracy plus an a11y gap on the erased/error/loading views; no data risk.
- **Fix sketch**: Drive the held list from the API projection (only list categories that exist), and hoist a stable `<h1>`/eyebrow above the state branches so every state has a heading.
