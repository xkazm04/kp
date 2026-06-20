# GitHub Evidence & CV Utilities — Bug Hunter scan

> Context: Pull GitHub repo evidence into a candidate analysis and auto-fill / vary CV-derived profile fields; backs the GitHub analysis panel and CV provenance helpers.
> Files reviewed: 11 of 11 (plus schemas.ts, repo-activity.ts, runAnalysis.ts, apply route, ConversationalApply for call-site grounding)
> Total: 7 findings — Critical: 0, High: 3, Medium: 2, Low: 2

## 1. `/api/github-analysis` is an unauthenticated, un-rate-limited request amplifier
- **Severity**: High
- **Category**: auth-gap / resource-abuse / cost-abuse
- **File**: `app/api/github-analysis/route.ts:109` (POST handler), contrast `app/api/apply/[id]/route.ts:27` which imports `rateLimit`/`clientIpFrom`
- **Scenario**: An anonymous client scripts `POST /api/github-analysis` with `{ profile: "<any username>", jobDescriptionText: "<random>" }` in a loop. Each *cache-missing* request fans out to GitHub: 1 user call + 1 repos call + up to 20 `/languages` calls + (for the deep review) up to 3 README + 3 commits + 3 contents calls — ~31 outbound REST calls — and then one **paid Gemini** `generateContent` call.
- **Root cause**: The route does no session/workspace check and no `rateLimit(clientIpFrom(...))`, unlike the project's other public/expensive routes (apply, demo, inbound, schedule). The in-process TTL cache only helps on *identical* `(username, jobDescription)` keys; varying either field defeats it (see #2), so it provides no abuse ceiling.
- **Impact**: A single attacker can (a) burn the app's anonymous GitHub 60/hr budget (or a configured `GITHUB_TOKEN`'s quota) so legitimate analyses fail, and (b) run up real Gemini spend. It also turns the server into a GitHub-scraping proxy against arbitrary usernames.
- **Fix sketch**: Apply the existing `rateLimit(clientIpFrom(request), …)` guard (per-IP, low budget) at the top of `POST`, and cap `profile`/`jobDescriptionText` length before any fetch. If the feature is recruiter-only, also gate behind the same session check the authoring routes use.

## 2. Cache key includes raw, unbounded `jobDescription` → cache is trivially bypassed and is a memory amplifier
- **Severity**: High
- **Category**: edge-case / resource-leak / silent-failure
- **File**: `app/api/github-analysis/route.ts:34` (`githubCacheKey`), `:113-115` (no length cap on `body.profile` / `body.jobDescriptionText`)
- **Scenario**: The cache key is `sha1(username.toLowerCase() + "\n" + jobDescription)` with the JD used **verbatim and un-normalized**. Two runs for the same candidate with a one-character JD difference (whitespace, a trailing newline from file extraction vs. typed text) miss the cache and each re-spend the full ~31-call + Gemini budget. An attacker can also send a multi-megabyte `jobDescriptionText`; nothing caps it before it is JSON-parsed, hashed, and embedded in `evidenceJson`/prompt.
- **Root cause**: The cache is intended as the route's abuse/cost ceiling ("re-analyzing the same candidate within the TTL serves the stored result"), but keying on the entire raw JD makes "same candidate" almost never collide in practice, and the absence of an input size cap lets the body itself be a DoS lever.
- **Impact**: The documented protection is illusory for the common case (file-extracted vs. typed JD differ), so cost/rate-limit pain in #1 is worse than the comments claim; large bodies inflate memory and the Gemini token bill.
- **Fix sketch**: Normalize the JD before hashing (trim + collapse whitespace, or hash only a bounded prefix), and reject `profile`/`jobDescriptionText` over a sane max (e.g. 50 KB) with a 400 before fetching.

