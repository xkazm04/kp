# Regulatory backlog — compiled 2026-09-08

What this is: the synthesis of four parallel regulatory research lanes (EU AI Act,
GDPR/recruiting, LLM-provider data terms, adjacent regimes) mapped onto the features
kp actually ships. It is the **work list**; `ai-act-conformity.md` remains the
article-by-article conformity map and `app/_lib/trust-posture.ts` remains the public
projection. When those three disagree, the module is the live truth and this file is
the plan.

**This is an engineering artifact, not legal advice.** Every item names its source and
its confidence. Items marked ⚠️ rest on secondary sources and must be re-verified by a
human before they reach a customer document.

---

## 0. The two lenses, stated once

Every finding below is graded twice, because kp is two products with one codebase.

| Lens | Who is who | What a finding means |
| --- | --- | --- |
| **OSS self-host** (AGPL, operator runs it) | The operator is the **GDPR controller** and the **AI Act deployer** (Art. 26). kp-vendor is still the **provider** (Art. 16) — Art. 2(12)'s open-source exemption explicitly does **not** reach high-risk systems, Art. 5, or Art. 50. | kp's duty is to make the operator's duty *dischargeable*: ship the knob, ship the document, and never hard-code a wrong default. A bad default is kp's fault even when the breach is theirs. |
| **kp-SaaS** (vendor hosts it) | kp is the **processor** for candidate data and the **controller** for account/billing, and is simultaneously the AI Act **provider** and a **deployer** for its own operations. | kp carries the duty directly. Art. 28/30/32/33 attach to kp, and a provider posture that is merely "disclosed" in OSS must become **enforced** in SaaS. |

The asymmetry that matters: **the OSS build is often the *worse* case, not the safer
one.** A keyless self-hosted install generates unmarked synthetic speech, seals its
decision chain with no HMAC key, and routes to whichever model endpoint the operator's
key happens to belong to. "They can run it offline" is true and is not a defence for
what the default does.

---

## 1. The headline: the clock this repo was counting down to has moved

**Annex III high-risk obligations now apply from 2 December 2027, not 2 August 2026.**
Regulation (EU) 2026/1744 (the AI Omnibus) entered into force 27 July 2026. Verified
against the Commission's own page on 2026-09-08:
<https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai> — *"Rules
for systems used in certain high-risk areas — including … employment … will apply from
2 December 2027."*

Three research lanes reached this independently. It was also filed inside this repo by
the craft scan of 2026-08-20 and not acted on, and `LAST_REVIEWED` was bumped to
2026-09-04 with the wrong date left standing — which is the actual lesson: **one review
date cannot cover both "read against the code" and "read against the law."**

What did **not** move, and therefore binds today:

| Regime | In force since | Exposure |
| --- | --- | --- |
| **Art. 5 prohibitions** — incl. 5(1)(f) emotion inference in the workplace | 2 Feb 2025 (penalties 2 Aug 2025) | €35M / 7%. **No safeguard cures a breach**; oversight and disclosure are irrelevant to it. |
| **Art. 50 transparency** — disclosure (50(1)) and synthetic-content marking (50(2)) | 2 Aug 2026; marking grace for pre-existing systems ends **2 Dec 2026** | €15M / 3%. The only 2026 deadline kp has. |
| **Art. 4 AI literacy** (softened by the Omnibus to an effort obligation) | 2 Feb 2025; enforceable 2 Aug 2026 | Low, but currently zero coverage. |
| **All of GDPR** | — | Unaffected by any AI Act date. |
| **National employment law** (DE/FR/CZ) | — | **Stricter than the AI Act in all three of kp's markets, with no high-risk gate.** |

**The deferral is a 15-month runway, not a reprieve.** kp ships continuously, so
Art. 111 grandfathering is unavailable in practice — any material scoring or automation
change voids it. Plan for full applicability on 2 Dec 2027.

---

