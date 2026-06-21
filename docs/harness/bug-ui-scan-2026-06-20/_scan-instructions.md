# Scan instructions (shared)

Project: **kp** — a recruiting/hiring SaaS (Next.js App Router + TypeScript/React frontend,
plus a Python `pipeline/jobfit` AI matching/extraction engine, SQLite via better-sqlite3,
Polar billing, i18n). Project root: `C:/Users/kazda/kiro/kp`.

You are auditing **one context** (a coherent feature/module). Your job: find the highest-value
problems through the lens defined in your role file, and write a structured findings report.

## Procedure
1. Read your role file (passed to you) for the lens to apply.
2. Read `docs/harness/bug-ui-scan-2026-06-20/_manifest.json`, find the entry whose `name`
   matches YOUR context name (given in your task). Use its `files`, `description`, `apiRoutes`.
3. Read the listed files under the project root. If there are many (>25), read the most
   important first (entry points, route handlers, the largest components, anything touching
   data writes / auth / money / external calls), and sample the rest. Read enough to ground
   every finding in real code — never invent.
4. Produce **5–8 findings** ranked by severity (more only if the context is genuinely rich;
   fewer if it's small/clean — quality over quantity, no padding).

## Output: write a single markdown file to
`docs/harness/bug-ui-scan-2026-06-20/<slug>.md` (use the `slug` from your manifest entry).

Use EXACTLY this structure so the findings can be parsed and counted:

```
# <Context name> — <Bug Hunter | UI Perfectionist> scan

> Context: <one-line description>
> Files reviewed: <N> of <M>
> Total: <T> findings — Critical: <c>, High: <h>, Medium: <m>, Low: <l>

## 1. <Short imperative title>
- **Severity**: Critical | High | Medium | Low
- **Category**: <e.g. race-condition | auth-gap | silent-failure | missing-empty-state | a11y | component-extraction | …>
- **File**: `relative/path.ts:LINE` (and other files if relevant)
- **Scenario**: <concrete trigger — "when a user does X while Y…">
- **Root cause**: <the underlying design assumption / omission>
- **Impact**: <what breaks for the user / system / business>
- **Fix sketch**: <2–4 lines of concrete remediation guidance>

## 2. <next finding>
...
```

Rules:
- Every finding MUST have a real `File:` with a line number you actually saw.
- One `## N. Title` heading per finding, numbered sequentially from 1.
- The `Total:` header counts must match the number of `## N.` headings and the per-severity tally.
- Be specific and reproducible. Severity reflects real-world blast radius, not novelty.

## Reply to the orchestrator (NOT the file) — keep under 150 words:
- the `slug` filename you wrote
- total findings + severity breakdown (e.g. `2C / 3H / 2M / 1L`)
- a one-line summary of the single most critical finding
- approx number of files you read

Do NOT modify any source code. This is a read-only audit. Only write your one report file.
