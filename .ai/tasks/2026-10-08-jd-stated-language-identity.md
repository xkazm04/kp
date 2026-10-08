# JD authoring: stated languages by identity (lite r2 rework)

**Must-address (ai-assisted-jd-authoring lite r2, head 733cd8838, 0.7479):** "value: A language the
author stated can be silently dropped from the role, and the Ledger cannot show it."

**Cause:** `statedLanguages` kept a model language only on a contiguous token match against the
author's input. 'Znalost češtiny' + 'Čeština', 'angličtina nutná' + 'English' and an English need built
with lang cs + 'Angličtina' all returned `[]`, so no `ko_lang` step. The reverse over-trust:
'No English needed' + 'English' kept the language, i.e. an automatic knockout (ADR 0019).

## What changed
- `app/_lib/jd-languages.ts` (+ test): lexicon of 11 languages (cs sk en de pl fr es it ru uk hu), every
  form -> one id; Czech adjective only beside "jazyk"; `languageMentions` splits clauses and applies
  negation cues (no, not, without, neither, nor, bez, není, nevyžadujeme, nepotřebujeme, nemusí).
- `jd-role-trace.ts`: `ROLE_TRACE_RULE = overlap-v1+lang-v1`; `statedLanguages` and the `languages` trace
  lines use identity; unknown names fall back to overlap-v1; brief still wins; `droppedLanguages()` and
  `RoleTrace.droppedLanguages` (reason unstated / negated / superseded). Header comment rewritten.
- `jd-build-run.ts`: persists dropped languages in `roleTrace`; `runJdBuild` takes an optional 5th
  argument (test seam for the two spawned design steps; production never passes it).
- Ledger: `readRoleTrace` parses `droppedLanguages` (old rows -> `[]`); `RoleTraceCard` lists them;
  4 new `library.tab.roleTraceDropped*` keys in all four catalogs.
- Tests: jd-languages.test.ts, jd-role-trace.test.ts, jd-language-chain.test.ts (runJdBuild -> ingest ->
  buildApplyScript), jdsLedgerArtifacts.test.ts.

## Known over-trust, pinned
'experience with the Czech market' states Czech; a bare "česky"/"anglicky" is read as the adverb;
'not only English but also German' negates English.

## Not done (out of scope)
`apply.ts`, `ingest-job.ts`, `intake-brief.ts`, `pipeline/jobfit/source.py` untouched.
