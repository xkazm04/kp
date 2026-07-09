# GitHub Evidence & CV Utilities — bug-hunter + ui-perfectionist scan

> Context: Pull GitHub repo evidence into a candidate analysis and auto-fill / vary CV-derived profile fields; backs the GitHub analysis panel and CV provenance helpers.
> Files reviewed: 8 of 12
> Total: 5

## 1. Reject organization handles — the deep-dive attributes an org's whole portfolio to the candidate

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: validation-gap / wrong-result (fairness)
- **File**: `app/api/github-analysis/route.ts:157,185-188,91-96` (+ `app/_lib/github-handle.ts:14-24`)
- **Scenario**: A candidate enters `vercel` (or a recruiter pastes `github.com/facebook`, or mistypes a company for a person). `coerceGithubHandle`/`parseGithubUsername` happily normalizes it — org handles share the exact 1–39 char grammar. `GET /users/vercel` returns 200 (GitHub's `/users/{login}` resolves **organizations** too, with `public_repos`/`followers`), and `/users/vercel/repos?type=owner` returns Vercel's repos. The panel then renders a god-tier profile — thousands of stars, strong complexity signals, near-perfect job-fit — stamped on this one applicant.
- **Root cause**: The route trusts that a syntactically valid handle is a *person's* account. `GithubUser` doesn't even carry `type`, and no branch checks `user.type === "User"`. Identity ("whose work is this?") is never verified — only the handle's *shape* is.
- **Impact**: A candidate can inflate their GitHub evidence to world-class by naming any org; a recruiter who fat-fingers a handle silently reviews an org's portfolio as an individual's. On a hiring surface this is a serious correctness+fairness failure (right shape, wrong human).
- **Fix sketch**: Add `type` to `GithubUser`; after the `/users` fetch, `if (user.type !== "User") throw new Error("That handle is an organization, not a personal GitHub account.")`. Make "the account is a person" a checked precondition of the whole analysis, not an assumption.

## 2. [STILL-OPEN] Partial GitHub throttling silently produces wrong job-fit gaps and a confident deep review built on a fraction of evidence

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: `app/api/github-analysis/route.ts:197-201` (`/languages` fan-out), `:602,621-635` (bundles + `hasAnySignal`); consumed at `:240` / panel `GithubAnalysisPanel.tsx:131-132`
- **Scenario**: For any account past a handful of repos, the route fires up to 20 `/languages` calls (then 3×3 bundle sub-fetches) as one `Promise.all`, each `.catch(() => ({}) / [])`. GitHub's **secondary** limiter 403s *bursts*. A partial throttle — some repos fetched, most 403'd — yields a thin-but-non-empty result: `hasAnySignal` only rejects the *all-empty* case (`bundles.some(...)`), so a review assembled from one repo still reaches Gemini and returns a confident "Repo-Signal Review." Worse, a repo whose `/languages` 403'd drops its secondary languages from `languageSummary`, so `buildJobFitSignals` can list a skill the candidate actually has under **Potential Gaps**.
- **Root cause**: Prior scan #3 flagged the uncapped fan-out; the rate-limit guard (#1/#2) landed but this did not. Coverage is still binary (any-signal vs none), so "partially blind" is indistinguishable from "complete" to every downstream consumer.
- **Impact**: A recruiter sees an authoritative gap/match list and deep review that were computed from a rate-limited fraction of the evidence — flagging a candidate as *missing* a skill purely because a transient 403 emptied a language map. Success theater on degraded data, on a hiring decision.
- **Fix sketch**: Bound concurrency (small pool, sequential-with-jitter) and *count* successful sub-fetches; when coverage is partial, downgrade `codeReview.status` and surface a "language/evidence data incomplete — retry" warning so a gap can never be asserted from missing data.

## 3. No repo pagination — prolific candidates are silently truncated to their 100 most-recently-updated repos

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case / silent-wrong-result
- **File**: `app/api/github-analysis/route.ts:186-188` (single `per_page=100&sort=updated`), totals `:225-231`, `:250-256`
- **Scenario**: A candidate with >100 owned repos gets exactly one page, `sort=updated`, so their oldest — often *most-starred / flagship* — work is dropped. `totalStars`, `totalForks`, `activeRepos`, the language mix, and the deep-review shortlist are all computed on that truncated set, while `metrics.publicRepos` (from `user.public_repos`, the true count) is shown alongside `ownedReposAnalyzed` (truncated). The two silently disagree, and the summary says "N owned public repositories analyzed" as if complete.
- **Root cause**: `per_page=100` with no `page=` loop treats "first page" as "all repos." Fine for typical accounts, systematically wrong for prolific ones — exactly the users whose GitHub evidence matters most.
- **Impact**: Under-counted stars/forks/languages and a wrong "Top Repositories" / deep-review shortlist for the strongest candidates — an unflagged undercount presented as a full portfolio.
- **Fix sketch**: Paginate until the page is short or a sane page cap (e.g. 3×100), or explicitly annotate the payload ("analyzed 100 of {public_repos} repos") so consumers never read a truncated total as complete.

## 4. Overlapping SKILL_ALIASES buckets count one JD keyword as several matches/gaps

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: data-quality / edge-case
- **File**: `app/api/github-analysis/route.ts:121-148` (buckets), `:438-446` (per-bucket loop)
- **Scenario**: `react` is an alias of **three** buckets (`typescript`, `javascript`, `react`); `next.js`/`nextjs` sit in two. A JD requiring a React stack against a candidate with no JS evidence produces Potential Gaps = `["typescript","javascript","react"]` — three bullets for one underlying gap. Symmetrically, a React-only candidate scores three "matches" for one skill, inflating apparent breadth.
- **Root cause**: The buckets are treated as disjoint skills, but their alias sets overlap, so a single token fans out into multiple bucket verdicts. The loop credits each bucket independently with no concept-level dedupe.
- **Impact**: The recruiter-facing match/gap counts mis-represent breadth — a single missing (or present) skill reads as several — skewing the job-fit read the panel exists to give.
- **Fix sketch**: Make buckets mutually exclusive (drop `react`/`next.js` from the `typescript`/`javascript` alias lists), or collapse matches/gaps to distinct underlying concepts before returning.

## 5. `extractCvEmail` prefills the FIRST email in the CV as the candidate's contact — which may be a referee's or company's

- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: data-quality / edge-case
- **File**: `app/_lib/cv-autofill.ts:10-18,58-64` (`EMAIL_RE.exec` first-match), consumed at conversational apply via `cvAutofill(d.text)`
- **Scenario**: A CV whose top lines list a portfolio host, a previous employer, or a "References: john@bigco.com" block before the candidate's own address makes `extractCvEmail` return that first email-shaped token, which `cvAutofill` sets as `email` and the apply flow pre-fills as the editable contact default. A candidate who trusts the prefill submits with someone else's email.
- **Root cause**: The module's stated rule is "a wrong guess is worse than none," yet the email extractor has no association between the matched token and the candidate — it takes position #1 regardless of whose address it is (unlike `guessCvName`, which at least applies name heuristics).
- **Impact**: Occasional wrong contact on a pipeline entry — the exact failure the module warns against. Blast radius is limited by the field being editable, hence Low.
- **Fix sketch**: Prefer an email that co-locates with the guessed name / top contact block, or skip the prefill when multiple distinct emails appear, so an ambiguous CV degrades to "candidate types it" rather than a confident wrong default.
