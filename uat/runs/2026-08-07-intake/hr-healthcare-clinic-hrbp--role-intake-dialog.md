# L1 certification — Priya Nair (hr-healthcare-clinic-hrbp) × role-intake-dialog

- **Level:** L1 (theoretical, code-grounded — no browser)
- **Date:** 2026-08-07
- **Character:** Priya Nair, HR Business Partner, private clinic group (UK, CQC-registered) — language **en**
- **Journey:** `uat/journeys/role-intake-dialog.md` — "from a feeling of 'something's missing' to a defensible role brief"
- **Behavior mode sampled (designed experience):** `over_specifier`-adjacent compliance-first requestor — Priya arrives with a *known* clinical role (backfill RGN, Band 5) and hard licensure gates; her failure mode is a tool that re-shapes her clinical need into a tech-shaped brief.
- **Verdict:** **L1-conditional**

---

## 1. Surface model (import chain, file:line)

Mount: Library tab → Saved/Generate/**Intake** `SegmentedControl`
(`app/features/library/jds/JdsSavedLedger.tsx:103` adds `{ value: "intake" }`;
`:45` mounts `JdsIntakePanel` Tier-3 dynamic — chat only pays its weight when opened; `:123` passes `onPromoted={reload}` so the promoted JD refreshes the ledger).

UI: `app/features/library/jds/intake/JdsIntakePanel.tsx:15` (ledger + session header + Promote button `:86-95`, degraded note `:98`) → `JdsIntakeChat.tsx:13` (bubbles + composer; Enter submits `:74-79`; closed state disables `:71-85`) + `JdsIntakeBriefPanel.tsx:28` (live brief; `ProvenanceChip` `:12-17` renders stated/inferred/default) — state/API in `jdsIntakeLogic.ts:35` (`useIntakeLogic`: optimistic send + rollback `:106,139`; `degraded` from `source === "deterministic"` `:121`; stale-session guard `activeIdRef` `:44`).

API: `app/api/intake/route.ts:15` POST (create + deterministic opener seeded into transcript `:23-25`), `:32` GET ledger; `app/api/intake/[id]/route.ts:9` GET session; `app/api/intake/[id]/message/route.ts` POST one exchange — operator-gated, then cheap refusals (404/409/400) **before** the per-IP `rateLimit` 30/10min, pinned by `app/api/rate-limit-contract.test.ts:119-128`; `app/api/intake/[id]/promote/route.ts` POST → `briefReadyToPromote` gate → `insertAnalyzingJd` + `startTask("jd_build", {... brief ...})` + `markIntakePromoted` with deterministic `jdJobId(slug)`.

Lib: `app/_lib/intake-run.ts:39` (`runIntakeOpening` — no LLM env passed, opener identical keyless/keyed) and `:46` (`runIntakeExchange` — spawns `python -m pipeline.jobfit.intake_cli` per message, transcript/brief via workdir files); `app/_lib/intake-brief.ts:20` (`needTextFromBrief`), `:57` (`briefReadyToPromote` = title + ≥1 must or 90-day outcome); `app/_lib/db/intakes.ts` — every query workspace-scoped (`:98,105,119,156,188,207`), colocated `intakes-tenancy.test.ts` exists; `updateIntakeDialog` runs IMMEDIATE (`:154-176`) so racing messages serialize.

Python: `pipeline/jobfit/intake_cli.py:33` (per-exchange CLI; `--no-llm`; provider `resolve_provider("role_intake")` `:54` with documented unavailable→deterministic dance `:56`) → `pipeline/jobfit/intake.py` — persona constants `:49-109`, deterministic slot script `:188-391`, `merge_brief` `:399`, `run_intake_turn` `:477` via `generate_with_fallback`; schema `pipeline/jobfit/rolebrief.py:99` (`RoleBrief`), coercion `:141`, `role_brief_from_spec` / `brief_job_requirements` bridges `:206,237`. Promote consumer: `app/_lib/jd-build-run.ts:229-244` (brief fills DevNeed stack/responsibilities/seniority/roleFamily).

Schema-breadth evidence: `pipeline/jobfit/eval/intake_scenarios_gen.py:53-58` — a `healthcare_clinical` family with musts `["valid nursing licence", "patient documentation"]`, ward-round 90-day outcome, burnout urgency; `taxonomy.py:126-130` — 16 role families from the active market block. `intake_eval.py:31,158` gates `brief_core` (title + ≥1 requirement) — **no assertion anywhere that the brief's `role_family` lands on the scenario's family** (grep over `intake_eval.py`: zero `role_family` matches).

## 2. Grounding audit — 9/10

Checklist per the journey ("cite the constants"; score how much real context reaches the prompt):

| # | Check | Evidence | |
|---|---|---|---|
| 1 | One question per turn | `intake.py:61` (rule 1) | ✓ |
| 2 | Reflect-before-ask, expansion paraphrase | `:62-65` (rule 2) | ✓ |
| 3 | Reuse the requestor's words | `:66-68` (rule 3) | ✓ |
| 4 | Ladder every must (what breaks without it) | `:69-71` (rule 4) | ✓ |
| 5 | Park premature solutions visibly | `:72-74` (rule 5) | ✓ |
| 6 | Name contradictions aloud | `:75-76` (rule 6) | ✓ |
| 7 | 90-day-outcome de-spec filter | `:78-80` (rule 8) | ✓ |
| 8 | Grounded read-back + `<<END>>` gate (`done` requires token: `:506`) | `:90-96` | ✓ |
| 9 | Real context to the prompt: full accumulated brief JSON + last-48-turn transcript + fenced new message + language directive | `:509-516`, `:41`, `:121` | ✓ |
| 10 | **Role-family vocabulary reaches the prompt** — the 16-family catalog (`taxonomy.role_family_catalog`, fed to the *analysis* prompt per `taxonomy.py:149-153`) is **never** given to the intake agent; `_EXTRACTION_RULES` (`:98-109`) instructs on provenance, grading, facets, shape, done — and says nothing about `role_family` | `intake.py:98-109` | ✗ |

This is a genuinely well-fed prompt — the opposite of "good machinery, thin context" — with exactly one hole, and the hole is the one that decides whether my nurse is a nurse (see L1-HRBP-2).

## 3. Walkthrough (cognitive walkthrough, in character)

**Step 1 — find it.** Library → an "Intake" segment next to Saved/Generate (`JdsSavedLedger.tsx:103`). Label matches my mental model ("role intake" is literally my job title's verb). I'd try it. The lede ("Talk the role through instead of writing it") tells me what it does. ✓

**Step 2 — start.** "New intake" → POST creates the row and seeds a fixed opener: "Think about the last month: where did the team feel the missing person most?" (`intake.py:190`). Identical keyless and keyed (`route.ts:10-12` comment, `opening_turn :464-474`) — the first impression can't be a crash. As a clinic with no LLM keys, this matters: **the tool works on day one with zero configuration.** ✓

**Step 3 — the dialog, keyless (my reality).** I type: "Our practice nurse handed in her notice — maternity cover, same role, Band 5." The deterministic shape triage (`:151-160`) looks for backfill/replacement markers; "maternity cover" and "handed in her notice" match nothing (`_POWER_UNIT_MARKERS` `:151-155`), so I get routed to the 10-question story path (`:313`) for a role I could define in five answers. Mild eye-roll, not fatal (each question is skippable, `_SKIP_WORDS :231`).

The questions themselves are **role-neutral and good**: last-month pain, working title, 90 days, dealbreakers, nice-to-haves, languages, team, urgency, budget (`_Q :188-229`). Nothing assumes software. When I answer "valid NMC registration (active PIN), Enhanced DBS eligibility, medicines management" under dealbreakers, each lands as a `must_have`/`prerequisite` requirement with provenance **stated**, confidence 0.9 (`_apply_answer :258-261`) — a **requirement, not a soft facet**, which is the defensible place for licensure: it projects onto the matching engine as a gate (`brief_job_requirements`, `rolebrief.py:237-246`). I could hand that provenance chain to an inspector. ✓

**Step 4 — where it bends tech.** The seniority question offers "junior, medior, senior, or lead" (`:210-212`). I grade nurses in Agenda-for-Change bands. I answer "Band 5, registered nurse" — no token matches (`_SENIORITY_TOKENS :233`, `:267-271`), the brief silently keeps the schema default `"medior"` (`rolebrief.py:105`), and the live panel shows a "medior" chip **with no provenance marker** (`JdsIntakeBriefPanel.tsx:46` — scalars have no provenance field, only requirements/facets do). The read-back then tells me "Role: Practice Nurse (medior)" (`:349`) — a template default dressed as something captured, in the exact surface whose docstring promises "a template default can never masquerade as something the requestor said" (`rolebrief.py:23-26`). The code even knows: "the default 'medior' is indistinguishable from unset" (`intake.py:296`).

Deeper: `role_family` defaults to `"software_engineering"` (`rolebrief.py:106,192`). The deterministic script **never asks about or sets it**. The LLM path is never told the 16-family vocabulary (`_EXTRACTION_RULES :98-109`) and is instructed to carry the current brief forward — which contains `roleFamily: "software_engineering"`; `merge_brief` only accepts a change *away* from that default (`:413`). So my Registered Nurse brief is, structurally, a software-engineering role.

**Step 5 — budget.** "Any compensation range in mind?" — free text, stored verbatim as a `budget_band` facet, provenance stated (`:280`). I can type "NHS Agenda for Change Band 5, £29,970–£36,483" and it survives untouched. **At intake level, no currency assumption.** ✓ (What happens after promote is another matter — below.)

**Step 6 — close, keyless.** After budget, the script is exhausted → read-back listing role, 90-day outcomes, dealbreakers, languages, context facets, then "What did I get wrong or miss? If nothing, I'll save the brief. `<<END>>`" (`_readback :348-362`) — **and `done=True` in the same turn** (`:391`). The route flips status to `complete` (`message/route.ts`: `...(exchange.done ? { status: "complete" } : {})`), and the message route rejects closed sessions with 409. The composer greys out ("This session is closed"). **The correction the read-back just invited can never land.** If the read-back mis-split my comma-list of dealbreakers, my only recourse is a fresh session.

**Step 7 — promote.** Gate is honest and clinical-friendly: title + one dealbreaker or 90-day outcome (`intake-brief.ts:57-62`), with a plain-language hint when unmet (`en.json promoteHint`). Promote reuses the *same* backgrounded jd_build as Generate (`promote/route.ts`), the brief threads structured fields (`jd-build-run.ts:233-244`), the intake is stamped with `jd_slug`/`job_id` so the job walks back to the conversation — an audit trail I'd praise. But the build input carries `roleFamily: brief.roleFamily` = software_engineering (`:244`), and the route hardcodes `marketResearch: true` with no opt-out — so my Band-5 nurse JD gets a **Czech-market tech-family salary read** attached (`taxonomy.py:100-128` — everything derives from `ACTIVE_MARKET`, the ČS/Czech seed). Wrong currency, wrong market, wrong family: my top pet peeve, auto-attached.

**Step 8 — feedback/status.** Every state is spoken: starting/thinking/closed/promoted, send errors roll back the optimistic bubble (`jdsIntakeLogic.ts:139`), degraded mode is disclosed in words I'd accept ("AI is offline — running the guided checklist instead. Your answers are captured all the same."). No silent successes. ✓

## 4. Findings

> Schema: id · type · severity · impact{frequency, reachability, trust_erosion} · code_check · resolution · l2_priority

### L1-HRBP-1 — strength — Licensure lands as a graded, stated requirement (the defensible place)
- **type:** strength (trust) · **severity:** — · **impact:** {frequency: high, reachability: high, trust_erosion: —}
- A typed must-have like "valid NMC registration" becomes `BriefRequirement{kind: must_have, hardness: prerequisite, provenance: stated, confidence: 0.9}` (`intake.py:258-261`), renders with a "you said" chip (`JdsIntakeBriefPanel.tsx:64`, `en.json provenance.stated`), and projects onto matching as a hard gate (`rolebrief.py:237-246`). The eval bank's own `healthcare_clinical` scenario proves the shape holds ("valid nursing licence" as must, `intake_scenarios_gen.py:55`). For compliance defensibility this is right: requirement, not facet. **Do not touch this seam.**
- **code_check:** confirmed-present. **resolution:** — (keep).

### L1-HRBP-2 — quality-gap — `role_family` silently stays `software_engineering` for a clinical role, and rides into the promoted JD
- **type:** quality-gap (wrong-domain) · **severity:** **major** · **impact:** {frequency: high — every non-tech intake, reachability: high, trust_erosion: high}
- The schema default is `"software_engineering"` (`rolebrief.py:106`, re-defaulted in coercion `:192`). The deterministic script never elicits or sets the family (no slot in `_Q :188-229`, no branch in `_apply_answer :245-281`). The LLM path receives the current brief **containing** the default, is told to carry fields forward, and `_EXTRACTION_RULES` (`intake.py:98-109`) never names `role_family` or offers the 16-family vocabulary that `role_family_catalog()` feeds to the *analysis* prompt (`taxonomy.py:149-153`); `merge_brief:413` can only accept a non-default the model was never equipped to produce. Promote then threads it verbatim: `roleFamily: brief.roleFamily || "software_engineering"` (`promote/route.ts` buildInput; `jd-build-run.ts:244`) — family-keyed skill weights and benchmarks (`taxonomy.py:393`) treat my nurse as a software engineer. CI won't catch it: `intake_eval.py` asserts `brief_core` (title+reqs, `:31,158`) but never `role_family`, even though the generated bank is literally organized *by family*.
- **code_check:** confirmed-present (defect confirmed by absence of the elicitation/vocabulary at the cited lines). **resolution:** open. **l2_priority:** **high** — run a clinical intake LLM-path live and inspect the stored brief's `roleFamily`; then check the promoted JD's family/market read.

### L1-HRBP-3 — trust — Default seniority masquerades as captured: scalars carry no provenance
- **type:** trust · **severity:** **major** · **impact:** {frequency: high for non-tech requestors, reachability: high, trust_erosion: high}
- "Band 5 registered nurse" matches no `_SENIORITY_TOKENS` (`intake.py:233,267-271`) → brief keeps default `"medior"` (`rolebrief.py:105`); `_slot_filled` admits the default is "indistinguishable from unset" (`intake.py:296`). The live panel renders the seniority chip with **no ProvenanceChip** (`JdsIntakeBriefPanel.tsx:46` — `RoleBrief` scalars title/seniority/role_family have no provenance field, `rolebrief.py:103-107`), and the read-back prints "(medior)" as if captured (`intake.py:334,349`). This directly breaks the module's own promise ("a template default can never masquerade as something the requestor said", `rolebrief.py:23-26`) and the journey's DoD ("each value marked stated / inferred / default"). Promote then feeds `seniorityTarget: "medior"` to the JD build (`jd-build-run.ts:243`).
- **code_check:** confirmed-present. **resolution:** open. **l2_priority:** medium — confirm the chip absence and read-back wording live.

### L1-HRBP-4 — broken-flow — Keyless close invites a correction it cannot accept
- **type:** broken-flow · **severity:** **major** (keyless is this Character's stated reality) · **impact:** {frequency: med — once per keyless session, at the highest-stakes moment, reachability: high, trust_erosion: high}
- `deterministic_turn` returns the read-back **and** `done=True` in the same exchange (`intake.py:389-391`); the route immediately flips `status: "complete"` (`message/route.ts`), and the message route 409s any non-open session — the composer disables (`JdsIntakeChat.tsx:71-85`, "This session is closed."). Yet the read-back's own text asks "What did I get wrong or miss? If nothing, I'll save the brief." (`:361`) — the answer "something" is unreceivable. The persona's rule — "Never emit `<<END>>` before a read-back was confirmed" (`:94-95`) — is violated by the module's own fallback. If the comma-splitter (`_split_items :236-238`) mangled my dealbreakers, my only path is a new session.
- **code_check:** confirmed-present. **scope_note:** adjacent to the documented "re-opening a completed session" known gap (journey Out-of-scope) — but this is the *close itself* foreclosing the promised correction, not a re-open request; I score it, with the known gap noted. **resolution:** open. **l2_priority:** medium-high — keyless run: answer the read-back with a correction, observe the 409/disabled composer.

### L1-HRBP-5 — quality-gap — Seniority vocabulary is a tech ladder; clinical grading is unrepresentable
- **type:** quality-gap (wrong-domain) · **severity:** minor (major only in combination with L1-HRBP-3, already scored) · **impact:** {frequency: high for clinical roles, reachability: high, trust_erosion: med}
- `junior|medior|senior|lead` is a closed enum (`rolebrief.py:191`, coercion floor `:136-138`); the keyless question literally offers those four words (`intake.py:210-212`, cs `:211`). Agenda-for-Change bands, HCA vs RN vs senior sister — no home except a facet I'd have to improvise. The role-*family* taxonomy can hold nurse/HCA/doctor (16 families incl. `healthcare_clinical`); the *grade* axis cannot. "Medior nurse" is not a phrase anyone at CQC has ever read.
- **code_check:** confirmed-present. **resolution:** open. **l2_priority:** low (fold into the L2 clinical dialog run).

### L1-HRBP-6 — trust — Promote auto-attaches a Czech-market research read with no opt-out
- **type:** trust (wrong-market comp) · **severity:** **major** by this Character's scored criteria ("CZK-only / wrong-market number with no override is a major") · **impact:** {frequency: high — every promote, reachability: high, trust_erosion: high for a banded-pay employer}
- `promote/route.ts` hardcodes `options = { description: true, marketResearch: true, ... }` — unlike the Generate surface there is no toggle at promote time — and all market data derives from `ACTIVE_MARKET` (Czech seed; `taxonomy.py:100-128`), keyed by a role family that L1-HRBP-2 left as software. A UK Band-5 nurse JD arrives with a Prague-tech-market comp read. My stated GBP `budget_band` facet survives *inside the brief* (strength L1-HRBP-9) but nothing pins the market layer to it.
- **code_check:** confirmed-present. **scope_note / ceiling:** the single-market Czech anchor is a documented workspace ceiling (Character file, Surface binding: the ČS seed + workspace lock are a known wrong-domain mismatch) — the *new* information here is the hardcoded `marketResearch: true` with no opt-out on this route. Severity kept per the Character's criterion; the ceiling is named. **resolution:** open. **l2_priority:** medium — promote a clinical brief and inspect the JD's market panel.

### L1-HRBP-7 — confusion — Backfill phrasing from care work misses the fast path
- **type:** confusion (shape economics) · **severity:** minor · **impact:** {frequency: med, reachability: high, trust_erosion: low}
- `_POWER_UNIT_MARKERS` (`intake.py:151-155`) knows backfill/replacement/"same as"/clone; "maternity cover", "she handed in her notice", "going on leave" — the shapes clinical backfills actually take — match nothing, and with no story-marker either, two turns default to `story` (`:172-173`) → the 10-slot path (`:313`) instead of 6. Keyless there is no override (the LLM may re-triage, `:505`). Each extra question is skippable, so cost is minutes, not completion.
- **code_check:** confirmed-present. **resolution:** open. **l2_priority:** low.

### L1-HRBP-8 — strength — Keyless honesty is real, not decorative
- **type:** strength (trust/clarity) · **impact:** {frequency: high, reachability: high}
- The opener is deterministic by design so keyless and keyed first impressions are identical (`intake/route.ts:10-12`, `intake.py:464-474`); provider-unavailable degrades to the same-schema script (`intake_cli.py:54-56`, `generate_with_fallback :518-526`); the UI names the degradation in honest words (`JdsIntakePanel.tsx:98`, `en.json degradedNote`: "AI is offline — running the guided checklist instead. Your answers are captured all the same."), and everything the requestor typed is provenance-`stated` (`:245-281`). A clinic with zero LLM configuration gets a working, honest guided intake. **This is the adoption-critical property for my segment, and it holds.**
- **code_check:** confirmed-present. **resolution:** — (keep).

### L1-HRBP-9 — strength — Budget is free text: GBP bands survive verbatim
- **type:** strength · **impact:** {frequency: high, reachability: high}
- "Any compensation range in mind? Totally fine to skip" (`intake.py:225-228`) → `budget_band` facet, verbatim, stated, importance `context` (`:280,241-242`). No currency parse, no coercion — "NHS AfC Band 5, £29,970–£36,483" is stored as my words. (Its journey *ends* at L1-HRBP-6's market layer, but the capture itself is right.)
- **code_check:** confirmed-present. **resolution:** — (keep).

### L1-HRBP-10 — strength — The paper trail: tenancy, throttle, atomicity, back-link
- **type:** strength (trust/audit) · **impact:** {frequency: high, reachability: high}
- Every `role_intakes` query workspace-scoped, point reads included (`db/intakes.ts:98,105,119,156,188,207`; colocated `intakes-tenancy.test.ts` exists); dialog writes are IMMEDIATE transactions (`:154-176`); the message route throttles per-IP 30/10min *after* cheap refusals and *before* spend, pinned by contract test (`rate-limit-contract.test.ts:119-128`); promotion stamps `jd_slug`/`job_id` so a job walks back to the conversation that defined it (`db/intakes.ts:196-211`), and `promotedBriefForJob` (`:183-194`) feeds downstream interview grounding. "I could hand this to an inspector" — the provenance chips plus the stored transcript plus the back-link are exactly the audit shape I mean.
- **code_check:** confirmed-present. **resolution:** — (keep).

## 5. Dialog-overlay checks (designed experience — L1 view)

| Check | Verdict | Evidence |
|---|---|---|
| One question per turn | pass (rule + deterministic script both single-question) | `intake.py:61`, `_Q` |
| Reflect before asking | encoded for LLM; deterministic path asks without reflecting — acceptable for a disclosed checklist | `:62-65` vs `:188-229` |
| Reuse the speaker's words | encoded (rule 3); deterministic stores verbatim | `:66-68`, `:245-281` |
| Park premature solutions | encoded (rule 5) — L2 must hear it live | `:72-74` |
| Name contradictions | encoded (rule 6) — L2 | `:75-76` |
| Close = grounded, correctable read-back | **half-fail keyless**: grounded yes, correctable no (L1-HRBP-4) | `:348-362,389-391` |
| Provenance honesty (stated never claimed for inferred) | pass for requirements/facets incl. merge guard (`:435-437,447-449`); **fail for scalars** (L1-HRBP-3) | `rolebrief.py:103-107` |
| Depth earned by ambiguity (shape) | mechanism present; clinical backfill idiom misses the fast path keyless (L1-HRBP-7) | `:151-174,308-313` |

## 6. Verdict — **L1-conditional**

The structure completes the job: Priya can reach the surface, hold a keyless guided dialog, watch a provenance-honest brief fill, and promote it into the real JD pipeline with an audit back-link. The persona constants encode the research rules essentially in full (grounding 9/10). But four majors stand between "completes" and "she'd adopt": the software-engineering `role_family` default that no path corrects (L1-HRBP-2), the unprovenance'd default seniority presented as captured (L1-HRBP-3), the keyless close that forecloses its own invited correction (L1-HRBP-4), and the no-opt-out wrong-market research on promote (L1-HRBP-6). None blocks the walkthrough; all are exactly the kind of thing she'd notice in the first session. L2-eligible; majors carry forward.

## 7. Time-saved estimate

- **Her baseline (manual, LLM-less):** shaping a clinical role with a head nurse — a meeting, notes, drafting the ad, one correction round — **~1.5–2.5 h** per role. (Her 8–12 h pipeline figure covers the whole hire; this journey is the intake/JD slice only.)
- **With this surface (keyless):** ~10 skippable questions ≈ 10–15 min + promote → draft JD. **Estimated saving ~45–90 min per role.**
- **Confidence: low-medium.** The saving is real for capture, but conditional: if the promoted JD arrives as a software-family, Czech-market document (L1-HRBP-2/6), the rework to make it clinic-sendable eats most of the margin — and by her own adoption line, wrong-currency comp "is worse than no number". Fix the family threading and the estimate firms to medium-high.

## 8. In her voice

"I'll say what surprised me first: I typed 'valid NMC registration' and it came back as a dealbreaker with a little chip that says *you said* — my words, graded as a hard prerequisite, on the record. That chip is the best thing in this product. That's a paper trail. And when your AI is switched off — which in my clinic it will be, permanently — the thing doesn't pretend: it says so, plainly, and the checklist still captures everything I type. I could hand that transcript to an inspector.

"Now the rest. I told it Band 5 and it wrote 'medior'. Nobody in my building knows what a medior is, and worse — it didn't ask, didn't flag it, just wore the default like it heard it from me. Everything else in this brief is scrupulous about *you said* versus *assumed*, and then the seniority line quietly lies. And somewhere underneath, my practice nurse is filed as a software engineer — I can't see it in the panel, but it rides into the job you build for me, along with a salary read from a Czech tech market I don't pay in. A koruna number on a Band 5 nursing ad is worse than no number; I'd have to unpick it before anyone saw it.

"And the ending — it read everything back, asked what it got wrong, and when I went to answer, the box was greyed out. Asking for a correction you can't receive is worse than not asking.

"The conversation itself? Honestly good. The questions are role-neutral, no commission-plan nonsense, the 90-days question works as well for 'runs the morning ward round' as for anything. The bones were built for everyone; the defaults were built for a software company. Fix the defaults — ask me the sector, let me set the band, take the correction — and this wasn't-built-for-a-clinic becomes was. I'd use it."