## 2. Backlog — ordered by (live obligation × wrongness of a public claim) ÷ cost

Status vocabulary: **OPEN** · **PARTIAL** · **DONE**. `R-` ids are this document's.

### Tier 1 — public claims that are currently false or stale

These are not gaps. They are statements kp publishes that the code or the law
contradicts, on an indexed page whose entire thesis is that its claims are checkable.

| id | Finding | OSS lens | SaaS lens | Size |
| --- | --- | --- | --- | --- |
| **R-01** | `/trust` publishes `appliesFrom: "2 August 2026"`. Wrong since 27 July 2026. Repeated in the conformity pack, the compliance README and `BACKLOG.md`. | identical | identical | S |
| **R-02** | `/trust` Art. 12 row claims a *"tamper-evident hash chain (HMAC-SHA256, key rotation, anti-downgrade)"* **unconditionally**. The reference deploy is **keyless** (`KP_DECISION_HMAC_KEY` unset ⇒ plain SHA-256, `key_id=''`), which is integrity-evident but **not** insider-tamper-resistant — and chain **truncation is undetectable at any key setting**. The engineering doc corrected this sentence; the public page did not. | The keyless default IS the OSS default — this is the case the claim describes wrongly. | kp can and should set the key, so SaaS can make the strong claim honestly. | S honesty / M mechanism |
| **R-03** | `DATA_RIGHTS` claims *"Erasure runs as a single transaction across the profile, transcripts, scorecards and the outbox."* True of kp's own store, **false for voice**: ElevenLabs Agents retains conversation audio + transcripts for **2 years by default** in the operator's EL account, and kp's erasure cannot reach it. | Operator's own EL account; kp must tell them to set `retention_days`. | kp holds the EL account — kp's own breach. | S scope / M reach |
| **R-04** | **The candidate-facing AI disclosure states a falsehood.** `aiDisclosure.body` asserts *"A human reviews and makes every advance, offer, and rejection decision; nothing adverse is decided automatically."* `trust-posture.ts` records internally that this absolute is **false in two thirds**: with an `auto` interview-plan gate, `automation-run.ts` ratifies an advance and extends an offer unattended (`actor: "system"`, kind `auto_advanced`). Renders on **8 public candidate surfaces × 4 locales**. The landing page retired the same sentence on 2026-08-28; this one outlived it. **Art. 50(1) is in force now**; GDPR Art. 13(2)(f) applies regardless. This is G16. | Both — the vendor ships the string, the deployer's config falsifies it. | Both | S |
| **R-05** | Landing `landing.trust.oversight.title` = **"EU AI Act ready"** — the unfalsifiable badge `trust-posture.ts`'s own header rejects, three rows from `not_yet`. | identical | identical | S (4 locales) |
| **R-06** | `/api/compliance` is **not** on the public allow-list, so on any password-protected deployment the candidate disclosure silently falls back to the EU regime and a hardcoded 12-month retention, whatever the workspace actually enforces. The route also ignores `workspaceId`. Under-disclosure in the direction `consentRetentionMonths()` rounds up to avoid. | Bites every self-host that sets an operator password. | Bites SaaS harder (multi-tenant). | S |

### Tier 2 — live obligations with no coverage

