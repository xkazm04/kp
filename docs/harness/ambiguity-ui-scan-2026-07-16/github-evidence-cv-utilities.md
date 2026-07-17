# GitHub Evidence & CV Utilities — ambiguity-guardian + ui-perfectionist scan

> Total: 6 findings (0 critical, 1 high, 4 medium, 1 low)

## 1. Full-analysis `href`s skip the scheme vetting the summary path documents as mandatory
- **Severity**: High
- **Lens**: ambiguity
- **Category**: unvetted-href-scheme
- **File**: `app/_components/GithubAnalysisPanel.tsx:106` (also `app/_lib/schemas.ts:191,213`)
- **Scenario**: A hand-crafted `PATCH /api/analyses/[slug]` persists a `githubAnalysis` whose `profileUrl` (or a `topRepositories[].url`) is `javascript:...`. `githubAnalysisSchema` validates both as bare `z.string()`, the payload is stored, and the saved report later renders `<a href={analysis.profileUrl}>` / `<a href={repo.url}>` in the recruiter console — a stored javascript: link a recruiter clicks.
- **Root cause**: `github-summary.ts:39-52` states the repo's own rule — "Length-clamping is NOT sanitization — the scheme must be vetted" — and inlines `safeLinkUrl` for the *summary* copy of this same data. The *full* analysis flows through `githubAnalysisSchema`, which never vets URL schemes, and the panel trusts it. The live `/api/github-analysis` path is safe (values come from GitHub's API), but the persisted-report path (`app/api/analyses/[slug]/route.ts:74` → `db/analyses.ts:389` → `ResultPanel` → this panel) accepts client-supplied URLs.
- **Impact**: The exact stored-XSS-shaped hazard the summary module was hardened against survives one layer up, on the richer payload. Two "validated" paths for the same data enforce different security invariants — future maintainers will reasonably assume schema-parsed means safe.
- **Fix sketch**: Give `profileUrl` and `topRepositories[].url` a scheme-vetting refinement in `githubAnalysisSchema` (e.g. `z.string().refine(isHttpUrl)` or a `.transform` that blanks non-http(s) values, mirroring `safeLinkUrl`), so every producer/consumer of the schema inherits the guard. Alternatively vet at render in `GithubAnalysisPanel`, but the schema is the single choke point.

## 2. Cache-key JD truncation makes different job descriptions collide — stale analysis served for an edited JD
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: cache-key-collision
- **File**: `app/api/github-analysis/route.ts:51-55`
- **Scenario**: A recruiter analyzes a candidate against a long JD (>4000 chars), then edits its tail — tightens the must-haves, changes the stack — and re-runs within the 15-minute TTL. The first 4000 normalized characters are unchanged, so `githubCacheKey` returns the same SHA-1 and the route serves the *previous* JD's cached `jobFitSignals` and Gemini review, silently presented as an analysis of the new JD.
- **Root cause**: `normJd` is sliced to `GITHUB_CACHE_JD_KEY_MAX = 4000` before hashing. The comment explains normalization ("the analysis still runs against the raw JD") but not that truncation introduces false cache *hits*. The cap buys nothing: the key is already a fixed-size SHA-1 digest, so hashing the full normalized JD costs microseconds and cannot bloat the key.
- **Impact**: Wrong-decision surface — gaps/matches and the deep review are JD-dependent, and the served payload carries the old `analyzedAt`, so nothing signals staleness. Long JDs (~600+ words) are common paste-ins.
- **Fix sketch**: Drop the `.slice(0, GITHUB_CACHE_JD_KEY_MAX)` (or raise it to a DoS-guard bound like 100k) and hash the full normalized JD. Keep the case/whitespace folding — that part correctly collapses trivial variations without collapsing real edits.

## 3. Language mix (and therefore gap verdicts) built from an undocumented, unranked "first 20 repos" slice
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: magic-number-evidence-scope
- **File**: `app/api/github-analysis/route.ts:222`
- **Scenario**: A candidate with 40+ owned repos has their flagship Rust project last pushed two years ago. `reposForLanguages = ownedRepos.slice(0, 20)` takes the 20 *most-recently-updated* repos (the list arrives `sort=updated`), so Rust never enters `languageSummary` — the Language Mix panel omits it and, when the JD names Rust, `buildJobFitSignals` can report it as a Potential Gap the candidate demonstrably fills.
- **Root cause**: `20` is the one unnamed, uncommented magic number in a file that pointedly names and documents every other threshold (the `REPO_RANK_*`/`COMPLEXITY_*` block, `REPO_PAGE_CAP`). It also quietly contradicts the FINDING #3 pagination work directly above it: pages 2-3 are fetched precisely so older flagship repos count, yet their languages are still excluded by recency ordering. Repo names/topics of *all* repos do enter the haystack, softening but not eliminating the miss.
- **Impact**: A recruiter-facing evidence surface (language mix + gaps) silently reflects "20 most recently touched repos", while adjacent copy implies the analyzed portfolio. Future tuners can't tell whether 20 is a rate-limit budget or an oversight.
- **Fix sketch**: Name it (`LANGUAGE_REPOS_LIMIT = 20` with a budget rationale — it exists to bound `/languages` REST calls) and take the slice from `rankedRepos` instead of the recency-ordered `ownedRepos`, so the same repos that surface as hiring evidence are the ones whose languages are counted. Optionally add a limitation line when `ownedRepos.length > LANGUAGE_REPOS_LIMIT`.

