# Scan instructions (shared) — bug-hunter + ui-perfectionist, 2026-07-09

Project: **kp** — a recruiting/hiring SaaS. Next.js 16 App Router + TypeScript/React,
a Python `pipeline/jobfit` AI matching/extraction engine, SQLite via better-sqlite3,
Polar billing, next-intl i18n (en/cs/de/fr). Project root: `C:/Users/kazda/kiro/kp`.

You are auditing **one context** (a coherent feature/module). Find the highest-value
problems through your assigned lens(es) and write one structured findings report.

**Read-only. Do NOT modify any project file** except your own report under the output dir.

## Procedure

1. Read your role file(s) — you are told which lens(es) apply:
   - `docs/harness/bug-ui-scan-2026-07-09/_role-bug-hunter.md`
   - `docs/harness/bug-ui-scan-2026-07-09/_role-ui-perfectionist.md`
   If your lens is `both`, wear both hats and mark each finding's `Lens:` accordingly.
2. Read `docs/harness/bug-ui-scan-2026-07-09/_manifest.json`, find the entry whose `name`
   matches YOUR context name. Use its `files`, `description`, `apiRoutes`, `dbTables`.
3. **Read the prior report** at the `priorReport` path in your manifest entry, if non-null.
   That is the 2026-06-20 scan of this same context with the same lenses. Most of its
   Criticals and many Highs have since been fixed on `main` (186 commits landed).
4. Read the listed files under the project root. If there are many (>25), prioritize entry
   points, route handlers, data writes, auth/money/external-call paths, and the largest
   components; sample the rest. **Ground every finding in real code you actually read —
   never invent, never infer from a filename.**
5. Produce **exactly 5 findings**, ranked by severity, best-first.

## De-duplication (IMPORTANT — this scan follows three prior scans)

kp has been scanned before: `bug-ui-scan-2026-06-20` (same lenses, 300 findings),
`triscan-2026-06-18`, and `ambiguity-biz-2026-06-25`. Their fixes largely landed on `main`.
Your value is in what is **new or still genuinely open**, not in re-reporting closed work.

Therefore:
- Before writing a finding, check it against the prior report for your context (step 3).
- If the prior report already describes it **and the code shows it is now fixed** → skip it.
- If the prior report describes it **and you verify in the current code it is STILL present**
  → you may report it, but prefix the title with `[STILL-OPEN]` and say in one line why it
  still matters. Do this sparingly — at most 1 of your 5.
- Prefer findings in code that changed recently or was never covered before. Three contexts
  (**Organizations, Members & Invites**; **Branding & White-label**; **ATS Integration &
  Egress**) have `priorReport: null` — they have never been scanned. Scan them fresh and hard.

## Known-hardened facts (do NOT re-report these as findings)

These were fixed in prior runs and are confirmed on `main`:
- The auth gate is **`proxy.ts` at the repo root**, not `middleware.ts` (Next 16 renamed it).
  A "no middleware.ts ⇒ no auth" finding is wrong.
- `isOperator()` already rejects the DEMO workspace; `/api/demo` minting is opt-in.
- `ensureDb()` memoizes on `globalThis.__kpDb` (HMR-safe).
- Archetype `weights` are fail-fast validated at `registry.py` import.
- Multi-tenancy is **deliberately half-built** and gated by `KP_MULTI_WORKSPACE` +
  `assertTenancyReady()` (see `app/_lib/tenancy.ts`). "Table X lacks workspace_id" is a known
  architectural gap, already tracked — only report a tenancy finding if it defeats that gate.
- `.ts`-extension relative imports are the repo convention (`allowImportingTsExtensions`).
  Not a bug.
- Dev Studio (`sub_dev`) is intentionally English-only — missing i18n there is not a finding.

## Repo gotchas that affect your reading

- The built-in **Grep tool has returned empty in this repo** in past runs. Use Bash
  `grep -rn` / `rg` instead if a content search comes back suspiciously empty.
- A pure `app/_lib/*.ts` module with a colocated `node --test` must stay import-light.
- i18n keys live in `messages/{en,cs,de,fr}.json`; `scripts/i18n-check.mjs` enforces parity.

## Output

Write ONE markdown file to `docs/harness/bug-ui-scan-2026-07-09/<slug>.md`
(use the `slug` from your manifest entry). Use EXACTLY this structure — the INDEX is built
by parsing it, so the `> Total:` line and the `- **Severity**:` bullets must be exact:

```
# <Context name> — bug-hunter + ui-perfectionist scan

> Context: <one-line description>
> Files reviewed: <N> of <M>
> Total: 5

## 1. <Short imperative title>

- **Severity**: Critical | High | Medium | Low
- **Lens**: bug-hunter | ui-perfectionist
- **Category**: <race-condition | silent-failure | edge-case | state-corruption | validation-gap |
  a11y | visual-consistency | missing-ui-state | component-architecture | responsiveness | ...>
- **File**: `path/to/file.ts:120-134`
- **Scenario**: <the exact reproduction: "If a user does X while Y is happening...">
- **Root cause**: <the design assumption that fails, not just the failing line>
- **Impact**: <crash / data loss / silent wrong result / UX degradation / security>
- **Fix sketch**: <2-4 lines: what to change, and how to make this CLASS of bug impossible>

## 2. ...
```

Severity bar — be honest, do not inflate:
- **Critical**: data loss/corruption, security breach, money error, or a crash on a common path.
- **High**: silently wrong results, a broken core flow, or a real reachable failure.
- **Medium**: degraded UX, a11y gap, an edge case with a workaround.
- **Low**: polish, consistency, minor cleanup.

A clean context is allowed to return Mediums and Lows. **Do not pad to hit severity.**

## Reply to the orchestrator (under 150 words)

Reply with: the slug you wrote, `Total: 5`, the severity breakdown (e.g. `1C/2H/1M/1L`),
the lens split, a one-line summary of your most severe finding, and the approximate number
of files you read. Nothing else — do not paste the report body.