| id | Finding | OSS lens | SaaS lens | Size |
| --- | --- | --- | --- | --- |
| **R-07** | **Art. 50(2) synthetic-content marking: entirely absent.** The AI voice interview generates fully synthetic audio delivered to a candidate. No watermark, no C2PA, no marking anywhere in `packages/voice-tts` or `app/api/tts`. Grace ends **2 Dec 2026**. A final **Code of Practice on Transparency of AI-Generated Content** (10 Jun 2026, ~190 signatories) is an accepted compliance vehicle; non-signatories must demonstrate adequacy individually. | **Worse in OSS**: keyless Piper/Kokoro produce wholly unmarked speech. | kp can pin marking-capable providers. | M + one decision |
| **R-08** | **Art. 5(1)(f) — kp is compliant by one unpinned prompt line.** kp stores transcripts only (never audio) and `automation.py` instructs *"Rate substance, not delivery: never lower a rating for nerves, hesitation, filler words, silences, a slow start, or imperfect grammar/accent."* Prosody-based affect inference in hiring is **per se unlawful, uncurable, 7%/€35M**. No test pins that sentence; `OBLIGATIONS` has no Art. 5 row; and the ElevenLabs agent platform ships conversation-analysis features that would produce exactly the prohibited signal if enabled. | Both exposed (prohibition binds provider and deployer). | Both | S |
| **R-09** | **Art. 15(5) prompt-injection screen exists, is wired, and has no test.** `authenticity.py` `prompt_injection_checks` flags imperative injections, zero-width/invisible characters and token stuffing on every CV at `pipeline.py`; `test_authenticity.py` never calls it. The one control answering Art. 15(5) on the highest-volume untrusted input is unpinned. Also: it is a **detector, not a sanitiser** — raw CV text still reaches the model. | identical | identical | S test / M neutralise |
| **R-10** | **Art. 4 AI literacy** — zero hits across `app/` and `docs/`. Softened to an effort obligation, enforceable since 2 Aug 2026. Deployers' recruiters are exactly the target. Do not conflate with Art. 26(2), which is unsoftened and lands on the customer. | Deployer's duty; kp ships the material. | kp's own + its customers'. | S |

### Tier 3 — provider and egress posture (the dual lens is sharpest here)

