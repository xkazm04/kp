# GitHub Code Analysis — UI+Bug combined scan
> Total: 4 findings (1 crit / 1 high / 1 med / 1 low)
> Group: Candidate-Facing Experiences | Lens mix: 3 bug / 1 ui | Files read: 4 (+3 peeked: devcase-run.ts, schemas.ts)

## 1. `parseRepoRef` accepts traversal segments → confused-deputy fetch against the GitHub API with the server token attached
- **Severity**: Critical
- **Lens**: 🐛 Bug Hunter
- **Category**: SSRF / path traversal / input validation at trust boundary
- **File**: `app/_lib/repo-snapshot.ts:33-38` (and the interpolations at `:56-59`, `:102-104`, `:159-160`, `:173`)
- **Scenario**: The repo ref is user-supplied. `runNeedAnalysis` (`app/_lib/devcase-run.ts:59-62`) forwards `need.codebaseRefs[].ref` straight into `buildRepoSnapshot(r.ref)` → `parseRepoRef`. The `owner/repo` branch of the regex, `/^([^/\s]+)\/([^/\s]+)$/`, allows `.` and `%` in both capture groups, so `"x/.."` parses to `{owner:"x", repo:".."}` and a ref of `kind:"github"` skips even the `github.com` host filter (`devcase-run.ts:60`). The captured parts are then interpolated **unencoded** into ``${GH}/repos/${owner}/${repo}/languages``. URL normalization collapses the traversal: `https://api.github.com/repos/x/../../user/repos` → `https://api.github.com/user/repos`. Encoded dots (`%2e%2e/%2e%2e`) pass through verbatim and normalize the same way. (Verified live with Node `new URL()`.)
- **Root cause**: No allow-list validation of `owner`/`repo` (GitHub names are `[A-Za-z0-9-._]`, owner ≤39 chars) and no `encodeURIComponent` on the path segments. Contrast the route, which does both correctly (`route.ts:105-108,217`).
- **Impact**: A crafted ref redirects the fetch to a *different* GitHub API endpoint that the server reaches with its `GITHUB_TOKEN`/`GH_TOKEN` Authorization header (`repo-snapshot.ts:26-31`). E.g. `x/../../user/...` hits token-owner endpoints (potentially private-repo data) rather than the named candidate repo — a confused-deputy. Host is hardcoded to `api.github.com` so it is not full off-host SSRF, but it IS unauthorized cross-endpoint access with privileged credentials, plus query-string injection (`a/b%3ftoken=x`).
- **Fix sketch**: After `parseRepoRef`, reject anything not matching GitHub's name grammar (`/^[A-Za-z0-9-]{1,39}$/` for owner, `/^[\w.-]{1,100}$/` for repo, reject `.`/`..`), and `encodeURIComponent` each segment at every interpolation site. Apply identically in `buildRepoSnapshot`, `fetchCommitTrace`, and `fetchRepoSignals`.

## 2. Deep-review evidence silently empties under partial fetch failure → LLM produces a confident assessment on no data
- **Severity**: High
- **Lens**: 🐛 Bug Hunter
- **Category**: silent failure / degraded result on a common path (rate limits)
- **File**: `app/api/github-analysis/route.ts:403-428` (`fetchRepoBundle`) feeding `runCodeReview:495-538`
- **Scenario**: The deep review fans out 3 repos × 3 calls (readme/commits/contents) = 9 GitHub calls, on top of the up-to-22 calls already made (user, repos, 20 language maps). Unauthenticated this blows past the 60/hr anonymous limit routinely. Each sub-fetch swallows failure to a benign default (`.catch(() => "")` / `.catch(() => [])`, lines 405/408/411). So a rate-limited or 5xx repo yields a bundle with empty README, no commits, no files — but `bundles = await Promise.all(...)` still *succeeds*, so the code skips the `status:"error"` branch (`:498-509`) and sends near-empty `evidenceJson` to Gemini, which returns a plausible-sounding `summary`/`confirmedSkills` rendered as `status:"ok"` evidence.
- **Root cause**: Per-call `.catch` defaults make a wholesale evidence-collection failure indistinguishable from a genuinely sparse repo. No "did we actually get any signal?" check before trusting the LLM output.
- **Impact**: A hiring-facing "Evidenced Skills / Hidden Strengths" panel can be fabricated from empty input during a rate-limit window, with no warning to the recruiter — worse than an honest error because it looks authoritative.
- **Fix sketch**: Have `fetchRepoBundle` track whether each sub-fetch threw vs. returned genuinely empty; if every bundle is empty (no readme + no commits + no files across all repos), return `status:"error"` (or a new `status:"insufficient_evidence"`) instead of calling Gemini. At minimum, count fetch failures and surface them in `error`/`evidenceBasis`.

## 3. `topRepositories` date can render "Invalid Date" and the loading bar is not exposed to assistive tech
- **Severity**: Medium
- **Lens**: 🎨 UI Perfectionist
- **Category**: missing/invalid state + accessibility
- **File**: `app/_components/GithubAnalysisPanel.tsx:158` and `:40-44`
- **Scenario (a)**: `{new Date(repo.updatedAt).toLocaleDateString()}` — the schema only guarantees `updatedAt: z.string()` (`schemas.ts:128`), so an empty or non-ISO string renders the literal text `Invalid Date` in the candidate card with no guard. **(b)**: The indeterminate progress bar (`<div className="h-1 ... bg-stone-200"><div className="w-2/3 animate-pulse bg-coral"/>`) has no `role="progressbar"` / `aria-busy` / `aria-label`, and the "In process" chip relies on a spinning icon only — screen-reader users get no announced loading state for an operation that can take up to `maxDuration = 60s` (`route.ts:15`).
- **Root cause**: Date is formatted without validity check; the loading affordance is purely visual.
- **Impact**: A malformed/empty timestamp degrades a polished card to "Invalid Date"; the long-running analysis is invisible to AT users, who may assume it hung.
- **Fix sketch**: Guard the date (`const d = new Date(repo.updatedAt); Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString()`). Add `role="progressbar" aria-busy="true" aria-label="Analyzing GitHub profile"` (or an `aria-live="polite"` status node) to the loading region.

## 4. `repos`/`user` responses are trusted as the declared type without a runtime array/shape guard
- **Severity**: Low
- **Lens**: 🐛 Bug Hunter
- **Category**: validation gap at external-data boundary
- **File**: `app/api/github-analysis/route.ts:106-109` (and `:223-243` `githubFetch`)
- **Scenario**: `githubFetch<GithubRepo[]>(...)` returns `response.json()` cast to the generic with no runtime check. GitHub can return a 200 body that is an object rather than an array (e.g. some abuse/secondary-rate-limit responses, or a future API shape change). `repos.filter(...)` at `:109` would then throw `repos.filter is not a function`.
- **Root cause**: Trust-the-cast deserialization; only HTTP status is validated, not the JSON shape.
- **Impact**: Low in practice — the throw is caught by the outer `try/catch` (`:194-209`) and surfaced as a graceful `200 + {error}` the panel renders. So no crash leaks to the user, but the error message ("repos.filter is not a function") is opaite/unhelpful and the failure mode is undetectable.
- **Fix sketch**: Validate with a lightweight runtime check (`Array.isArray(repos)`) or a small zod array schema right after fetch, throwing a clear "Unexpected GitHub response shape" message so logs/UI are actionable.
