# GitHub Evidence & CV Utilities — Tri-Lens Scan
> Total: 5
> Severity: 1 Critical / 1 High / 2 Medium / 1 Low
> Lens: 3 bug / 1 ui / 1 biz

## 1. Stored XSS via unvalidated `profileUrl` / repo `url` in coerced GitHub evidence
- **Lens**: 🐛 Bug Hunter
- **Severity**: Critical
- **Category**: Security / XSS / trust-boundary validation gap
- **Value**: impact 9/10 · effort 2/10 · risk 2/10
- **File**: `app/_lib/github-summary.ts:81` (and `:77`, `:87`)
- **Scenario**: An authenticated user POSTs `{ action: "set_github", github: { username: "x", profileUrl: "javascript:fetch('/api/...')...", topRepositories:[{name:"r", url:"javascript:..."}], ... } }` to `/api/pipeline/[id]`. `coerceGithubEvidenceSummary` accepts it: `profileUrl` only has to be a string (`typeof o.profileUrl !== "string"`), and repo `url` only has to be a string (line 74). It is clamped to 240 chars but the scheme is never checked, so the malicious value is stored verbatim. `CandidateDrawer.tsx:596` renders `<a href={github.profileUrl}>` and `:630` renders `<a href={r.url}>` directly — the payload fires when a recruiter clicks the candidate's GitHub link.
- **Root cause**: The module's docstring claims coercion makes a "hand-crafted POST" safe ("a hand-crafted POST … can never put an unbounded blob on the board payload"), and the route comments assert "the only producer is our own client, so a shape mismatch is drift, not input." Both treat a public HTTP boundary as trusted and validate *length/shape* but not *URL scheme*. Length-clamping is not sanitization.
- **Impact**: Stored XSS in the recruiter console — session/token theft, cross-candidate data exfiltration, actions on behalf of the recruiter (multi-workspace SaaS = cross-tenant blast radius).
- **Fix sketch**: In `coerceGithubEvidenceSummary`, reject (or null out) any `profileUrl`/repo `url` whose parsed protocol is not `http:`/`https:` (`try { new URL(v) } catch` → drop; assert `["http:","https:"].includes(u.protocol)`). Do the same in `buildGithubEvidenceSummary`. This kills the class for every consumer that renders these as `href`.

## 2. CV name autofill silently skips real names ≥41 chars or with 5+ words
- **Lens**: 🐛 Bug Hunter
- **Severity**: High
- **Category**: Edge-case / silent failure (over-conservative parsing)
- **Value**: impact 6/10 · effort 3/10 · risk 2/10
- **File**: `app/_lib/cv-autofill.ts:47` and `:49`
- **Scenario**: A candidate's CV leads with "María del Carmen Fernández de la Vega" (5 tokens) or any name line >40 chars. `guessCvName` hits `if (line.length > 40 …) continue` and `if (tokens.length … > 4) continue`, returns `undefined`, and the apply flow silently offers no name prefill — the candidate must retype it. Spanish/Portuguese/Arabic/compound names routinely exceed both bounds.
- **Root cause**: The 40-char / 2–4-token guardrails were tuned to reject body prose and titles, but they conflate "long" with "not a name." A wrong guess being worse than none justifies *rejecting non-names*, not capping *valid* multi-part names — there is no upper-bound reason a 5-word name is less likely to be a name than a 4-word one once it already passed the NAME_TOKEN + TITLE_WORDS filters.
- **Impact**: Degraded autofill UX for a large, internationally-common name class — exactly the candidates the feature was meant to spare from retyping; reads as a quiet i18n gap.
- **Fix sketch**: Raise the length cap (~60) and token cap (~6), and rely on the existing NAME_TOKEN/TITLE_WORDS/digit filters (which are the real precision guards) to reject non-names. Add an international multi-part-name test fixture.