## 3. Deep-review concurrency is uncapped — `Promise.all` over up to 20 + 3 sub-fetches stampedes GitHub
- **Severity**: High
- **Category**: race-condition / silent-failure
- **File**: `app/api/github-analysis/route.ts:144-148` (languages `Promise.all`), `:536` (`bundles = await Promise.all(repos.map(fetchRepoBundle))`)
- **Scenario**: For a prolific account, the route fires 20 `/languages` requests in parallel, then `fetchRepoBundle` fires 3×3 more in parallel. GitHub's secondary rate limiter penalizes *bursts* of concurrent requests from one client; the burst makes a 403 secondary-rate-limit **more** likely than a paced sequence would.
- **Root cause**: Every sub-fetch is `.catch(() => default)`, so a rate-limited burst silently produces empty language maps and empty bundles. The only backstop is `hasAnySignal` (`:555`), which converts a fully-empty burst into an error — but a *partially* throttled burst (some repos fetched, most 403'd) passes `hasAnySignal` and sends a thin, misleading evidence set to Gemini, which then writes a confident assessment from one repo while appearing to have reviewed three.
- **Impact**: Recruiter sees an authoritative "Repo-Signal Review" that was actually built from a fraction of the intended evidence, with no warning — success theater on degraded data.
- **Fix sketch**: Bound concurrency (small pool / sequential with jitter) for the languages and bundle fetches; track how many sub-fetches actually succeeded and downgrade `codeReview.status` (or annotate `evidenceBasis`) when coverage is partial, not only when it is zero.

## 4. Email-sized list/`encodeURIComponent` is fine, but `extractCvEmail` runs an ambiguous regex on uncapped CV text
- **Severity**: Medium
- **Category**: edge-case / potential-ReDoS
- **File**: `app/_lib/cv-autofill.ts:10` (`EMAIL_RE`), call site `app/apply/[id]/ConversationalApply.tsx:367` (`cvAutofill(d.text)` on full extracted text, no slice)
- **Scenario**: `cvAutofill` is called on the *entire* extracted CV text (the apply route caps `cvText` to `MAX_CV_TEXT_LENGTH` only later at submit, not before this client-side autofill). `EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/` has overlapping character classes around the literal `.`; a pathological CV with a very long run that *almost* completes the right-hand `[A-Za-z0-9.-]+\.[A-Za-z]{2,}` after an `@` can force quadratic backtracking on the main thread.
- **Root cause**: The regex is applied to attacker-influenced, unbounded input (a candidate uploads the CV) with no length guard, and the pattern is not linear-time-safe.
- **Impact**: A crafted CV could briefly hang the apply tab (frozen UI) during autofill. Low exploit value (self-inflicted, client-side) but it's an unbounded-input-meets-ambiguous-regex pattern worth closing.
- **Fix sketch**: Slice the text to a few KB before matching (the name guess already only scans the first 8 lines); or anchor/possessive-ize the pattern, or scan line-by-line so each match target is short.

## 5. `repoRank` size term can be NaN/`Infinity` and silently corrupt the top-repo ordering
- **Severity**: Medium
- **Category**: edge-case / silent-failure
- **File**: `app/api/github-analysis/route.ts:306-313` (`repoRank`), used at `:156` to sort and at `:188` to pick the deep-review shortlist
- **Scenario**: `repoRank` reads `repo.size`, `repo.stargazers_count`, `repo.forks_count` directly off the GitHub JSON with no numeric coercion. The route's `GithubRepo` type *declares* these as `number`, but the body is untrusted JSON — a missing/`null`/string `size` makes `repo.size / 500` produce `NaN`. `Array.prototype.sort` with a comparator that returns `NaN` is implementation-defined and yields an effectively arbitrary order.
- **Root cause**: The TypeScript type is treated as a runtime guarantee; the only shape check is `Array.isArray(repos)` (`:139`), not per-field numeric validation.
- **Impact**: A repo with odd metadata can scramble which repos surface as "top" and, worse, which 3 get the expensive deep review — so the review may run against the wrong repos while looking correct.
- **Fix sketch**: Coerce each numeric field with a `Number(x) || 0` (or a small `safeNum` helper) inside `repoRank`/`complexitySignals`, and guard the comparator to never return `NaN`.

## 6. `guessCvName` mis-fires on common two-word company/location headers and ALL-CAPS section titles
- **Severity**: Low
- **Category**: edge-case / data-quality
- **File**: `app/_lib/cv-autofill.ts:44-55` (`guessCvName`)
- **Scenario**: The heuristic accepts the first 2–4 token line where every token starts uppercase and none is in `TITLE_WORDS`. Lines like `"Prague Czechia"`, `"Charles University"`, `"Adobe Systems"`, or an ALL-CAPS `"WORK EXPERIENCE"` (two tokens, both `\p{Lu}`-initial, not title words) pass and get pre-filled as the candidate's *name*.
- **Root cause**: "Looks like a capitalized 2–4 word line" is a weak proxy for "is a person's name"; the deny-list (`TITLE_WORDS`, `NON_NAME_LINE`) only covers job titles and CV headers, not places/orgs/section headers.
- **Impact**: A wrong, editable name prefill — exactly the "a wrong guess is worse than none" failure the module's own header warns against. The candidate must notice and delete it.
- **Fix sketch**: Require at least one token to be Title-case (not ALL-CAPS) to skip section headers; optionally only accept the name when it appears above/next to the extracted email line, raising confidence before prefilling.

## 7. `buildGithubEvidenceSummary` trusts `analyzedAt`/`summary` lengths but coerce path can emit a stale-but-valid summary indefinitely
- **Severity**: Low
- **Category**: trust-boundary / staleness
- **File**: `app/_lib/github-summary.ts:80-107` (`coerceGithubEvidenceSummary`), DB read path noted at `:8-10`
- **Scenario**: `coerce` re-validates a stored summary at the DB read boundary and clamps lengths, but `analyzedAt` is accepted as *any* string (`:105`) with no date validity or freshness check. A corrupt/forged column with `analyzedAt: "not-a-date"` (or a far-future timestamp) round-trips through `coerce` unchanged; the panel's `safeDate` only protects the *github-analysis* card, not this summary's consumer.
- **Root cause**: The coercer's job is bounding size and neutralizing URL scheme (which it does well — the XSS guard at `:44-52` is correct), but it treats `analyzedAt` as an opaque label, so "when was this evidence gathered" can be meaningless on the decision surface.
- **Impact**: A recruiter could see a decision-relevant GitHub summary stamped with a nonsense or misleading date, undermining the provenance the summary exists to carry. Low blast radius (display-only) but it weakens an audit/provenance feature.
- **Fix sketch**: In `coerce`, validate `analyzedAt` parses to a finite `Date` and isn't in the future; on failure, drop it to `""` so consumers render "—" rather than a bogus timestamp.
