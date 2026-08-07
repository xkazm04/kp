# GitHub Evidence & CV Utilities — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀2 / 🚀3 | Severity: C0/H3/M2/L0

## 1. GitHub deep-review evidence is display-only — never feeds scoring or fraud-flagging
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: dark-capability
- **File**: app/_components/GithubAnalysisPanel.tsx:40
- **Observation**: The Gemini deep review computes the single most decision-relevant GitHub signal — `unverifiedClaims` ("JD skill not visible in the repo signals") plus `confirmedSkills`/`hiddenStrengths` (route.ts:621-630). It is rendered in a panel and stored as a bounded summary (`buildGithubEvidenceSummary`, github-summary.ts:58), but nothing consumes it for ranking or flagging. The panel header literally states the analysis "Runs separately from the CV analysis... without blocking the main result," and the candidate comparison/scoring path keys off the *CV* analysis (`comparison.ts:63` reads `analysis.jobFit.matchingSkills`, not the GitHub review). So GitHub's "this claimed skill is NOT evidenced in public work" never reaches the recruiter's match score or surfaces as a CV-claim-vs-evidence discrepancy.
- **Why it matters**: Cross-checking CV-claimed skills against GitHub-unverified claims is a near-unique anti-resume-fraud differentiator for a hiring SaaS — and it is already computed, then discarded into a read-only drawer. Connecting it to the score (or a "claims X but no public evidence" badge) converts an existing cost (≈31 REST calls + a paid Gemini call) into a headline trust feature.
- **Recommendation**: Feed `unverifiedClaims` into a candidate-level "unverified CV claims" flag and let `confirmedSkills` nudge the match score (small, capped weight). At minimum, intersect the GitHub `unverifiedClaims` with the CV's claimed skills and surface the overlap in the pipeline row, not just the drawer.
- **Effort**: M

## 2. Job-fit comparison is hard-wired to a closed 10-skill taxonomy — blind to most of the tech world
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: differentiation
- **File**: app/api/github-analysis/route.ts:103
- **Observation**: `SKILL_ALIASES` enumerates exactly ten buckets (python, typescript, javascript, react, docker, sql, ai, cloud, testing, ci). `buildJobFitSignals` only ever emits matches/gaps drawn from these keys (route.ts:392-400). A JD that requires Go, Rust, Java, C#, Kotlin/Swift, Kubernetes, Terraform, security, or data-engineering can never appear as a `matchingSkill` *or* a `potentialGap` — it is silently invisible. The closed nature of this list is undocumented in the UI; a recruiter sees "Potential Gaps: none" and reasonably reads it as "no gaps," when it actually means "no gaps among ten hard-coded skills."
- **Why it matters**: The GitHub-to-JD fit comparison is the feature's headline differentiator, yet its coverage is a tribal-knowledge constant most recruiters and candidates will never know about. False "no gaps" reassurance on an off-taxonomy role is a silent wrong-hiring-signal; competitors marketing "skill matching" will cover hundreds of skills.
- **Recommendation**: Externalize the taxonomy (data file / DB) and expand it substantially, or derive the comparison skill set from the JD's own extracted skills rather than a fixed dictionary. Surface coverage honestly ("compared against N tracked skills").
- **Effort**: M

## 3. GitHub review runs on one shared/anonymous token — unusable at scale, and a clear premium tier
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: monetization
- **File**: app/api/github-analysis/route.ts:264
- **Observation**: Auth is a single app-wide `process.env.GITHUB_TOKEN` (or anonymous when unset). The route's own cache note (route.ts:22-29) flags GitHub's anonymous 60/hr limit as "the route's dominant real-world failure," and each run burns ≈31 REST calls. The 403 path even tells the *candidate/recruiter* to "Configure GITHUB_TOKEN" (route.ts:272-273) — an env var they cannot touch. There is no per-org token, no OAuth, and one rate budget shared across all tenants.
- **Why it matters**: At any real multi-tenant volume the feature rate-limits itself into the degraded "try again shortly" state, undermining the core promise. It's also money left on the table: "Connect your GitHub org" (per-org token/OAuth) is a natural premium/team-tier upsell that simultaneously fixes the scaling ceiling and unlocks candidate-consented private-contribution evidence the current anonymous path explicitly cannot read (github-evidence.ts:30).
- **Recommendation**: Add per-org GitHub OAuth/token storage and key REST calls off the tenant's token; gate higher-limit/private-evidence analysis behind a paid tier. Stop instructing end users to set a server env var.
- **Effort**: L

## 4. Deep review hard-codes a *preview* Gemini model with no override or fallback
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: magic-number
- **File**: app/api/github-analysis/route.ts:19
- **Observation**: `GEMINI_MODEL = "gemini-3-flash-preview"` is a literal preview model id, alongside unexplained `temperature: 0.1` and `maxOutputTokens: 4000` (route.ts:601-604). Every other operational knob here is env-driven (`GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GITHUB_TOKEN`) but the model id is not. When a preview model is renamed or sunset, the entire deep review collapses to `status:"error"` and the raw provider error string is shown verbatim to recruiters (GithubAnalysisPanel.tsx:213-215). No recorded reasoning explains the model/temperature/token choices or an upgrade path.
- **Why it matters**: A silent, provider-driven outage of the most valuable signal, surfaced as a cryptic recruiter-facing error, with no config lever to swap models without a code deploy. The magic constants make tuning a reverse-engineering exercise.
- **Recommendation**: Make the model id an env var with a non-preview default; document the temperature/token rationale inline; add a fallback model (or a clear "review temporarily unavailable" copy distinct from rate-limit errors).
- **Effort**: S

## 5. `guessCvName` magic thresholds silently reject many valid (non-Western) names
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: edge-case
- **File**: app/_lib/cv-autofill.ts:44
- **Observation**: Name autofill is governed by undocumented constants: scan only the first 8 lines (`.slice(0, 8)`), reject any line `> 40` chars, and require exactly 2–4 whitespace tokens (cv-autofill.ts:45-49), each Title/UPPER-cased (`NAME_TOKEN`, line 26). This silently drops legitimate names: 5+ token names ("Maria del Carmen Fernández García"), long compound names exceeding 40 chars, mononyms/single-name cultures, and all-lowercase stylized names. The "why these numbers" is unrecorded — they encode a Western-name happy path as tribal knowledge.
- **Why it matters**: In a hiring product, an autofill that systematically misses non-Western name structures is a quiet fairness/inclusion smell and an inconsistent UX (some candidates get the convenience, others silently don't). The constants being unnamed/undocumented makes the bias invisible to reviewers. (Mitigated: the value is an editable, never-auto-submitted default — hence Medium, not High.)
- **Recommendation**: Name and comment each threshold with its rationale; relax token-count (allow ≥2, drop the hard 4-cap), raise/justify the 40-char cap, and add test fixtures for multi-token and mononym names to make the intended coverage explicit.
- **Effort**: S