## 4. Email attribution counts blank lines in the "contact block", unlike the name guesser it anchors on
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: inconsistent-line-semantics
- **File**: `app/_lib/cv-autofill.ts:49-54`
- **Scenario**: A CV with more than one address reads `Jane Applicant\n\n\njane@x.com\n...\nReferences: john@bigco.com` — a blank line or two between the name and the contact details, which PDF text extraction produces constantly. `extractCvEmail` slices `EMAIL_BLOCK_LINES = 3` *raw* lines from the name line, the block is the name plus two blanks, no address is found, and the prefill silently degrades to nothing even though attribution was unambiguous.
- **Root cause**: `guessCvName` normalizes with `.filter(Boolean)` before scanning (blank lines don't count toward its 8-line window), while `extractCvEmail` splits the same text without filtering — the two halves of one attribution heuristic disagree about what a "line" is, and the `EMAIL_BLOCK_LINES` comment ("their name line + the next few lines") doesn't say whether blanks count.
- **Impact**: Safe-direction failure (no wrong prefill), but the feature under-delivers on the most common real CV layout it was built for, and nobody will notice because "no prefill" is indistinguishable from "no email".
- **Fix sketch**: Build the block from the first `EMAIL_BLOCK_LINES` *non-empty* lines starting at the name line (mirror `guessCvName`'s filtered view), or filter blanks before the slice. One shared `nonEmptyLines(text)` helper used by both functions makes the semantics impossible to desync; the existing tests keep passing and a blank-separated fixture locks it in.

## 5. Job Skill Matches / Potential Gaps render internal taxonomy slugs to recruiters
- **Severity**: Medium
- **Lens**: ui
- **Category**: raw-slug-copy
- **File**: `app/_components/GithubAnalysisPanel.tsx:139-140` (source: `app/api/github-analysis/route.ts:137-164`)
- **Scenario**: A JD mentioning C#, C++, Terraform, MongoDB and Spark produces Job Skill Matches / Potential Gaps bullets reading `csharp`, `cpp`, `iac`, `nosql`, `data_engineering` — the `SKILL_ALIASES` object keys — verbatim in a hiring-decision panel that otherwise writes full recruiter-facing sentences.
- **Root cause**: `buildJobFitSignals` pushes the taxonomy *keys* (`matchingSkills.push(skill)`), which were named as identifiers (snake_case, no `#`/`+`), and `TitledList` renders items untransformed. No display-label layer exists between the taxonomy and the UI.
- **Impact**: Visual/typographic inconsistency in the panel's most decision-relevant lists, and mild comprehension risk (`iac`, `ci`, `nosql` are jargon-slugs; `csharp` looks like a typo next to prose bullets).
- **Fix sketch**: Add a `SKILL_LABELS: Record<string, string>` beside `SKILL_ALIASES` (`csharp: "C#"`, `data_engineering: "Data Engineering"`, `iac: "Infrastructure as Code"`, ...) and map keys to labels either in the route payload or at render. A sync test asserting every alias key has a label prevents drift when buckets are added.

## 6. Repo cards and the profile link are the panel's only interactive elements without a visible focus style
- **Severity**: Low
- **Lens**: ui
- **Category**: focus-ring-consistency
- **File**: `app/_components/GithubAnalysisPanel.tsx:179` (also `:106`)
- **Scenario**: A keyboard user tabs through the panel: the Retry button (line 65) shows the app's `focus-ring` treatment, but the `@username` profile link and each Top Repositories card `<a>` (which have hover styling: `hover:bg-limewash`) show only the browser default — or effectively nothing against the tinted `bg-paper` card — so it's easy to lose track of focus exactly on the elements that open external tabs.
- **Root cause**: The repo convention is an explicit `focus-ring` utility on interactive elements (used on this file's own button and throughout `ResultPanel`), but the two anchor styles here define hover states without the matching focus class.
- **Impact**: Keyboard-navigation papercut and inconsistency with the app's established focus idiom; hover-only affordances also mean keyboard users get less feedback than mouse users on the same element.
- **Fix sketch**: Add `focus-ring` (or `focus-visible:` equivalents matching it) to the profile anchor at line 106 and the repo-card anchor at line 179, keeping the existing hover classes. Two-class change, no layout impact.