| id | Finding | OSS lens | SaaS lens | Size |
| --- | --- | --- | --- | --- |
| **R-11** | **The Claude CLI route is kp's default and is not a permitted configuration outside a dev box.** `claude_cli.py` deliberately strips `ANTHROPIC_API_KEY` so the child bills the *subscription*; `registry.py` makes `claude_cli` the engine when no `llm_config` row exists, and a keyless production box falls through to it. Anthropic's Consumer Terms forbid commercial/business use, carry **no DPA**, and since 2025-08-28 default Free/Pro/Max — **explicitly including Claude Code** — to training with **5-year retention**. `docs/architecture/llm-provider-layer.md` already says "local/dev only"; **nothing enforces it**. | **Not acceptable** for a customer's production install. Needs a refusal, not a doc line. | **Prohibited outright** (OAuth is "individual use only"). | S guard / S disclosure split |
| **R-12** | **Gemini free tier trains on candidate CVs, with human review** — except for EEA/CH/UK operators, who get Paid terms even on the free tier. `cv_analysis` requires `CAP_FILE_INPUT`, advertised only by `gemini`, so the whole-CV upload is **hard-routed** to the Developer API and no config row can move it. kp never asks whether the key is billing-enabled. | The realistic OSS default, and worldwide distribution means most operators are outside the carve-out. | kp controls the key. | S warning / M probe / M Vertex |
| **R-13** | **Google Search Grounding cannot be placed under Zero Data Retention** (30-day storage, no way to disable) — and kp enables it on the CV/salary path. A ZDR-approved customer still leaks the one call carrying the whole CV. The File API upload is likewise not ZDR-covered and needs explicit deletion. | identical | identical | S |
| **R-14** | **"OpenRouter" alone is not adequate Art. 28 sub-processor disclosure** (EDPB Opinion 22/2024: identity of *all* processors down the chain, proactively). Worse, the adapter sends only attribution headers — **not** the documented `{"provider":{"zdr":true,"data_collection":"deny"}}` block — so kp asserts nothing about who served a candidate's CV. That block is small and additive-only. ⚠️ A secondary source alleges an *irrevocable commercial-use grant* once prompt logging is enabled; unconfirmed and disqualifying if real. | Operator's own account. | Do not offer, or pin to one disclosed downstream. | S code / S docs |
| **R-15** | **Anthropic and OpenAI are verified NOT DPF-certified** (queried the official register across all statuses). kp's default provider is Anthropic. SCCs + a transfer-impact assessment are mandatory, not optional. kp asserts **nothing** about transfer bases anywhere. Also: no Bedrock/Vertex adapter, so **EU-resident Claude or Gemini inference is unreachable through kp in any configuration**. | Operator must do their own TIA; kp should hand them the facts. | kp's own Chapter V exposure. | S docs / M adapters |
| **R-16** | **Two good configurations kp already reaches and tells nobody about**: Qwen has a **Frankfurt** endpoint (`eu-central-1.maas.aliyuncs.com`) reachable today via `baseUrl`, and kp ships a **self-hosted voice** path (Gravitone, `ELEVENLABS_BASE_URL`) that answers R-03 and R-07 outright. Neither appears on `/trust`. Azure OpenAI in the customer's own tenant with Modified Abuse Monitoring is the strongest posture in the matrix and is rendered as one bare line. | This is the OSS story and it is under-sold. | The enterprise answer. | S |
| **R-17** | **The synthesis fix: a provider-posture registry in code.** `trust-posture.ts` is already pure testable data with a coverage test binding `SUBPROCESSORS` to `LLM_PROVIDERS` (the mechanism that caught the undisclosed `qwen` adapter). Extend it with declared, sourced fields — `trainsOnInputs`, `retentionDays`, `zeroRetention`, `euRegion`, `dpa`, `transferBasis`, `dataClass`, `sourceUrl`, `verifiedOn` — render them on `/trust`, and let a test assert every provider has a row and none is stale. **Per-row `verifiedOn` is exactly what one global `LAST_REVIEWED` hid in R-01.** | Turns two columns of prose into something a reviewer can act on. | Lets kp-SaaS **refuse to route** to any provider whose posture is `trainsOnInputs !== "no"` — which converts R-11 and R-12 from documentation into enforcement. | M |
| **R-18** | **Blind screening exists, fails closed, and is off by default.** `--blind` redacts name/contact/photo/gendered terms/age and sends redacted *text* instead of uploading the file, so **the photo never reaches the model** — and it refuses rather than silently uploading when redaction is impossible. It is reachable from exactly one place (the manual Analyze tool) and **the automated screening path never sets it**. So the decisions that actually matter under Art. 22 run on the unredacted CV including the photo. Cheapest high-value fix in the whole review. ⚠️ Never claim "we send no personal data" — a name-stripped CV is a quasi-identifier dossier and remains personal data. | identical | identical | S |
| **R-19** | Telemetry is clean and unclaimed: `llm_usage` holds counts and costs only — **no prompt, no response, no candidate reference** — and LightTrack is the operator's own self-hosted service, off by default, receiving no prompt text. Two edges: the TS-side error field forwards 500 bytes of provider-authored text (the Python half already reduces this to a code), and `KP_OFFLINE` allow-lists the LightTrack host. | Say it on `/trust`; it is a genuine differentiator. | Same. | S |
| **R-20** | CV bytes land in `os.tmpdir()/jobfit-*`; a crash between `createWorkdir` and `cleanupWorkdir` leaves candidate CVs on disk. | identical | identical | S |

### Tier 4 — GDPR: the conceptual gaps

These are the deepest findings and the most expensive. They are not mechanical
failures — kp's mechanisms are ahead of the market — they are the **model** being wrong.

