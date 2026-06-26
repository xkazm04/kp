> Total: 6 findings (0c critical, 2h high, 2m medium, 2l low)

## 1. Two GitHub-username parsers with the same grammar that can drift apart
- **Severity**: High
- **Category**: duplication
- **File**: app/api/github-analysis/route.ts:257 (`parseGithubUsername`), app/_lib/apply-intake.ts:231 (`coerceGithubHandle`)
- **Scenario**: Both functions take a bare handle OR a github.com profile URL, strip a leading `@` and trailing slashes, and accept the username only against the identical grammar `/^[A-Za-z0-9-]{1,39}$/` with the same "no leading/trailing hyphen" rule. I grepped `A-Za-z0-9-]{1,39}` (3 hits: route.ts:262, apply-intake.ts:237, repo-snapshot.ts:48) and read both functions. apply-intake.ts:224-226 literally documents the dependency: "Mirrors the username rules /api/github-analysis enforces." They are already subtly out of sync — the route's URL regex requires `^https?://` (route.ts:260) while `coerceGithubHandle` makes the protocol optional (`(?:https?:\/\/)?`, apply-intake.ts:235). So a handle accepted by the apply step (`github.com/foo`) is rejected by the deep-dive route, the exact "passes here = runnable there" contract the comment claims to uphold.
- **Root cause**: The route grew its own inline parser; the apply-intake handle gate was added later and copied the rules by hand instead of importing a shared helper.
- **Impact**: Two copies of a security-relevant normalizer (it gates a value spliced into a `api.github.com/users/${username}` URL) that are already divergent and will keep drifting; a future grammar tweak (e.g. allowing dots) must be remembered in two places.
- **Fix sketch**: Extract one `parseGithubUsername(input): string | null` into a dependency-free module (e.g. `app/_lib/github-handle.ts`, beside the existing `pipeline-github-handle.test.ts`). Decide one URL rule (protocol-optional is the more lenient, user-friendly choice) and have both `route.ts` and `coerceGithubHandle` call it. Keep the existing tests pointed at the shared symbol.

## 2. `safeLinkUrl` re-implements `safeHttpUrl` on a stale "must be dependency-free" premise
- **Severity**: High
- **Category**: duplication
- **File**: app/_lib/github-summary.ts:43-52 (`_HTTP_SCHEMES` + `safeLinkUrl`), duplicates app/_lib/safe-url.ts:34-45 (`safeHttpUrl`)
- **Scenario**: `safeLinkUrl` parses a URL, allows only `http:`/`https:`, returns `u.href` or `""` — byte-for-byte the same security guard as `safeHttpUrl` (which returns `{ href }` for the same inputs). The inline comment (github-summary.ts:42) justifies the copy as keeping the module "dependency-free (loadable by the strip-only test runner)." I verified that premise is false: `safe-url.ts` has **zero imports** (`grep -n "^import" app/_lib/safe-url.ts` → none) and already has its own colocated `safe-url.test.ts` that runs under the same `node --test` strip-only runner (`test:unit` = `node --test "app/**/*.test.ts"`). So importing it imposes no dependency the runner can't handle.
- **Root cause**: The "inline to stay test-loadable" rule is a real constraint elsewhere in this file (the type-only schemas import), but it was over-applied to a URL guard that has no such constraint.
- **Impact**: Two copies of an XSS-prevention guard (both feed recruiter-rendered `<a href>`). If the allow-list or normalization is hardened in `safe-url.ts`, the github-summary path silently keeps the weaker copy.
- **Fix sketch**: Replace `safeLinkUrl(v)` with `safeHttpUrl(typeof v === "string" ? v : "")?.href ?? ""` importing from `./safe-url`, and delete `_HTTP_SCHEMES` + `safeLinkUrl`. Update the module-header comment that asserts dependency-freeness. The existing github-summary.test.ts "drops dangerous-scheme URLs" case will keep guarding behavior.

## 3. GitHub REST fetch + base64-README decode duplicated between route and repo-snapshot
- **Severity**: Medium
- **Category**: duplication
- **File**: app/api/github-analysis/route.ts:268-288 (`githubFetch`) + 475-484 (`fetchReadme`), parallels app/_lib/repo-snapshot.ts:30-61 (`ghHeaders`/`gh`) + 102-109 (base64 README decode)
- **Scenario**: Both modules build GitHub headers (`Accept: application/vnd.github+json`, optional `Bearer ${GITHUB_TOKEN}`), `fetch(url, { next: { revalidate: 0 } })`, and base64-decode the `/readme` payload with `Buffer.from(content,"base64").toString("utf-8")`. repo-snapshot.ts:2 even says "Mirrors the fetch layer used by /api/github-analysis." I confirmed via `grep "base64\").toString(\"utf-8\")"` (route.ts:481, repo-snapshot.ts:105) and read both header builders.
- **Root cause**: repo-snapshot was written "deliberately self-contained (no sibling imports) so its colocated node --test keeps resolving" (repo-snapshot.ts:5-7) — a legitimate constraint, so this is partly intentional. But the two also differ in ways that look accidental: route auth uses only `GITHUB_TOKEN`, repo-snapshot accepts `GITHUB_TOKEN || GH_TOKEN`; route sends `X-GitHub-Api-Version` + `User-Agent`, repo-snapshot sends neither.
- **Impact**: GitHub fetch behavior (auth env vars, API-version pinning, error handling) lives in two places and is already inconsistent; a token-handling or API-version change must be made twice or one path silently lags.
- **Fix sketch**: This one is lower-confidence because of the deliberate import-free constraint on repo-snapshot. Minimal safe step: align the two header builders (same env vars + headers) and add a short comment cross-linking them. If the test-isolation constraint can be relaxed (the helper is pure and dependency-free, so a shared `github-fetch.ts` would be loadable by `node --test`), extract one `githubFetch`/`ghHeaders` and have both import it.

