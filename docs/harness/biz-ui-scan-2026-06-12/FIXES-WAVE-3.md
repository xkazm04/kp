# Biz+UI Fix Wave 3 — Real corpus, real data (intake & matching correctness)

> 6 commits, **6 findings closed** (all High).
> Baseline preserved: tsc 0 → 0, unit 719 → 729 (+10 new tests), python 511 → 523 OK (+12 new), `next build` ✓, i18n parity 1879 keys.
> First wave executed via implementation subagents (batch A parallel on disjoint files, batch B staggered over the shared message catalogs); the orchestrator verified gates and committed each scope atomically.

## Commits

| # | Commit | Finding closed | Files |
|---|--------|----------------|-------|
| 1 | `1d04002` | cv-analysis-workspace #1 — JD-blind runs tagged with the JD | sub_analyze (4 files), messages |
| 2 | `267de74` | job-catalog-sourcing #1 — fabricated salary | jobs.py, campaign.py, jobMarkdown.ts, db.ts, ingest-job.ts, +7 golden tests |
| 3 | `6541a03` | matching-fit-matrix #1 — Match/reasoning see only the demo corpus | _cli.py (shared load_jobs_arg), match_cli, reasoning_cli, match route, reasoning-run, reasoning-cache-key(+test), +5 CLI tests |
| 4 | `16b72a4` | jd-library-builder #1 — public JD page PII leak | jds/[slug] page, db.ts, jds API (+new analyses endpoint), LibraryTab, messages |
| 5 | `008fed6` | job-catalog-sourcing #2 — lifecycle invisible, dead apply links | db.ts, jobs API, sub_jobs (6 files), messages |
| 6 | `a8eebaa` | conversational-apply #1 — quick-apply identity loss | db.ts (lead_token), lead-intake, apply-intake(+9 tests), apply pages/routes, messages |

## What was fixed (grouped by sub-pattern)

1. **The ranking lies stopped** (`6541a03`, `267de74`, `1d04002`) — three ways the product asserted data it didn't have. The Match tab and "Explain fit" ranked against the static seed corpus only, so a recruiter's own published role never appeared at any rank while the Fit Matrix scored it happily — both CLIs now augment the corpus with live DB jobs (shared `load_jobs_arg`, DB wins on id collision, matrix/rematch precedent) and the reasoning cache gains a corpus-fingerprint axis. Ingested ads advertised a salary the employer never stated — the taxonomy anchor band, unmarked as defaulted — now stated pay is extracted, the anchor fallback is provenance-marked (`defaulted_fields`), campaign facts are stated-only (WARN_NO_SALARY finally fires), and postings label estimates as estimates. And a failed saved-JD body fetch silently shipped a JD-blind score persisted under the JD's slug — the picker now clears + errors, and submit blocks the inconsistent state.

2. **Public surfaces stopped leaking and lying** (`16b72a4`, `008fed6`) — the candidate-facing JD page rendered every analyzed applicant's real name + score (GDPR-grade; relocated to a lazy-loaded recruiter-side Library section with a new scoped read endpoint). Role lifecycle state finally reaches the UI: status badges on catalog rows + the posting modal, draft modals swap dead 404 apply links for the publish action, closed roles disable their links, an "open only" filter, and the unthemeable `window.confirm` replaced with the shared Modal.

3. **The enrichment hand-off knows the lead** (`a8eebaa`) — the E2 loop's conversion point greeted returning leads as strangers and could fork duplicates on an email typo. Lead entries mint an opaque token (fill-only column) recording explicitly-passed KO gates; it rides the ack email + success CTA, prefills the chat (skipping exactly the recorded gates — unasked gates are asked, never assumed), and targets the merge directly with email identity as fallback. Invalid tokens degrade silently.

## Verification table

| Gate | Before wave | After wave |
|------|------------|-----------|
| tsc --noEmit | 0 errors | 0 errors |
| node --test unit | 719/719 | 729/729 (+10) |
| python unittest | 511 OK | 523 OK (+12), 4 skipped |
| next build | ✓ | ✓ |
| i18n parity | 1866 keys | 1879 keys (en=cs) |

## Cumulative status (scan 2026-06-12)

**19 / 108 findings closed (14 / 32 Highs)** across waves 1–3, 19 fix commits, 0 regressions.

## Patterns established (catalogue additions, items 34–37)

34. **Corpus injection over corpus forking** — any CLI that scores against "the jobs" must take `--jobs-json` overriding the seed corpus (id collision: DB wins); any TS spawner must write the live corpus to the workdir and fingerprint it into cache keys. Grep `load_corpus(` when adding scoring CLIs.
35. **Defaulted facts carry provenance or don't ship** — a derived/estimated value (anchor salary band) must land in `defaulted_fields` and candidate-facing surfaces must route such facts through a stated-only filter. The honesty contract is only as good as its narrowest writer.
36. **Public pages get an audience split before they get features** — when a recruiter surface becomes candidate-faced (apply CTA, shared links), every panel on it must re-justify itself for the new audience; relocation beats auth for invited-visitor pages.
37. **Identity tokens, not retyped identity** — when a flow hands off between surfaces (quick → full apply), mint an opaque CSPRNG token on the durable record and thread it; deriving identity from re-typed fields forks duplicates. Record only explicitly-verified state on the token (provided-only), never assumed state.

## What remains

Wave 4 (suggested next): **D — close the loop** (7 Highs): jd_build rehydrate, prep regenerate desync, human-verdict Schedule visibility, voice-interview ending + revoke-mid-call, persistent recruiter notes, archetype routing.