| id | Finding | OSS lens | SaaS lens | Size |
| --- | --- | --- | --- | --- |
| **R-21** | **No lawful basis is modelled anywhere, and "consent" is the wrong one.** `recordEntryConsent` is a retention clock with no opt-in artifact. EDPB, CNIL, ÚOOÚ and the German DSK all say consent is **invalid** for an application (power imbalance) and the basis is Art. 6(1)(b)/(f) — while consent **is** the right basis for a talent pool, which kp does not record. kp has it exactly inverted. (The voice interview, by contrast, implements real Art. 7 consent correctly.) | Controller's call; kp must model the *choice*. | kp must document it per tenant. | M |
| **R-22** | **Consent is fabricated for people who never applied.** `lead-intake.ts` and `cv-intake.ts` stamp `granted` consent events for job-board webhooks, pull sources and recruiter uploads — a false entry in the Art. 5(2) accountability log. **GDPR Art. 14** (notice when data was not obtained from the subject) appears **nowhere** in the codebase. Enforcement precedent: AEPD PS/00237/2021, fined for exactly this on an unsolicited CV. | Both. | Both. | M |
| **R-23** | **One global 365-day TTL, defensible in no jurisdiction.** ~2× too long for Germany (AGG §15(4) + ArbGG §61b ⇒ ~6 months); wrong-shaped for France, whose référentiel was **rewritten by délibération 2026-031 of 29 Jan 2026**. The clock anchors at intake and never re-anchors. `KP_CONSENT_TTL_DAYS` is not even in `.env.example`. ⚠️ **CNIL made recruitment retention a 2026 priority control theme.** | The knob exists; the defaults and the jurisdiction-awareness do not. | kp sets it per tenant. | M–L |
| **R-24** | **The privacy feature creates a labour-law liability.** No intermediate-archive state exists, and `anonymizeExpiredConsents` sweeps globally without exempting terminal rows — so at day 365 it destroys the **5-year discrimination evidence a French employer is obliged to keep** (code du travail L.1134-5) and scrubs hired employees. | Both. | Both. | M |
| **R-25** | **`/data/[token]` returns a category list, not an Art. 15(3) copy** (CRIF: *"a faithful and intelligible reproduction"*; Nowak puts recruiter notes and transcripts in scope). And nothing delivers Art. 15(1)(h) **logic** to the standard **CJEU C-203/22 *Dun & Bradstreet* (27 Feb 2025)** sets — a **counterfactual**, "what would have had to change", rejecting both a formula dump and a step trace. kp has the raw material (`evidenceTrace`, `provenance-dossier`, sealed decisive facts) and it is all operator-only. | Both. | Both. | M |
| **R-26** | **Art. 22(3) contest is prose with no mechanism.** *"Just reply to any message from the hiring team"* — no link, no record, no SLA, no named contact, not at the point of decision. WP251 asks for *"a link to an appeals process at the point the automated decision is delivered… with agreed timescales and a named contact point."* | Both. | Both. | M |
| **R-27** | **SCHUFA (C-634/21) puts the match score itself inside Art. 22** where a recruiter draws on it decisively — **today**, regardless of the deferred AI Act timeline. kp's Art. 22 machinery is strong; the finding is that kp never *names* this basis. `/trust` has no GDPR section at all. | Both. | Both. | S docs |
| **R-28** | **A DPIA is mandatory** for AI CV screening, and France, Germany and Czechia each name this processing on their Art. 35(4) lists. kp ships no template. | Deployer's duty; kp should hand them a template. | kp's own. | M |
| **R-29** | **The entire Art. 28/30/33 SaaS contract layer does not exist**: no DPA, RoPA, sub-processor register with addresses or change-notification, breach runbook, TIA, or **tenant-deletion endpoint** (export/import exist, so Art. 28(3)(g) has only the "return" half). ⚠️ EDPB 9/2022: kp's breach notification *starts the customer's 72-hour clock*. | Not applicable — the operator is the controller. | **Blocking for launch.** | L |
| **R-30** | Two `ConsentEventKind` values — `expiring_notified` and `erasure_requested` — have **no writer**, yet the recruiter panel renders copy for `expiring_notified` and `CONSENT_EXPIRING_DAYS = 30` exists for a reminder nothing sends. A candidate is never warned before anonymisation. Implementing it is also the natural place to ask for talent-pool consent (R-21). | Both. | Both. | S |

