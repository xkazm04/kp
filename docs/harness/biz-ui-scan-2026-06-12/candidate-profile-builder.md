# Biz+UI Scan — Candidate Profile Builder (2026-06-12)

> Total: 5 (1H/4M/0L)

## 1. Let the profile builder route to recruiter-created archetypes
- **Lens**: business_visionary
- **Severity**: High
- **Category**: functionality
- **File**: `app/features/sub_profile/ProfileTypes.ts:86`
- **Scenario**: The ArchetypeManager (the first panel on the Profile tab) invites the recruiter to create custom archetypes — id, label, weights, fairness shield, even a candidate-facing `applyLabel`. Candidates CAN then self-declare that archetype in the apply chat (`app/_lib/apply.ts:46` builds options from the registry), and it gets its own matrix column (`CandidateMatrix.tsx:41-46`). But the recruiter's own profile builder — sitting directly below the manager — can never route a profile to it: the editor's SegmentedControl is fed the hardcoded 4-item `ARCHETYPE_CHOICES` (auto/bau/student/career_switcher). Worse, opening an existing profile that *was* routed to a custom archetype (a candidate self-declared it at apply, then the recruiter deep-links into edit) hydrates `choice` to that id (`ProfileForm.ts:93`) and the control renders with **no segment selected**; one stray click on another segment and the custom routing is unrecoverable from the UI.
- **Root cause**: `ARCHETYPE_CHOICES` is a static literal (`ProfileTypes.ts:86-91`) consumed at `ProfileEditor.tsx:277-282` with static translation keys `t("choice.<id>")`, while every other archetype surface (apply flow, matrix columns, Python router — `profile_cli.py` accepts any `declared in ARCHETYPES`, which is registry-derived via `registry.archetype_ids()`) is registry-driven. The backend already accepts custom ids; only this UI list is frozen.
- **Impact**: The configurable, fairness-aware archetype taxonomy is the product's differentiation vs a stock ATS — and the studio half of it is a dead end. Candidates get a routing option the recruiter cannot reproduce, audit, or correct manually, and the taxonomy the manager promises is editable is effectively read-only at intake.
- **Fix sketch**: ProfileTab already fetches `/api/archetypes`; pass `archetypes` into `ProfileEditor` and build the choices as `[{v:"auto"}, ...archetypes.map(a => ({v: a.id, label: a.label}))]` — keep `t("choice.<id>")` for the four known ids (existing keys) and fall back to the registry `label` for custom ones (same degrade pattern as `archetypeApplyLabel` in `apply.ts:77-84`). `archetypeFieldVisibility` already fails safe for unknown ids (years/seniority hidden).

## 2. Localize the archetype promotion banner and its completeness follow-up
- **Lens**: ui_perfectionist
- **Severity**: Medium
- **Category**: ui
- **File**: `app/_components/results/ArchetypeBanner.tsx:72`
- **Scenario**: A Czech recruiter reads an analysis report whose frame, tabs and actions were just made bilingual (commits `7a318b6`/`b6ee6b9`), then hits the archetype banner — the interactive heart of this context's promote-to-profile loop — entirely in English: "Detected archetype", "confidence {n}%", "Save as profile", "Saved · open in Profile", "Routing:", the early-career explainer paragraph, "Fill the gaps the CV left (n) — optional, raises completeness", plus every follow-up prompt/placeholder ("Tell us about a school project or thesis you're proud of…").
- **Root cause**: `ArchetypeBanner.tsx` contains zero `useTranslations` calls — all strings are literals (lines 72, 74-75, 83, 92, 99, 101-104, 111-112) and the archetype pill reads the registry's English `ARCHETYPE_LABEL` (`archetypes.ts:26`) instead of `useEnumLabel("archetype", …)` whose `enums.archetype` catalog exists in both locales. The follow-up fields come from `GAP_FIELDS` in `app/_lib/completeness-followup.ts:29-69`, whose `prompt`/`placeholder` are hardcoded English. (Scoped to this interactive block — NOT the deferred deep per-tab report body labels.)
- **Impact**: The single most action-dense block of the report — the one that converts an analysis into a matchable pool profile and harvests completeness answers — breaks the bilingual promise mid-page; the cs recruiter gets intake prompts they may copy verbatim to a Czech candidate in English.
- **Fix sketch**: Give the banner a `useTranslations("results.archetypeBanner")` namespace like its sibling result components; swap `ARCHETYPE_LABEL` for `useEnumLabel`. For `GAP_FIELDS`, keep the spec map keyed by check id but store catalog keys (`profile.gaps.<check>.prompt` / `.placeholder`) resolved at render with `t.has()` fallback to the current English strings — preserving the module's pure, unit-tested `mergeGapAnswers` untouched.

