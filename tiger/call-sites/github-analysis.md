---
id: github-analysis
type: tiger/call-site
modality: text
file: app/api/github-analysis/route.ts:600-610
wrapper: direct Gemini SDK (full wrapper bypass)
provider: gemini  model: gemini-3-flash-preview (hardcoded const route.ts:18)
schema: yes — geminiReviewSchema (route.ts:491-496, lenient .catch) + githubAnalysisSchema/codeReviewSchema (schemas.ts:84,105)
grounding: 6/7 sources
quality_score: 4  code_score: 3
recommended_model: "—"
status: assessed
last_scanned: 2026-06-20
characters: ["[[eva-eng-hiring-lead]]", "[[helena-buyer]]"]
---
## What it does
GitHub deep-dive for hiring. Fetches a user + up to 100 repos via GitHub REST (132-148), derives deterministic metrics/rank, then runs an LLM "repo-signal review" over the top 3 ranked repos (runCodeReview 498-647). Per repo it bundles README (truncated), recent commit subjects, root file/dir NAMES, language, topics (fetchRepoBundle 442-467) and asks Gemini for {summary, confirmed_skills, unverified_claims, hidden_strengths} (601-610). Validated, cached, returned.

## Prompt & grounding
Prompt is tight and conservative (585-598): tells the model it is NOT reading source, only lightweight public signals, "treat a skill as evidenced only when the visible signals directly support it." Feeds real evidence: actual repo names, real commit subjects, real file names, README, language, topics + the role JD (571-583,593-597). Eva's "cite real repos/commits, not generic active-contributor filler" bar is structurally met. **6/7**: the one missing source is file/diff bodies — by design (only NAMES and SUBJECTS, never code). Honest about it: limitations[] (209-213) + the prompt flag it; a real `insufficient_evidence` guard (555-569) refuses to call Gemini when every bundle came back empty — prevents the "confident assessment from nothing" Helena would distrust. Clears the senior bar for an honest surface-signal review; would NOT clear a verified-code-quality bar (it disclaims that).

## Code quality (wrapping · logging · caching)
**Headline finding — full wrapper bypass.** A DIRECT `new GoogleGenAI({apiKey})` call (route.ts:601, import line 4), NOT through resolve_provider / the Python TextProvider — even though `github_analysis` is a fully-registered use case on BOTH sides (capabilities.py:46, llm-config.ts:42) with the SAME default model. The config row exists and is ignored. Lost vs the Python layer:
- **No LightTrack telemetry** — emits none; only logGithub (224-231) to a local file with NO tokens/cost/model.
- **No cost stamping** — never computes spend; for Helena's BYOM/metered model, GitHub-analysis spend is fully unmetered.
- **No shared retry** — single try/catch (one Gemini blip → degraded "error" review, no retry).
- **No key parity / BYOM** — reads its OWN env GEMINI_API_KEY ?? GOOGLE_API_KEY (506), NOT the encrypted provider_keys BYOM/platform rows; a customer's BYOM key is ignored and spend misattributed.
- **No config parity** — model is a hardcoded const (18); an llm_config pin for github_analysis is unreachable.
Done well: typed schema with lenient field `.catch()` defaults; fence-tolerant parseGeminiJson (652-661); a content-hash TTL cache keyed username+JD (28-36, never caches errors); sane temp 0.1 / maxOutputTokens 4000; maxDuration 60; prompt not bloated (3 repos, truncated evidence). The doc lists "the TS github-analysis wrapper" as the outstanding Phase-3 port — known gap.

## Findings
- [code] **HIGH — wrapper bypass: no telemetry/cost/key/config parity** (route.ts:506,601-610,18). Fix: build the documented TS mini-wrapper — either route canary-style through spawnPython→resolve_provider("github_analysis") like /api/llm/test already does (test/route.ts:25-29 with buildLlmConfigEnv()), or read buildLlmConfigEnv()'s github_analysis entry + gemini key in TS so model, key precedence (byom→platform→env), and a telemetry emit match the Python layer.
- [code] **MED — no spend metering at all, even locally** (logger.ts:57-69). Fix: capture response.usageMetadata token counts into github.log. (Note: the doc's claim that an insertLlmUsage writer "exists" is STALE — no such symbol anywhere.)
- [value] **LOW — confirmed_skills can read stronger than the surface evidence warrants** (591). Fix: require a per-skill evidence pointer {skill, repo, signal} so the UI shows provenance, not a bare list.
- [code] **LOW — cache is single-process only** (30, acknowledged). Fine for demo.