### Tier 5 — the national layer, which binds today and outranks the deferral

No high-risk gate applies to any of this. It is stricter than the AI Act in all three
of kp's markets.

| id | Finding | Size |
| --- | --- | --- |
| **R-31** | **Germany — BetrVG § 95(2a)** makes AI-generated selection criteria **co-determined**: kp's weightings and family floors *are* Auswahlrichtlinien, and a customer who cannot enumerate them cannot run its own statutory procedure. **§ 80(3)** makes a works-council expert presumptively necessary at the employer's expense — and that expert will read kp's documentation. Germany **is** designated (KI-MIG in force 29 Jul 2026, BNetzA); France and Czechia are not. | M docs |
| **R-32** | **France — the CNIL already treats algorithmic sorting as *"en principe interdits"*** (fiche 13) and a rubber-stamped recommendation as fully automated; **recruitment is its 2026 priority control theme**, explicitly as an AI Act dry run. `L1221-8/L1221-9`: candidates must be informed of evaluation methods **before** use, methods must be relevant, and *"les résultats sont confidentiels"* — which constrains cross-client benchmarking and score reuse. | M docs |
| **R-33** | **Czechia — zák. o zaměstnanosti § 12(2)** lets a candidate demand the employer **prove the necessity of each data point**, SÚIP-enforced to **CZK 1m today**. kp's primary market. | M docs |
| **R-34** | **Enumerate the selection criteria.** One machine-readable criteria/weighting manifest per workspace serves § 95(2a) co-determination, § 12(2) necessity proof, and fiche 13's explainability at once. The data exists; it is not assembled. | M code |
| **R-35** | **`REGIME_IDS` treats the EU as one bucket** (`compliance-regimes.ts`) and cannot express any of R-31…R-33. Add `de`, `fr`, `cz`. | S |

### Tier 6 — the documentation chain (the 15-month runway)

The paradox worth naming: **kp's mechanisms are ahead of its documentation, and the AI
Act is a documentation regime.** The deferral is almost exactly enough time to close
that asymmetry.

