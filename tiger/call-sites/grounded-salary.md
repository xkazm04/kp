---
id: grounded-salary
type: tiger/call-site
modality: text
file: pipeline/jobfit/market_salary_cli.py:116 (grounded_answer, use_grounding=True) → gemini.py:275. Same seam serves analyze's grounded market_evidence (gemini.py:491).
wrapper: direct Gemini SDK (via grounded_answer; bypasses resolve_provider)
provider: Google Gemini  model: gemini-3-flash-preview (gemini.py:25)
schema: yes — inline JSON contract (suggestedMin/Max/currency/confidence/summary :111-114); expected_keys (:120); _coerce validate+repair (:49-75)
grounding: 3/4 sources
quality_score: 3  code_score: 3
recommended_model: keep Gemini (web grounding is the whole point; Claude has no web access)
status: benchmarked
last_scanned: 2026-07-16
characters: ["[[petra-recruiter]]", "[[katerina-ta-analytics]]"]
---

> **2026-07-16 Lens-3 benchmark → [[models/grounded-salary]]** (Claude-only). No ranking —
> the benchmark surfaced a **live prompt bug**: with `region="Munich, Germany"`, ALL 3 Claude
> tiers (incl. opus) obeyed the **hardcoded CZK** prompt and emitted a nonsensical "CZK/month
> for a Munich job" via EUR→CZK conversion. This is **finding #20 (currency lock) proven live
> AND model-independent** — no model escapes a hardwired-currency prompt. **KEEP Gemini** (Claude
> has no web grounding → degrades to parametric low-confidence). **Action: promote #20** — derive
> currency/period from region, reusing [[cv-analysis]]'s working inference.
>
> **✅ RESOLVED 2026-07-16 (#20 / B1):** `market_salary_cli.py:114-148` now branches on region —
> the active market keeps the byte-identical CZK prompt; any other region is told to price in
> that region's own ISO currency and NOT convert to CZK (`_coerce` already passed the model
> currency through). Verified EUR survives for a foreign region; CZK preserved for the default;
> 31 market tests pass. Ceiling: the deterministic FALLBACK still returns the CZK taxonomy band
> (no foreign benchmark data held). → [[2026-07-16-backlog]] B1.
## What it does
Grounded market-salary estimate for a role, used by the JD builder via a TS bridge. Uses Gemini Google-Search grounding for a current monthly-gross CZK band with cited sources, falling back to the deterministic taxonomy band (role_family × seniority) when no key / grounding fails (:36-46,:98-101,:123).

## Prompt & grounding
"compensation analyst" + role facts + region + JSON-only contract (:105-114). Live grounding wired correctly: tools=[GoogleSearch()] when use_grounding (gemini.py:266-267); sources from grounding_metadata (:512-523) and the result IS used — surfaced as ans.sources[:8], source flips to "llm" only when _coerce confirms a usable band (:123-126). Senior bar (salary with a basis): band has confidence + grounded summary + cited sources. Two weaknesses: (a) region hard-locked "Czech Republic (Prague)" (:23) + forced CZK/month (:112) — the industry-lock; non-CZ roles get wrong-currency basis; (b) company collapsed to "similar to {company}" so two employers in one family get the same band. **3/4.**

## Code quality (wrapping · logging · caching)
- Shared seam → inherits unwired-retry bug. Partly masked: passes fallback=GroundedAnswer(empty) (:121) so a transient error degrades to taxonomy band — but a recoverable 429 silently downgrades a groundable answer to "deterministic" with no retry.
- Telemetry/ledger: invisible; usage tokens discarded here (reads payload/sources only); no cost stamp.
- **No input-hash cache** — every JD-builder salary lookup recomputes a live grounded call. cache-key.ts not applied here.
- temperature=0.1, max_output_tokens=8000 default (:244-245) — fine; generous for 5 keys.
- _coerce hardens numeric parse (:59-68) — good.

## Findings
1. [code] **No cache on a live grounded web call** — market_salary_cli.py:116. MEDIUM (every JD edit/preview estimating salary pays a full Google-Search round-trip). Fix: key by (title, seniority, family, region, stack, lang); serve cached band on hit.
2. [value] **Currency/region lock undercuts the basis for non-CZ roles** — REGION_DEFAULT (:23) + forced CZK/month (:112-113). MEDIUM-HIGH (the #1 multi-market adoption blocker). Fix: derive currency/period from region as analyze already does (gemini.py:463).
3. [code] **Discarded usage + no ledger** (:123). MEDIUM for auditability. Fix: emit a ledger row with ans.usage + Gemini price row (shared seam).
4. [code] **Transient errors silently downgrade instead of retrying** (:121 + unwired retry). LOW-MEDIUM. Fix: wiring retry at grounded_answer lets retry run before the fallback engages.