## 3. Parse the AI-draft CLI through parsePythonJson like every other profile seam
- **Lens**: business_visionary
- **Severity**: Medium
- **Category**: functionality
- **File**: `app/api/profile/draft/route.ts:36`
- **Scenario**: The recruiter pastes notes and clicks "Draft with AI". The draft CLI succeeds (exit 0, valid JSON emitted at `profile_draft_cli.py:246`), but the editor shows a cryptic `Unexpected token … in JSON` error and the draft is lost — whenever the interpreter prints anything else to stdout (Gemini/absl/grpc warnings, atexit/ResourceWarning shutdown noise) or stdout arrives empty.
- **Root cause**: `draft/route.ts:36` does `NextResponse.json(JSON.parse(stdout))` — the only profile CLI seam that raw-parses. Its sibling `/api/profile` deliberately uses `parsePythonJson` and documents exactly this failure mode in place (`app/api/profile/route.ts:59-65`: "stray warnings before the result… shutdown noise after it… each turning a successful build/edit into a 500"); the rediscover seam repeats the warning verbatim (`rediscover/route.ts:74-77`, "common on Windows"). The draft route is the *LLM-calling* one — the noisiest stdout of the three — yet the least defended.
- **Impact**: Intermittent, environment-dependent failure of the AI-assist that is the builder's fastest intake path; the recruiter blames the AI feature ("flaky") when the draft actually succeeded, eroding trust in the product's headline assist.
- **Fix sketch**: One-line change to `parsePythonJson<…>(stdout, stderr)` (already imported a directory up; `python-runner.ts:226`), typing the result against the draft shape (`{ profile, signals, archetype, confidence, reasons }`) the way `route.ts:65` types `ProfileCliOutput`.

## 4. Route the evidence-column dropdowns through the enum-label seam
- **Lens**: ui_perfectionist
- **Severity**: Medium
- **Category**: ui
- **File**: `app/features/sub_profile/ProfileEvidenceColumn.tsx:37`
- **Scenario**: In the otherwise fully localized profile builder, the three taxonomy dropdowns show raw machine slugs: skill level (`foundational/working/strong`), skill provenance (`self_declared`, `personal_project`, `open_source`…) and evidence kind (`extracurricular`, `certification`…) — snake_case English in both locales, sitting next to selects the editor *does* localize (family/education/seniority via `useEnumLabel`, `ProfileEditor.tsx:296-297,326`).
- **Root cause**: `ProfileEvidenceColumn.tsx:37-39, 46-48, 67-69` renders `<option key={x}>{x}</option>` — the raw generated values from `taxonomy.generated.ts`, with the option *text* doubling as the wire value. The display never passes through `useEnumLabel`, even though the `enums.provenance` catalog already exists in en ("prod", "intern", "self"…) and cs ("praxe", "stáž", "vlastní"…) — built for badges elsewhere but skipped here.
- **Impact**: The intake form recruiters use to encode the product's signature provenance model is the one place provenance reads as developer vocabulary; for the Czech-market user it is also untranslated, undercutting the just-finished bilingual sweep on the exact surface that teaches what provenance means.
- **Fix sketch**: `<option key={x} value={x}>{enumLabel("provenance", x)}</option>` (explicit `value` now that text ≠ value), same for `level`/`kind` with new `enums.level` / `enums.evidenceKind` catalog groups in en/cs — `useEnumLabel`'s `labelize` fallback keeps unmapped slugs rendering gracefully, matching its documented degrade path.

## 5. Allow retiring an archetype — the manager can create but never delete
- **Lens**: business_visionary
- **Severity**: Medium
- **Category**: maintenance
- **File**: `app/api/archetypes/route.ts:17`
- **Scenario**: A recruiter experimenting with the taxonomy creates a test archetype (or typos an id — the id field is only editable at create, `ArchetypeManager.tsx:297-301`). It is now permanent: a forever-empty column in the candidate matrix, a row in the manager's list, and — if given an `applyLabel` — a live option *candidates see* in the apply chat's self-declaration step (`apply.ts:46`). Nothing in the UI or API can remove it.
- **Root cause**: The archetype API exposes only GET/POST (`app/api/archetypes/route.ts:8,17`) and PUT (`app/api/archetypes/[id]/route.ts:6`); no `deleteArchetype` exists anywhere in `app/` (grep), and `ArchetypeManager` renders only New/Edit affordances. Contrast: profiles got a full DELETE route in the same area (`app/api/profile/route.ts:165`).
- **Impact**: The taxonomy — the lens every candidate is routed and fairness-shielded through — accretes junk with no hygiene path; a stray candidate-facing apply option is a credibility risk in a candidate-facing flow, and dilutes the genuine choices the fairness routing depends on (`MIN_ARCHETYPE_OPTIONS_TO_OFFER` logic, `apply.ts:59`).
- **Fix sketch**: Add `DELETE /api/archetypes/[id]` in the registry helper (mirror `createArchetype`'s validation seam), refusing to delete an archetype any saved profile/analysis currently routes to (or reassigning those to `bau` with a count-confirm) — `CandidateMatrix.tsx:44` already tolerates unknown archetype ids as extra columns, so historical rows degrade gracefully. Surface as a guarded "Delete" button with confirm in `ViewPanel`, following the existing destructive-action patterns elsewhere in the app.