| id | Item | Art. | Size |
| --- | --- | --- | --- |
| **R-36** | `RISK_MANAGEMENT.md` + DPIA (G1). Every input already exists in fragments: hazards named in the pack, mitigations = the Art. 14/15 mechanisms, residual risks = the published gaps. Needs a review cadence and a named owner. | 9 | M |
| **R-37** | `INSTRUCTIONS_FOR_USE.md` (G2). **Highest leverage in the whole list** — it is the vehicle for R-10, R-15, R-23's retention statement, the declared accuracy of R-38, Art. 26(7), the Art. 27 narrowing, and the deployer half of everything in Tier 5. | 11, 13, 26 | M |
| **R-38** | **No declared accuracy figure.** Art. 15(3) wants numbers in the instructions for use; kp measures continuously (calibration, Brier, sealed holdout, label-leakage taxonomy) and publishes none. Safe direction, not compliance. | 15(3) | M |
| **R-39** | **Roles and responsibilities in `self-hosting.md`** — 36KB with **zero** AI Act role language. Must state the deployer/provider split **and enumerate which configuration changes kp treats as foreseen in its own conformity assessment**. Art. 3(23)'s test is drafted so the provider's own assessment sets the envelope, and the Art. 25 value-chain guidelines are announced only — **so kp gets to define this while the Commission is silent.** A genuine competitive asset; nobody publishes it. | 25, 26 | M |
| **R-40** | **The JD builder is inside the high-risk system** and the classification never mentions it. Draft Art. 6(5) guidelines para 247: a generator that derives qualifications *itself* — and that feeds a scorer that evaluates CVs against them — is **not** a narrow procedural task. Para 90 independently blocks unbundling. kp's builder does both. | 6, Annex IV | S |
| **R-41** | Art. 17 QMS, and Art. 18/19/20/21/25/43/47/48 — **the gap register tracks ~11 of ~20 provider-binding articles**, so "what remains is almost entirely documentation" is right in substance but drawn from a partial list. | 17–21 | M |
| **R-42** | Art. 72/73 post-market monitoring + serious-incident process (G10), and **no incident contact channel exists in either direction**. Publish a security/incident contact now (S); the plan can follow. | 72, 73 | S + M |
| **R-43** | Art. 43 internal-control assessment → Annex V declaration of conformity → CE marking → Art. 49 EU-database registration (G14). **No longer premature** — 15 months is exactly this horizon. kp qualifies for the **SME/small-mid-cap simplified technical-documentation template**. | 43, 47–49 | L |
| **R-44** | `audit_events` for auth/config/PII-read/export (G4) and signed SIEM export (G7). | 12 | M each |
| **R-45** | **No harmonised standard is citable** — zero OJEU citations, so the Art. 40 presumption is unavailable **to anyone**. EN 18286:2026 (QMS) is published but not cited; M/613 expires 28 Feb 2027, nine months before the obligations. Annex IV §7 should say this is the state of the art, not read as a kp gap. | 40, 41 | S |
| **R-46** | **Art. 10(5) tightened** by the Omnibus: special-category processing for bias detection is permitted only in exceptional circumstances. This **vindicates** kp's no-demographic-data posture (G13) — write it up as a deliberate mitigation choice with its cost (no in-product disparate-impact measurement), not as an admission. | 10 | S |
| **R-47** | **Art. 86 is under-claimed.** `/trust` says `partial`; `status-decisions.ts` derives a redacted explanation **from the sealed record** and renders it on `/status/[token]`. The pack itself says the residual limit is by design. Under-claiming a shipped control costs as much credibility as over-claiming one. Fix the dropped unknown-actor chip first. | 86 | S |
| **R-48** | **GPAI/Annex XII intake**: kp is a *downstream* provider, so Art. 53 does not bind it — but the mirror duty runs toward kp, and nothing records per provider/model what Annex XII documentation was obtained. `llm_usage` + the prompt-version lockstep are a better evidence base than most vendors have, just unassembled. Honest asymmetry: `ollama`/`qwen` self-hosted routes have no upstream Annex XII at all. | 53, Annex XII | M |

### Tier 7 — adjacent regimes

Lane 4 (pay transparency, Cyber Resilience Act, NIS2, accessibility,
anti-discrimination, works councils, non-EU) was interrupted by a rate limit and
re-dispatched. **This section is provisional until it lands.** Known pointers:

| id | Item | Why it matters here | Size |
| --- | --- | --- | --- |
| **R-49** | **EU Pay Transparency Directive (2023/970)**, transposition due 7 Jun 2026: pay range in the ad or before interview, and a **ban on asking about pay history**. kp extracts a **salary anchor from the CV** and builds JDs from Market Pulse data. Both sides of the directive touch shipped features. | JD builder, CV analysis, interview scripts, offer flow | TBD |
| **R-50** | **Cyber Resilience Act** reporting obligations from **11 Sep 2026** — three days out. Does a self-hostable OSS web app count as a product with digital elements? The open-source-steward carve-out vs the SaaS offering. kp already ships `npm run sbom`; a coordinated vulnerability-disclosure policy / `security.txt` is the cheap half. | Distribution of the self-host build | TBD |
| **R-51** | **European Accessibility Act** (in force 28 Jun 2025), EN 301 549 / WCAG 2.1 AA. kp runs axe checks on the landing and public marketing pages; **the candidate token surfaces** (apply, schedule, interview, status, offer, devcase) are the ones a candidate is compelled to use. | e2e a11y coverage | TBD |

---

## 3. What is genuinely strong, and is currently under-claimed

Stated because a backlog that lists only gaps misrepresents the codebase, and because
several of these are differentiators kp is not selling.