## 4. `complexitySignals`, `pushedAt`, and `topics` are computed per top-repo but never read
- **Severity**: Medium
- **Category**: dead-code
- **File**: app/api/github-analysis/route.ts:174-175 (and schema app/_lib/schemas.ts:135-137)
- **Scenario**: Each `topRepositories` entry carries `pushedAt`, `topics`, and `complexitySignals: complexitySignals(repo)`. The only renderer, `TopRepositoriesBlock` (GithubAnalysisPanel.tsx:145-189), reads only `name/url/description/primaryLanguage/stars/forks/updatedAt`. `buildGithubEvidenceSummary` (github-summary.ts:68-71) takes only `name`+`url`. I grepped `.pushedAt`/`.complexitySignals`/`.topics` across `app/` — zero consumers of these on the top-repos payload. Note: the `complexitySignals()` function is NOT dead (route.ts:412 uses its length for `complexityAssessment`, which IS displayed); only the per-repo string array attached at line 175 is unused.
- **Root cause**: Fields were added to the payload (and locked into the schema) speculatively for a per-repo "why this repo ranks" UI that was never built.
- **Impact**: Low runtime cost, but it inflates the JSON, makes the schema read as if these surface in the UI, and runs `complexitySignals(repo)` over every top repo for output nobody consumes — cruft that masks intent.
- **Fix sketch**: Either (a) surface them (e.g. render `complexitySignals` as chips in `TopRepositoriesBlock`), or (b) drop `pushedAt`/`topics`/`complexitySignals` from the `topRepositories.map` (route.ts:170-176) and the matching schema fields. Because they are in the validated schema/API contract, prefer (a) or do (b) as a deliberate contract change with the e2e fixture updated in lockstep.

## 5. `safeDate` "Invalid Date" guard reinvented instead of using the existing date helpers
- **Severity**: Low
- **Category**: duplication
- **File**: app/_components/GithubAnalysisPanel.tsx:11-14 (`safeDate`)
- **Scenario**: `safeDate` does `new Date(value); Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString()` — the same "don't render 'Invalid Date'" pattern the repo already centralizes. `grep "Invalid Date|toLocaleDateString"` shows the repo has `timezone.ts` (whose helpers explicitly "never render 'Invalid Date' or throws", timezone.ts:41) and several other ad-hoc `new Date(iso).toLocaleDateString()` sites (HistoryTab.tsx:294, history/[slug]/page.tsx:107) that do NOT guard — so the guarding logic is genuinely scattered.
- **Root cause**: No single "format a possibly-bad ISO date as a short date or em-dash" helper exists, so each component rolls its own (some forget the guard entirely).
- **Impact**: Minor — a one-liner, but it's a copy of an idea the codebase keeps re-deriving inconsistently.
- **Fix sketch**: Add a tiny `formatShortDateOrDash(iso, locale?)` to a shared date util (next to `timezone.ts`) and have `safeDate` and the unguarded call sites use it. Low priority; safe but optional.

## 6. Stale "richer field parsing stays server-side at submit (profile_cli)" comment vs actual flow
- **Severity**: Low
- **Category**: cleanup
- **File**: app/_lib/cv-autofill.ts:7-8
- **Scenario**: The header comment says richer parsing "stays server-side at submit (profile_cli)". `cvAutofill` is consumed once, in app/apply/[id]/ConversationalApply.tsx:367 (confirmed via grep — only that site plus the test). The comment is borderline accurate but reads as a forward-looking note ("years, skills") describing intent rather than current behavior, and references `profile_cli` by name, coupling this otherwise self-contained pure helper's doc to a Python module's identity. This is a documentation-staleness nit, not dead code — the helper itself is fully used and well-tested.
- **Root cause**: Aspirational comment left in place after the helper shipped.
- **Impact**: Negligible; only a maintainer-confusion risk if `profile_cli`'s responsibilities move.
- **Fix sketch**: Trim the comment to describe what the helper does ("conservative email/name only; deeper fields parsed elsewhere at submit") without naming a specific downstream module, or leave as-is. Lowest priority.
