# Feature Scout #2 — Fix Wave 2: "GitHub becomes a first-class signal" (Theme B)

> 5 commits, 7 findings closed (4 High + 2 Medium from Theme B, + the CV1 High enabler from the CV-analysis re-scan).
> Baseline preserved: tsc 0 → 0 · next build ✓ · unit 642 → **646** (+4 coercer tests) · python 500 OK → 500 OK · eslint clean on all 20 changed files.

One mental model: the GitHub deep-dive was a rich, paid, validated artifact that existed only
as transient client state — persisted nowhere, integrated with nothing, gated behind an
unrelated CV upload. One persistence decision (GH1) plus one shape authority
(`github-summary.ts`) unlocked history, the pipeline, the dev-case bridge and recovery.

## Commits

| # | Commit | Finding | Value | Files |
|---|---|---|---|---|
| 1 | `c72c0e6` | GH1+RES1 (duplicate pair) — persist deep-dive with the saved analysis, + CV1 slug enabler | High×2 (+High enabler) | 5 (+144/−9) |
| 2 | `a199604` | GH3 — GitHub-only deep-dive (no CV required) | High | 5 (+38/−8) |
| 3 | `2dafa1e` | GH2 — attach assessment to the pipeline entry | High | 12 (+300/−9) |
| 4 | `fdd52d1` | GH5 — TTL cache + panel retry | Medium | 5 (+103/−33) |
| 5 | `ffb031c` | GH4 — one-click submitter assessment from a dev-case | Medium | 2 (+94/−3) |

## What was fixed

1. **GH1+RES1 — the deep-dive survives the tab.** `analyses.github_json` (idempotent ALTER)
   stores the validated payload, attached via a PATCH `/api/analyses/[slug]` extension
   (schema-validated, 413 over 256KB; disposition semantics untouched). **CV1 enabler:**
   `analysisSchema` now declares the `persistence {slug, createdAt}` receipt analyze-run has
   always attached server-side — zod was silently stripping it client-side (the documented
   CV1 deferral, solved exactly via the `comparison` `.extend` precedent). The form PATCHes
   when receipt + done result both exist (order-agnostic, per-slug guard), restores the
   persisted dive after a refresh-resume, and the history page revives it defensively.

2. **GH3 — paste a handle, get an assessment.** `submit()` hard-required a CV the deep-dive
   route never needed. A filled GitHub profile alone now runs the dive standalone (no server
   task, no stage strip), with the panel rendering alone in the result area. Pure client
   form-gating; en+cs helper copy.

3. **GH2 — evidence reaches the decision surfaces.** New pure module
   `app/_lib/github-summary.ts` is the single shape authority for a compact, bounded
   evidence summary: `build()` client-side at add-to-pipeline, `coerce()` (hand-rolled,
   repo convention) at BOTH the POST boundary (400 on malformed — drift, not input) and the
   DB read boundary (corrupt column → null, never a blob on the board payload). Stored in
   `pipeline_entries.github_json`; re-adds backfill empty, never overwrite. The drawer shows
   evidenced/unverified/hidden skills + top repos beside the interview outcomes, with an
   explicit "public signals, not inspected source" note (en+cs).

4. **GH5 — rate limits stop cascading.** In-process 15-min TTL cache keyed
   `sha1(lc(username) + JD)` (matrix-route precedent; errors never cached; 20-entry LRU-ish
   eviction). The dive launch extracted to `launchGithubRun()` → `handlers.retryGithub`, and
   the panel error state gained "Retry GitHub analysis" on both mounts.

5. **GH4 — the take-home and the profile join up.** `parseRepoRef(repoRef).owner` IS the
   submitter's username; SubmissionRow's "Author's GitHub" toggle assesses it against the
   case's role spec flattened to JD text, rendered in the existing panel with GH5's retry.

## Verification

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| `next build` | ✓ | ✓ |
| `npm run test:unit` | 642 | **646** (+4 github-summary coercer tests) |
| `npm run test:python` | 500 OK (4 skip) | 500 OK (4 skip) |
| eslint (changed files) | clean | clean |

## Patterns established (catalogue items 5–7)

5. **A dropped wire-field is found at the zod boundary, not the producer.** analyze-run had
   attached `persistence` for months; the client schema's silent unknown-key stripping was
   the bug surface. When a server-attached field "doesn't arrive", check the client parse
   schema before the producer.
6. **One shape authority per cross-boundary payload.** `github-summary.ts` exports build +
   coerce; the POST boundary and the DB read boundary both call the SAME coercer, so the
   stored shape can't drift from the accepted shape. Reject loudly (400) when the only
   producer is first-party — a mismatch is drift, not user input.
7. **Cache the expensive read at the route, retry the failure at the panel.** For
   fan-out-priced external APIs (31 REST calls/run), the TTL cache prevents the re-run
   burn and the panel-level retry prevents the whole-pipeline re-run; they compose (retry
   hits the cache when the first run actually succeeded).

## What remains

Theme B is complete (GH6 repo-link verification, Low, stays open). CV1's UI half (live
Analyze-tab add-to-pipeline button + stable report link) is now UNBLOCKED by the schema
enabler — the receipt is on the client; only the surfacing remains. Next per the INDEX:
**Wave 3/4 (i18n completion)** or **Wave 5 (dev-case deliverability)** / **Wave 7
(automation trust)** depending on appetite.
