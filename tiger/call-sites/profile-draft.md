---
id: profile-draft
type: tiger/call-site
modality: text
file: pipeline/jobfit/profile_draft_cli.py:209-238
wrapper: direct Gemini (default) — resolve_provider ONLY when a KP_LLM_CONFIG profile_draft row exists
provider: gemini (direct grounded_answer)  model: gemini-3-flash-preview (gemini.py:25)
schema: no strict schema — prompt-embedded DRAFT_SCHEMA + build_draft enum coercion (:37-67; :93-183)
grounding: 1/2 sources
quality_score: 3  code_score: 3
recommended_model: "—"
status: assessed
last_scanned: 2026-06-20
characters: ["[[petra-recruiter]]", "[[jana-sourcer]]"]
---
## What it does
Drafts a CandidateProfileV2 intake from free-text recruiter notes. Route app/api/profile/draft/route.ts:30 spawns profile_draft_cli. _extract (:186) builds the prompt and **by default calls grounded_answer directly** (gemini.py:238) — the wrapper is bypassed unless an explicit KP_LLM_CONFIG profile_draft row exists (:214-226). build_draft (:93) coerces every enum to a known value + runs the same deterministic detect_archetype as manual intake (:168). Does not persist — fills the editor.

## Prompt & grounding
Prompt at :195-208. Good for grounding: "Do not invent facts not supported by the notes" (:205), provenance honesty (:202-204), false/null when unclear (:201-202). build_draft is the safety net — every hallucinated enum coerced (_one_of :88-91), provenance defaults self_declared (:114). Grounding **1/2**: notes reach the model; missing = (a) enum *definitions* — role_family offered as a bare join (:39) with no descriptions, model guesses from labels; (b) reconciliation with existing candidate signals (acceptable for fill-from-scratch). temperature=0.1 keeps it faithful.

## Code quality (wrapping · logging · caching)
**Confirmed: profile_draft bypasses the wrapper by default** (per the doc + inline comment :209-213) — the unconfigured default deliberately stays direct grounded_answer (:228-235) because resolve_provider's CLI fallback would change this Gemini-default grounding-capable use case. Consequence: **no LightTrack telemetry, no operation=profile_draft event, no ledger row** — monitor.emit_result never runs; only gemini.py's own retry/usage applies. max_output_tokens=4000 (:233), expected_keys (:234). No input-hash dedupe. **lang plumbed in Python but severed at the route**: _extract(text,lang)+language_directive correct (:186,:206), CLI accepts --lang (:248), but route.ts:30 spawns with no --lang, defaulting to en — a Czech recruiter's draft comes back in English fields.

## Findings
- [code] **HIGH — no telemetry/ledger on the default path** (:228). Direct Gemini skips the wrapper → metered Gemini spend invisible. Fix: route profile_draft through a gemini-default registry entry, OR have grounded_answer emit monitor.emit_result so the direct path still meters.
- [value] **MED — lang dropped at the route** (route.ts:30). Fix: read locale and pass ["--lang", lang].
- [value] **MED — role_family from bare labels, no definitions** (:39). Mis-routing skews detect_archetype. Fix: feed role_family_catalog() descriptions into the prompt.
- [code] **LOW — no dedupe for identical notes** (route.ts:30). Lower impact (one-shot, human-reviewed).