## 3. CodeReview "ok" with empty skills is indistinguishable from a no-evidence result
- **Lens**: 🐛 Bug Hunter
- **Severity**: Medium
- **Category**: Success-theater / ambiguous status
- **Value**: impact 5/10 · effort 3/10 · risk 3/10
- **File**: `app/api/github-analysis/route.ts:625` (and panel `app/_components/GithubAnalysisPanel.tsx:234`)
- **Scenario**: Gemini returns valid JSON but with `confirmed_skills: []` / `hidden_strengths: []` (common when signals are genuinely thin, or the model hedges). The route returns `status: "ok"` with three empty arrays. The panel's `CodeReviewBlock` shows the green "ok" badge and three columns all reading "None detected." A recruiter reads a confident, completed review that found nothing — the same surface as a real low-evidence candidate, with no signal that the review was effectively vacuous.
- **Root cause**: `status` reflects only *that the model responded*, not *whether the response carried any evidence*. The earlier `hasAnySignal` guard protects the *input* side (no repo signals → error) but there is no equivalent on the *output* side (model produced no findings → still "ok").
- **Impact**: Misleading hiring evidence — an empty review is presented with the authority of a substantive one; erodes trust in the feature when noticed.
- **Fix sketch**: When `status === "ok"` but all three skill arrays are empty, either map to a distinct `"empty"`/low-confidence state or have the panel render an explicit "review completed but surfaced no specific skills" note instead of three "None detected." columns.

## 4. Code-review error string rendered raw; no retry/empty parity with the main panel
- **Lens**: 🎨 UI Perfectionist
- **Severity**: Medium
- **Category**: Error-state polish / inconsistency
- **Value**: impact 5/10 · effort 3/10 · risk 2/10
- **File**: `app/_components/GithubAnalysisPanel.tsx:213`
- **Scenario**: When the deep review fails (rate limit, Gemini down, malformed payload), `CodeReviewBlock` shows the raw `review.error` — including internal strings like `"insufficient_evidence: no readme/commits/files fetched across all repos"` or `"non-json response"` — in a small red box with no recovery affordance. Meanwhile the outer panel (status === "error") offers an `onRetry` button. The sub-review, whose dominant real-world failure (GitHub rate limit) is exactly the *retryable* one, offers no retry and leaks developer-facing diagnostics to recruiters.
- **Root cause**: The two error surfaces evolved separately: the panel has a designed error state (`onRetry`, friendly copy) but the embedded code-review block just dumps the backend `error` field. There is no shared "retryable failure" component or human-message mapping.
- **Impact**: UX degradation and unpolished, jargon-y errors on the most common failure path; recruiters can't recover a rate-limited review without re-running the whole analysis.
- **Fix sketch**: Map known `error` codes to friendly copy, hide raw internal strings behind a "details" toggle, and surface the panel's `onRetry` (or a scoped re-run) inside `CodeReviewBlock` when `status === "error"`.

## 5. No "regenerate / refresh" affordance for stale GitHub evidence on a pipeline entry
- **Lens**: 🚀 Business Visionary
- **Severity**: Low
- **Category**: Missing capability / user-journey dead-end
- **Value**: impact 4/10 · effort 4/10 · risk 3/10
- **File**: `app/_lib/db/pipeline.ts:821` (fill-only UPDATE) + `app/features/sub_pipeline/CandidateDrawer.tsx:339`
- **Scenario**: A recruiter runs the GitHub deep-dive on a candidate in week 1; the result is stored FILL-ONLY (`github_json IS NULL OR github_json = ''`). Weeks later the candidate has shipped major public work, or the first run was a thin rate-limited result. The drawer's `runGithubDeepDive` no-ops on the server (fill-only keeps the first result), and there is no UI to force a refresh — the recruiter is stuck with stale/weak evidence and no path forward except editing the DB.
- **Root cause**: Fill-only was chosen to make concurrent double-runs idempotent, but it conflates "don't clobber on a race" with "never refresh." A paying recruiter expects to re-pull evidence as a candidate progresses; there is no `analyzedAt`-aware refresh path.
- **Impact**: Retention/value gap — the evidence a recruiter relies on silently decays and can't be updated in-product; undermines the differentiation of the GitHub analysis feature.
- **Fix sketch**: Add an explicit "Refresh GitHub evidence" action (separate route/flag, e.g. `force: true`) that overwrites when the recruiter opts in, while keeping the fill-only default for the automatic race path; show `analyzedAt` and a "stale" hint past a threshold.