- **Art. 14 human oversight** — a signed, cohort-bound, single-use approval token; a
  refusal to seal an unattributable bulk rejection; AUTO1 retired; a fail-closed clock
  pause reaching every discretionary pass with one documented statutory exemption. Well
  beyond the obligation, and the hardest thing here to retrofit.
- **Art. 5(1)(f)** — kp does not infer emotion. Competitors scoring "enthusiasm" are in
  per-se-unlawful territory.
- **Art. 10(5) / Art. 4a** — no demographic data by design; proxy neutrality tested by
  **perturbation** (byte-identity across Czech M/F `-ová`, Vietnamese, Ukrainian, Arabic
  and Roma-associated names) rather than by collecting protected attributes.
- **Art. 15(5)** — a wired deterministic prompt-injection and hidden-character screen on
  the CV path. Rare in this product category.
- **Art. 86** — a redacted, sealed-record-sourced candidate explanation, shipped before
  the obligation applies.
- **The erasure discipline** — `erasure-full-scrub.test.ts` **parses the erasure SQL** and
  holds it against the tenancy manifest, so the claim cannot outrun the code; `ERASURE_EXEMPT`
  is a DPO-readable table where each exemption carries its reason; erasure is exactly-once
  under concurrency and survives a re-seed.
- **The egress floor** — `KP_OFFLINE` as one `fetch` wrap plus a Python `is_local_url` gate
  that refuses a configured `base_url` resolving to a public host; provider keys refused
  rather than stored plaintext; capability tokens kept out of analytics by one list driving
  both the exclusion and the tracker.
- **Prompt-free telemetry** — `llm_usage` records counts and costs only, with `reason`
  constrained to a closed vocabulary precisely because a provider message can echo a prompt.
- **The honesty discipline itself** — a coverage test binding the subprocessor table to the
  product's own provider list (which is how an undisclosed `qwen` adapter was caught), and a
  public page ordered weakest-first. **Under Art. 17 this IS quality-management evidence.**
  It has simply never been described as such.

---

## 4. Verification debt

Do not put any of these in a customer document until a human has opened the primary source.

1. **DONE 2026-09-08** — the Annex III date, verified against the Commission's own page
   (2 December 2027, Reg. (EU) 2026/1744).
2. `dataprivacyframework.gov` participant status for Anthropic, OpenAI, Microsoft,
   ElevenLabs, with the date checked. (Google LLC is confirmed.)
3. OpenRouter's **primary** privacy text for the alleged irrevocable commercial-use grant
   on logging (R-14) — disqualifying if real — and its DPA tier.
4. Commission Guidelines C(2025) 884 for the paragraph placing hiring inside "workplace"
   (R-08); the PDF did not parse.
5. OpenAI's DPA and sub-processor list, and ElevenLabs' sub-processors (all JS-gated or 403).
6. Whether kp deletes the Gemini File-API upload handle after a CV analysis (R-13).
7. Whether the OpenAI **Realtime** adapter honours `OPENAI_BASE_URL`, before anyone claims
   EU residency for voice.
8. Polar's DPA (the published URL 404s) before kp-SaaS takes a payment.
9. Pinpoint paragraph numbers for C-634/21, C-203/22, C-413/23 P and C-184/20 — currently
   single-sourced.
10. The Netherlands AP Art. 35(4) list, and Czech zákon 110/2019 Sb. on recruitment retention.

**Two watch items with dates:** EDPB Guidelines 02/2026 on **anonymisation** (consultation
open to 30 Oct 2026, expressly covering generative AI) — directly relevant to R-24's
"anonymised" record actually being pseudonymised. And CNIL's **2026 recruitment control
campaign**, already under way.

**Re-check quarterly.** The two events that change this plan are adoption of the Art. 6(5)
classification guidelines (targeted end-2026) and the first OJ citation of a harmonised
standard.
